from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select

from app.auth import (
    CurrentUser,
    SessionToken,
    drop_other_sessions,
    end_session,
    start_session,
)
from app.config import settings
from app.db import DbSession
from app.models import InviteCode, User
from app.ratelimit import invite_limiter, login_limiter
from app.schemas.auth import AuthStatusOut, ChangePasswordIn, LoginIn, RegisterIn, UserOut
from app.security import hash_password, normalize_invite_code, verify_password
from app.timeutil import utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _user_count(db: DbSession) -> int:
    return db.scalar(select(func.count(User.id))) or 0


def find_user(db: DbSession, username: str) -> User | None:
    """Case-insensitive for any alphabet. SQLite's lower() only folds ASCII, so «Мария» and
    «мария» would not match in SQL; with ≤20 users comparing in Python is fine."""
    key = username.strip().casefold()
    return next((u for u in db.scalars(select(User)) if u.username.casefold() == key), None)


@router.get("/status", response_model=AuthStatusOut)
def auth_status(db: DbSession) -> AuthStatusOut:
    count = _user_count(db)
    return AuthStatusOut(has_users=count > 0, registration_open=count < settings.max_users)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, request: Request, response: Response, db: DbSession) -> User:
    ip = _client_ip(request)
    if invite_limiter.is_blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток, подождите")

    count = _user_count(db)
    if count >= settings.max_users:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Регистрация закрыта: достигнут лимит {settings.max_users} пользователей",
        )

    invite: InviteCode | None = None
    if count > 0:
        code = normalize_invite_code(body.invite_code or "")
        invite = db.scalar(select(InviteCode).where(InviteCode.code == code)) if code else None
        if invite is None or not invite.is_usable(utcnow()):
            invite_limiter.fail(ip)
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неверный или недействующий код")

    if find_user(db, body.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Такое имя уже занято")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        # The very first account bootstraps the system and becomes admin.
        is_admin=count == 0,
        invite_code_id=invite.id if invite else None,
    )
    db.add(user)
    if invite:
        invite.used_count += 1
    db.flush()
    start_session(db, user, response)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> User:
    key = f"{_client_ip(request)}:{body.username.strip().lower()}"
    if login_limiter.is_blocked(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток, подождите")
    user = find_user(db, body.username)
    if user is None or not verify_password(user.password_hash, body.password):
        login_limiter.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверное имя или пароль")
    login_limiter.reset(key)
    start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, db: DbSession, token: SessionToken = None) -> Response:
    end_session(db, token, response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordIn, user: CurrentUser, db: DbSession, token: SessionToken = None
) -> None:
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль неверный")
    user.password_hash = hash_password(body.new_password)
    # Log out other devices, keep this one.
    drop_other_sessions(db, user, keep_token=token)
    db.commit()
