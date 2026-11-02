from fastapi import APIRouter, Depends

from app.api.deps import DB, CurrentUser, auth_rate_limit
from app.schemas.auth import TokenRequest
from app.schemas.organization import InvitationPreview, OrganizationOut
from app.services import organizations as org_service

router = APIRouter(prefix="/invitations", tags=["invitations"])


@router.post("/preview", dependencies=[Depends(auth_rate_limit("invite_preview"))])
async def preview_invitation(data: TokenRequest, db: DB) -> InvitationPreview:
    """Public: lets the invite page show who invited you before you sign in or sign up.
    POST (not GET) keeps the token out of URLs and access logs."""
    invitation, org = await org_service.preview_invitation(db, data.token)
    return InvitationPreview(
        organization_name=org.name,
        email=invitation.email,
        role_name=invitation.role.name,
        status=org_service.invitation_status(invitation),  # type: ignore[arg-type]
    )


@router.post("/accept")
async def accept_invitation(data: TokenRequest, db: DB, user: CurrentUser) -> OrganizationOut:
    return OrganizationOut.model_validate(await org_service.accept_invitation(db, user, data.token))
