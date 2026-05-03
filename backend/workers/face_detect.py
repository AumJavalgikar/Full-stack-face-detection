import asyncio
import json
import os
import subprocess
import tempfile
import traceback
from urllib.parse import urlparse

import mediapipe as mp
import numpy as np
from sqlalchemy import update

from backend.config import s3_bucket, s3_endpoint, s3_public_endpoint
from backend.db.models import Tasks
from backend.db.sessions import create_async_session
from backend.object_store.s3 import StorageClient
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

    @staticmethod
    def scale_boxes(boxes, scale_x, scale_y):
        return [
            {
                "x": int(box["x"] * scale_x),
                "y": int(box["y"] * scale_y),
                "w": int(box["w"] * scale_x),
                "h": int(box["h"] * scale_y),
            }
            for box in boxes
        ]


class FeedWorker:
    def __init__(self):
        self.redis_client = RedisClient(db=1).get_async_client()
        self.face_detector = FaceDetector()
        self.storage_client = StorageClient().get_client()

    @staticmethod
    async def stream_frames(video_path, width=640, height=480):
        try:
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
        except Exception as exc:
            print(f"[worker] Failed to start frame stream for {video_path}: {exc}", flush=True)
            traceback.print_exc()
            raise RuntimeError(f"Failed to start frame stream for {video_path}") from exc

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

    @staticmethod
    def _get_video_dimensions(video_path):
        try:
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "json",
                    video_path,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            data = json.loads(probe.stdout)
            stream = data["streams"][0]
            return int(stream["width"]), int(stream["height"])
        except Exception as exc:
            print(f"[worker] Failed to read video dimensions for {video_path}: {exc}", flush=True)
            traceback.print_exc()
            raise RuntimeError(f"Failed to read video dimensions for {video_path}") from exc

    async def _store_roi_data(self, task_id, roi_data_url):
        Session = await create_async_session()
        async with Session() as session:
            stmt = (
                update(Tasks)
                .where(Tasks.id == task_id)
                .values(roi_data=roi_data_url, status="completed")
            )
            await session.execute(stmt)
            await session.commit()

    async def _set_task_status(self, task_id, status):
        Session = await create_async_session()
        async with Session() as session:
            stmt = (
                update(Tasks)
                .where(Tasks.id == task_id)
                .values(status=status)
            )
            await session.execute(stmt)
            await session.commit()

    def _upload_roi_data(self, task_id, roi_payload):
        try:
            if not s3_bucket:
                raise RuntimeError("S3_BUCKET is not set")

            key = f"roi-data/task-{task_id}.json"
            body = json.dumps(roi_payload).encode("utf-8")

            self.storage_client.put_object(
                Bucket=s3_bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                ACL="public-read",
            )

            endpoint = (s3_public_endpoint or s3_endpoint or "").rstrip("/")
            return f"{endpoint}/{s3_bucket}/{key}"
        except Exception as exc:
            print(f"[worker] Failed to upload ROI data for task {task_id}: {exc}", flush=True)
            traceback.print_exc()
            raise RuntimeError(f"Failed to upload ROI data for task {task_id}") from exc

    def _download_feed(self, feed_url):
        if not s3_bucket:
            raise RuntimeError("S3_BUCKET is not set")

        parsed = urlparse(feed_url)
        path_parts = parsed.path.lstrip("/").split("/", 1)
        if len(path_parts) != 2:
            raise RuntimeError(f"Invalid S3 feed URL: {feed_url}")

        bucket_name, key = path_parts
        if bucket_name != s3_bucket:
            print(
                f"[worker] Feed URL bucket {bucket_name} does not match configured bucket {s3_bucket}",
                flush=True,
            )

        try:
            response = self.storage_client.get_object(Bucket=bucket_name, Key=key)
            body = response["Body"].read()

            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
            tmp.write(body)
            tmp.flush()
            tmp.close()
            return tmp.name
        except Exception as exc:
            print(f"[worker] Failed to fetch feed from S3 path {key}: {exc}", flush=True)
            traceback.print_exc()
            raise RuntimeError(f"Failed to fetch feed from S3 path {key}") from exc

    async def _detect_frame(self, frame):
        try:
            return await asyncio.to_thread(self.face_detector.detect_faces, frame)
        except Exception as exc:
            print(f"[worker] Failed to detect faces for a frame: {exc}", flush=True)
            traceback.print_exc()
            raise RuntimeError("Failed to detect faces for frame") from exc

    async def process_feed(self, job_data):
        task_id = job_data["id"]
        feed_url = job_data["feed_url"]
        video_path = None

        try:
            await self._set_task_status(task_id, "processing")
            video_path = await asyncio.to_thread(self._download_feed, feed_url)
            original_width, original_height = await asyncio.to_thread(
                self._get_video_dimensions, video_path
            )
            scale_x = original_width / 640
            scale_y = original_height / 480

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
                        "boxes": self.face_detector.scale_boxes(boxes, scale_x, scale_y),
                    }
                )

            roi_data_url = await asyncio.to_thread(self._upload_roi_data, task_id, roi_payload)
            await self._store_roi_data(task_id, roi_data_url)
        except Exception:
            print(f"[worker] Task {task_id} failed", flush=True)
            traceback.print_exc()
            await self._set_task_status(task_id, "failed")
            raise
        finally:
            if video_path and os.path.exists(video_path):
                os.remove(video_path)

    async def run(self):
        while True:
            try:
                job = await self.redis_client.blpop("feed_tasks", timeout=1)
                if job is None:
                    await asyncio.sleep(1)
                    continue

                _, raw_payload = job
                job_data = json.loads(raw_payload)
                await self.process_feed(job_data)
            except Exception:
                print("[worker] Worker loop error", flush=True)
                traceback.print_exc()
                await asyncio.sleep(1)


async def main():
    print("Starting face_detect worker..", flush=True)
    worker = FeedWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
