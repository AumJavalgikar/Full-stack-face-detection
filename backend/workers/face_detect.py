import asyncio
import json
import os
import subprocess
import tempfile
import urllib.request

import mediapipe as mp
import numpy as np
from sqlalchemy import update

from backend.db.models import Tasks
from backend.db.sessions import create_async_session
from backend.msg_queue.redis_client import RedisClient


class FaceDetector:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init_detector()
        return cls._instance

    def _init_detector(self):
        self._mp_face = mp.solutions.face_detection
        self._detector = self._mp_face.FaceDetection(model_selection=0)

    def detect_faces(self, frame):
        results = self._detector.process(frame)
        boxes = []

        if results.detections:
            h, w, _ = frame.shape
            for det in results.detections:
                bbox = det.location_data.relative_bounding_box
                boxes.append(
                    {
                        "x": int(bbox.xmin * w),
                        "y": int(bbox.ymin * h),
                        "w": int(bbox.width * w),
                        "h": int(bbox.height * h),
                    }
                )

        return boxes


class FeedWorker:
    def __init__(self):
        self.redis_client = RedisClient(db=1).get_async_client()
        self.face_detector = FaceDetector()

    @staticmethod
    async def stream_frames(video_path, width=640, height=480):
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-i", video_path,
            "-vf", f"scale={width}:{height}",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        frame_size = width * height * 3
        frame_id = 0
        
        async def read_exact(stream, size):
            buf = b""
            while len(buf) < size:
                chunk = await stream.read(size - len(buf))
                if not chunk:
                    return None
                buf += chunk
            return buf

        try:
            while True:
                raw = await read_exact(process.stdout, frame_size)
                if raw is None:
                    break

                frame = np.frombuffer(raw, np.uint8).reshape((height, width, 3))
                yield frame_id, frame
                frame_id += 1
        finally:
            if process.returncode is None:
                process.terminate()
                await process.wait()

    async def _store_roi_data(self, task_id, roi_data_json):
        Session = await create_async_session()
        async with Session() as session:
            stmt = (
                update(Tasks)
                .where(Tasks.id == task_id)
                .values(roi_data=roi_data_json, status="completed")
            )
            await session.execute(stmt)
            await session.commit()

    @staticmethod
    def _download_feed(feed_url):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tmp.close()
        urllib.request.urlretrieve(feed_url, tmp.name)
        return tmp.name

    async def _detect_frame(self, frame):
        return await asyncio.to_thread(self.face_detector.detect_faces, frame)

    async def process_feed(self, job_data):
        task_id = job_data["id"]
        feed_url = job_data["feed_url"]
        video_path = None

        try:
            video_path = await asyncio.to_thread(self._download_feed, feed_url)

            roi_payload = {
                "task_id": task_id,
                "feed_url": feed_url,
                "frames": [],
            }

            async for frame_id, frame in self.stream_frames(video_path):
                boxes = await self._detect_frame(frame)
                roi_payload["frames"].append(
                    {
                        "frame_id": frame_id,
                        "boxes": boxes,
                    }
                )

            roi_data_json = json.dumps(roi_payload)
            await self._store_roi_data(task_id, roi_data_json)
        finally:
            if video_path and os.path.exists(video_path):
                os.remove(video_path)

    async def run(self):
        while True:
            job = await self.redis_client.blpop("feed_tasks", timeout=1)
            if job is None:
                await asyncio.sleep(1)
                continue

            _, raw_payload = job
            job_data = json.loads(raw_payload)
            await self.process_feed(job_data)


async def main():
    worker = FeedWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
