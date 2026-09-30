from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.auth import AdminUser, drop_other_sessions
from app.config import settings
from app.db import DbSession
from app.models import InviteCode, User
from app.schemas.auth import (
    AdminUserOut,
    AdminUserPatch,
    AdminUsersOut,
    InviteCreateIn,
    InviteOut,
    InvitePatch,
    TempPasswordOut,
)
from app.security import hash_password, new_invite_code, new_temp_password
from app.timeutil import utcnow

router = APIRouter(prefix="/admin", tags=["admin"])


def _get_user(db: DbSession, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    return user


def _admin_count(db: DbSession) -> int:
    return db.scalar(select(func.count(User.id)).where(User.is_admin)) or 0


# --- users ---


@router.get("/users", response_model=AdminUsersOut)
def list_users(_: AdminUser, db: DbSession) -> AdminUsersOut:
    users = db.scalars(select(User).order_by(User.created_at)).all()
    return AdminUsersOut(
        users=[AdminUserOut.model_validate(u) for u in users], max_users=settings.max_users
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(user_id: int, body: AdminUserPatch, _: AdminUser, db: DbSession) -> User:
    user = _get_user(db, user_id)
    if user.is_admin and not body.is_admin and _admin_count(db) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя снять права с последнего админа")
    user.is_admin = body.is_admin
    db.commit()
    return user


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(user_id: int, _: AdminUser, db: DbSession) -> TempPasswordOut:
    user = _get_user(db, user_id)
    password = new_temp_password()
    user.password_hash = hash_password(password)
    drop_other_sessions(db, user)
    db.commit()
    return TempPasswordOut(password=password)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, admin: AdminUser, db: DbSession) -> None:
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить самого себя")
    db.delete(user)
    db.commit()


# --- invite codes ---


def _invite_out(invite: InviteCode) -> InviteOut:
    out = InviteOut.model_validate(invite)
    out.usable = invite.is_usable(utcnow())
    return out


@router.get("/invites", response_model=list[InviteOut])
def list_invites(_: AdminUser, db: DbSession) -> list[InviteOut]:
    invites = db.scalars(select(InviteCode).order_by(InviteCode.created_at.desc())).all()
    return [_invite_out(i) for i in invites]


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(body: InviteCreateIn, admin: AdminUser, db: DbSession) -> InviteOut:
    code = new_invite_code()
    while db.scalar(select(InviteCode.id).where(InviteCode.code == code)):
        code = new_invite_code()
    invite = InviteCode(
        code=code,
        created_by_id=admin.id,
        max_uses=body.max_uses,
        expires_at=utcnow() + timedelta(days=body.expires_in_days)
        if body.expires_in_days
        else None,
    )
    db.add(invite)
    db.commit()
    return _invite_out(invite)


@router.patch("/invites/{invite_id}", response_model=InviteOut)
def update_invite(invite_id: int, body: InvitePatch, _: AdminUser, db: DbSession) -> InviteOut:
    invite = db.get(InviteCode, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Код не найден")
    invite.is_active = body.is_active
    db.commit()
    return _invite_out(invite)
