from fastapi import APIRouter

from app.api.v1 import auth, channels, health, internal, invitations, me, organizations, roles

api_router = APIRouter(prefix="/api/v1")
for module in (health, auth, me, organizations, invitations, roles, channels, internal):
    api_router.include_router(module.router)
