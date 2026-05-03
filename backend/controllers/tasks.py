import uuid
import json

from fastapi import UploadFile, HTTPException
from sqlalchemy import select
from backend.db.models import Tasks
from backend.db.schemas.tasks import SubmitFeedRequest
from backend.config import s3_bucket, s3_endpoint


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
        "url": task.video_feed,
        "status": task.status,
    }


async def fetch_feed_data(task_id, session):
    query = select(Tasks).where(Tasks.id == task_id, Tasks.state == "live")
    result = await session.execute(query)
    task = result.scalar_one_or_none()

    if task is None:
        return None

    return {
        "id": task.id,
        "url": task.video_feed,
        "video_feed": task.video_feed,
        "roi_data": task.roi_data,
        "status": task.status,
        "state": task.state,
    }


async def fetch_history(session):
    query = select(Tasks).where(Tasks.state == "live").order_by(Tasks.id.desc())
    result = await session.execute(query)
    tasks = result.scalars().all()

    return [
        {
            "id": task.id,
            "feed_url": task.video_feed,
            "video_feed": task.video_feed,
            "roi_data": task.roi_data,
            "status": task.status,
            "state": task.state,
        }
        for task in tasks
    ]


async def upload_feed(file: UploadFile, storage_client):
    
    if not s3_bucket:
        raise HTTPException(status_code=500, detail="S3_BUCKET is not set")
    
    key = f"feeds/{uuid.uuid4().hex}.mp4"
    
    content = await file.read()

    storage_client.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=content,
        ContentType=file.content_type or "video/mp4",
        ACL="public-read"
    )

    return {
        "url": f"{s3_endpoint}/{s3_bucket}/{key}",
    }
