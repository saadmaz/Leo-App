"""
Super-admin authentication dependency.

Any route under /admin/* should use `SuperAdminUser` as its user dependency
instead of the standard `CurrentUser`. It verifies the Firebase ID token AND
checks that the decoded claims include `superAdmin: true`.

Setting the claim (run once per admin account via Firebase Admin SDK):
    firebase_admin.auth.set_custom_user_claims(uid, {"superAdmin": True})

Or use the helper in firebase_service:
    from backend.services import firebase_service
    firebase_service.set_super_admin_claim(uid)
"""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.services import firebase_service

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=True)


async def get_current_super_admin(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> dict:
    """
    FastAPI dependency. Verifies the Firebase ID token and asserts the caller
    has the `superAdmin: true` custom claim.

    Raises:
        HTTP 401 - invalid or expired token
        HTTP 403 - valid token but not a super admin
    """
    token = credentials.credentials
    try:
        decoded = firebase_service.verify_token(token)
    except Exception as exc:
        logger.warning("Admin token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not decoded.get("superAdmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required.",
        )

    return decoded


# Convenient type alias - use in route signatures like `user: SuperAdminUser`
SuperAdminUser = Annotated[dict, Depends(get_current_super_admin)]
