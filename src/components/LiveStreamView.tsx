import React, { useState } from 'react';
import {
  Video,
  Download,
  Copy,
  Check,
  Cpu,
  ShieldCheck,
  Terminal,
  Play,
  Gauge,
  Activity,
  Layers,
  Sparkles,
  ArrowRight,
  Tv,
  Camera,
  FileDown,
  Info,
} from 'lucide-react';

export const LiveStreamView: React.FC = () => {
  const [deviceIndex, setDeviceIndex] = useState<string>('0');
  const [resolution, setResolution] = useState<'1080p' | '720p' | '4k'>('1080p');
  const [fps, setFps] = useState<number>(60);
  const [scale, setScale] = useState<string>('auto');
  const [isSynthetic, setIsSynthetic] = useState<boolean>(false);
  const [isHeadless, setIsHeadless] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Resolution dimensions
  const resDimensions = {
    '1080p': { w: 1920, h: 1080 },
    '720p': { w: 1280, h: 720 },
    '4k': { w: 3840, h: 2160 },
  }[resolution];

  // Dynamic CLI command builder
  const generatedCommand = [
    'python3 live_stream_decoder.py',
    isSynthetic ? '--test' : `--camera ${deviceIndex}`,
    `--width ${resDimensions.w} --height ${resDimensions.h}`,
    `--fps ${fps}`,
    scale !== 'auto' ? `--scale ${scale}` : '',
    isHeadless ? '--headless' : '',
    '-o restored_stream.txt',
    '--log-file stream_metrics.csv',
  ]
    .filter(Boolean)
    .join(' ');

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(generatedCommand);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleCopyScript = () => {
    fetch('/live_stream_decoder.py')
      .then((res) => res.text())
      .then((code) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      })
      .catch(() => {
        // Fallback
        navigator.clipboard.writeText('# Download live_stream_decoder.py from the button above');
      });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-stone-100 text-stone-700 border border-stone-200">
              OpenCV • Python 3.8+
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Tv className="w-3 h-3 mr-1 text-indigo-600" />
              HDMI Capture &amp; Webcam
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
              Reed-Solomon FEC Protected
            </span>
          </div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <span>Real-Time Video Stream Decoder</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono font-medium">
              live_stream_decoder.py
            </span>
          </h2>
          <p className="text-xs text-stone-600 mt-1 max-w-2xl">
            Continuously ingests high-framerate 1080p60/720p60 video from HDMI capture cards or webcams, auto-detects visual pixel grids, repairs chroma subsampling color shifts using <strong>Reed-Solomon (ECC)</strong>, validates CRC32 checksums, and reassembles the transmission in real time.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            id="btn-download-live-script"
            href="/live_stream_decoder.py"
            download="live_stream_decoder.py"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shadow-sm transition-all"
          >
            <Download className="w-4 h-4 text-amber-400" />
            <span>Download live_stream_decoder.py</span>
          </a>
        </div>
      </div>

      {/* Grid: 2 Columns (Live HUD Preview & Configuration Builder) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Live OpenCV Window Preview (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-stone-900 rounded-2xl border border-stone-800 overflow-hidden shadow-md">
            <div className="px-4 py-2.5 bg-stone-950 border-b border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-stone-300 font-mono">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>OpenCV GUI Display Window: 1080p60 Stream Capture</span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-800 text-stone-400">
                cv2.imshow Active
              </span>
            </div>

            {/* Simulated Live Stream Feed / Preview Screenshot */}
            <div className="relative aspect-video bg-stone-950 flex items-center justify-center overflow-hidden group">
              <img
                src="/live_stream_preview.png"
                alt="OpenCV Live Stream Decoder HUD Preview"
                className="w-full h-full object-contain"
                onError={(e) => {
                  // Fallback visual display if preview not yet cached
                  e.currentTarget.style.display = 'none';
                }}
              />

              {/* Overlay Badge */}
              <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-sm border border-stone-700 px-2.5 py-1 rounded-lg text-[11px] font-mono text-emerald-400 flex items-center gap-1.5 shadow-md">
                <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>60.0 FPS • LOCK / SYNC</span>
              </div>
            </div>

            {/* Broadcast HUD Capabilities Bar */}
            <div className="p-4 bg-stone-950/80 border-t border-stone-800 grid grid-cols-3 gap-3 text-xs text-stone-300">
              <div className="space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Throughput HUD</span>
                <p className="font-semibold text-emerald-400 font-mono">Real-Time KB/s</p>
                <p className="text-[11px] text-stone-400">Cumulative payload tracking</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">FEC Telemetry</span>
                <p className="font-semibold text-amber-400 font-mono">Reed-Solomon RS(255, 239)</p>
                <p className="text-[11px] text-stone-400">Live repaired byte counter</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Data Verification</span>
                <p className="font-semibold text-indigo-400 font-mono">IEEE 802.3 CRC32</p>
                <p className="text-[11px] text-stone-400">Sequential reassembly to disk</p>
              </div>
            </div>
          </div>

          {/* Quick Start Hardware Guide */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide flex items-center gap-1.5">
              <Tv className="w-4 h-4 text-stone-700" />
              HDMI Capture Card &amp; Webcam Setup Guide
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-stone-600">
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 space-y-1">
                <strong className="text-stone-900 block">HDMI Capture Cards (UVC USB3)</strong>
                <p className="text-[11px]">
                  Plugs in as a USB Video Class (UVC) device. Appears on Linux as <code>/dev/video0</code> or <code>/dev/video1</code>, or device index <code>0</code> on Windows/macOS. Supports uncompressed 1080p60.
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 space-y-1">
                <strong className="text-stone-900 block">Standard Webcams &amp; Screens</strong>
                <p className="text-[11px]">
                  Direct camera aiming at an optical pixel grid displayed on another monitor. The built-in contour detector isolates the display area automatically.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Command Line Generator (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-stone-700" />
                Live Stream CLI Generator
              </h3>
              <span className="text-[11px] font-mono text-stone-400">argparse v2</span>
            </div>

            {/* Input Controls */}
            <div className="space-y-4 text-xs">
              {/* Capture Source Mode */}
              <div className="space-y-1.5">
                <label className="font-semibold text-stone-700 block">Capture Source</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSynthetic(false)}
                    className={`px-3 py-2 rounded-xl text-left border flex items-center gap-2 transition-all ${
                      !isSynthetic
                        ? 'bg-stone-900 text-white border-stone-900 shadow-2xs font-semibold'
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>HDMI / Webcam</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSynthetic(true)}
                    className={`px-3 py-2 rounded-xl text-left border flex items-center gap-2 transition-all ${
                      isSynthetic
                        ? 'bg-stone-900 text-white border-stone-900 shadow-2xs font-semibold'
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 text-amber-400" />
                    <span>Synthetic Self-Test</span>
                  </button>
                </div>
              </div>

              {/* Device Index (if hardware) */}
              {!isSynthetic && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-stone-700 block">Camera / Video Device Index</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={deviceIndex}
                      onChange={(e) => setDeviceIndex(e.target.value)}
                      placeholder="0, 1, or /dev/video0"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-stone-400 bg-stone-50"
                    />
                    <span className="text-[11px] text-stone-400">default: 0</span>
                  </div>
                </div>
              )}

              {/* Resolution & Framerate */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-stone-700 block">Resolution</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as '1080p' | '720p' | '4k')}
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-mono bg-stone-50"
                  >
                    <option value="1080p">1080p (1920×1080)</option>
                    <option value="720p">720p (1280×720)</option>
                    <option value="4k">4K (3840×2160)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-stone-700 block">Framerate (FPS)</label>
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-mono bg-stone-50"
                  >
                    <option value={60}>60 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={120}>120 FPS</option>
                  </select>
                </div>
              </div>

              {/* Pixel Scale & Display Mode */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-stone-700 block">Grid Upscale Scale</label>
                  <select
                    value={scale}
                    onChange={(e) => setScale(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-mono bg-stone-50"
                  >
                    <option value="auto">Auto-Detect</option>
                    <option value="10">10× (e.g. 640×20 px)</option>
                    <option value="8">8× Scale</option>
                    <option value="4">4× Scale</option>
                    <option value="1">1× (Native Pixels)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-stone-700 block">Execution Mode</label>
                  <select
                    value={isHeadless ? 'headless' : 'gui'}
                    onChange={(e) => setIsHeadless(e.target.value === 'headless')}
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-mono bg-stone-50"
                  >
                    <option value="gui">OpenCV Window (GUI)</option>
                    <option value="headless">Headless (Terminal Only)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Generated Shell Command Box */}
            <div className="space-y-2 pt-2 border-t border-stone-100">
              <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono">
                <span>Terminal Command:</span>
                <button
                  type="button"
                  onClick={handleCopyCmd}
                  className="text-stone-800 hover:text-stone-900 font-semibold flex items-center gap-1 transition-all"
                >
                  {copiedCmd ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCmd ? 'Copied to Clipboard' : 'Copy'}</span>
                </button>
              </div>

              <div className="bg-stone-900 rounded-xl p-3 text-xs font-mono text-stone-100 overflow-x-auto selection:bg-stone-700 border border-stone-800">
                <code>{generatedCommand}</code>
              </div>
            </div>

            {/* Python Dependencies Notice */}
            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1.5 text-xs">
              <span className="font-bold text-stone-800 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                Required Python Dependencies
              </span>
              <div className="bg-white p-2 rounded border border-stone-200 font-mono text-[11px] text-stone-800 flex items-center justify-between">
                <code>pip install opencv-python numpy pillow reedsolo</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Architecture Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs">
            01
          </div>
          <h4 className="text-xs font-bold text-stone-900">UVC Video Capture Engine</h4>
          <p className="text-[11px] text-stone-500">
            Initializes <code>cv2.VideoCapture</code> with zero-latency buffer (<code>CAP_PROP_BUFFERSIZE=1</code>) supporting 1080p60 HDMI feeds.
          </p>
        </div>

        <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs">
            02
          </div>
          <h4 className="text-xs font-bold text-stone-900">Multi-Scale Center Sampling</h4>
          <p className="text-[11px] text-stone-500">
            Center-samples candidate blocks (10×, 8×, 4×, 1×) to completely bypass HDMI 4:2:2/4:2:0 chroma blur at pixel boundary edges.
          </p>
        </div>

        <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center font-bold text-xs">
            03
          </div>
          <h4 className="text-xs font-bold text-stone-900">Reed-Solomon FEC Repair</h4>
          <p className="text-[11px] text-stone-500">
            Automatic Berlekamp-Massey &amp; Forney decoding repairs bit-flips and sensor noise BEFORE checking IEEE 802.3 CRC32 integrity.
          </p>
        </div>

        <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-xs">
            04
          </div>
          <h4 className="text-xs font-bold text-stone-900">Sequential Stream Reassembly</h4>
          <p className="text-[11px] text-stone-500">
            Deduplicates identical frames across 60 FPS refresh intervals, orders sequential chunks, and writes clean payload streams to disk.
          </p>
        </div>
      </div>
    </div>
  );
};
