from fastapi import APIRouter

from app.api.v1 import (
    auth,
    channels,
    crm,
    health,
    inbox,
    internal,
    invitations,
    me,
    organizations,
    roles,
    stream,
)

api_router = APIRouter(prefix="/api/v1")
for module in (health, auth, me, organizations, invitations, roles, channels, inbox, crm, stream, internal):
    api_router.include_router(module.router)
