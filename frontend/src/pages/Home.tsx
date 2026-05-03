import { useEffect, useRef } from "react";

export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gridSize = 6;
    const gap = 2;
    const cellSize = gridSize + gap;
    let animationRef = 0;
    let grid: { targetOp: number; currentOp: number }[][] = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const columns = Math.ceil(w / cellSize);
    const rows = Math.ceil(h / cellSize);

    for (let c = 0; c < columns; c++) {
      grid[c] = [];
      for (let r = 0; r < rows; r++) {
        grid[c][r] = { targetOp: Math.random() > 0.9 ? Math.random() * 0.4 + 0.1 : 0, currentOp: 0 };
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let c = 0; c < columns; c++) {
        for (let r = 0; r < rows; r++) {
          const cell = grid[c]?.[r];
          if (!cell) continue;
          if (Math.random() < 0.02) {
            cell.targetOp = Math.random() > 0.92 ? Math.random() * 0.5 + 0.08 : 0;
          }
          cell.currentOp += (cell.targetOp - cell.currentOp) * 0.08;
          if (cell.currentOp > 0.01) {
            ctx.fillStyle = `rgba(255, 255, 255, ${cell.currentOp})`;
            const x = c * cellSize;
            const y = r * cellSize;
            ctx.beginPath();
            ctx.roundRect(x, y, gridSize, gridSize, 1);
            ctx.fill();
          }
        }
      }
      animationRef = requestAnimationFrame(draw);
    };

    draw();
    return () => { if (animationRef) cancelAnimationFrame(animationRef); };
  }, []);

  return (
    <div
      className="h-screen bg-[#09090b] text-white relative overflow-hidden"
      data-uid='div-2e30f1b2'>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: '60vh',
          height: '60vh',
          background: 'white',
          top: '10%',
          left: '10%',
          filter: 'blur(150px)',
          opacity: 0.15,
          animation: 'noiseFloat 30s infinite ease-in-out alternate',
        }}
        data-uid='div-22952bdb' />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: '50vh',
          height: '50vh',
          background: '#cccccc',
          bottom: '5%',
          right: '15%',
          filter: 'blur(150px)',
          opacity: 0.15,
          animation: 'noiseFloat 25s infinite ease-in-out alternate-reverse',
        }}
        data-uid='div-b8736b4c' />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none w-full h-full"
        style={{ zIndex: 2 }}
        data-uid='canvas-7f85e178' />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 3,
          mixBlendMode: 'screen',
          boxShadow: 'inset 0 0 80px rgba(255,255,255,0.2)',
        }}
        data-uid='div-538819a4' />
      <style data-uid='style-3f0f343e'>{`
        @keyframes noiseFloat {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(100px, 50px) scale(1.1); }
          66% { transform: translate(-50px, 150px) scale(0.9); }
          100% { transform: translate(-100px, -50px) scale(1); }
        }
      `}</style>
      <div
        className="absolute inset-0 flex items-center justify-center z-10"
        data-uid='div-afdc1ea2'>
        <div className="text-center space-y-4" data-uid='div-d4b4f4a5'>
          <div
            className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto ring-1 ring-white/10"
            data-uid='div-cf957571'>
            <svg
              className="w-8 h-8 text-white/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              data-uid='svg-2a1534d9'>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                data-uid='path-0ab1b4fa' />
            </svg>
          </div>
          <div data-uid='div-905fdc89'>
            <h2 className="text-lg font-medium text-white/60" data-uid='h2-dd3fac2b'>Ready to Create</h2>
            <p className="text-sm text-neutral-500" data-uid='p-5685312d'>Ask the AI to build something amazing.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
