import React, { useState, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Cpu,
  Code2,
  FileCode,
  Settings2,
  ShieldCheck,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { EncodeResult } from '../types';
import {
  generateCHeader,
  CPixelFormat,
  CStorageQualifier,
  sanitizeCIdentifier,
} from '../utils/cHeaderExport';

interface CHeaderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  encodeResult: EncodeResult;
  sourceFilename?: string;
  rawPayloadBytes?: Uint8Array;
}

export const CHeaderExportModal: React.FC<CHeaderExportModalProps> = ({
  isOpen,
  onClose,
  encodeResult,
  sourceFilename = 'encoded_payload.bin',
  rawPayloadBytes,
}) => {
  const initialIdent = useMemo(
    () => sanitizeCIdentifier(sourceFilename.replace(/\.[^/.]+$/, '') || 'vcdc_payload'),
    [sourceFilename]
  );

  const [identifier, setIdentifier] = useState<string>(initialIdent);
  const [format, setFormat] = useState<CPixelFormat>(
    encodeResult.mode === 'RGB' ? 'RGB888' : 'MONO8'
  );
  const [qualifier, setQualifier] = useState<CStorageQualifier>('static_const');
  const [includeHelper, setIncludeHelper] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Generate header code based on current user configuration
  const headerData = useMemo(() => {
    try {
      return generateCHeader(encodeResult, {
        identifier: sanitizeCIdentifier(identifier || 'vcdc_payload'),
        format,
        qualifier,
        includeHelper,
        sourceFilename,
        rawPayloadBytes,
      });
    } catch (err) {
      console.error('Failed to generate C header:', err);
      return null;
    }
  }, [encodeResult, identifier, format, qualifier, includeHelper, sourceFilename, rawPayloadBytes]);

  if (!isOpen || !headerData) return null;

  const handleCopy = () => {
    if (!headerData) return;
    navigator.clipboard.writeText(headerData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!headerData) return;
    const blob = new Blob([headerData.code], { type: 'text/x-c;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = headerData.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100/80 border border-blue-200 text-blue-700 flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-stone-900">
                  Export Embedded C/C++ Header (.h)
                </h3>
                <span className="text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
                  VCDC Standard
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Ready-to-use C99 / C++11 header buffer for microcontrollers, HDMI transmitters, and embedded framebuffers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-xl transition-all"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Settings & Code Preview */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Configuration Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200 text-xs">
            {/* 1. Format Selection */}
            <div>
              <label className="font-semibold text-stone-800 flex items-center gap-1.5 mb-1.5">
                <Layers className="w-3.5 h-3.5 text-stone-600" />
                Pixel Buffer Format
              </label>
              <select
                id="select-c-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as CPixelFormat)}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white font-mono text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="RGB888">RGB888 (24-bit, 3B/px) - Standard VCDC</option>
                <option value="RGBA8888">RGBA8888 (32-bit, 4B/px) - 32-bit Aligned</option>
                <option value="MONO8">MONO8 (8-bit, 1B/px) - Grayscale</option>
                <option value="RAW_PAYLOAD">Raw Unencoded Payload Bytes</option>
              </select>
              <p className="text-[10px] text-stone-500 mt-1">
                {format === 'RGB888' && 'Matches visual_tx.h & standard VCDC display frames.'}
                {format === 'RGBA8888' && 'Directly compatible with DMA2D, OpenGL, and 32-bit framebuffers.'}
                {format === 'MONO8' && 'Ideal for monochrome OLEDs (SSD1306) and e-Paper displays.'}
                {format === 'RAW_PAYLOAD' && 'Original unencoded binary payload for dynamic MCU transmission.'}
              </p>
            </div>

            {/* 2. Target Architecture / Memory Qualifier */}
            <div>
              <label className="font-semibold text-stone-800 flex items-center gap-1.5 mb-1.5">
                <Cpu className="w-3.5 h-3.5 text-stone-600" />
                Target Architecture Qualifier
              </label>
              <select
                id="select-c-qualifier"
                value={qualifier}
                onChange={(e) => setQualifier(e.target.value as CStorageQualifier)}
                className="w-full p-2.5 rounded-lg border border-stone-300 bg-white font-mono text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="static_const">static const uint8_t (Default C99)</option>
                <option value="arm_aligned">aligned(4) (ARM Cortex-M / STM32 / ESP32)</option>
                <option value="progmem">PROGMEM (AVR / Arduino Flash)</option>
                <option value="rodata">.rodata section (GCC Flash Section)</option>
                <option value="const">const uint8_t (Global Linkage)</option>
              </select>
              <p className="text-[10px] text-stone-500 mt-1">
                {qualifier === 'progmem' && 'Places array in Flash ROM, preserving vital microcontroller SRAM.'}
                {qualifier === 'arm_aligned' && 'Ensures 32-bit word alignment for hardware DMA transfers.'}
                {qualifier === 'static_const' && 'Safe for multiple header file inclusions.'}
                {qualifier === 'rodata' && 'Forces GCC/Clang linker to place buffer in read-only Flash.'}
                {qualifier === 'const' && 'Standard global read-only variable.'}
              </p>
            </div>

            {/* 3. C Identifier Name */}
            <div>
              <label className="font-semibold text-stone-800 flex items-center gap-1.5 mb-1.5">
                <FileCode className="w-3.5 h-3.5 text-stone-600" />
                C Identifier Prefix
              </label>
              <input
                id="input-c-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="vcdc_payload"
                className="w-full p-2 rounded-lg border border-stone-300 bg-white font-mono text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between mt-1 text-[10px] text-stone-500">
                <span>Output file: <strong className="font-mono text-stone-700">{headerData.filename}</strong></span>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeHelper}
                    onChange={(e) => setIncludeHelper(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-3 w-3"
                  />
                  <span>visual_tx.h docs</span>
                </label>
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Buffer Size</span>
              <span className="font-mono font-bold text-sm text-stone-900">
                {headerData.bufferSize.toLocaleString()} bytes
              </span>
              <span className="text-[10px] text-stone-500 block">
                {(headerData.bufferSize / 1024).toFixed(2)} KB
              </span>
            </div>

            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Grid Layout</span>
              <span className="font-mono font-bold text-sm text-stone-900">
                {encodeResult.width} × {encodeResult.height} px
              </span>
              <span className="text-[10px] text-stone-500 block">
                Row 0 Header + {encodeResult.height - 1} Data Rows
              </span>
            </div>

            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Data Payload</span>
              <span className="font-mono font-bold text-sm text-stone-900">
                {encodeResult.payloadBytes.toLocaleString()} B
              </span>
              <span className="text-[10px] text-stone-500 block">
                +{encodeResult.totalParityBytes} B Reed-Solomon Parity
              </span>
            </div>

            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-[10px] uppercase font-bold text-stone-400 block">CRC32 Checksum</span>
              <span className="font-mono font-bold text-xs text-emerald-700 block truncate" title={encodeResult.crcHex}>
                {encodeResult.crcHex}
              </span>
              <span className="text-[10px] text-stone-500 block">IEEE 802.3 Standard</span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950">
              <span className="text-[10px] uppercase font-bold text-emerald-700 block">SHA-256 Digest</span>
              <span className="font-mono font-bold text-xs block truncate mt-0.5" title={encodeResult.sha256Hex}>
                {encodeResult.sha256Hex.slice(0, 10)}...
              </span>
              <span className="text-[10px] text-emerald-700 block">Row 0 Embedded</span>
            </div>
          </div>

          {/* Code Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-stone-600 px-1">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-stone-800">
                  Generated C Header Source: <span className="font-mono text-blue-700">{headerData.filename}</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-stone-400 font-mono">
                  {headerData.code.split('\n').length.toLocaleString()} lines
                </span>
              </div>
            </div>

            <div className="relative rounded-xl border border-stone-800 bg-stone-950 text-stone-100 overflow-hidden shadow-inner">
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <button
                  id="btn-modal-copy-header"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800/90 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-medium border border-stone-700 transition-all shadow-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy C Code</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-4 pt-10 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[380px] scrollbar-thin scrollbar-thumb-stone-700 select-all">
                <code>{headerData.code}</code>
              </pre>
            </div>
          </div>

          {/* Integration Guide Snippet */}
          <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200/80 flex items-start gap-3 text-xs text-blue-950">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-blue-900">
                Quick Integration with Embedded Systems:
              </div>
              <p className="text-blue-800/90 leading-relaxed">
                Include this header in your firmware project (e.g. STM32 HAL, ESP-IDF, Arduino, or Linux DRM framebuffer).
                To stream over HDMI or DisplayPort using our accompanying <code className="bg-blue-100 text-blue-900 px-1 py-0.5 rounded font-mono font-bold">visual_tx.h</code> library, pass <code className="bg-blue-100 text-blue-900 px-1 py-0.5 rounded font-mono font-bold">{identifier}_frame.pixels</code> directly to <code className="bg-blue-100 text-blue-900 px-1 py-0.5 rounded font-mono font-bold">vcdc_render_framebuffer()</code>.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-stone-500 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>VCDC V2 Standard Compliant: 56-byte Row-0 Header + Reed-Solomon FEC</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2 border border-stone-300 hover:bg-stone-200/70 text-stone-700 rounded-xl text-xs font-semibold transition-all"
            >
              Close
            </button>

            <button
              type="button"
              id="btn-modal-download-header"
              onClick={handleDownload}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Download {headerData.filename}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
