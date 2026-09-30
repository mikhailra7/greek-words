"""Session cookies and the CurrentUser / AdminUser dependencies."""

from datetime import timedelta
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select

from app.config import settings
from app.db import DbSession
from app.models import AuthSession, User
from app.security import hash_token, new_session_token
from app.timeutil import utcnow

SESSION_COOKIE = "greek_session"
SESSION_TTL = timedelta(days=30)
# An active user's session is extended once less than this much is left.
SESSION_RENEW_BEFORE = timedelta(days=15)


def start_session(db: DbSession, user: User, response: Response) -> None:
    token = new_session_token()
    now = utcnow()
    db.add(AuthSession(user_id=user.id, token_hash=hash_token(token), expires_at=now + SESSION_TTL))
    user.last_login_at = now
    db.commit()
    _set_cookie(response, token)


def end_session(db: DbSession, token: str | None, response: Response) -> None:
    if token:
        session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


def drop_other_sessions(db: DbSession, user: User, keep_token: str | None = None) -> None:
    keep_hash = hash_token(keep_token) if keep_token else None
    for s in list(user.sessions):
        if s.token_hash != keep_hash:
            db.delete(s)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.env != "dev",
        path="/",
    )


def get_current_user(
    db: DbSession,
    response: Response,
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужно войти")
    if not token:
        raise unauthorized
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    now = utcnow()
    if session is None or session.expires_at <= now:
        raise unauthorized
    if session.expires_at - now < SESSION_RENEW_BEFORE:
        session.expires_at = now + SESSION_TTL
        db.commit()
        _set_cookie(response, token)
    return session.user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]
