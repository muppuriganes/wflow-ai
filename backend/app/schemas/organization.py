import uuid
from datetime import datetime
from typing import Annotated, Any, Literal
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, EmailStr, StringConstraints

from app.schemas.common import APIModel


def _check_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("Unknown IANA timezone")
    return value


Timezone = Annotated[str, AfterValidator(_check_timezone)]
OrgName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
RoleKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class RoleSummary(APIModel):
    id: uuid.UUID
    key: str
    name: str
    rank: int


Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]


class OrganizationRequest(BaseModel):
    """What a new organization tells the platform team when it asks to join."""

    business_type: Short | None = None
    phone: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)] | None = None
    website: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    team_size: Literal["1", "2-5", "6-20", "21-100", "100+"] | None = None
    country: Short | None = None
    use_case: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None


class OrganizationCreate(BaseModel):
    name: OrgName
    timezone: Timezone = "UTC"
    request: OrganizationRequest | None = None


class OrganizationUpdate(BaseModel):
    name: OrgName | None = None
    timezone: Timezone | None = None


class OrganizationOut(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    timezone: str
    created_at: datetime


class MyOrganizationOut(OrganizationOut):
    """An organization as seen by the current user, including their role and permissions."""

    role: RoleSummary
    permissions: list[str]
    status: str = "active"
    approval_status: str = "approved"
    rejection_reason: str | None = None
    billing_required: bool = False
    # Why the workspace is closed, if it is: pending | rejected | billing_required
    access_block: str | None = None
    support_session: bool = False
    support_access_until: datetime | None = None


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: RoleSummary
    status: str
    joined_at: datetime


class MemberUpdate(BaseModel):
    role_key: RoleKey


class InvitationCreate(BaseModel):
    email: EmailStr
    role_key: RoleKey


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: RoleSummary
    status: Literal["pending", "accepted", "revoked", "expired"]
    expires_at: datetime
    created_at: datetime


class InvitationPreview(BaseModel):
    organization_name: str
    email: str
    role_name: str
    status: Literal["pending", "accepted", "revoked", "expired"]


class PermissionOut(APIModel):
    code: str
    category: str
    description: str


class RoleOut(APIModel):
    id: uuid.UUID
    key: str
    name: str
    description: str
    rank: int
    is_system: bool
    permissions: list[str]


class AuditLogOut(APIModel):
    id: uuid.UUID
    action: str
    actor_user_id: uuid.UUID | None
    actor_email: str | None = None
    target_type: str | None
    target_id: str | None
    details: dict[str, Any]
    ip_address: str | None
    created_at: datetime
