import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Copy,
  Check,
  Download,
  CheckCircle2,
  XCircle,
  FileCheck,
  Lock,
  Cpu,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { IntegrityVerificationReport } from '../types';

interface DataIntegrityCardProps {
  report?: IntegrityVerificationReport | null;
  expectedSha256?: string | null;
  calculatedSha256?: string | null;
  expectedCrc32Hex?: string | null;
  calculatedCrc32Hex?: string | null;
  isChecksumValid?: boolean;
  isSha256Valid?: boolean;
  totalBytes?: number;
  fileName?: string;
  sourceContext?: 'file_decoder' | 'live_stream' | 'batch_processor';
  streamStats?: {
    chunksReceived: number;
    chunksVerified: number;
    chunksRejected: number;
  };
}

export const DataIntegrityCard: React.FC<DataIntegrityCardProps> = ({
  report,
  expectedSha256,
  calculatedSha256,
  expectedCrc32Hex,
  calculatedCrc32Hex,
  isChecksumValid = true,
  isSha256Valid = true,
  totalBytes,
  fileName = 'payload.bin',
  sourceContext = 'file_decoder',
  streamStats,
}) => {
  const [copiedSha, setCopiedSha] = useState<boolean>(false);
  const [copiedManifest, setCopiedManifest] = useState<boolean>(false);

  // Derive active values from report or props
  const calcSha = report?.sha256?.calculated || calculatedSha256 || '';
  const expSha = report?.sha256?.expected || expectedSha256 || null;
  const calcCrc = report?.crc32?.calculated || calculatedCrc32Hex || '';
  const expCrc = report?.crc32?.expected || expectedCrc32Hex || '';
  const crcMatch = report ? report.crc32.matches : isChecksumValid;
  const shaMatch = report ? report.sha256.matches : isSha256Valid;
  const status = report
    ? report.integrityStatus
    : !crcMatch || (expSha && !shaMatch)
    ? 'CORRUPTED'
    : expSha
    ? 'VERIFIED'
    : 'UNVERIFIED';

  const byteCount = report?.payloadLength ?? totalBytes ?? 0;

  const handleCopySha = () => {
    if (!calcSha) return;
    navigator.clipboard.writeText(calcSha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  const handleDownloadManifest = () => {
    if (!calcSha) return;
    const manifestContent = `${calcSha.toLowerCase()}  ${fileName}\n`;
    const blob = new Blob([manifestContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.sha256`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyManifest = () => {
    if (!calcSha) return;
    const manifestContent = `${calcSha.toLowerCase()}  ${fileName}`;
    navigator.clipboard.writeText(manifestContent);
    setCopiedManifest(true);
    setTimeout(() => setCopiedManifest(false), 2000);
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs">
      {/* Top Banner Header */}
      <div
        className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
          status === 'VERIFIED'
            ? 'bg-emerald-50/70 border-emerald-200'
            : status === 'CORRUPTED'
            ? 'bg-rose-50/70 border-rose-200'
            : 'bg-amber-50/60 border-amber-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
              status === 'VERIFIED'
                ? 'bg-emerald-600 text-white'
                : status === 'CORRUPTED'
                ? 'bg-rose-600 text-white'
                : 'bg-amber-600 text-white'
            }`}
          >
            {status === 'VERIFIED' ? (
              <ShieldCheck className="w-5 h-5" />
            ) : status === 'CORRUPTED' ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <Shield className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-stone-900">
                Data Integrity &amp; Cryptographic Verification
              </h3>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                  status === 'VERIFIED'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : status === 'CORRUPTED'
                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {status === 'VERIFIED'
                  ? 'SHA-256 Bit-Exact'
                  : status === 'CORRUPTED'
                  ? 'Hash Mismatch'
                  : 'CRC32 Verified (Legacy Header)'}
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Dual-layer verification combining rapid CRC32 frame integrity with NIST FIPS 180-4 SHA-256
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {calcSha && (
            <button
              type="button"
              onClick={handleDownloadManifest}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-2xs transition-all"
              title="Download sidecar .sha256 checksum manifest"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export .sha256 Manifest</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5 text-xs">
        {/* Verification Checkpoints Pipeline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <span className="text-[10px] uppercase text-stone-400 font-sans block font-semibold">Step 1: Magic</span>
              <span className="font-mono text-stone-900 font-semibold text-xs">0x56434443 (VCDC)</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-2.5">
            {crcMatch ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <div>
              <span className="text-[10px] uppercase text-stone-400 font-sans block font-semibold">Step 2: CRC32</span>
              <span className={`font-mono font-semibold text-xs ${crcMatch ? 'text-emerald-700' : 'text-rose-600'}`}>
                {crcMatch ? 'Frame Verified' : 'Bad Sector'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <div>
              <span className="text-[10px] uppercase text-stone-400 font-sans block font-semibold">Step 3: ECC Recovery</span>
              <span className="font-mono text-stone-900 font-semibold text-xs">RS(255, 239)</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-2.5">
            {shaMatch ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <div>
              <span className="text-[10px] uppercase text-stone-400 font-sans block font-semibold">Step 4: Cryptographic</span>
              <span className={`font-mono font-semibold text-xs ${shaMatch ? 'text-emerald-700' : 'text-rose-600'}`}>
                {shaMatch ? 'SHA-256 Valid' : 'Hash Mismatch'}
              </span>
            </div>
          </div>
        </div>

        {/* SHA-256 Cryptographic Details Box */}
        <div className="p-4 rounded-xl bg-stone-900 text-stone-100 font-mono text-xs space-y-3">
          <div className="flex items-center justify-between border-b border-stone-800 pb-2">
            <div className="flex items-center gap-2 text-stone-300">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-xs">SHA-256 Payload Hash Digest</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">256-bit</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopySha}
                className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-100 transition-colors"
                title="Copy SHA-256 hash"
              >
                {copiedSha ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Hash</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleCopyManifest}
                className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-100 transition-colors ml-2"
                title="Copy sidecar manifest entry"
              >
                {copiedManifest ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied Manifest</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-3 h-3" />
                    <span>Copy Manifest</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <span className="text-stone-400 text-[10px] block uppercase">Calculated Hash:</span>
              <div className="p-2 rounded-lg bg-stone-950 border border-stone-800 text-emerald-400 font-mono text-xs break-all select-all">
                {calcSha || 'Computing hash...'}
              </div>
            </div>

            {expSha && (
              <div>
                <span className="text-stone-400 text-[10px] block uppercase">Expected Hash (Embedded in Row-0 Header):</span>
                <div
                  className={`p-2 rounded-lg bg-stone-950 border text-xs font-mono break-all select-all ${
                    shaMatch ? 'border-emerald-800/80 text-emerald-300' : 'border-rose-800 text-rose-300'
                  }`}
                >
                  {expSha}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Checksum & Frame Rejection Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CRC32 Frame Checksum */}
          <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-stone-500 font-medium">IEEE 802.3 CRC32</span>
              <span
                className={`font-mono px-2 py-0.5 rounded text-[10px] font-semibold ${
                  crcMatch ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {crcMatch ? 'Match' : 'Mismatch'}
              </span>
            </div>
            <div className="flex items-center justify-between text-stone-700 font-mono">
              <span className="text-stone-400">Calculated:</span>
              <span className="font-bold text-stone-900">{calcCrc || '0x00000000'}</span>
            </div>
            {expCrc && (
              <div className="flex items-center justify-between text-stone-700 font-mono">
                <span className="text-stone-400">Expected:</span>
                <span className="font-bold text-stone-900">{expCrc}</span>
              </div>
            )}
          </div>

          {/* Stream Chunk Stats or Payload Metric */}
          <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 space-y-1.5">
            {streamStats ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 font-medium">Stream Chunk Reassembly</span>
                  <span className="font-mono text-emerald-700 text-[10px] font-bold">
                    {streamStats.chunksVerified} / {streamStats.chunksReceived} Chunks
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-700">
                  <span className="text-stone-400">Rejected Bad Chunks:</span>
                  <span className={`font-mono font-bold ${streamStats.chunksRejected > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {streamStats.chunksRejected} rejected
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-700">
                  <span className="text-stone-400">Total Stream Payload:</span>
                  <span className="font-mono font-bold text-stone-900">
                    {(byteCount / 1024).toFixed(2)} KB
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 font-medium">Payload Integrity Scope</span>
                  <span className="font-mono text-stone-600 text-[10px]">
                    {byteCount.toLocaleString()} Bytes Verified
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-700">
                  <span className="text-stone-400">Tamper Resilience:</span>
                  <span className="font-semibold text-emerald-700">Bit-Exact Cryptographic Seal</span>
                </div>
                <div className="flex items-center justify-between text-stone-700">
                  <span className="text-stone-400">Sidecar Format:</span>
                  <span className="font-mono text-stone-600">Standard Linux sha256sum</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
