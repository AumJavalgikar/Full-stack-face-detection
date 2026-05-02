from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import tasks


def create_app() -> FastAPI:
    app = FastAPI()

    app.include_router(tasks.router)

    origins = [
        "http://localhost:3000",
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
