import uuid

from fastapi import APIRouter, status

from app.api.deps import DB, OrgCtx
from app.schemas.templates import TemplateCreate, TemplateOut
from app.schemas.workflows import WorkflowOut
from app.services import templates as svc

router = APIRouter(prefix="/organizations/{org_id}/workflow-templates", tags=["templates"])


@router.get("")
async def list_templates(db: DB, ctx: OrgCtx, category: str | None = None) -> list[TemplateOut]:
    ctx.require("templates.read")
    return await svc.list_templates(db, ctx.org_id, category)


@router.get("/{template_id}")
async def get_template(template_id: uuid.UUID, db: DB, ctx: OrgCtx) -> TemplateOut:
    ctx.require("templates.read")
    return await svc.get_template(db, ctx.org_id, template_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(data: TemplateCreate, db: DB, ctx: OrgCtx) -> TemplateOut:
    ctx.require("templates.manage")
    return await svc.create_template(db, ctx.org_id, ctx.user_id, data)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    ctx.require("templates.manage")
    await svc.delete_template(db, ctx.org_id, ctx.user_id, template_id)


@router.post("/{template_id}/instantiate", status_code=status.HTTP_201_CREATED)
async def instantiate_template(template_id: uuid.UUID, db: DB, ctx: OrgCtx) -> WorkflowOut:
    ctx.require("workflows.manage")
    return await svc.instantiate_template(db, ctx, template_id)
