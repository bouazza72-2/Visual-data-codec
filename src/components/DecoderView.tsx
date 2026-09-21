import React, { useState, useRef } from 'react';
import {
  FileDown,
  UploadCloud,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Binary,
  Copy,
  Check,
  ArrowRight,
  Info,
  CheckCircle,
  Wrench,
  Sparkles,
  Cpu,
  AlertTriangle,
} from 'lucide-react';
import { DecodeResult } from '../types';
import { decodeImageFile, decodeCanvasToBytes } from '../utils/codec';

export const DecoderView: React.FC = () => {
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'text' | 'hex'>('text');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [noiseStatus, setNoiseStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const processFile = async (file: File) => {
    setErrorMsg(null);
    setNoiseStatus(null);
    setIsProcessing(true);
    setSelectedFileName(file.name);
    try {
      const img = new Image();
      const reader = new FileReader();

      await new Promise<void>((resolve, reject) => {
        reader.onload = () => {
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              reject(new Error('Canvas context failure'));
              return;
            }
            ctx.drawImage(img, 0, 0);
            loadedCanvasRef.current = canvas;

            try {
              const result = decodeCanvasToBytes(canvas);
              setDecodeResult(result);
              setActiveView(result.isUtf8Text ? 'text' : 'hex');
              resolve();
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = () => reject(new Error('Failed to load image file.'));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown decoding error occurred.';
      setErrorMsg(msg);
      setDecodeResult(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSimulateNoise = () => {
    if (!loadedCanvasRef.current || !decodeResult) return;
    const origCanvas = loadedCanvasRef.current;
    const testCanvas = document.createElement('canvas');
    testCanvas.width = origCanvas.width;
    testCanvas.height = origCanvas.height;
    const ctx = testCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(origCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height);
    const data = imgData.data;

    // Mutate color channels in data row (Row 1) to simulate transmission color shift
    const row1Start = testCanvas.width * 4;
    const corruptedIndices: number[] = [];
    for (let i = 0; i < 4; i++) {
      const idx = row1Start + i * 12;
      if (idx < data.length - 3) {
        data[idx] = (data[idx] + 83) % 256;      // R shift
        data[idx + 1] = (data[idx + 1] + 137) % 256;  // G shift
        corruptedIndices.push(idx);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    try {
      const result = decodeCanvasToBytes(testCanvas);
      setDecodeResult(result);
      if (result.eccCorrectedCount > 0) {
        setNoiseStatus(`Simulated color shift injected: Reed-Solomon successfully repaired ${result.eccCorrectedCount} corrupted byte(s)!`);
      } else {
        setNoiseStatus('Tested: image decoded.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Decoding failed';
      setErrorMsg(msg);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDownloadDecoded = () => {
    if (!decodeResult) return;
    const blob = new Blob([decodeResult.reconstructedBytes as unknown as BlobPart], {
      type: decodeResult.isUtf8Text ? 'text/plain;charset=utf-8' : 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const extension = decodeResult.isUtf8Text ? 'txt' : 'bin';
    const baseName = selectedFileName ? selectedFileName.replace(/\.[^/.]+$/, '') : 'decoded_output';
    a.download = `${baseName}_reconstructed.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyText = () => {
    if (!decodeResult?.decodedText) return;
    navigator.clipboard.writeText(decodeResult.decodedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format hex dump (first 256 bytes)
  const formatHexDump = (bytes: Uint8Array, limit: number = 256): string => {
    const slice = bytes.slice(0, limit);
    let output = '';
    for (let i = 0; i < slice.length; i += 16) {
      const offsetHex = i.toString(16).padStart(6, '0').toUpperCase();
      const chunk = slice.slice(i, i + 16);
      let hexPart = '';
      let asciiPart = '';

      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          const byte = chunk[j];
          hexPart += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
          asciiPart += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
        } else {
          hexPart += '   ';
        }
      }
      output += `${offsetHex}:  ${hexPart} |${asciiPart}|\n`;
    }
    if (bytes.length > limit) {
      output += `\n... [${(bytes.length - limit).toLocaleString()} additional bytes omitted from preview]`;
    }
    return output;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Upload Zone */}
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                Decode PNG Pixel Grid to Data
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Upload any PNG encoded by the Python script or browser encoder to parse Row 0 & verify CRC32.
              </p>
            </div>
            {selectedFileName && (
              <span className="text-xs font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-md border border-stone-200">
                {selectedFileName}
              </span>
            )}
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/png,image/*"
            className="hidden"
          />

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-stone-300 hover:border-indigo-500 hover:bg-indigo-50/20 rounded-2xl p-8 text-center cursor-pointer transition-all"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <UploadCloud className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-medium text-stone-800">
              Click to select or drag and drop an encoded PNG image
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Validates 24-byte Row-0 header magic (<code>VCDC</code>), checks mode, and computes CRC32
            </p>
          </div>

          {errorMsg && (
            <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong>Decoding Failed:</strong> {errorMsg}
              </div>
            </div>
          )}
        </div>

        {/* Decoder Result Display */}
        {decodeResult && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
            
            {/* Header / Checksum Verification Status Banner */}
            <div
              className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                decodeResult.isChecksumValid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-3">
                {decodeResult.isChecksumValid ? (
                  <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    <span>
                      {decodeResult.isChecksumValid
                        ? 'CRC32 Checksum Verified: 100% Bit-Exact Match'
                        : 'CRC32 Checksum Mismatch: Data Corrupted'}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/70 border border-current font-normal">
                      IEEE 802.3
                    </span>
                  </div>
                  <p className="text-xs opacity-80 mt-0.5">
                    Expected from Row-0 header: <code>{decodeResult.header.expectedCrcHex}</code> • Calculated from payload: <code>{decodeResult.calculatedCrcHex}</code>
                  </p>
                </div>
              </div>

              <button
                id="btn-download-decoded"
                onClick={handleDownloadDecoded}
                className="flex items-center gap-1.5 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-all"
              >
                <FileDown className="w-4 h-4 text-emerald-400" />
                <span>Download Restored File</span>
              </button>
            </div>

            {/* Metadata Overview Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-sans">Magic & Mode</span>
                <span className="font-mono font-bold text-stone-900 text-sm">
                  {decodeResult.header.magic} • {decodeResult.header.mode}
                </span>
                <span className="text-stone-400 text-[10px] block">
                  {decodeResult.header.mode === 'RGB' ? '3 Bytes / Pixel' : '1 Byte / Pixel'}
                </span>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-sans">Payload Size</span>
                <span className="font-mono font-bold text-stone-900 text-sm">
                  {decodeResult.header.payloadLength.toLocaleString()} B
                </span>
                <span className="text-stone-400 text-[10px] block">
                  Exact byte count
                </span>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-sans">Dimensions</span>
                <span className="font-mono font-bold text-stone-900 text-sm">
                  {decodeResult.dimensions.width} × {decodeResult.dimensions.height}
                </span>
                <span className="text-stone-400 text-[10px] block">
                  {decodeResult.upscaleFactor ? (
                    <span className="text-purple-600 font-semibold">
                      Auto-restored from {decodeResult.upscaleFactor}× upscale
                    </span>
                  ) : (
                    `Row 0 + ${decodeResult.dimensions.height - 1} data rows`
                  )}
                </span>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <span className="text-stone-400 text-[10px] uppercase block font-sans">Detected Type</span>
                <span className="font-bold text-stone-900 text-sm flex items-center gap-1">
                  {decodeResult.isUtf8Text ? 'UTF-8 Text' : 'Binary File'}
                </span>
                <span className="text-stone-400 text-[10px] block">
                  {decodeResult.isUtf8Text ? 'Valid unicode characters' : 'Raw byte sequence'}
                </span>
              </div>
            </div>

            {/* Reed-Solomon Forward Error Correction (FEC) Status Card */}
            <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-stone-900 flex items-center gap-2">
                    <span>Forward Error Correction (Reed-Solomon)</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {decodeResult.header.eccParityBytes && decodeResult.header.eccParityBytes > 0
                        ? `RS(${decodeResult.header.eccBlockSize || 255}, ${(decodeResult.header.eccBlockSize || 255) - decodeResult.header.eccParityBytes})`
                        : 'No ECC'}
                    </span>
                  </div>
                  <p className="text-stone-600 text-[11px] mt-0.5">
                    {decodeResult.eccCorrectedCount > 0 ? (
                      <strong className="text-emerald-700 font-semibold">
                        Repaired {decodeResult.eccCorrectedCount} corrupted byte{decodeResult.eccCorrectedCount > 1 ? 's' : ''} (bit flips / optical color shifts) before CRC32 check!
                      </strong>
                    ) : decodeResult.header.eccParityBytes && decodeResult.header.eccParityBytes > 0 ? (
                      <span>
                        Protected with {decodeResult.header.eccParityBytes} parity bytes per block. Zero errors detected in transmission.
                      </span>
                    ) : (
                      <span className="text-stone-500">
                        Image encoded without ECC parity bytes. Raw payload extracted directly.
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {decodeResult.header.eccParityBytes && decodeResult.header.eccParityBytes > 0 && (
                <button
                  type="button"
                  onClick={handleSimulateNoise}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-xl shadow-2xs transition-all shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Simulate Color Shift &amp; Auto-Repair</span>
                </button>
              )}
            </div>

            {noiseStatus && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{noiseStatus}</span>
              </div>
            )}

            {/* Reconstructed Data Content View */}
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <div className="bg-stone-50 px-4 py-2.5 border-b border-stone-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {decodeResult.isUtf8Text && (
                    <button
                      onClick={() => setActiveView('text')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        activeView === 'text'
                          ? 'bg-white text-stone-900 shadow-xs border border-stone-200 font-semibold'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Decoded Text</span>
                    </button>
                  )}

                  <button
                    onClick={() => setActiveView('hex')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      activeView === 'hex'
                        ? 'bg-white text-stone-900 shadow-xs border border-stone-200 font-semibold'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <Binary className="w-3.5 h-3.5" />
                    <span>Hex Dump</span>
                  </button>
                </div>

                {activeView === 'text' && decodeResult.decodedText && (
                  <button
                    onClick={handleCopyText}
                    className="flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900 font-medium"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Text</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="p-4 bg-stone-900 text-stone-100 font-mono text-xs overflow-auto max-h-96">
                {activeView === 'text' && decodeResult.decodedText ? (
                  <pre className="whitespace-pre-wrap font-mono text-emerald-400 leading-relaxed">
                    {decodeResult.decodedText}
                  </pre>
                ) : (
                  <pre className="whitespace-pre font-mono text-stone-300 leading-tight">
                    {formatHexDump(decodeResult.reconstructedBytes)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
