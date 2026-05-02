from fastapi import APIRouter, Depends, HTTPException

from backend.controllers.tasks import fetch_history, fetch_task, submit_feed
from backend.db.schemas.tasks import SubmitFeedRequest
from backend.db.sessions import get_async_session
from backend.msg_queue.redis_client import RedisClient

router = APIRouter(prefix="/tasks", tags=["tasks"])


def get_redis_client():
    return RedisClient(db=1).get_client()


@router.post("/submit_feed")
async def submit_feed_endpoint(
    payload: SubmitFeedRequest,
    session=Depends(get_async_session),
    redis_client=Depends(get_redis_client),
):
    return await submit_feed(payload, session, redis_client)


@router.get("/get_task_status")
async def get_task_status_endpoint(
    id: int,
    session=Depends(get_async_session),
):
    task = await fetch_task(id, session)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/history")
async def history_endpoint(
    session=Depends(get_async_session),
):
    return await fetch_history(session)
