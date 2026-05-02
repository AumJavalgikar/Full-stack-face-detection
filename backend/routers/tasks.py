from fastapi import APIRouter, Depends

from backend.controllers.tasks import submit_feed
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
 
