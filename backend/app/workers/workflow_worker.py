"""Runs workflow executions (Temporal worker).

uv run python -m app.workers.workflow_worker
"""

import asyncio

from temporalio.client import Client
from temporalio.worker import Worker

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.workflow_engine.activities import ALL_ACTIVITIES
from app.workflow_engine.workflow import GraphWorkflow

log = get_logger("worker.workflows")


def build_worker(client: Client, task_queue: str) -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[GraphWorkflow],
        activities=ALL_ACTIVITIES,
        max_concurrent_activities=50,
    )


async def main() -> None:
    settings = get_settings()
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    log.info("workflow_worker_started", task_queue=settings.temporal_task_queue)
    await build_worker(client, settings.temporal_task_queue).run()


if __name__ == "__main__":
    configure_logging(get_settings().log_level, json=get_settings().environment == "production")
    asyncio.run(main())
