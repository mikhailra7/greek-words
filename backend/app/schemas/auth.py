from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=32, pattern=r"^[\w.\-]+$"),
]
Password = Annotated[str, StringConstraints(min_length=6, max_length=128)]


class RegisterIn(BaseModel):
    username: Username
    password: Password
    invite_code: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: Password


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_admin: bool


class AuthStatusOut(BaseModel):
    has_users: bool
    registration_open: bool


class AdminUserOut(UserOut):
    created_at: datetime
    last_login_at: datetime | None


class AdminUsersOut(BaseModel):
    users: list[AdminUserOut]
    max_users: int


class AdminUserPatch(BaseModel):
    is_admin: bool


class TempPasswordOut(BaseModel):
    password: str


class InviteCreateIn(BaseModel):
    max_uses: int | None = Field(default=None, ge=1, le=1000)
    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class InvitePatch(BaseModel):
    is_active: bool


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    max_uses: int | None
    used_count: int
    expires_at: datetime | None
    is_active: bool
    created_at: datetime
    usable: bool = False
