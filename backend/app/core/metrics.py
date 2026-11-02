"""Prometheus metrics registry and telemetry collectors for WFlow AI."""

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

# HTTP Metrics
HTTP_REQUESTS_TOTAL = Counter(
    "wflow_http_requests_total",
    "Total HTTP requests received",
    ["method", "path", "status"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "wflow_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

# Database Pool Metrics
DB_POOL_ACTIVE_CONNECTIONS = Gauge(
    "wflow_db_pool_active_connections",
    "Current active database connections checked out from the pool",
)

DB_POOL_SIZE = Gauge(
    "wflow_db_pool_size",
    "Current total connections allocated in the pool",
)

# Application & Workflow Metrics
WORKFLOW_RUNS_TOTAL = Counter(
    "wflow_workflow_runs_total",
    "Total workflow executions processed",
    ["status"],  # completed, failed, cancelled
)

WEBHOOK_DELIVERIES_TOTAL = Counter(
    "wflow_webhook_deliveries_total",
    "Total outgoing webhook delivery attempts",
    ["status"],  # success, failure
)

MESSAGES_TOTAL = Counter(
    "wflow_messages_total",
    "Total messages processed across channels",
    ["channel_type", "direction"],  # in, out
)

AUTH_FAILED_LOGINS_TOTAL = Counter(
    "wflow_auth_failed_logins_total",
    "Total failed login attempts",
)

AUTH_LOCKOUTS_TOTAL = Counter(
    "wflow_auth_lockouts_total",
    "Total account lockout events triggered by brute force detection",
)


def render_metrics() -> tuple[bytes, str]:
    """Generates the Prometheus metrics text format."""
    return generate_latest(), CONTENT_TYPE_LATEST
