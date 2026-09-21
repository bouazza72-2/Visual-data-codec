import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  FolderOpen,
  UploadCloud,
  Download,
  Copy,
  Check,
  Layers,
  FileText,
  Binary,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  ArrowUpDown,
  Terminal,
  FileCode,
  Sparkles,
  Eye,
  Info,
  FolderArchive,
  ArrowRight,
} from 'lucide-react';
import { DecodeResult } from '../types';
import { decodeImageFile, encodeBytesToCanvas } from '../utils/codec';
import { formatCRC32Hex } from '../utils/crc32';
import { BatchProgressBar } from './BatchProgressBar';

export interface BatchItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'processing' | 'success' | 'repaired' | 'error';
  errorMessage?: string;
  decodeResult?: DecodeResult;
  thumbnailUrl?: string;
  included: boolean;
}

export const BatchProcessorView: React.FC = () => {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number | null>(null);
  const [currentFrameName, setCurrentFrameName] = useState<string>('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'name-asc' | 'name-desc' | 'size-asc' | 'size-desc'>('name-asc');
  const [activePreviewTab, setActivePreviewTab] = useState<'combined-text' | 'combined-hex' | 'manifest'>('combined-text');
  const [separatorMode, setSeparatorMode] = useState<'raw' | 'newline' | 'space'>('raw');
  const [dirPathInput, setDirPathInput] = useState<string>('./vcdc_frames');
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [selectedItemForModal, setSelectedItemForModal] = useState<BatchItem | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  // Live timer interval to update elapsedMs smoothly during execution
  useEffect(() => {
    if (!isProcessing || !startTime) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      setElapsedMs(elapsed);

      if (progress.current > 0 && progress.total > progress.current) {
        const avgPerItem = elapsed / progress.current;
        const remainingItems = progress.total - progress.current;
        setEstimatedRemainingMs(avgPerItem * remainingItems);
      } else if (progress.current >= progress.total && progress.total > 0) {
        setEstimatedRemainingMs(0);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isProcessing, startTime, progress.current, progress.total]);

  // Natural sort comparator for filenames (e.g. frame_1, frame_2, frame_10)
  const sortItems = (itemList: BatchItem[], order: typeof sortOrder) => {
    return [...itemList].sort((a, b) => {
      if (order === 'name-asc') {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (order === 'name-desc') {
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (order === 'size-asc') {
        return a.size - b.size;
      } else {
        return b.size - a.size;
      }
    });
  };

  const addFilesToBatch = (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.png')
    );

    if (rawFiles.length === 0) return;

    const newItems: BatchItem[] = rawFiles.map((f, idx) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${idx}`,
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',
      thumbnailUrl: URL.createObjectURL(f),
      included: true,
    }));

    setItems((prev) => {
      const combined = [...prev, ...newItems];
      return sortItems(combined, sortOrder);
    });
  };

  // Modern Directory Picker using File System Access API
  const handlePickDirectoryApi = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
        const collectedFiles: File[] = [];
        setDirPathInput(dirHandle.name);

        for await (const entry of (dirHandle as unknown as AsyncIterable<FileSystemHandle>)) {
          if (entry.kind === 'file') {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            if (file.name.toLowerCase().endsWith('.png') || file.type.startsWith('image/')) {
              collectedFiles.push(file);
            }
          }
        }

        if (collectedFiles.length > 0) {
          addFilesToBatch(collectedFiles);
        }
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          // Fallback to standard input
          folderInputRef.current?.click();
        }
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  // Generate a sequential test batch of 5 frames
  const handleGenerateSampleBatch = async () => {
    setIsProcessing(true);
    try {
      const samplePayloads = [
        '[CHUNK 1/5 - HEADER & INITIALIZATION]\nProtocol: Visual Data Codec (VCDC)\nTimestamp: 2026-09-21T10:40:00Z\nTransmission Mode: 24-bit Lossless Optical Grid\nForward Error Correction: Reed-Solomon RS(255, 239)\nStatus: SYNCHRONIZED\n\n',
        '[CHUNK 2/5 - SYSTEM TELEMETRY]\nFramerate: 60 FPS Target\nUpscale Factor: 10x Lossless Nearest-Neighbor\nParity Symbols: 16 bytes per block\nChannel Noise Resilience: Up to 8 corrupted bytes/block recovered\nGrid Dimension: 64 columns x 2 rows\n\n',
        '[CHUNK 3/5 - DATA STREAM PAYLOAD]\nTransmitting multi-frame sequential telemetry packet.\nVerifying end-to-end data integrity over visual optical links.\nAll pixel coordinates are center-sampled to mitigate chroma subsampling artifacts.\n\n',
        '[CHUNK 4/5 - CHECKPOINT VERIFICATION]\nIEEE 802.3 CRC32 hardware-grade polynomial: 0xEDB88320\nRow 0 metadata structure validated: Magic=VCDC, End=END\\0\nBit-level reassembly verified.\n\n',
        '[CHUNK 5/5 - TRANSMISSION COMPLETE]\nEnd of Visual Data Codec batch sequence.\nAll 5 chunks reassembled sequentially with 100% bit-for-bit fidelity.\nStream Status: SUCCESS / COMPLETED.\n',
      ];

      const generatedFiles: File[] = [];

      for (let i = 0; i < samplePayloads.length; i++) {
        const textBytes = new TextEncoder().encode(samplePayloads[i]);
        const enc = encodeBytesToCanvas(textBytes, 'RGB', 64, 16, 255);

        // Convert canvas to blob
        const blob = await new Promise<Blob>((resolve) => {
          enc.canvas.toBlob((b: Blob | null) => resolve(b || new Blob()), 'image/png');
        });

        const frameNum = String(i + 1).padStart(3, '0');
        const file = new File([blob], `vcdc_frame_${frameNum}.png`, { type: 'image/png' });
        generatedFiles.push(file);
      }

      addFilesToBatch(generatedFiles);
    } finally {
      setIsProcessing(false);
    }
  };

  // Process all pending items sequentially
  const handleProcessBatch = async () => {
    if (items.length === 0 || isProcessing) return;

    setIsProcessing(true);
    const start = performance.now();
    setStartTime(start);
    setElapsedMs(0);
    setEstimatedRemainingMs(null);
    setProgress({ current: 0, total: items.length });

    const updated = [...items];

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      setCurrentFrameName(item.name);

      // Mark processing
      item.status = 'processing';
      setItems([...updated]);

      try {
        const decodeRes = await decodeImageFile(item.file);
        item.decodeResult = decodeRes;
        item.status = decodeRes.eccCorrectedCount > 0 ? 'repaired' : 'success';
        item.errorMessage = undefined;
      } catch (err: unknown) {
        item.status = 'error';
        item.errorMessage = err instanceof Error ? err.message : 'Decoding failed';
      }

      const completedCount = i + 1;
      setProgress({ current: completedCount, total: updated.length });
      
      const now = performance.now();
      const currentElapsed = now - start;
      setElapsedMs(currentElapsed);

      if (completedCount < updated.length) {
        const avgPerItem = currentElapsed / completedCount;
        setEstimatedRemainingMs(avgPerItem * (updated.length - completedCount));
      } else {
        setEstimatedRemainingMs(0);
      }

      setItems([...updated]);
    }

    setIsProcessing(false);
    setCurrentFrameName('');
  };

  const handleClearAll = () => {
    items.forEach((it) => {
      if (it.thumbnailUrl) URL.revokeObjectURL(it.thumbnailUrl);
    });
    setItems([]);
    setProgress({ current: 0, total: 0 });
    setElapsedMs(0);
    setEstimatedRemainingMs(null);
    setStartTime(null);
    setCurrentFrameName('');
  };

  const handleToggleInclude = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, included: !it.included } : it))
    );
  };

  const handleSortChange = (newOrder: typeof sortOrder) => {
    setSortOrder(newOrder);
    setItems((prev) => sortItems(prev, newOrder));
  };

  // Compute summary stats
  const stats = useMemo(() => {
    const total = items.length;
    const completed = items.filter((it) => it.status === 'success' || it.status === 'repaired');
    const repaired = items.filter((it) => it.status === 'repaired');
    const errors = items.filter((it) => it.status === 'error');
    const totalBytes = completed.reduce(
      (acc, it) => acc + (it.decodeResult ? it.decodeResult.reconstructedBytes.length : 0),
      0
    );
    const totalRepairedBytes = completed.reduce(
      (acc, it) => acc + (it.decodeResult ? it.decodeResult.eccCorrectedCount : 0),
      0
    );

    return {
      total,
      completedCount: completed.length,
      repairedCount: repaired.length,
      errorCount: errors.length,
      totalBytes,
      totalRepairedBytes,
      successRate: total > 0 ? Math.round((completed.length / total) * 100) : 0,
    };
  }, [items]);

  // Combine reconstructed payloads in order
  const combinedData = useMemo(() => {
    const includedItems = items.filter(
      (it) => it.included && (it.status === 'success' || it.status === 'repaired') && it.decodeResult
    );

    if (includedItems.length === 0) {
      return {
        bytes: new Uint8Array(0),
        isAllUtf8: true,
        text: '',
        chunksCount: 0,
      };
    }

    // Determine separator bytes
    let sepBytes = new Uint8Array(0);
    if (separatorMode === 'newline') {
      sepBytes = new TextEncoder().encode('\n');
    } else if (separatorMode === 'space') {
      sepBytes = new TextEncoder().encode(' ');
    }

    // Calculate total length
    let totalLen = 0;
    includedItems.forEach((it, idx) => {
      totalLen += it.decodeResult!.reconstructedBytes.length;
      if (idx < includedItems.length - 1) {
        totalLen += sepBytes.length;
      }
    });

    const combinedBytes = new Uint8Array(totalLen);
    let offset = 0;
    let allUtf8 = true;
    let combinedText = '';

    includedItems.forEach((it, idx) => {
      const bytes = it.decodeResult!.reconstructedBytes;
      combinedBytes.set(bytes, offset);
      offset += bytes.length;

      if (!it.decodeResult!.isUtf8Text) {
        allUtf8 = false;
      }

      if (idx < includedItems.length - 1 && sepBytes.length > 0) {
        combinedBytes.set(sepBytes, offset);
        offset += sepBytes.length;
      }
    });

    if (allUtf8) {
      try {
        combinedText = new TextDecoder('utf-8', { fatal: true }).decode(combinedBytes);
      } catch {
        allUtf8 = false;
      }
    }

    return {
      bytes: combinedBytes,
      isAllUtf8: allUtf8,
      text: combinedText,
      chunksCount: includedItems.length,
    };
  }, [items, separatorMode]);

  // Download combined file
  const handleDownloadCombined = () => {
    if (combinedData.bytes.length === 0) return;

    const isText = combinedData.isAllUtf8;
    const mime = isText ? 'text/plain;charset=utf-8' : 'application/octet-stream';
    const extension = isText ? 'txt' : 'bin';
    const filename = `combined_vcdc_output.${extension}`;

    const blob = new Blob([combinedData.bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download JSON Manifest
  const handleDownloadManifest = () => {
    const manifest = {
      generator: 'Visual Data Codec Batch Processor v2',
      exportedAt: new Date().toISOString(),
      stats: {
        totalFrames: stats.total,
        successfullyDecoded: stats.completedCount,
        repairedFrames: stats.repairedCount,
        totalBytesReconstructed: stats.totalBytes,
        totalErrorsRepaired: stats.totalRepairedBytes,
      },
      frames: items.map((it, index) => ({
        index,
        fileName: it.name,
        fileSize: it.size,
        status: it.status,
        included: it.included,
        errorMessage: it.errorMessage,
        codecHeader: it.decodeResult
          ? {
              magic: it.decodeResult.header.magic,
              mode: it.decodeResult.header.mode,
              payloadLength: it.decodeResult.header.payloadLength,
              expectedCrc32Hex: it.decodeResult.header.expectedCrcHex,
              calculatedCrc32Hex: it.decodeResult.calculatedCrcHex,
              isChecksumValid: it.decodeResult.isChecksumValid,
              eccParityBytes: it.decodeResult.header.eccParityBytes,
              eccBlockSize: it.decodeResult.header.eccBlockSize,
              eccCorrectedBytes: it.decodeResult.eccCorrectedCount,
              upscaleFactor: it.decodeResult.upscaleFactor || 1,
              nativeDimensions: it.decodeResult.dimensions,
            }
          : null,
      })),
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vcdc_batch_manifest.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyCombinedText = () => {
    if (combinedData.text) {
      navigator.clipboard.writeText(combinedData.text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    }
  };

  // Generated CLI batch command for Python
  const pythonBatchCommand = `python3 visual_codec.py batch --dir "${dirPathInput}" -o combined_restored.txt`;

  const handleCopyCliCommand = () => {
    navigator.clipboard.writeText(pythonBatchCommand);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hidden File / Folder Inputs */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but supported in all modern browsers
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFilesToBatch(e.target.files);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/png,image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFilesToBatch(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-stone-100 text-stone-700 border border-stone-200">
              VCDC Multi-Frame Pipeline
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
              RS FEC Bit-Flip Recovery
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Layers className="w-3 h-3 mr-1 text-indigo-600" />
              Sequential Chunk Stitching
            </span>
          </div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <span>Batch Frame Processor</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 font-mono">
              Auto-Decode &amp; Reassembly
            </span>
          </h2>
          <p className="text-xs text-stone-600 mt-1 max-w-3xl">
            Upload an entire folder of VCDC pixel grid frames or point to a recorded directory. Automatically decodes multi-scale images (1× to 10×), repairs sensor noise and color shifts via Reed-Solomon FEC, validates CRC32 integrity, and stitches sequential chunks into a restored file.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            id="btn-generate-sample-batch"
            type="button"
            onClick={handleGenerateSampleBatch}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold border border-stone-200 transition-all cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Load Sample Batch</span>
          </button>

          <button
            id="btn-upload-folder"
            type="button"
            onClick={handlePickDirectoryApi}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Select Folder</span>
          </button>
        </div>
      </div>

      {/* Directory Path Helper & Drag-and-Drop Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Dropzone & File Ingestion (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                addFilesToBatch(e.dataTransfer.files);
              }
            }}
            className="border-2 border-dashed border-stone-300 hover:border-stone-400 rounded-2xl p-6 bg-white hover:bg-stone-50/60 transition-all text-center flex flex-col items-center justify-center space-y-3 shadow-2xs"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200 shadow-2xs">
              <FolderArchive className="w-6 h-6 text-amber-600" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-bold text-stone-900">
                Drag and drop a folder or multiple VCDC image frames here
              </p>
              <p className="text-xs text-stone-500 max-w-md">
                Supports PNG pixel grids (native 1× or 10× upscaled). Natural alphanumeric sorting ensures sequential ordering of chunked streams.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                id="btn-pick-folder-action"
                type="button"
                onClick={handlePickDirectoryApi}
                className="px-3.5 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>Upload Folder</span>
              </button>

              <span className="text-xs text-stone-400">or</span>

              <button
                id="btn-pick-files-action"
                type="button"
                onClick={() => filesInputRef.current?.click()}
                className="px-3.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold border border-stone-200 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5 text-stone-600" />
                <span>Select Multiple Files</span>
              </button>
            </div>
          </div>

          {/* Directory Path & Python CLI Companion */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-stone-700" />
                Directory Path &amp; Python CLI Command
              </h3>
              <span className="text-[11px] font-mono text-stone-500">Terminal Batch Mode</span>
            </div>

            <p className="text-xs text-stone-600">
              Process hundreds of frames directly from a local directory path on your machine using the Python backend:
            </p>

            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  id="input-dir-path"
                  type="text"
                  value={dirPathInput}
                  onChange={(e) => setDirPathInput(e.target.value)}
                  placeholder="/path/to/frames_folder"
                  className="w-full pl-3 pr-24 py-1.5 rounded-lg border border-stone-200 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-stone-400 bg-stone-50 text-stone-800"
                />
                <button
                  type="button"
                  onClick={handlePickDirectoryApi}
                  className="absolute right-1.5 top-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-200 hover:bg-stone-300 text-stone-700 transition-all cursor-pointer"
                >
                  Browse...
                </button>
              </div>

              <button
                id="btn-copy-cli-command"
                type="button"
                onClick={handleCopyCliCommand}
                className="px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCmd ? 'Copied' : 'Copy CLI Command'}</span>
              </button>
            </div>

            <div className="bg-stone-900 rounded-lg p-2.5 text-[11px] font-mono text-stone-300 overflow-x-auto border border-stone-800">
              <code>{pythonBatchCommand}</code>
            </div>
          </div>
        </div>

        {/* Right Column: Statistics & Execution Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-stone-700" />
                Batch Overview &amp; Control
              </h3>
              {items.length > 0 && (
                <button
                  id="btn-clear-batch"
                  type="button"
                  onClick={handleClearAll}
                  disabled={isProcessing}
                  className="text-stone-400 hover:text-rose-600 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear ({items.length})</span>
                </button>
              )}
            </div>

            {/* Metrics Matrix */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Frames Loaded</span>
                <p className="text-lg font-bold text-stone-900 font-mono">
                  {stats.completedCount} <span className="text-xs font-normal text-stone-500">/ {stats.total}</span>
                </p>
                <div className="text-[11px] text-stone-500">
                  {stats.successRate}% decoded
                </div>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Restored Data</span>
                <p className="text-lg font-bold text-emerald-700 font-mono">
                  {stats.totalBytes >= 1024
                    ? `${(stats.totalBytes / 1024).toFixed(2)} KB`
                    : `${stats.totalBytes} B`}
                </p>
                <div className="text-[11px] text-emerald-600">
                  {combinedData.chunksCount} chunks combined
                </div>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">RS FEC Repaired</span>
                <p className="text-lg font-bold text-amber-700 font-mono">
                  {stats.totalRepairedBytes} <span className="text-xs font-normal text-stone-500">bytes</span>
                </p>
                <div className="text-[11px] text-amber-600">
                  Across {stats.repairedCount} frames
                </div>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 space-y-0.5">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Failed / Corrupt</span>
                <p className="text-lg font-bold text-stone-900 font-mono">
                  {stats.errorCount} <span className="text-xs font-normal text-stone-500">errors</span>
                </p>
                <div className="text-[11px] text-stone-500">
                  {stats.errorCount === 0 ? 'Clean sequence' : 'Requires inspection'}
                </div>
              </div>
            </div>

            {/* Real-Time Progress Bar with D3.js & CSS Transitions */}
            {items.length > 0 && (
              <BatchProgressBar
                current={progress.current}
                total={items.length}
                isProcessing={isProcessing}
                elapsedMs={elapsedMs}
                estimatedRemainingMs={estimatedRemainingMs}
                currentFrameName={currentFrameName}
                repairedCount={stats.repairedCount}
                cleanCount={Math.max(0, stats.completedCount - stats.repairedCount)}
                errorCount={stats.errorCount}
              />
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                id="btn-process-batch"
                type="button"
                onClick={handleProcessBatch}
                disabled={items.length === 0 || isProcessing}
                className="flex-1 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Decoding Batch...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-amber-400" />
                    <span>Decode All ({items.length})</span>
                  </>
                )}
              </button>

              <button
                id="btn-export-combined-data"
                type="button"
                onClick={handleDownloadCombined}
                disabled={combinedData.bytes.length === 0 || isProcessing}
                className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Download className="w-4 h-4" />
                <span>Export Combined File</span>
              </button>
            </div>

            {/* Manifest & Settings Toggle */}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-stone-100">
              <button
                id="btn-download-manifest"
                type="button"
                onClick={handleDownloadManifest}
                disabled={items.length === 0}
                className="text-stone-600 hover:text-stone-900 font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-40"
              >
                <FileCode className="w-3.5 h-3.5 text-stone-500" />
                <span>Export JSON Manifest</span>
              </button>

              <div className="flex items-center gap-1.5 text-stone-500">
                <span className="text-[11px]">Delimiter:</span>
                <select
                  value={separatorMode}
                  onChange={(e) => setSeparatorMode(e.target.value as typeof separatorMode)}
                  className="px-2 py-0.5 rounded border border-stone-200 text-[11px] font-mono bg-stone-50 text-stone-700"
                >
                  <option value="raw">None (Binary / Exact)</option>
                  <option value="newline">Newline (\n)</option>
                  <option value="space">Space</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area: Frame Queue & Combined Reassembly Inspector */}
      {items.length > 0 && (
        <div className="space-y-6">
          {/* Controls Bar: Sort, Filter, Selection */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-xs font-bold text-stone-700 uppercase tracking-wide flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-stone-500" />
                Frame Sequence Queue ({items.length})
              </span>

              <span className="text-xs text-stone-400">•</span>

              <button
                type="button"
                onClick={() => {
                  const allIncluded = items.every((i) => i.included);
                  setItems((prev) => prev.map((i) => ({ ...i, included: !allIncluded })));
                }}
                className="text-xs text-stone-600 hover:text-stone-900 font-semibold underline decoration-dotted cursor-pointer"
              >
                {items.every((i) => i.included) ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <div className="flex items-center gap-1.5 text-xs text-stone-600">
                <ArrowUpDown className="w-3.5 h-3.5 text-stone-400" />
                <span>Sort by:</span>
                <select
                  value={sortOrder}
                  onChange={(e) => handleSortChange(e.target.value as typeof sortOrder)}
                  className="px-2.5 py-1 rounded-lg border border-stone-200 text-xs font-mono bg-stone-50 text-stone-700"
                >
                  <option value="name-asc">Filename (Natural 1→N)</option>
                  <option value="name-desc">Filename (N→1)</option>
                  <option value="size-asc">Size (Smallest first)</option>
                  <option value="size-desc">Size (Largest first)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table / List of Frames */}
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 font-mono text-[11px]">
                    <th className="py-2.5 px-4 w-12 text-center">Inc.</th>
                    <th className="py-2.5 px-4 w-12 text-center">#</th>
                    <th className="py-2.5 px-4 w-16 text-center">Preview</th>
                    <th className="py-2.5 px-4">Filename</th>
                    <th className="py-2.5 px-4">Status &amp; Integrity</th>
                    <th className="py-2.5 px-4">Mode / Scale</th>
                    <th className="py-2.5 px-4">Payload Size</th>
                    <th className="py-2.5 px-4">CRC32 Checksum</th>
                    <th className="py-2.5 px-4">RS ECC</th>
                    <th className="py-2.5 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-mono">
                  {items.map((item, index) => {
                    const res = item.decodeResult;
                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-stone-50/80 transition-colors ${
                          !item.included ? 'opacity-50 bg-stone-50/40' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={item.included}
                            onChange={() => handleToggleInclude(item.id)}
                            className="rounded border-stone-300 text-stone-900 focus:ring-stone-400 cursor-pointer"
                          />
                        </td>

                        {/* Sequential Index */}
                        <td className="py-3 px-4 text-center font-semibold text-stone-400">
                          {index + 1}
                        </td>

                        {/* Image Thumbnail */}
                        <td className="py-3 px-4 text-center">
                          {item.thumbnailUrl && (
                            <img
                              src={item.thumbnailUrl}
                              alt={item.name}
                              className="w-10 h-10 object-contain rounded border border-stone-200 bg-stone-950 mx-auto"
                            />
                          )}
                        </td>

                        {/* Filename */}
                        <td className="py-3 px-4 font-semibold text-stone-900 truncate max-w-xs">
                          {item.name}
                          <span className="block text-[10px] text-stone-400 font-normal">
                            {(item.size / 1024).toFixed(1)} KB file
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4">
                          {item.status === 'pending' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-600">
                              Pending
                            </span>
                          )}
                          {item.status === 'processing' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700">
                              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                              Decoding
                            </span>
                          )}
                          {item.status === 'success' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                              CRC32 Verified
                            </span>
                          )}
                          {item.status === 'repaired' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              <ShieldCheck className="w-3 h-3 mr-1 text-amber-600" />
                              RS Repaired
                            </span>
                          )}
                          {item.status === 'error' && (
                            <span
                              title={item.errorMessage}
                              className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
                            >
                              <ShieldAlert className="w-3 h-3 mr-1 text-rose-600" />
                              Failed
                            </span>
                          )}
                        </td>

                        {/* Mode / Scale */}
                        <td className="py-3 px-4 text-stone-600 text-[11px]">
                          {res ? (
                            <span>
                              {res.header.mode} • {res.upscaleFactor ? `${res.upscaleFactor}× Scale` : '1× Native'}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        {/* Payload Size */}
                        <td className="py-3 px-4 text-stone-900 font-semibold">
                          {res ? (
                            <span>{res.header.payloadLength} B</span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        {/* CRC32 */}
                        <td className="py-3 px-4 text-stone-700">
                          {res ? (
                            <span className={res.isChecksumValid ? 'text-emerald-700 font-bold' : 'text-rose-700'}>
                              {res.calculatedCrcHex}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        {/* RS ECC */}
                        <td className="py-3 px-4">
                          {res ? (
                            res.eccCorrectedCount > 0 ? (
                              <span className="text-amber-700 font-semibold">
                                +{res.eccCorrectedCount} repaired
                              </span>
                            ) : res.header.eccParityBytes > 0 ? (
                              <span className="text-stone-500">Clean</span>
                            ) : (
                              <span className="text-stone-400">None</span>
                            )
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        {/* Inspect Details Button */}
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedItemForModal(item)}
                            disabled={!res}
                            className="p-1 rounded hover:bg-stone-100 text-stone-600 hover:text-stone-900 disabled:opacity-30 cursor-pointer"
                            title="Inspect Frame"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Combined Reassembly Viewer */}
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs space-y-0">
            <div className="p-4 bg-stone-50 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                <h3 className="text-sm font-bold text-stone-900">
                  Combined Reassembly Preview ({combinedData.chunksCount} chunks stitched)
                </h3>
                <span className="text-xs font-mono text-stone-500">
                  ({combinedData.bytes.length} total bytes)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-stone-200 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab('combined-text')}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      activePreviewTab === 'combined-text'
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 inline mr-1" />
                    Combined Text
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivePreviewTab('combined-hex')}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      activePreviewTab === 'combined-hex'
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <Binary className="w-3.5 h-3.5 inline mr-1" />
                    Hex / Bytes
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivePreviewTab('manifest')}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      activePreviewTab === 'manifest'
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5 inline mr-1" />
                    Manifest
                  </button>
                </div>

                {activePreviewTab === 'combined-text' && combinedData.text && (
                  <button
                    id="btn-copy-combined-text"
                    type="button"
                    onClick={handleCopyCombinedText}
                    className="p-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    title="Copy Combined Text"
                  >
                    {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedText ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Viewer Display Body */}
            <div className="p-4 bg-stone-950 text-stone-200 font-mono text-xs overflow-x-auto min-h-[160px] max-h-[380px]">
              {activePreviewTab === 'combined-text' && (
                combinedData.text ? (
                  <pre className="whitespace-pre-wrap selection:bg-stone-700 text-emerald-400">
                    {combinedData.text}
                  </pre>
                ) : combinedData.bytes.length > 0 ? (
                  <div className="text-amber-400 p-4 text-center space-y-2">
                    <p>Reconstructed payload contains binary data (non-UTF8 characters).</p>
                    <p className="text-stone-400 text-xs">Switch to "Hex / Bytes" tab or click "Export Combined File" to download as a .bin file.</p>
                  </div>
                ) : (
                  <p className="text-stone-500 italic p-4 text-center">
                    No frames decoded yet. Click "Decode All" above to reassemble the stream.
                  </p>
                )
              )}

              {activePreviewTab === 'combined-hex' && (
                combinedData.bytes.length > 0 ? (
                  <div className="grid grid-cols-1 gap-1 text-[11px]">
                    {Array.from({ length: Math.min(Math.ceil(combinedData.bytes.length / 16), 128) }).map((_, rowIdx) => {
                      const start = rowIdx * 16;
                      const slice = combinedData.bytes.slice(start, start + 16);
                      const hexParts = Array.from(slice)
                        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                        .join(' ');
                      const ascii = Array.from(slice)
                        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
                        .join('');

                      return (
                        <div key={rowIdx} className="flex gap-4 hover:bg-stone-900 py-0.5 px-1 rounded">
                          <span className="text-stone-600 select-none">
                            {start.toString(16).padStart(6, '0').toUpperCase()}:
                          </span>
                          <span className="text-stone-300 tracking-wider flex-1">{hexParts.padEnd(48, ' ')}</span>
                          <span className="text-amber-400 select-none">{ascii}</span>
                        </div>
                      );
                    })}
                    {combinedData.bytes.length > 2048 && (
                      <p className="text-stone-500 pt-2 text-center text-xs">
                        ... {combinedData.bytes.length - 2048} more bytes omitted from web preview (download file for complete data)
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-stone-500 italic p-4 text-center">
                    No bytes extracted yet.
                  </p>
                )
              )}

              {activePreviewTab === 'manifest' && (
                <pre className="text-stone-300 text-[11px] selection:bg-stone-800">
                  {JSON.stringify(
                    {
                      totalFrames: stats.total,
                      verifiedChecksums: stats.completedCount,
                      totalBytes: stats.totalBytes,
                      rsRepairedBytes: stats.totalRepairedBytes,
                      sequence: items
                        .filter((it) => it.included && it.decodeResult)
                        .map((it, idx) => ({
                          chunkIndex: idx + 1,
                          filename: it.name,
                          bytes: it.decodeResult?.header.payloadLength,
                          crc32: it.decodeResult?.calculatedCrcHex,
                          eccRepairs: it.decodeResult?.eccCorrectedCount,
                        })),
                    },
                    null,
                    2
                  )}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Frame Detail Inspection Modal */}
      {selectedItemForModal && selectedItemForModal.decodeResult && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-stone-200 max-w-2xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-stone-700" />
                <span>Frame Inspection: {selectedItemForModal.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedItemForModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold text-lg px-2 cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Magic &amp; Mode</span>
                <p className="font-bold text-stone-900 font-mono">
                  {selectedItemForModal.decodeResult.header.magic} ({selectedItemForModal.decodeResult.header.mode})
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                <span className="text-[10px] uppercase text-stone-500 font-mono">CRC32 Checksum</span>
                <p className="font-bold text-emerald-700 font-mono">
                  {selectedItemForModal.decodeResult.calculatedCrcHex}
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                <span className="text-[10px] uppercase text-stone-500 font-mono">RS FEC Status</span>
                <p className="font-bold text-amber-700 font-mono">
                  {selectedItemForModal.decodeResult.eccCorrectedCount > 0
                    ? `Repaired ${selectedItemForModal.decodeResult.eccCorrectedCount} B`
                    : 'Clean'}
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                <span className="text-[10px] uppercase text-stone-500 font-mono">Detected Scale</span>
                <p className="font-bold text-stone-900 font-mono">
                  {selectedItemForModal.decodeResult.upscaleFactor || 1}× Scale
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-700">Decoded Payload Content:</label>
              <div className="bg-stone-950 p-3 rounded-xl font-mono text-xs text-stone-200 max-h-48 overflow-y-auto">
                {selectedItemForModal.decodeResult.isUtf8Text ? (
                  <pre className="whitespace-pre-wrap text-emerald-400">
                    {selectedItemForModal.decodeResult.decodedText}
                  </pre>
                ) : (
                  <p className="text-stone-400 italic">Binary data (non UTF-8)</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedItemForModal(null)}
                className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
