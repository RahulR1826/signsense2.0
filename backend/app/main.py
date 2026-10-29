import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, dataset, health, include_import, meetings, personal_signs, signaling
from app.core.config import settings
from app.core.database import SessionLocal
from app.services.meetings import close_dangling_participants


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        async with SessionLocal() as session:
            closed = await close_dangling_participants(session)
        if closed:
            logging.getLogger("signsense").info("marked %d participants from before the restart as left", closed)
    except OSError:  # database down: the health endpoint reports it; don't block startup
        pass
    yield


# Interactive API docs only outside production.
_docs = settings.environment != "production"
app = FastAPI(
    title="SignSense API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/auth") or request.url.path.startswith("/api/users"):
        response.headers["Cache-Control"] = "no-store"  # never cache account data
    return response


app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(meetings.router, prefix="/api")
app.include_router(personal_signs.router, prefix="/api")
if settings.enable_dev_tools:
    app.include_router(dataset.router, prefix="/api")
    app.include_router(include_import.router, prefix="/api")
app.include_router(signaling.router)
