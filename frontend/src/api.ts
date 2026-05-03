export interface ApiResponseTask {
  id: number;
  feed_url: string;
  video_feed: string;
  status: string;
  state: string;
  roi_data?: RoiData | string | null;
}

export interface RoiData {
  task_id: number;
  feed_url: string;
  frames: {
    frame_id: number;
    boxes: {
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
  }[];
}

export interface TaskStatusResponse {
  id: number;
  url: string;
  status: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * Fetches the task history from the backend API.
 * @returns Promise containing the list of tasks
 */
export const fetchHistory = async (): Promise<ApiResponseTask[]> => {
  const response = await fetch(`${API_BASE_URL}/tasks/history`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
};

/**
 * Uploads a raw video file to the server.
 * @returns Promise containing the uploaded video URL
 */
export const uploadVideo = async (file: File): Promise<{ url: string }> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/tasks/upload_feed`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return await response.json();
};

/**
 * Submits a new video feed for processing.
 */
export const submitFeed = async (url: string): Promise<ApiResponseTask> => {
  const response = await fetch(`${API_BASE_URL}/tasks/submit_feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error(`Submit failed: ${response.status}`);
  return await response.json();
};

/**
 * Polls for the status of a specific task.
 */
export const getTaskStatus = async (id: string): Promise<TaskStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/tasks/get_task_status?id=${id}`);
  if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
  return await response.json();
};

/**
 * Fetches the final result data for a completed task.
 * Handles cases where roi_data is a URL string pointing to a JSON file.
 */
export const getFeedData = async (id: string): Promise<ApiResponseTask> => {
  const response = await fetch(`${API_BASE_URL}/tasks/feed_data?id=${id}`);
  if (!response.ok) throw new Error(`Feed data fetch failed: ${response.status}`);
  const data: ApiResponseTask = await response.json();

  // If roi_data is a URL string, fetch the actual JSON content
  if (typeof data.roi_data === 'string' && data.roi_data.startsWith('http')) {
    try {
      const roiResponse = await fetch(data.roi_data);
      if (roiResponse.ok) {
        data.roi_data = await roiResponse.json();
      }
    } catch (err) {
      console.error("Failed to fetch external ROI JSON:", err);
    }
  }

  return data;
};