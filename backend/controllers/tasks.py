import json

from sqlalchemy import select

from backend.db.models import Tasks
from backend.db.schemas.tasks import SubmitFeedRequest


async def submit_feed(payload: SubmitFeedRequest, session, redis_client):
    task = Tasks(
        video_feed=str(payload.url),
        roi_data=None,
        status="started",
        state="live",
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)

    task_data = {
        "id": task.id,
        "feed_url": task.video_feed,
        "video_feed": task.video_feed,
        "roi_data": task.roi_data,
        "status": task.status,
        "state": task.state,
    }
    redis_client.rpush("feed_tasks", json.dumps(task_data))

    return task_data


async def fetch_task(task_id, session):
    query = select(Tasks).where(Tasks.id == task_id, Tasks.state == "live")
    result = await session.execute(query)
    task = result.scalar_one_or_none()

    if task is None:
        return None

    return {
        "id": task.id,
        "feed_url": task.video_feed,
        "video_feed": task.video_feed,
        "roi_data": task.roi_data,
        "status": task.status,
        "state": task.state,
    }
