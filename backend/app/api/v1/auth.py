import uuid
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status

from app.api.deps import DB, CurrentUser, auth_rate_limit
from app.core.config import get_settings
from app.schemas.auth import (
    ChangePasswordRequest,
    EmailRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionOut,
    TokenRequest,
    TokenResponse,
    UserOut,
)
from app.schemas.common import MessageResponse
from app.services import auth as auth_service
from app.services.auth import IssuedTokens

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "wflow_rt"
# The refresh token only ever travels to the auth endpoints, never to the rest of the API.
REFRESH_COOKIE_PATH = "/api/v1/auth"

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE)]


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


def _token_response(response: Response, tokens: IssuedTokens) -> TokenResponse:
    _set_refresh_cookie(response, tokens.refresh_token)
    return TokenResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        user=UserOut.model_validate(tokens.user),
    )


@router.post(
    "/register", status_code=status.HTTP_201_CREATED, dependencies=[Depends(auth_rate_limit("register"))]
)
async def register(data: RegisterRequest, db: DB, response: Response) -> TokenResponse:
    """Creates the user, their first organization (as owner) and signs them in.
    A verification email is sent; the account works while unverified."""
    return _token_response(response, await auth_service.register(db, data))


@router.post("/login", dependencies=[Depends(auth_rate_limit("login"))])
async def login(data: LoginRequest, db: DB, response: Response) -> TokenResponse:
    return _token_response(response, await auth_service.login(db, data.email, data.password))


@router.post("/refresh")
async def refresh(db: DB, response: Response, wflow_rt: RefreshCookie = None) -> TokenResponse:
    """Exchanges the refresh cookie for a new access token and rotates the refresh token."""
    return _token_response(response, await auth_service.refresh(db, wflow_rt))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(db: DB, response: Response, wflow_rt: RefreshCookie = None) -> None:
    await auth_service.logout(db, wflow_rt)
    _clear_refresh_cookie(response)


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(auth_rate_limit("forgot"))],
)
async def forgot_password(data: EmailRequest, db: DB) -> MessageResponse:
    await auth_service.request_password_reset(db, data.email)
    return MessageResponse(message="If an account exists for this email, a reset link has been sent.")


@router.post("/reset-password", dependencies=[Depends(auth_rate_limit("reset"))])
async def reset_password(data: ResetPasswordRequest, db: DB) -> MessageResponse:
    await auth_service.reset_password(db, data.token, data.password)
    return MessageResponse(message="Password updated. Please sign in with your new password.")


@router.post("/verify-email", dependencies=[Depends(auth_rate_limit("verify"))])
async def verify_email(data: TokenRequest, db: DB) -> UserOut:
    return UserOut.model_validate(await auth_service.verify_email(db, data.token))


@router.post(
    "/resend-verification",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(auth_rate_limit("resend"))],
)
async def resend_verification(db: DB, user: CurrentUser) -> MessageResponse:
    await auth_service.resend_verification(db, user)
    return MessageResponse(message="Verification email sent.")


@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest, db: DB, user: CurrentUser, wflow_rt: RefreshCookie = None
) -> MessageResponse:
    """Signs out every other session; the current one stays signed in."""
    current = await auth_service.family_of(db, wflow_rt)
    await auth_service.change_password(
        db,
        user,
        data.current_password,
        data.new_password,
        current_family=current.family_id if current and current.user_id == user.id else None,
    )
    return MessageResponse(message="Password changed.")


# Session management lives under /auth because only these paths receive the refresh cookie,
# which is how the current session is identified.


@router.get("/sessions")
async def list_sessions(db: DB, user: CurrentUser, wflow_rt: RefreshCookie = None) -> list[SessionOut]:
    current = await auth_service.family_of(db, wflow_rt)
    sessions = []
    for token in await auth_service.list_sessions(db, user):
        started = await auth_service.first_login_of_family(db, token.family_id)
        sessions.append(
            SessionOut(
                id=token.family_id,
                user_agent=token.user_agent,
                ip_address=token.ip_address,
                created_at=started or token.created_at,
                last_used_at=token.last_used_at or token.created_at,
                current=current is not None and current.family_id == token.family_id,
            )
        )
    return sessions


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(session_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    await auth_service.revoke_session(db, user, session_id)
