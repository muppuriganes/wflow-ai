from fastapi import APIRouter

from app.api.v1 import (
    admin,
    analytics,
    auth,
    billing,
    channels,
    crm,
    health,
    inbox,
    integrations,
    internal,
    invitations,
    me,
    organizations,
    plans,
    roles,
    schedules,
    stream,
    templates,
    workflows,
)

api_router = APIRouter(prefix="/api/v1")
for module in (
    health,
    auth,
    me,
    organizations,
    plans,
    billing,
    integrations,
    admin,
    invitations,
    roles,
    channels,
    inbox,
    crm,
    workflows,
    schedules,
    templates,
    analytics,
    stream,
    internal,
):
    api_router.include_router(module.router)
api_router.include_router(workflows.hooks)
