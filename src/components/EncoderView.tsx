import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Download,
  FileUp,
  Type,
  Palette,
  CheckCircle2,
  Sliders,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { CodecMode, EncodeResult } from '../types';
import { encodeBytesToCanvas } from '../utils/codec';
import { HeaderInspector } from './HeaderInspector';
import { PixelMagnifier } from './PixelMagnifier';

const PRESETS = [
  {
    name: 'Sample Message',
    content:
      'Hello from the Visual Data Codec! 🎨\n\n' +
      'This message has been serialized into an array of bytes, mapped into RGB pixel channels (3 bytes per pixel), ' +
      'and prefixed with a 24-byte Row-0 metadata header holding the Magic Bytes (VCDC), mode, byte size, and CRC32 checksum.',
  },
  {
    name: 'JSON Config',
    content: JSON.stringify(
      {
        codec: 'visual_codec.py',
        version: '1.0.0',
        author: 'Google AI Studio',
        spec: {
          headerRow: 0,
          magic: 'VCDC',
          crc32: true,
          rgbBytesPerPixel: 3,
          monoBytesPerPixel: 1,
        },
        features: ['Lossless PNG', 'NumPy Array', 'PIL Interop', 'OpenCV Interop'],
      },
      null,
      2
    ),
  },
  {
    name: 'Python Code',
    content:
      'import numpy as np\n' +
      'import zlib, struct\n\n' +
      '# Encode bytes to image with Row-0 CRC32 header\n' +
      'data = b"Visual Codec Demo"\n' +
      'crc = zlib.crc32(data) & 0xFFFFFFFF\n' +
      'header = struct.pack(">4sB3sQI4s", b"VCDC", 1, b"\\x00\\x00\\x00", len(data), crc, b"END\\x00")\n' +
      'print(f"Header length: {len(header)} bytes, CRC32: {hex(crc)}")\n',
  },
];

export const EncoderView: React.FC = () => {
  const [inputTab, setInputTab] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState<string>(PRESETS[0].content);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number; bytes: Uint8Array } | null>(null);
  const [mode, setMode] = useState<CodecMode>('RGB');
  const [minWidth, setMinWidth] = useState<number>(64);
  const [eccParityBytes, setEccParityBytes] = useState<number>(16);
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Derive current binary bytes to encode
  const currentBytes = useMemo<Uint8Array>(() => {
    if (inputTab === 'file' && uploadedFile) {
      return uploadedFile.bytes;
    }
    return new TextEncoder().encode(textInput);
  }, [inputTab, uploadedFile, textInput]);

  // Re-encode whenever input bytes, mode, minWidth, or eccParityBytes change
  useEffect(() => {
    try {
      const result = encodeBytesToCanvas(currentBytes, mode, minWidth, eccParityBytes, 255);
      setEncodeResult(result);
    } catch (err) {
      console.error('Encoding error:', err);
    }
  }, [currentBytes, mode, minWidth, eccParityBytes]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      setUploadedFile({
        name: file.name,
        size: file.size,
        bytes: new Uint8Array(arrayBuffer),
      });
      setInputTab('file');
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadPNG = () => {
    if (!encodeResult) return;
    const a = document.createElement('a');
    a.href = encodeResult.imageDataUrl;
    const filename =
      inputTab === 'file' && uploadedFile
        ? `${uploadedFile.name.replace(/\.[^/.]+$/, '')}_encoded_${mode.toLowerCase()}.png`
        : `encoded_data_${mode.toLowerCase()}.png`;
    a.download = filename;
    a.click();
  };

  const handleDownloadUpscaledPNG = () => {
    if (!encodeResult) return;
    const scale = 10;
    const upCanvas = document.createElement('canvas');
    upCanvas.width = encodeResult.width * scale;
    upCanvas.height = encodeResult.height * scale;
    const ctx = upCanvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(encodeResult.canvas, 0, 0, upCanvas.width, upCanvas.height);
    const a = document.createElement('a');
    a.href = upCanvas.toDataURL('image/png');
    const baseName =
      inputTab === 'file' && uploadedFile
        ? uploadedFile.name.replace(/\.[^/.]+$/, '')
        : 'encoded_data';
    a.download = `${baseName}_${mode.toLowerCase()}_10x_${upCanvas.width}x${upCanvas.height}.png`;
    a.click();
  };

  const handleCopyHex = () => {
    if (!encodeResult) return;
    navigator.clipboard.writeText(encodeResult.crcHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Inputs & Configuration */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-stone-900">
                1. Input Data Source
              </h2>

              <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs">
                <button
                  id="btn-input-text"
                  onClick={() => setInputTab('text')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    inputTab === 'text'
                      ? 'bg-white text-stone-900 font-semibold shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  <span>Text String</span>
                </button>

                <button
                  id="btn-input-file"
                  onClick={() => setInputTab('file')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    inputTab === 'file'
                      ? 'bg-white text-stone-900 font-semibold shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Binary File</span>
                </button>
              </div>
            </div>

            {inputTab === 'text' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="text-payload-input" className="text-xs font-medium text-stone-700">
                    Text / UTF-8 Payload
                  </label>
                  <div className="flex items-center gap-1.5 text-xs text-stone-500">
                    <span>Presets:</span>
                    {PRESETS.map((p, idx) => (
                      <button
                        key={idx}
                        onClick={() => setTextInput(p.content)}
                        className="text-stone-600 hover:text-stone-900 underline px-1 py-0.5 rounded text-[11px]"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  id="text-payload-input"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={8}
                  placeholder="Enter any text string to convert into an RGB or monochrome pixel grid..."
                  className="w-full font-mono text-xs p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-stone-400 transition-all text-stone-800"
                />

                <div className="flex items-center justify-between text-xs text-stone-500">
                  <span>{currentBytes.length.toLocaleString()} bytes encoded</span>
                  <span>UTF-8 charset</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-stone-300 hover:border-stone-400 rounded-2xl p-8 text-center cursor-pointer bg-stone-50/50 hover:bg-stone-50 transition-all"
                >
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-stone-200/60 flex items-center justify-center text-stone-600">
                    <FileUp className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-medium text-stone-800">
                    {uploadedFile ? uploadedFile.name : 'Choose or drop any file to encode'}
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Supports any binary or text format (.dat, .bin, .pdf, .zip, .json, .txt)
                  </p>
                  {uploadedFile && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 font-mono">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {uploadedFile.size.toLocaleString()} bytes loaded
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Encoding Mode Configuration */}
            <div className="mt-6 pt-6 border-t border-stone-100 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Sliders className="w-4 h-4 text-stone-700" />
                <h3 className="text-sm font-semibold text-stone-900">
                  2. Encoding Configuration
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Mode Select */}
                <div>
                  <label className="text-xs font-medium text-stone-700 block mb-1.5">
                    Pixel Color Mapping Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      id="btn-mode-rgb"
                      onClick={() => setMode('RGB')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        mode === 'RGB'
                          ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                          : 'border-stone-200 bg-stone-50 hover:bg-white text-stone-800'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5 text-amber-400" />
                        RGB (3B / px)
                      </div>
                      <div className={`text-[11px] mt-1 ${mode === 'RGB' ? 'text-stone-300' : 'text-stone-500'}`}>
                        R, G, B channels
                      </div>
                    </button>

                    <button
                      type="button"
                      id="btn-mode-mono"
                      onClick={() => setMode('L')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        mode === 'L'
                          ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                          : 'border-stone-200 bg-stone-50 hover:bg-white text-stone-800'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-r from-black to-white border border-stone-400" />
                        Mono (1B / px)
                      </div>
                      <div className={`text-[11px] mt-1 ${mode === 'L' ? 'text-stone-300' : 'text-stone-500'}`}>
                        8-bit Grayscale
                      </div>
                    </button>
                  </div>
                </div>

                {/* Min Width Selector */}
                <div>
                  <label className="text-xs font-medium text-stone-700 block mb-1.5">
                    Minimum Image Width (px)
                  </label>
                  <select
                    id="select-min-width"
                    value={minWidth}
                    onChange={(e) => setMinWidth(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 text-xs font-mono text-stone-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-400"
                  >
                    <option value={32}>32 px (Compact)</option>
                    <option value={64}>64 px (Default)</option>
                    <option value={128}>128 px (Wide)</option>
                    <option value={256}>256 px (Extra Wide)</option>
                  </select>
                  <p className="text-[11px] text-stone-400 mt-1">
                    Row 0 requires ≥ {mode === 'RGB' ? '8' : '24'} pixels for the 24-byte header.
                  </p>
                </div>
              </div>

              {/* Forward Error Correction (Reed-Solomon) */}
              <div className="mt-4 pt-4 border-t border-stone-100">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-stone-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    Forward Error Correction (Reed-Solomon)
                  </label>
                  <span className="text-[11px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    {eccParityBytes > 0 ? `RS(255, ${255 - eccParityBytes})` : 'Disabled'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Standard', parity: 16, desc: 'Recovers ≤ 8 bytes / block' },
                    { label: 'Robust', parity: 32, desc: 'Recovers ≤ 16 bytes / block' },
                    { label: 'Light', parity: 8, desc: 'Recovers ≤ 4 bytes / block' },
                    { label: 'None (0B)', parity: 0, desc: 'Raw payload without ECC' },
                  ].map((option) => (
                    <button
                      key={option.parity}
                      type="button"
                      onClick={() => setEccParityBytes(option.parity)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        eccParityBytes === option.parity
                          ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold shadow-2xs'
                          : 'border-stone-200 bg-stone-50/50 hover:bg-white text-stone-700'
                      }`}
                    >
                      <div className="text-xs">{option.label}</div>
                      <div className="text-[10px] text-stone-500 font-normal mt-0.5 leading-tight">
                        {option.desc}
                      </div>
                    </button>
                  ))}
                </div>

                {encodeResult && eccParityBytes > 0 && (
                  <div className="mt-2.5 p-2.5 bg-indigo-50/40 rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-indigo-900">
                    <span>
                      Parity overhead: <strong>+{encodeResult.totalParityBytes} ECC bytes</strong> ({encodeResult.blockCount} block{encodeResult.blockCount > 1 ? 's' : ''})
                    </span>
                    <span className="font-mono">
                      Payload: {encodeResult.payloadBytes}B &rarr; Total: {encodeResult.totalEncodedBytes}B
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 0 Header Inspector */}
          {encodeResult && (
            <HeaderInspector
              payloadLength={encodeResult.payloadBytes}
              crcHex={encodeResult.crcHex}
              mode={encodeResult.mode}
              width={encodeResult.width}
              height={encodeResult.height}
              eccParityBytes={encodeResult.eccParityBytes}
              eccBlockSize={encodeResult.eccBlockSize}
            />
          )}
        </div>

        {/* Right Column: Visual Result & Magnifier */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <h2 className="text-base font-semibold text-stone-900">
                Generated Lossless PNG Grid
              </h2>

              {encodeResult && (
                <div className="flex items-center gap-2">
                  <button
                    id="btn-download-png"
                    onClick={handleDownloadPNG}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-medium transition-all border border-stone-300 shadow-2xs"
                    title={`Download original 1x scale (${encodeResult.width}×${encodeResult.height} px)`}
                  >
                    <Download className="w-3.5 h-3.5 text-stone-600" />
                    <span>Download 1× Raw</span>
                  </button>

                  <button
                    id="btn-download-upscaled-png"
                    onClick={handleDownloadUpscaledPNG}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium transition-all shadow-xs"
                    title={`Download 10x Nearest Neighbor upscale (${encodeResult.width * 10}×${encodeResult.height * 10} px)`}
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>Download 10× ({encodeResult.width * 10}×{encodeResult.height * 10})</span>
                  </button>
                </div>
              )}
            </div>

            {encodeResult ? (
              <div className="space-y-4">
                {/* Stats overview cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                    <span className="text-stone-400 text-[10px] block uppercase">Dimensions</span>
                    <span className="text-stone-900 font-bold font-mono text-sm">
                      {encodeResult.width} × {encodeResult.height}
                    </span>
                    <span className="text-stone-400 text-[10px] block">
                      {encodeResult.totalPixels.toLocaleString()} total px
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                    <span className="text-stone-400 text-[10px] block uppercase">Data Payload</span>
                    <span className="text-stone-900 font-bold font-mono text-sm">
                      {encodeResult.payloadBytes.toLocaleString()} B
                    </span>
                    <span className="text-stone-400 text-[10px] block">
                      {mode === 'RGB' ? '3 bytes/px' : '1 byte/px'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                    <span className="text-stone-400 text-[10px] block uppercase">Color Mode</span>
                    <span className="text-stone-900 font-bold text-sm">
                      {mode === 'RGB' ? 'RGB (24-bit)' : 'Monochrome (8-bit)'}
                    </span>
                    <span className="text-stone-400 text-[10px] block">Mode ID: {mode === 'RGB' ? 1 : 2}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-700 text-[10px] uppercase">CRC32 Checksum</span>
                      <button
                        onClick={handleCopyHex}
                        className="text-emerald-700 hover:text-emerald-900"
                        title="Copy Checksum"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <span className="font-mono font-bold text-xs block truncate mt-0.5">
                      {encodeResult.crcHex}
                    </span>
                    <span className="text-emerald-600 text-[10px] block">Standard IEEE 802.3</span>
                  </div>
                </div>

                {/* Natural Scale Image Container */}
                <div className="border border-stone-200 rounded-xl p-4 bg-stone-100 flex flex-col items-center justify-center min-h-[160px]">
                  <div className="text-[11px] font-mono text-stone-500 mb-2">
                    Actual Size ({encodeResult.width} × {encodeResult.height} pixels):
                  </div>
                  <div className="p-2 bg-white rounded-lg shadow-xs border border-stone-200 inline-block">
                    <img
                      src={encodeResult.imageDataUrl}
                      alt="Encoded pixel grid"
                      className="border border-stone-300"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <div className="text-[11px] text-stone-400 mt-2">
                    Row 0 (top line) = 24-byte Header • Rows 1..{encodeResult.height - 1} = Encoded Data
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-stone-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-stone-400" />
                Generating pixel grid...
              </div>
            )}
          </div>

          {/* Interactive Pixel Magnifier */}
          {encodeResult && (
            <PixelMagnifier
              canvas={encodeResult.canvas}
              mode={encodeResult.mode}
            />
          )}
        </div>

      </div>
    </div>
  );
};
