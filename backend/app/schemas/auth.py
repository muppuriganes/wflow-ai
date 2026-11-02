import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints

from app.schemas.common import APIModel
from app.schemas.organization import OrganizationRequest


def _check_password_strength(value: str) -> str:
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("Password must contain at least one letter and one number")
    return value


Password = Annotated[str, Field(min_length=10, max_length=128), AfterValidator(_check_password_strength)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
OrgName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: Password
    full_name: Name
    # Omitted when signing up through an invitation: the user joins that org instead.
    organization_name: OrgName | None = None
    # About the business: shown to the platform team reviewing the organization request.
    organization_request: OrganizationRequest | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class EmailRequest(BaseModel):
    email: EmailStr


class TokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ResetPasswordRequest(TokenRequest):
    password: Password


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: Password


class UpdateProfileRequest(BaseModel):
    full_name: Name


class UserOut(APIModel):
    id: uuid.UUID
    email: str
    full_name: str
    email_verified_at: datetime | None
    is_superadmin: bool
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class SessionOut(BaseModel):
    id: uuid.UUID  # the session family id
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    last_used_at: datetime | None
    current: bool
