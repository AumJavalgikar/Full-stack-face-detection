import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  History, 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ChevronRight, 
  FileVideo,
} from 'lucide-react';
import { fetchHistory, submitFeed, getTaskStatus, getFeedData, uploadVideo } from '../api';
import type { RoiData } from '../api';
// --- Types ---

type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'started';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
  frameId?: number;
}

interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  timestamp: string;
  videoUrl?: string;
  results?: BoundingBox[];
  progress: number;
  roiData?: RoiData;
  roiError?: boolean;
}

// --- Mock Data ---

const MOCK_TASKS: Task[] = [
  {
    id: 'task-1',
    name: 'Security_Cam_Entrance.mp4',
    status: 'completed',
    timestamp: '2024-03-20 14:30',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-people-walking-in-a-modern-city-4444-large.mp4',
    results: [
      { x: 100, y: 150, width: 80, height: 80, label: 'Face 1', confidence: 0.98 },
      { x: 300, y: 200, width: 70, height: 70, label: 'Face 2', confidence: 0.92 },
    ],
    progress: 100,
  },
  {
    id: 'task-2',
    name: 'Interview_Session_01.mov',
    status: 'processing',
    timestamp: '2024-03-20 15:12',
    progress: 65,
  },
  {
    id: 'task-3',
    name: 'Crowd_Analysis_Test.mp4',
    status: 'pending',
    timestamp: '2024-03-20 15:45',
    progress: 0,
  }
];

export default function FaceDetectionPage() {
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(MOCK_TASKS[0]?.id ?? null);
  const [isUploading, setIsUploading] = useState(false);

  // --- API Fetching ---
  const loadHistory = async () => {
    try {
      const data = await fetchHistory();
      
      const mappedTasks: Task[] = data.map(item => ({
        id: item.id.toString(),
        name: item.feed_url.split('/').pop() || `Task ${item.id}`,
        status: item.status as TaskStatus,
        timestamp: new Date().toLocaleString(),
        videoUrl: item.video_feed,
        progress: item.status === 'completed' ? 100 : item.status === 'failed' ? 0 : 10,
        roiError: false,
      }));

      setTasks(mappedTasks);
      if (mappedTasks.length > 0 && !activeTaskId) {
        setActiveTaskId(mappedTasks[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);
  
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Lazy Load ROI Data on Selection ---
  useEffect(() => {
    const fetchRoiForActiveTask = async () => {
      if (!activeTaskId) return;
      const task = tasks.find(t => t.id === activeTaskId);
      
      // Only fetch if it's completed and doesn't have results yet
      if (task?.status === 'completed' && !task.results) {
        try {
          const finalData = await getFeedData(task.id);
          const roi = finalData.roi_data as RoiData | undefined;
          const results = roi?.frames.flatMap(f => 
            f.boxes.map(b => ({
              x: b.x, y: b.y, width: b.w, height: b.h, label: 'Face', confidence: 1.0, frameId: f.frame_id
            }))
          ) ?? [];

          setTasks(prev => prev.map(t => t.id === task.id ? {
            ...t,
            roiData: roi,
            roiError: !roi,
            results,
          } : t));
        } catch (err) {
          console.error("Failed to lazy load ROI data:", err);
          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, roiError: true, results: [] } : t));
        }
      }
    };

    fetchRoiForActiveTask();
  }, [activeTaskId]);

  // --- Real Polling Logic ---
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      const processingTasks = tasks.filter(t => t.status === 'started' || t.status === 'processing');
      
      for (const task of processingTasks) {
        try {
          const statusRes = await getTaskStatus(task.id);
          if (statusRes.status === 'completed') {
            const finalData = await getFeedData(task.id);
            const roi = finalData.roi_data as RoiData | undefined;
            const results = roi?.frames.flatMap(f => 
              f.boxes.map(b => ({
                x: b.x, y: b.y, width: b.w, height: b.h, label: 'Face', confidence: 1.0, frameId: f.frame_id
              }))
            ) ?? [];

            setTasks(prev => prev.map(t => t.id === task.id ? {
              ...t,
              status: 'completed',
              progress: 100,
              videoUrl: finalData.video_feed,
              roiData: roi,
              roiError: !roi,
              results,
            } : t));
          }
        } catch (err) {
          console.error("Polling error for task", task.id, err);
        }
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [tasks]);

  // --- Canvas Drawing ---
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !activeTask?.results) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawBoxes = () => {
      if (!video || !canvas) return;
      
      // 1. Match canvas size to the actual video element display size
      const displayWidth = video.clientWidth;
      const displayHeight = video.clientHeight;
      
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 2. Calculate scaling factors between raw video resolution and display size
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestAnimationFrame(drawBoxes);
        return;
      }

      // 3. Calculate offsets if the video is centered (object-fit: contain behavior)
      const videoRatio = video.videoWidth / video.videoHeight;
      const displayRatio = displayWidth / displayHeight;
      
      let offsetX = 0;
      let offsetY = 0;
      let actualVideoWidth = displayWidth;
      let actualVideoHeight = displayHeight;

      if (displayRatio > videoRatio) {
        actualVideoWidth = displayHeight * videoRatio;
        offsetX = (displayWidth - actualVideoWidth) / 2;
      } else {
        actualVideoHeight = displayWidth / videoRatio;
        offsetY = (displayHeight - actualVideoHeight) / 2;
      }

      const finalScaleX = actualVideoWidth / video.videoWidth;
      const finalScaleY = actualVideoHeight / video.videoHeight;

      // Calculate current frame
      const currentFrame = Math.floor(video.currentTime * 30);
      
      const visibleBoxes = activeTask.results?.filter(box => 
        box.frameId === undefined || box.frameId === currentFrame
      ) || [];

      visibleBoxes.forEach(box => {
        // Apply scaling and offsets to the raw coordinates
        const drawX = (box.x * finalScaleX) + offsetX;
        const drawY = (box.y * finalScaleY) + offsetY;
        const drawW = box.width * finalScaleX;
        const drawH = box.height * finalScaleY;

        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.strokeRect(drawX, drawY, drawW, drawH);
        
        ctx.fillStyle = '#2563eb';
        ctx.font = '12px Roboto Mono';
        ctx.fillText(`${box.label}`, drawX, drawY - 5);
      });

      requestAnimationFrame(drawBoxes);
    };

    // 4. Start the loop immediately and handle resize
    const animationId = requestAnimationFrame(drawBoxes);
    
    const resizeObserver = new ResizeObserver(() => {
      // Force canvas sync on resize
      if (video && canvas) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
    });

    resizeObserver.observe(video);
    
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
    };
  }, [activeTaskId, activeTask?.results]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      // 1. Upload the actual file to get the storage URL
      const uploadResponse = await uploadVideo(files[0]);
      const videoUrl = uploadResponse.url;
      
      // 2. Submit the task with the returned URL
      const response = await submitFeed(videoUrl);
      
      const newTask: Task = {
        id: response.id.toString(),
        name: response.feed_url.split('/').pop() || `Task ${response.id}`,
        status: 'started',
        timestamp: new Date().toLocaleString(),
        progress: 0,
        videoUrl: response.video_feed
      };

      setTasks(prev => [newTask, ...prev]);
      setActiveTaskId(newTask.id);
    } catch (error) {
      console.error("Failed to submit task:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="flex h-full bg-white font-sans text-[#111827]"
      data-uid='div-eb265209'>
      {/* --- Left Sidebar: History --- */}
      <aside
        className="w-72 border-r border-[#e5e7eb] flex flex-col bg-[#f9fafb]"
        data-uid='aside-92dc3e95'>
        <div
          className="p-5 border-b border-[#e5e7eb] flex items-center justify-between"
          data-uid='div-28dca59e'>
          <div className="flex items-center gap-2" data-uid='div-40f081eb'>
            <History size={18} className="text-[#6b7280]" data-uid='history-99c3feaf' />
            <h2
              className="font-semibold text-sm uppercase tracking-wider text-[#6b7280]"
              data-uid='h2-99793799'>History</h2>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto" data-uid='div-13ef0496'>
          {tasks.map(task => (
            <button
              key={task.id}
              onClick={() => setActiveTaskId(task.id)}
              className={`w-full text-left p-4 border-b border-[#e5e7eb] transition-all hover:bg-white group ${
                activeTaskId === task.id ? 'bg-white ring-1 ring-inset ring-[#e5e7eb] z-10' : ''
              }`}
              data-uid='button-fa336ccb'>
              <div className="flex items-start justify-between mb-1" data-uid='div-57e1bf26'>
                <span className="text-xs font-mono text-[#6b7280]" data-uid='span-9c532f17'>{task.timestamp}</span>
                <StatusBadge status={task.status} data-uid='statusbadge-7ccc35b7' />
              </div>
              <h3 className="text-sm font-medium truncate pr-4" data-uid='h3-00eb18bb'>{task.name}</h3>
              {(task.status === 'started' || task.status === 'processing') && (
                <div
                  className="mt-2 w-full bg-[#f3f4f6] h-1 rounded-full overflow-hidden"
                  data-uid='div-c063eabe'>
                  <div
                    className="bg-[#000000] h-full transition-all duration-500"
                    style={{ width: `${task.progress}%` }}
                    data-uid='div-962f248b' />
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-[#e5e7eb]" data-uid='div-aefef788'>
          <label
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#000000] text-white rounded-lg cursor-pointer hover:bg-[#1a1a1a] transition-colors font-medium text-sm"
            data-uid='label-42fb5330'>
            <Upload size={16} data-uid='upload-47585507' />
            <span data-uid='span-8919469a'>New Task</span>
            <input
              type="file"
              multiple
              accept="video/*"
              className="hidden"
              onChange={handleFileUpload}
              data-uid='input-73105824' />
          </label>
        </div>
      </aside>
      {/* --- Main Content: Active Task --- */}
      <main className="flex-1 flex flex-col min-w-0" data-uid='main-65ea21ee'>
        {/* Header / Breadcrumbs */}
        <header
          className="h-16 border-b border-[#e5e7eb] flex items-center px-6 justify-between bg-white"
          data-uid='header-2245d2ba'>
          <div className="flex items-center gap-2 text-sm" data-uid='div-39b50721'>
            <span className="text-[#6b7280]" data-uid='span-1570cebe'>Tasks</span>
            <ChevronRight size={14} className="text-[#e5e7eb]" data-uid='chevronright-8f46d14d' />
            <span className="font-medium" data-uid='span-174ac6ae'>{activeTask?.name || 'Select a task'}</span>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex" data-uid='div-c3c2190d'>
          {/* Video Canvas Area */}
          <div className="flex-1 bg-[#f3f4f6] p-8 flex flex-col" data-uid='div-c76ca919'>
            <div
              className="flex-1 relative bg-black rounded-xl overflow-hidden shadow-sm border border-[#e5e7eb] flex items-center justify-center"
              data-uid='div-58b32100'>
              {activeTask?.status === 'completed' && activeTask.videoUrl ? (
                <div
                  className="relative w-full h-full flex items-center justify-center"
                  data-uid='div-76a93d3b'>
                  <video
                    ref={videoRef}
                    src={activeTask.videoUrl}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    muted
                    loop
                    data-uid='video-43851876' />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    data-uid='canvas-d1e67d88' />
                </div>
              ) : (
                <div className="text-center space-y-4" data-uid='div-ce8ada8c'>
                  <div
                    className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto"
                    data-uid='div-7e4a5fa4'>
                    {activeTask?.status === 'processing' || activeTask?.status === 'started' ? (
                      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" data-uid='loader-spinner' />
                    ) : activeTask?.status === 'failed' ? (
                      <AlertCircle className="text-white/40" size={32} data-uid='filevideo-failed' />
                    ) : (
                      <FileVideo className="text-white/40" size={32} data-uid='filevideo-e343447c' />
                    )}
                  </div>
                  <div data-uid='div-b0bccbf4'>
                    <h3 className="text-white font-medium" data-uid='h3-5aca4333'>
                      {activeTask?.status === 'started'
                        ? 'Task Started'
                        : activeTask?.status === 'processing'
                          ? 'Processing Video...'
                        : activeTask?.status === 'failed'
                          ? 'Processing Failed'
                          : 'No Video Selected'}
                    </h3>
                    <p className="text-white/40 text-sm mt-1" data-uid='p-763be1f6'>
                      {activeTask?.status === 'started'
                        ? 'Waiting for a worker to pick up the job.'
                        : activeTask?.status === 'processing'
                          ? `Analyzing frames... ${activeTask.progress}%`
                          : activeTask?.status === 'failed'
                        ? 'The task failed to process the video.'
                        : 'Select a completed task to view results'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            

          </div>

          {/* --- Right Sidebar: Metadata --- */}
          <aside
            className="w-80 border-l border-[#e5e7eb] bg-white flex flex-col"
            data-uid='aside-d1e7597e'>
            <div className="p-5 border-b border-[#e5e7eb]" data-uid='div-41067d15'>
              <h2
                className="font-semibold text-sm uppercase tracking-wider text-[#6b7280]"
                data-uid='h2-f0177d76'>Detection Data</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6" data-uid='div-f15f3167'>
              {activeTask?.roiError ? (
                <div
                  className="h-full flex flex-col items-center justify-center text-center opacity-40"
                  data-uid='div-aa0edd32'>
                  <AlertCircle size={32} className="mb-2" data-uid='alertcircle-725e80f5' />
                  <p className="text-sm" data-uid='p-fc5d684a'>ROI data unavailable</p>
                </div>
              ) : activeTask?.results?.length ? (
                <div className="space-y-4" data-uid='div-3bc3ef6c'>
                  <div className="flex items-center justify-between" data-uid='div-62ba9428'>
                    <span className="text-sm text-[#6b7280]" data-uid='span-97b8a7e9'>Total Detections</span>
                    <span className="text-sm font-mono font-bold" data-uid='span-3a324ca3'>{activeTask.results.length}</span>
                  </div>
                  <div className="space-y-2" data-uid='div-ca328dbe'>
                    {activeTask.results.map((box, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] hover:border-[#2563eb] transition-colors cursor-default"
                        data-uid='div-b25724b9'>
                        <div
                          className="flex justify-between items-center mb-2"
                          data-uid='div-44583e8b'>
                          <span className="text-xs font-bold text-[#2563eb]" data-uid='span-88e7c78c'>{box.label}</span>
                          <span className="text-[10px] font-mono text-[#6b7280]" data-uid='span-aeb77d97'>{(box.confidence * 100).toFixed(1)}%</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2" data-uid='div-482aced0'>
                          <div className="text-[10px] text-[#6b7280]" data-uid='div-3741a0b8'>
                            X: <span className="text-[#111827]" data-uid='span-b52fe622'>{box.x}px</span>
                          </div>
                          <div className="text-[10px] text-[#6b7280]" data-uid='div-44eed190'>
                            Y: <span className="text-[#111827]" data-uid='span-f84c9627'>{box.y}px</span>
                          </div>
                          <div className="text-[10px] text-[#6b7280]" data-uid='div-2b649319'>
                            W: <span className="text-[#111827]" data-uid='span-1dd7604a'>{box.width}px</span>
                          </div>
                          <div className="text-[10px] text-[#6b7280]" data-uid='div-162d84cb'>
                            H: <span className="text-[#111827]" data-uid='span-80bf6bd4'>{box.height}px</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="h-full flex flex-col items-center justify-center text-center opacity-40"
                  data-uid='div-aa0edd32'>
                  <AlertCircle size={32} className="mb-2" data-uid='alertcircle-725e80f5' />
                  <p className="text-sm" data-uid='p-fc5d684a'>No data available</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
      {/* Upload Overlay */}
      {isUploading && (
        <div
          className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center"
          data-uid='div-68a5a8c2'>
          <div
            className="bg-white p-8 rounded-2xl border border-[#e5e7eb] shadow-xl max-w-sm w-full text-center"
            data-uid='div-49db65bc'>
            <div
              className="w-12 h-12 border-4 border-[#f3f4f6] border-t-[#000000] rounded-full animate-spin mx-auto mb-4"
              data-uid='div-7df0d617' />
            <h3 className="text-lg font-semibold" data-uid='h3-fc50313c'>Uploading Videos</h3>
            <p className="text-[#6b7280] text-sm mt-1" data-uid='p-704bcda1'>Preparing your tasks for processing...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const styles = {
    pending: 'bg-[#f3f4f6] text-[#6b7280]',
    processing: 'bg-[#eff6ff] text-[#2563eb]',
    started: 'bg-[#fff7ed] text-[#c2410c]',
    completed: 'bg-[#f0fdf4] text-[#16a34a]',
    failed: 'bg-[#fef2f2] text-[#dc2626]',
  };

  const icons = {
    pending: <Clock size={10} data-uid='clock-40584055' />,
    processing: <Play size={10} className="animate-pulse" data-uid='play-1473a816' />,
    started: <Clock size={10} data-uid='clock-started' />,
    completed: <CheckCircle2 size={10} data-uid='checkcircle2-71d10e3e' />,
    failed: <AlertCircle size={10} data-uid='alertcircle-3297972d' />,
  };

  const displayLabel = status;
  const normalizedStatus = status;

  return (
    <span
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight ${styles[normalizedStatus] ?? styles.failed}`}
      data-uid='span-629588ad'>
      {icons[normalizedStatus] ?? icons.failed}
      {displayLabel}
    </span>
  );
}
