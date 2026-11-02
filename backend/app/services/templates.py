"""Workflow templates service: browse, preview, save custom, and instantiate into drafts."""

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PermissionDeniedError
from app.models import WorkflowTemplate
from app.schemas.templates import TemplateCreate, TemplateOut
from app.schemas.workflows import WorkflowOut
from app.services.audit import record_audit
from app.services.organizations import OrgContext
from app.services.realtime import publish


async def list_templates(
    db: AsyncSession,
    org_id: uuid.UUID,
    category: str | None = None,
) -> list[TemplateOut]:
    q = select(WorkflowTemplate).where(
        or_(
            WorkflowTemplate.is_system.is_(True),
            WorkflowTemplate.organization_id == org_id,
        )
    )
    if category:
        q = q.where(WorkflowTemplate.category == category)
    q = q.order_by(WorkflowTemplate.is_system.desc(), WorkflowTemplate.name.asc())
    rows = await db.scalars(q)
    return [_to_out(t) for t in rows.all()]


async def get_template(
    db: AsyncSession,
    org_id: uuid.UUID,
    template_id: uuid.UUID,
) -> TemplateOut:
    t = await db.get(WorkflowTemplate, template_id)
    if t is None or (not t.is_system and t.organization_id != org_id):
        raise NotFoundError("Template not found", code="template_not_found")
    return _to_out(t)


async def create_template(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: TemplateCreate,
) -> TemplateOut:
    t = WorkflowTemplate(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        category=data.category,
        definition=data.definition,
        is_system=False,
        created_by_user_id=user_id,
    )
    db.add(t)
    record_audit(
        db,
        "template.created",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="workflow_template",
        target_id=t.id,
        details={"name": t.name, "category": t.category},
    )
    await db.commit()
    await publish(org_id, "template.updated", template_id=t.id)
    return _to_out(t)


async def delete_template(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    template_id: uuid.UUID,
) -> None:
    t = await db.get(WorkflowTemplate, template_id)
    if t is None or (not t.is_system and t.organization_id != org_id):
        raise NotFoundError("Template not found", code="template_not_found")
    if t.is_system:
        raise PermissionDeniedError("Cannot delete system templates", code="system_template_immutable")

    record_audit(
        db,
        "template.deleted",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="workflow_template",
        target_id=t.id,
        details={"name": t.name},
    )
    await db.delete(t)
    await db.commit()
    await publish(org_id, "template.updated", template_id=template_id)


async def instantiate_template(
    db: AsyncSession,
    ctx: OrgContext,
    template_id: uuid.UUID,
) -> WorkflowOut:
    t = await db.get(WorkflowTemplate, template_id)
    if t is None or (not t.is_system and t.organization_id != ctx.org_id):
        raise NotFoundError("Template not found", code="template_not_found")

    from app.services.workflows import create_workflow

    return await create_workflow(
        db, ctx, name=f"{t.name} (from template)", description=t.description, definition=t.definition
    )


def _to_out(t: WorkflowTemplate) -> TemplateOut:
    return TemplateOut(
        id=t.id,
        organization_id=t.organization_id,
        name=t.name,
        description=t.description,
        category=t.category,
        definition=t.definition,
        is_system=t.is_system,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )
