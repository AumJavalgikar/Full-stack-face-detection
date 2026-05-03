# Problem statement:

Design and create a containerized backend API to accept a video feed on an endpoint, process the video feed to detect a face, store import regions of interest in a database, draw a rectangle around that face (specifically, an axis-aligned minimal bounding box, henceforth referred to as “ROI”) without using the OpenCV python library, and return the feed and the corresponding ROI data to the frontend.

## Stack:

Backend: fastapi, redis, mysql, minio (object store), docker

Frontend: react.js

# Summary

I started by scoping out the requirements (functional and non-functional) and creating a high-level system design as outlined in docs/design.png.

I decided to use FastAPI as the server framework for its quick setup, Redis for an asynchronous task execution system, and MySQL as the database. I chose to focus on the core functionality and the more interesting parts of the system, and skipped JWT auth/user sessions since these are well-solved problems.

I used MinIO as a local object store to emulate S3. A local object store is required to store the uploaded MP4 files and ROI data as JSON files. In the database, I store only URLs that point to these objects, as storing them as blobs or plain text is not optimal.

I then worked on the backend using a cleanly modularized FastAPI template. I implemented all APIs as defined during the design phase. I also wrote a worker that asynchronously picks up tasks from Redis, processes them, and updates the status in the database.

After that, I built a React frontend to consume the API. It supports uploading MP4 files, polling task status, showing history, and rendering ROI overlays for completed tasks. I used AI tools for the frontend, specifically https://www.getbezier.com/
 for UI generation and Codex for functionality.

Once the backend and frontend were complete, I added Dockerfiles and a docker-compose setup for quick, one-command local deployment.

# Data flow
The frontend fetches task history. If there are any processing tasks, it begins polling.

A user can create a new task. The frontend lets the user pick an MP4 file, then calls the upload_file endpoint, which returns the file URL. The frontend then passes this URL to the POST /submit_feed endpoint.

This creates a new row in the tasks table with status "started", null ROI data, and the feed URL set to the MP4 URL. A new JSON payload is also added to the "feed_tasks" list in Redis (db1), and the row data is returned to the frontend.

The frontend then polls get_task_status for that task ID.

A background worker picks up the task JSON from Redis, downloads the MP4, and begins processing it. After processing is completed, the ROI data (if any) is uploaded to the object store, and the URL is stored in the database along with the appropriate status (completed or failed).

Once the frontend polling detects that the task is completed, it loads the MP4 and ROI data, and renders the bounding boxes on the video accordingly.

### Interesting points

Initially, I stored ROI data as stringified JSON in the database. However, this started failing for larger MP4 files, as even the LONGTEXT data type could not handle the size. I then moved ROI data to JSON files in the object store and stored only the URL in the database.

Due to the atomic properties of redis, we never have to worry about a race condition between multiple workers picking up the same task.

## Running guide

It is highly recommended to use Docker to run the application.

Command:

`docker compose up --build`

To run multiple workers:

`docker compose up --scale worker=3`

Once you see

```
backend       | INFO:     Started server process [1]
backend       | INFO:     Waiting for application startup.
backend       | INFO:     Application startup complete.
backend       | INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

the services are up, open the frontend at:

`http://localhost:5173/`

Note:

> If you face error, "Port already in use", Run below command, in case the output is not empty, you already have a process running on some of these ports and need to kill that process.

`lsof -i :3307 -i :6379 -i :9000 -i :9001 -i :8000 -i :5173`

## Future work:

- JWT auth / user sessions
- Avoid using a public bucket
- Use Celery for task processing
- Add a cron job to clean up stray tasks
- Add proper logging
- Use WebSockets/SSE instead of polling
- Add indexes to fetch tasks by status
- Add queue position for started videos
- Support other file formats
- Production nginx/docker setup