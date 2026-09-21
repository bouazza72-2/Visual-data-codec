import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Timer, Clock, Zap, CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react';

interface BatchProgressBarProps {
  current: number;
  total: number;
  isProcessing: boolean;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  currentFrameName?: string;
  repairedCount: number;
  cleanCount: number;
  errorCount: number;
}

export const BatchProgressBar: React.FC<BatchProgressBarProps> = ({
  current,
  total,
  isProcessing,
  elapsedMs,
  estimatedRemainingMs,
  currentFrameName,
  repairedCount,
  cleanCount,
  errorCount,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const rawFraction = total > 0 ? Math.min(1, current / total) : 0;

  // Format milliseconds into human readable mm:ss.s or seconds
  const formatTime = (ms: number): string => {
    if (ms < 0) return '0.0s';
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(1);
    const padSec = parseFloat(seconds) < 10 ? `0${seconds}` : seconds;
    return `${minutes}m ${padSec}s`;
  };

  const formatETA = (ms: number | null): string => {
    if (ms === null || !isProcessing) return '—';
    if (current === 0) return 'Calculating...';
    if (ms <= 0 || current >= total) return '0.0s';
    return `~${formatTime(ms)}`;
  };

  // Compute processing speed
  const speedFps = elapsedMs > 0 && current > 0 ? (current / (elapsedMs / 1000)).toFixed(1) : null;
  const avgMsPerFrame = current > 0 && elapsedMs > 0 ? Math.round(elapsedMs / current) : null;

  // D3 animated rendering for the SVG visual track
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = 1000;
    const height = 20;

    svg.selectAll('*').remove();

    // Scale mapping [0, total] to [0, width]
    const xScale = d3.scaleLinear().domain([0, Math.max(1, total)]).range([0, width]);

    // Defs for gradients & filters
    const defs = svg.append('defs');

    // Gradient for the progress fill
    const mainGradient = defs
      .append('linearGradient')
      .attr('id', 'vcdc-batch-progress-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');

    mainGradient.append('stop').attr('offset', '0%').attr('stop-color', '#f59e0b');
    mainGradient.append('stop').attr('offset', '100%').attr('stop-color', '#10b981');

    // Background track
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('rx', height / 2)
      .attr('ry', height / 2)
      .attr('fill', '#f5f5f4') // stone-100
      .attr('stroke', '#e7e5e4') // stone-200
      .attr('stroke-width', 1.5);

    // Segmented breakdowns if there are items completed
    if (total > 0 && current > 0) {
      const cleanW = xScale(cleanCount);
      const repW = xScale(repairedCount);
      const errW = xScale(errorCount);

      // Clean (Emerald)
      if (cleanCount > 0) {
        svg
          .append('rect')
          .attr('x', 0)
          .attr('y', 1)
          .attr('width', Math.max(0, cleanW))
          .attr('height', height - 2)
          .attr('rx', height / 2)
          .attr('ry', height / 2)
          .attr('fill', '#10b981')
          .attr('opacity', 0.9);
      }

      // Repaired (Amber)
      if (repairedCount > 0) {
        svg
          .append('rect')
          .attr('x', Math.max(0, cleanW))
          .attr('y', 1)
          .attr('width', Math.max(0, repW))
          .attr('height', height - 2)
          .attr('fill', '#f59e0b')
          .attr('opacity', 0.95);
      }

      // Error (Rose)
      if (errorCount > 0) {
        svg
          .append('rect')
          .attr('x', Math.max(0, cleanW + repW))
          .attr('y', 1)
          .attr('width', Math.max(0, errW))
          .attr('height', height - 2)
          .attr('fill', '#f43f5e')
          .attr('opacity', 0.95);
      }
    }

    // Interactive animated indicator pip
    const currentX = xScale(current);
    if (current > 0 && currentX > 12) {
      svg
        .append('circle')
        .attr('cx', Math.min(width - 6, currentX - 4))
        .attr('cy', height / 2)
        .attr('r', 6)
        .attr('fill', '#ffffff')
        .attr('stroke', '#d97706')
        .attr('stroke-width', 3);
    }

    // Scale ticks at 25%, 50%, 75%
    [0.25, 0.5, 0.75].forEach((tickRatio) => {
      const tickX = width * tickRatio;
      svg
        .append('line')
        .attr('x1', tickX)
        .attr('y1', 3)
        .attr('x2', tickX)
        .attr('y2', height - 3)
        .attr('stroke', '#d6d3d1')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '3,3');
    });
  }, [current, total, cleanCount, repairedCount, errorCount]);

  return (
    <div className="bg-stone-50/80 rounded-xl border border-stone-200 p-4 space-y-3.5 transition-all shadow-2xs">
      {/* Top Header: Progress percentage & status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-bold text-xs text-stone-900">
            {isProcessing ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
            ) : current >= total && total > 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <div className="w-2.5 h-2.5 rounded-full bg-stone-400" />
            )}
            <span>
              {isProcessing
                ? 'Decoding Batch in Progress'
                : current >= total && total > 0
                ? 'Batch Complete'
                : 'Batch Ready'}
            </span>
          </div>

          {currentFrameName && isProcessing && (
            <span className="text-[11px] font-mono text-stone-500 truncate max-w-[150px] sm:max-w-[200px]" title={currentFrameName}>
              ({currentFrameName})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="font-bold text-stone-900 text-sm">{percentage}%</span>
          <span className="text-stone-500 text-[11px]">
            ({current} / {total} frames)
          </span>
        </div>
      </div>

      {/* D3 SVG Track + Smooth CSS Bar container */}
      <div className="space-y-1">
        <div className="w-full relative">
          <svg
            ref={svgRef}
            viewBox="0 0 1000 20"
            className="w-full h-[18px] block rounded-full"
            style={{ width: '100%' }}
          />
        </div>

        {/* Milestone labels */}
        <div className="flex justify-between text-[10px] font-mono text-stone-400 px-1 pt-0.5">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Real-time Metrics Matrix: Time Elapsed, Remaining (ETA), Speed, Composition */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        {/* Metric 1: Time Elapsed */}
        <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs space-y-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
            <Clock className="w-3 h-3 text-stone-500" />
            <span>Time Elapsed</span>
          </div>
          <div className="font-mono text-xs font-bold text-stone-900">
            {formatTime(elapsedMs)}
          </div>
        </div>

        {/* Metric 2: Estimated Time Remaining (ETA) */}
        <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs space-y-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
            <Timer className="w-3 h-3 text-amber-600" />
            <span>Estimated Remaining</span>
          </div>
          <div className="font-mono text-xs font-bold text-amber-800">
            {formatETA(estimatedRemainingMs)}
          </div>
        </div>

        {/* Metric 3: Processing Velocity / Speed */}
        <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs space-y-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
            <Zap className="w-3 h-3 text-indigo-600" />
            <span>Velocity</span>
          </div>
          <div className="font-mono text-xs font-bold text-stone-800">
            {speedFps ? (
              <span>
                {speedFps} <span className="text-[10px] font-normal text-stone-500">fps</span>
              </span>
            ) : (
              <span className="text-stone-400">—</span>
            )}
          </div>
        </div>

        {/* Metric 4: Integrity Status */}
        <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs space-y-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            <span>Integrity Split</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-emerald-700 font-bold" title="Clean verified frames">
              ✓{cleanCount}
            </span>
            {repairedCount > 0 && (
              <span className="text-amber-700 font-bold" title="RS FEC repaired frames">
                +{repairedCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-rose-700 font-bold" title="Failed frames">
                ✕{errorCount}
              </span>
            )}
            {cleanCount === 0 && repairedCount === 0 && errorCount === 0 && (
              <span className="text-stone-400">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
