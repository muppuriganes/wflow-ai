from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import register


@pytest.mark.asyncio
async def test_system_templates_seeded(client: AsyncClient) -> None:
    a = await register(client, "owner-tmpl@example.com")

    res = await client.get(
        f"/api/v1/organizations/{a.org_id}/workflow-templates",
        headers=a.headers,
    )
    assert res.status_code == 200, res.text
    templates = res.json()
    assert len(templates) >= 5

    names = {t["name"] for t in templates}
    assert "Keyword auto-reply" in names
    assert "Out-of-hours reply" in names
    assert "New-lead capture" in names
    assert "Approval for discounts" in names
    assert "Follow-up after no reply" in names

    # Filter by category
    cs_res = await client.get(
        f"/api/v1/organizations/{a.org_id}/workflow-templates?category=Customer Support",
        headers=a.headers,
    )
    assert cs_res.status_code == 200
    cs_items = cs_res.json()
    assert all(t["category"] == "Customer Support" for t in cs_items)
    assert len(cs_items) >= 2


@pytest.mark.asyncio
async def test_custom_template_and_isolation(client: AsyncClient, make_client: Any) -> None:
    a = await register(client, "owner-a-tmpl@example.com")

    # Create custom template for Org A
    create_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/workflow-templates",
        headers=a.headers,
        json={
            "name": "Acme Special Flow",
            "description": "Internal special automation",
            "category": "Operations",
            "definition": {"nodes": [], "edges": []},
        },
    )
    assert create_res.status_code == 201, create_res.text
    tmpl = create_res.json()
    assert tmpl["is_system"] is False
    assert tmpl["organization_id"] == a.org_id
    tmpl_id = tmpl["id"]

    # Org B registers
    client_b = make_client()
    b = await register(client_b, "owner-b-tmpl@example.com")

    # B can see system templates but NOT Org A's private template
    b_list = await client_b.get(
        f"/api/v1/organizations/{b.org_id}/workflow-templates",
        headers=b.headers,
    )
    assert b_list.status_code == 200
    b_ids = {t["id"] for t in b_list.json()}
    assert tmpl_id not in b_ids

    # B directly requesting A's template gets 404
    b_get = await client_b.get(
        f"/api/v1/organizations/{b.org_id}/workflow-templates/{tmpl_id}",
        headers=b.headers,
    )
    assert b_get.status_code == 404

    # B cannot delete A's template
    b_del = await client_b.delete(
        f"/api/v1/organizations/{b.org_id}/workflow-templates/{tmpl_id}",
        headers=b.headers,
    )
    assert b_del.status_code == 404

    # Org A can delete its own custom template
    a_del = await client.delete(
        f"/api/v1/organizations/{a.org_id}/workflow-templates/{tmpl_id}",
        headers=a.headers,
    )
    assert a_del.status_code == 204


@pytest.mark.asyncio
async def test_cannot_delete_system_template(client: AsyncClient) -> None:
    a = await register(client, "owner-sys-tmpl@example.com")
    res = await client.get(
        f"/api/v1/organizations/{a.org_id}/workflow-templates",
        headers=a.headers,
    )
    sys_tmpl = next(t for t in res.json() if t["is_system"])

    del_res = await client.delete(
        f"/api/v1/organizations/{a.org_id}/workflow-templates/{sys_tmpl['id']}",
        headers=a.headers,
    )
    assert del_res.status_code == 403


@pytest.mark.asyncio
async def test_instantiate_template(client: AsyncClient) -> None:
    a = await register(client, "owner-inst-tmpl@example.com")

    # Pick Keyword auto-reply template
    res = await client.get(
        f"/api/v1/organizations/{a.org_id}/workflow-templates",
        headers=a.headers,
    )
    tmpl = next(t for t in res.json() if t["name"] == "Keyword auto-reply")

    # Instantiate
    inst = await client.post(
        f"/api/v1/organizations/{a.org_id}/workflow-templates/{tmpl['id']}/instantiate",
        headers=a.headers,
    )
    assert inst.status_code == 201, inst.text
    wf = inst.json()
    assert wf["status"] == "draft"
    assert "Keyword auto-reply (from template)" in wf["name"]
    assert wf["definition"]["nodes"] == tmpl["definition"]["nodes"]
    assert wf["definition"]["nodes"][0]["data"]["nodeType"] == "trigger.message_received"

    # Verify it exists in Org A workflows
    wfs = await client.get(f"/api/v1/organizations/{a.org_id}/workflows", headers=a.headers)
    assert any(w["id"] == wf["id"] for w in wfs.json())
