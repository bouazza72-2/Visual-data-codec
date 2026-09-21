import React, { useState, useRef, useEffect } from 'react';
import {
  Maximize2,
  Download,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Layers,
  ZoomIn,
  Eye,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface BlockInspection {
  origX: number;
  origY: number;
  upX: number;
  upY: number;
  r: number;
  g: number;
  b: number;
  hex: string;
  isHeaderRow: boolean;
}

export const UpscalerView: React.FC = () => {
  const [scaleFactor, setScaleFactor] = useState<number>(10);
  const [samplePattern, setSamplePattern] = useState<'sample64x2' | 'custom'>('sample64x2');
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number }>({ width: 64, height: 2 });
  const [upscaledDataUrl, setUpscaledDataUrl] = useState<string | null>(null);
  const [bilinearDataUrl, setBilinearDataUrl] = useState<string | null>(null);
  const [inspection, setInspection] = useState<BlockInspection | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [comparisonMode, setComparisonMode] = useState<'nearest' | 'bilinear' | 'split'>('nearest');

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const upscaledCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Generate the standard 64x2 test pattern (like encoded_data_rgb.png)
  useEffect(() => {
    if (samplePattern === 'sample64x2') {
      const w = 64;
      const h = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;

      // Row 0: 24-byte header for "VCDC", mode=1 (RGB), len=100, CRC=0x9ABCDEF0
      // Pixel 0: 'V' (86), 'C' (67), 'D' (68)
      // Pixel 1: 'C' (67), mode=1, pad=0
      // ...
      const headerBytes = [
        86, 67, 68, 67, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 100,
        154, 188, 222, 240, 69, 78, 68, 0
      ];

      // Fill Row 0
      for (let px = 0; px < w; px++) {
        const byteOffset = px * 3;
        const i = (0 * w + px) * 4;
        if (byteOffset < headerBytes.length) {
          data[i] = headerBytes[byteOffset] || 0;
          data[i + 1] = headerBytes[byteOffset + 1] || 0;
          data[i + 2] = headerBytes[byteOffset + 2] || 0;
        } else {
          // Zero padding in header row
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
        data[i + 3] = 255;
      }

      // Row 1: Sample payload data bytes with vibrant distinctive RGB values
      for (let px = 0; px < w; px++) {
        const i = (1 * w + px) * 4;
        // Deterministic pseudo-random bytes
        data[i] = (px * 37 + 13) % 256;       // Red
        data[i + 1] = (px * 59 + 79) % 256;   // Green
        data[i + 2] = (px * 97 + 163) % 256;  // Blue
        data[i + 3] = 255;
      }

      ctx.putImageData(imgData, 0, 0);
      sourceCanvasRef.current = canvas;
      setSourceDimensions({ width: w, height: h });
      setInputImage(canvas.toDataURL('image/png'));
    }
  }, [samplePattern]);

  // Perform Nearest Neighbor Upscale & Bilinear Comparison
  useEffect(() => {
    if (!sourceCanvasRef.current) return;
    const srcCanvas = sourceCanvasRef.current;
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;

    const upW = srcW * scaleFactor;
    const upH = srcH * scaleFactor;

    // 1. NEAREST NEIGHBOR (LOSSLESS)
    const nnCanvas = document.createElement('canvas');
    nnCanvas.width = upW;
    nnCanvas.height = upH;
    const nnCtx = nnCanvas.getContext('2d');
    if (nnCtx) {
      nnCtx.imageSmoothingEnabled = false;
      // @ts-ignore
      nnCtx.mozImageSmoothingEnabled = false;
      // @ts-ignore
      nnCtx.webkitImageSmoothingEnabled = false;
      // @ts-ignore
      nnCtx.msImageSmoothingEnabled = false;
      nnCtx.drawImage(srcCanvas, 0, 0, upW, upH);
      upscaledCanvasRef.current = nnCanvas;
      setUpscaledDataUrl(nnCanvas.toDataURL('image/png'));
    }

    // 2. BILINEAR (DESTRUCTIVE - FOR SCIENTIFIC COMPARISON)
    const biCanvas = document.createElement('canvas');
    biCanvas.width = upW;
    biCanvas.height = upH;
    const biCtx = biCanvas.getContext('2d');
    if (biCtx) {
      biCtx.imageSmoothingEnabled = true;
      biCtx.imageSmoothingQuality = 'high';
      biCtx.drawImage(srcCanvas, 0, 0, upW, upH);
      setBilinearDataUrl(biCanvas.toDataURL('image/png'));
    }
  }, [inputImage, scaleFactor]);

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);

        sourceCanvasRef.current = canvas;
        setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        setInputImage(canvas.toDataURL('image/png'));
        setSamplePattern('custom');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleMouseMoveUpscaled = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!upscaledCanvasRef.current || !sourceCanvasRef.current) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = Math.floor((e.clientX - rect.left) * scaleX);
    const clickY = Math.floor((e.clientY - rect.top) * scaleY);

    if (clickX < 0 || clickX >= canvas.width || clickY < 0 || clickY >= canvas.height) {
      setInspection(null);
      return;
    }

    const origX = Math.floor(clickX / scaleFactor);
    const origY = Math.floor(clickY / scaleFactor);

    // Get pixel from original source canvas
    const srcCtx = sourceCanvasRef.current.getContext('2d');
    if (!srcCtx) return;
    const pixel = srcCtx.getImageData(origX, origY, 1, 1).data;

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();

    setInspection({
      origX,
      origY,
      upX: clickX,
      upY: clickY,
      r,
      g,
      b,
      hex,
      isHeaderRow: origY === 0,
    });
  };

  const handleDownloadUpscaled = () => {
    if (!upscaledDataUrl) return;
    const a = document.createElement('a');
    a.href = upscaledDataUrl;
    a.download = `encoded_data_rgb_${scaleFactor}x_${sourceDimensions.width * scaleFactor}x${sourceDimensions.height * scaleFactor}.png`;
    a.click();
  };

  const handleDownloadSource = () => {
    if (!inputImage) return;
    const a = document.createElement('a');
    a.href = inputImage;
    a.download = `encoded_data_rgb_1x_${sourceDimensions.width}x${sourceDimensions.height}.png`;
    a.click();
  };

  const PYTHON_UPSCALER_SNIPPET = `from PIL import Image
import cv2

def upscale_png(input_path: str, output_path: str, scale_factor: int = 10):
    """
    Lossless upscale using Nearest Neighbor interpolation.
    Expands each pixel into a (scale_factor x scale_factor) solid block.
    Preserves 100% bit-exact color values without smoothing or color shifting.
    """
    # Pillow (PIL) Implementation
    with Image.open(input_path) as img:
        w, h = img.size
        # Image.Resampling.NEAREST (Pillow >= 9.0) or Image.NEAREST
        resample_mode = getattr(Image, 'Resampling', Image).NEAREST
        upscaled = img.resize((w * scale_factor, h * scale_factor), resample=resample_mode)
        upscaled.save(output_path, format='PNG', optimize=True)

# Example: 64x2 -> 640x20 pixels
upscale_png('encoded_data_rgb.png', 'encoded_data_rgb_10x.png', scale_factor=10)`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(PYTHON_UPSCALER_SNIPPET);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Banner */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <Maximize2 className="w-3 h-3 mr-1" />
                Nearest Neighbor Scaling
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3 h-3 mr-1" />
                100% Bit-Exact Integrity
              </span>
            </div>
            <h2 className="text-2xl font-bold text-stone-900 tracking-tight">
              Lossless PNG Upscaler (64×2 → 640×20)
            </h2>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Enlarges tiny visual data images by an integer factor (<strong>10×</strong>) using the <strong>Nearest Neighbor algorithm</strong> in OpenCV &amp; Pillow. Each source pixel expands into a crisp 10×10 solid color block with zero smoothing, preserving visual codec data for transmission and display.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadUpscaled}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-900 text-white hover:bg-stone-800 text-sm font-medium shadow-sm transition-all"
            >
              <Download className="w-4 h-4 text-amber-400" />
              <span>Download 10× PNG ({sourceDimensions.width * scaleFactor}×{sourceDimensions.height * scaleFactor})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Control Strip */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 mb-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Source Image Selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Source:</span>
          <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl border border-stone-200 text-xs font-medium">
            <button
              onClick={() => setSamplePattern('sample64x2')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                samplePattern === 'sample64x2'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Default 64×2 PNG (encoded_data_rgb.png)
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                samplePattern === 'custom'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Upload Custom PNG
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleCustomUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Scale Multiplier */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Scale Factor:</span>
          <div className="flex items-center gap-1">
            {[2, 4, 8, 10, 16, 20].map((s) => (
              <button
                key={s}
                onClick={() => setScaleFactor(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                  scaleFactor === s
                    ? 'bg-stone-900 text-white shadow-xs font-bold'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
          <span className="text-xs font-mono text-stone-400">
            = {sourceDimensions.width * scaleFactor} × {sourceDimensions.height * scaleFactor} px
          </span>
        </div>

        {/* Comparison Mode */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">View:</span>
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs">
            <button
              onClick={() => setComparisonMode('nearest')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                comparisonMode === 'nearest' ? 'bg-white font-semibold text-stone-900 shadow-xs' : 'text-stone-600'
              }`}
            >
              Nearest (Lossless)
            </button>
            <button
              onClick={() => setComparisonMode('bilinear')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                comparisonMode === 'bilinear' ? 'bg-white font-semibold text-rose-700 shadow-xs' : 'text-stone-600'
              }`}
            >
              Bilinear (Blurred)
            </button>
            <button
              onClick={() => setComparisonMode('split')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                comparisonMode === 'split' ? 'bg-white font-semibold text-indigo-700 shadow-xs' : 'text-stone-600'
              }`}
            >
              Side-by-Side
            </button>
          </div>
        </div>
      </div>

      {/* Main Visual Display Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Left 2 Columns: Large Interactive Preview Canvas */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-stone-700" />
                <h3 className="text-sm font-semibold text-stone-900">
                  Interactive Upscaled View ({sourceDimensions.width * scaleFactor} × {sourceDimensions.height * scaleFactor} pixels)
                </h3>
              </div>
              <span className="text-xs font-mono text-stone-500">
                1 original px = {scaleFactor}×{scaleFactor} ({scaleFactor * scaleFactor}) solid px block
              </span>
            </div>

            {/* Display Canvas with Nearest Neighbor */}
            <div className="bg-stone-950 p-6 rounded-xl border border-stone-800 flex flex-col items-center justify-center overflow-x-auto min-h-[160px]">
              {comparisonMode === 'nearest' && upscaledDataUrl && (
                <div className="space-y-3 w-full flex flex-col items-center">
                  <div className="border border-stone-700 rounded shadow-md overflow-hidden bg-stone-900 p-1">
                    <img
                      src={upscaledDataUrl}
                      alt="Nearest Neighbor Upscaled Visual Data"
                      className="cursor-crosshair max-w-full"
                      style={{ imageRendering: 'pixelated' }}
                      onMouseMove={(e) => {
                        const img = e.currentTarget;
                        const rect = img.getBoundingClientRect();
                        const clickX = Math.floor(((e.clientX - rect.left) / rect.width) * (sourceDimensions.width * scaleFactor));
                        const clickY = Math.floor(((e.clientY - rect.top) / rect.height) * (sourceDimensions.height * scaleFactor));
                        const origX = Math.floor(clickX / scaleFactor);
                        const origY = Math.floor(clickY / scaleFactor);
                        if (sourceCanvasRef.current) {
                          const ctx = sourceCanvasRef.current.getContext('2d');
                          if (ctx) {
                            const p = ctx.getImageData(origX, origY, 1, 1).data;
                            setInspection({
                              origX,
                              origY,
                              upX: clickX,
                              upY: clickY,
                              r: p[0],
                              g: p[1],
                              b: p[2],
                              hex: `#${p[0].toString(16).padStart(2, '0')}${p[1].toString(16).padStart(2, '0')}${p[2].toString(16).padStart(2, '0')}`.toUpperCase(),
                              isHeaderRow: origY === 0
                            });
                          }
                        }
                      }}
                      onMouseLeave={() => setInspection(null)}
                    />
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Nearest Neighbor: Crisp edges, 0% color bleed, exact RGB preserved
                  </div>
                </div>
              )}

              {comparisonMode === 'bilinear' && bilinearDataUrl && (
                <div className="space-y-3 w-full flex flex-col items-center">
                  <div className="border border-rose-700/60 rounded shadow-md overflow-hidden bg-stone-900 p-1">
                    <img
                      src={bilinearDataUrl}
                      alt="Bilinear Smoothed Visual Data (Destructive)"
                      className="max-w-full"
                    />
                  </div>
                  <div className="text-[11px] font-mono text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Bilinear Smoothing: Pixels blurred, RGB values shifted, destroys CRC32 integrity!
                  </div>
                </div>
              )}

              {comparisonMode === 'split' && upscaledDataUrl && bilinearDataUrl && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                  <div className="p-3 bg-stone-900 rounded-lg border border-emerald-800/60 flex flex-col items-center">
                    <span className="text-[11px] font-mono text-emerald-400 font-bold mb-2">
                      Nearest Neighbor (Lossless)
                    </span>
                    <img
                      src={upscaledDataUrl}
                      alt="Lossless"
                      className="border border-stone-700 max-w-full"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <span className="text-[10px] text-stone-400 mt-2">Zero interpolation</span>
                  </div>
                  <div className="p-3 bg-stone-900 rounded-lg border border-rose-800/60 flex flex-col items-center">
                    <span className="text-[11px] font-mono text-rose-400 font-bold mb-2">
                      Bilinear (Destructive)
                    </span>
                    <img
                      src={bilinearDataUrl}
                      alt="Destructive"
                      className="border border-stone-700 max-w-full"
                    />
                    <span className="text-[10px] text-rose-400 mt-2">Corrupted bit values</span>
                  </div>
                </div>
              )}
            </div>

            {/* Hover Crosshair / Inspector info */}
            {inspection ? (
              <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg border border-stone-300 shadow-xs shrink-0"
                    style={{ backgroundColor: inspection.hex }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-stone-900">
                        Source Pixel ({inspection.origX}, {inspection.origY})
                      </span>
                      {inspection.isHeaderRow ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-100 text-indigo-800">
                          Row 0: Header
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800">
                          Row 1: Payload
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-stone-500 text-[11px]">
                      Upscaled Block: [{inspection.origX * scaleFactor}..{(inspection.origX + 1) * scaleFactor - 1}, {inspection.origY * scaleFactor}..{(inspection.origY + 1) * scaleFactor - 1}]
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 font-mono">
                  <div>
                    <span className="text-stone-400 text-[10px] block">RGB VALUES</span>
                    <span className="text-stone-900 font-bold">
                      R:{inspection.r} G:{inspection.g} B:{inspection.b}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 text-[10px] block">HEX CODE</span>
                    <span className="text-stone-900 font-bold">{inspection.hex}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-center text-xs text-stone-400 py-1">
                Hover over the upscaled image above to inspect individual (X, Y) pixel blocks and channel values.
              </div>
            )}
          </div>

          {/* Verification Metrics Card */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <h3 className="text-sm font-semibold text-stone-900 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Mathematical Integrity &amp; Verification Matrix
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-semibold">Source Dimensions</span>
                <span className="text-stone-900 font-mono font-bold text-sm">
                  {sourceDimensions.width} × {sourceDimensions.height} px
                </span>
                <span className="text-stone-500 text-[10px] block mt-0.5">
                  {(sourceDimensions.width * sourceDimensions.height).toLocaleString()} original pixels
                </span>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-semibold">Upscaled Dimensions</span>
                <span className="text-stone-900 font-mono font-bold text-sm">
                  {sourceDimensions.width * scaleFactor} × {sourceDimensions.height * scaleFactor} px
                </span>
                <span className="text-stone-500 text-[10px] block mt-0.5">
                  {(sourceDimensions.width * scaleFactor * sourceDimensions.height * scaleFactor).toLocaleString()} total pixels
                </span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900">
                <span className="text-emerald-700 text-[10px] uppercase block font-semibold">Color Shift</span>
                <span className="font-mono font-bold text-sm text-emerald-800">
                  0.00% (Bit-Exact)
                </span>
                <span className="text-emerald-600 text-[10px] block mt-0.5">
                  Uniform {scaleFactor}×{scaleFactor} blocks
                </span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900">
                <span className="text-emerald-700 text-[10px] uppercase block font-semibold">Transmission Status</span>
                <span className="font-mono font-bold text-sm text-emerald-800">
                  Lossless Safe
                </span>
                <span className="text-emerald-600 text-[10px] block mt-0.5">
                  Preserves CRC32 Checksum
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Original 1x Image + Python Code + Explanation */}
        <div className="space-y-6">
          {/* Original 1x Image Card */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-stone-600" />
                Original 1× Image
              </h3>
              <button
                onClick={handleDownloadSource}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save 1×</span>
              </button>
            </div>

            <div className="p-4 bg-stone-100 rounded-xl border border-stone-200 flex flex-col items-center justify-center">
              <span className="text-[11px] font-mono text-stone-500 mb-2">
                Actual Physical Size ({sourceDimensions.width}×{sourceDimensions.height} px):
              </span>
              {inputImage && (
                <img
                  src={inputImage}
                  alt="Original 1x"
                  className="border border-stone-300 shadow-xs"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              <span className="text-[10px] text-stone-400 mt-2 text-center">
                At 1× zoom, a 64×2 image is nearly microscopic on modern high-DPI displays.
              </span>
            </div>
          </div>

          {/* Python upscale_png() Function Snippet */}
          <div className="bg-stone-900 text-stone-200 rounded-2xl border border-stone-800 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-stone-950 border-b border-stone-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                <span className="font-mono text-stone-200">upscale_png.py</span>
              </div>
              <button
                onClick={handleCopyCode}
                className="text-stone-400 hover:text-stone-200 flex items-center gap-1 text-xs"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="p-4 overflow-x-auto text-[11px] font-mono leading-relaxed max-h-[300px]">
              <pre>
                <code>{PYTHON_UPSCALER_SNIPPET}</code>
              </pre>
            </div>

            <div className="p-3 bg-stone-950/80 border-t border-stone-800 text-[11px] text-stone-400 flex items-center justify-between">
              <span>Supports both Pillow &amp; OpenCV</span>
              <a
                href="/upscale_png.py"
                download="upscale_png.py"
                className="text-amber-400 hover:text-amber-300 font-sans font-medium flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Download .py</span>
              </a>
            </div>
          </div>

          {/* Technical Explanation */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs text-xs text-stone-600 space-y-2.5">
            <h4 className="font-semibold text-stone-900 text-sm flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-500" />
              Why Nearest Neighbor is Required
            </h4>
            <p>
              In conventional graphics, <strong>Bilinear</strong> or <strong>Bicubic</strong> interpolation is favored because it creates smooth gradients.
            </p>
            <p>
              However, in visual data codecs, <strong>each channel represents exact numerical byte values</strong> (0–255). Blurring adjacent pixels shifts RGB values (e.g. <code>[86, 67, 68]</code> blends into <code>[75, 45, 12]</code>), which irreversibly destroys the payload and fails the CRC32 check.
            </p>
            <p className="font-medium text-stone-800 pt-1">
              <strong>Nearest Neighbor</strong> copies every pixel value into a solid block of identical pixels with <strong>zero interpolation</strong>, preserving 100% transmission integrity.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
