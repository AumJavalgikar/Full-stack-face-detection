from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.db.models import Tasks  # noqa: F401
from backend.db.sessions import Base, async_engine
from backend.routers import tasks


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield

    app = FastAPI(lifespan=lifespan)

    app.include_router(tasks.router)

    origins = [
        "http://localhost:5173",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> str:
        return "ok"

    return app
