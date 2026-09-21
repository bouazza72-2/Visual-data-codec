import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, Eye, Crosshair } from 'lucide-react';
import { CodecMode, PixelInspection } from '../types';
import { getPixelInspection } from '../utils/codec';

interface PixelMagnifierProps {
  canvas: HTMLCanvasElement | null;
  mode: CodecMode;
}

export const PixelMagnifier: React.FC<PixelMagnifierProps> = ({ canvas, mode }) => {
  const [zoomLevel, setZoomLevel] = useState<number>(12); // magnification factor (e.g. 12x)
  const [hoveredPixel, setHoveredPixel] = useState<PixelInspection | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const renderDisplay = useCallback(() => {
    if (!canvas || !displayCanvasRef.current) return;
    const target = displayCanvasRef.current;
    target.width = canvas.width * zoomLevel;
    target.height = canvas.height * zoomLevel;

    const ctx = target.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false; // Crisp pixelation!
    ctx.drawImage(canvas, 0, 0, target.width, target.height);

    // Optional: Draw subtle grid lines if zoomLevel >= 8
    if (zoomLevel >= 8) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * zoomLevel, 0);
        ctx.lineTo(x * zoomLevel, target.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * zoomLevel);
        ctx.lineTo(target.width, y * zoomLevel);
        ctx.stroke();
      }

      // Highlight Row 0 (Header Row) with subtle amber guideline
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, target.width, zoomLevel);
    }
  }, [canvas, zoomLevel]);

  useEffect(() => {
    renderDisplay();
  }, [renderDisplay]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvas || !displayCanvasRef.current) return;
    const rect = displayCanvasRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const pxX = Math.floor(clientX / zoomLevel);
    const pxY = Math.floor(clientY / zoomLevel);

    const inspection = getPixelInspection(canvas, pxX, pxY, mode);
    setHoveredPixel(inspection);
  };

  const handleMouseLeave = () => {
    setHoveredPixel(null);
  };

  if (!canvas) return null;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-stone-700" />
          <h4 className="text-sm font-semibold text-stone-800">
            Pixel Grid Magnifier & Inspector
          </h4>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500">Zoom:</span>
          <div className="flex items-center bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-xs">
            {[4, 8, 12, 20].map((level) => (
              <button
                key={level}
                onClick={() => setZoomLevel(level)}
                className={`px-2 py-0.5 rounded-md font-mono ${
                  zoomLevel === level
                    ? 'bg-white text-stone-900 font-bold shadow-xs'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                {level}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative border border-stone-200 rounded-lg overflow-auto max-h-80 bg-stone-900 p-4 flex items-center justify-center">
        <canvas
          ref={displayCanvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="cursor-crosshair shadow-md max-w-none transition-transform"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Pixel Details Bar */}
      <div className="mt-3 p-3 bg-stone-50 rounded-lg border border-stone-200 flex flex-wrap items-center justify-between text-xs gap-2">
        {hoveredPixel ? (
          <>
            <div className="flex items-center gap-2">
              <Crosshair className="w-3.5 h-3.5 text-stone-400" />
              <span className="font-mono text-stone-700">
                X: <strong>{hoveredPixel.x}</strong>, Y: <strong>{hoveredPixel.y}</strong>
              </span>
              <span className="text-stone-300">|</span>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded border border-stone-300 inline-block shadow-xs"
                  style={{ backgroundColor: `rgb(${hoveredPixel.r}, ${hoveredPixel.g}, ${hoveredPixel.b})` }}
                />
                <span className="font-mono text-stone-800">
                  {mode === 'RGB'
                    ? `RGB(${hoveredPixel.r}, ${hoveredPixel.g}, ${hoveredPixel.b})`
                    : `Gray(${hoveredPixel.r})`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hoveredPixel.isHeaderRow ? (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded text-[11px] font-medium">
                  {hoveredPixel.headerField || 'Row 0 Header'}
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[11px] font-medium">
                  Payload Byte #{hoveredPixel.payloadByteIndex}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-stone-400 italic flex items-center gap-2">
            <ZoomIn className="w-3.5 h-3.5" />
            Hover over any pixel on the grid to inspect its coordinate, channel bytes, and header mapping.
          </div>
        )}
      </div>
    </div>
  );
};
