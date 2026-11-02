import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class TemplateCreate(BaseModel):
    name: Name
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    category: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] = "General"
    definition: dict[str, Any] = Field(default_factory=dict)


class TemplateOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID | None
    name: str
    description: str | None
    category: str
    definition: dict[str, Any]
    is_system: bool
    created_at: datetime
    updated_at: datetime
