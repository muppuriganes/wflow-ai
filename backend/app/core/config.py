from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo-root .env is shared by docker compose, the backend and the frontend.
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


DEFAULT_CREDENTIALS_KEY = "wflow-credentials-encryption-key-32b!"
DEFAULT_STRIPE_WEBHOOK_SECRET = "whsec_mock_wflow"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ROOT_ENV, extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "WFlow AI"
    log_level: str = "INFO"

    database_url: str
    database_admin_url: str
    redis_url: str = "redis://127.0.0.1:56379/0"

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    email_verification_ttl_hours: int = 48
    password_reset_ttl_minutes: int = 60
    invitation_ttl_days: int = 7

    cookie_secure: bool = False
    frontend_url: str = "http://localhost:5180"
    # Public base URL of this API (used for webhook links shown to users).
    public_api_url: str = "http://localhost:8100"
    cors_origins: str = "http://localhost:5180"

    smtp_host: str = "127.0.0.1"
    smtp_port: int = 51025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    smtp_local_hostname: str = "wflow.local"
    email_from: str = "WFlow AI <no-reply@wflow.local>"

    # Requests per window for unauthenticated auth endpoints, keyed by client IP.
    auth_rate_limit: int = 20
    auth_rate_window_seconds: int = 60

    max_organizations_per_user: int = 10

    # --- Channels / messaging gateway ---
    gateway_url: str = "http://127.0.0.1:8200"
    # Shared secret for backend <-> gateway calls (both directions). Never exposed to browsers.
    internal_api_token: str = Field(default="", min_length=0)
    max_connections_per_org: int = 3
    # Conservative outbound cap per connection; protects customers' numbers and recipients.
    channel_send_limit_per_minute: int = 20
    # The simulator channel is for development and demos; disabled in production.
    simulator_enabled: bool = True
    channel_event_stream: str = "wflow:channel-events"

    # --- Workflow engine (Temporal) ---
    temporal_address: str = "127.0.0.1:57233"
    temporal_namespace: str = "wflow"
    temporal_task_queue: str = "wflow-workflows"
    # Multiplier for delays, reply/approval timeouts and retry back-off. Tests use a tiny value so
    # an hour-long delay takes about a second; production refuses anything but 1.
    workflow_time_scale: float = 1.0

    # --- Commercial platform & Integrations (M6) ---
    # New organizations wait for a Super Admin's approval before they can be used.
    org_approval_required: bool = True
    # Development only: lets webhooks and HTTP steps call services on this machine or LAN.
    outbound_allow_private_networks: bool = False
    credentials_encryption_key: str = DEFAULT_CREDENTIALS_KEY
    stripe_secret_key: str = "sk_test_mock_wflow"
    stripe_webhook_secret: str = DEFAULT_STRIPE_WEBHOOK_SECRET
    billing_test_mode: bool = True

    # --- Object storage (MinIO locally, any S3-compatible service in production) ---
    s3_endpoint_url: str = "http://127.0.0.1:59000"
    # Host browsers use for signed download links (defaults to s3_endpoint_url).
    s3_public_endpoint_url: str = ""
    s3_bucket: str = "wflow-files"
    s3_region: str = "us-east-1"
    # A bucket-scoped key in production; locally, blank means "use the MinIO root login".
    s3_access_key: str = ""
    s3_secret_key: str = ""
    minio_root_user: str = ""
    minio_root_password: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        # An empty S3_ACCESS_KEY= line in .env must fall back, not connect with blank credentials.
        self.s3_access_key = self.s3_access_key or self.minio_root_user
        self.s3_secret_key = self.s3_secret_key or self.minio_root_password
        if self.environment == "production":
            if "change-me" in self.jwt_secret:
                raise ValueError("JWT_SECRET must be set to a random value in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
            if len(self.internal_api_token) < 32:
                raise ValueError("INTERNAL_API_TOKEN must be a random value of 32+ characters in production")
            if self.simulator_enabled:
                raise ValueError("SIMULATOR_ENABLED must be false in production")
            if self.workflow_time_scale != 1.0:
                raise ValueError("WORKFLOW_TIME_SCALE must be 1 in production")
            # The defaults below are public (they are in the repository): anyone could decrypt stored
            # credentials or forge billing webhooks with them.
            if (
                self.credentials_encryption_key == DEFAULT_CREDENTIALS_KEY
                or len(self.credentials_encryption_key) < 32
            ):
                raise ValueError(
                    "CREDENTIALS_ENCRYPTION_KEY must be a random value of 32+ characters in production"
                )
            if self.outbound_allow_private_networks:
                raise ValueError("OUTBOUND_ALLOW_PRIVATE_NETWORKS must be false in production")
            if self.billing_test_mode:
                raise ValueError(
                    "BILLING_TEST_MODE must be false in production (test checkouts need no payment)"
                )
            if self.stripe_webhook_secret in ("", DEFAULT_STRIPE_WEBHOOK_SECRET):
                raise ValueError(
                    "STRIPE_WEBHOOK_SECRET must be the real webhook signing secret in production"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
