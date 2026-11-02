from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo-root .env is shared by docker compose, the backend and the frontend.
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        if self.environment == "production":
            if "change-me" in self.jwt_secret:
                raise ValueError("JWT_SECRET must be set to a random value in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
            if len(self.internal_api_token) < 32:
                raise ValueError("INTERNAL_API_TOKEN must be a random value of 32+ characters in production")
            if self.simulator_enabled:
                raise ValueError("SIMULATOR_ENABLED must be false in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
