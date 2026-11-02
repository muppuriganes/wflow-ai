from fastapi import APIRouter

from app.api.v1 import auth, health, invitations, me, organizations, roles

api_router = APIRouter(prefix="/api/v1")
for module in (health, auth, me, organizations, invitations, roles):
    api_router.include_router(module.router)
