"""FastAPI app factory: healthz, startup fail-closed check, and the
validation-error handler that never echoes a submitted field value
(spec AC11 — FastAPI's default handler echoes Pydantic's `input`)."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.analytics.router import router as analytics_router
from app.auth.router import router as auth_router
from app.core.config import settings
from app.db.session import check_db_connection
from app.tasks.router import router as tasks_router

# Fail closed before the app object even exists — see AC19.
settings.fail_closed_on_missing_secrets()

app = FastAPI(title="FocusFlow internal API")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Never echoes a submitted value — only field path + message.

    FastAPI's default handler returns Pydantic v2's raw error list, which
    includes an `input` key holding the offending value. For a password
    field that's a plaintext leak straight into a 422 response (AC11).
    """
    messages = "; ".join(
        f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()
    )
    return JSONResponse(status_code=422, content={"detail": messages})


@app.get("/healthz")
async def healthz() -> JSONResponse:
    if await check_db_connection():
        return JSONResponse(status_code=200, content={"status": "ok"})
    return JSONResponse(status_code=503, content={"detail": "database unreachable"})


app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(analytics_router)
