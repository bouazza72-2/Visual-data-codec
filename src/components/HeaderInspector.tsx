import React from 'react';
import { ShieldCheck, Info, Database, Hash } from 'lucide-react';
import { CodecMode } from '../types';

interface HeaderInspectorProps {
  payloadLength: number;
  crcHex: string;
  mode: CodecMode;
  width: number;
  height: number;
  eccParityBytes?: number;
  eccBlockSize?: number;
}

export const HeaderInspector: React.FC<HeaderInspectorProps> = ({
  payloadLength,
  crcHex,
  mode,
  width,
  height,
  eccParityBytes = 16,
  eccBlockSize = 255,
}) => {
  const modeId = mode === 'RGB' ? 1 : 2;
  const pixelsInRow0 = width;
  const headerPixels = mode === 'RGB' ? 8 : 24;
  const paddingPixels = pixelsInRow0 - headerPixels;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-stone-800">
            Row 0 Metadata Header (24 Bytes)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {eccParityBytes > 0 ? (
            <span className="text-[11px] font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
              RS({eccBlockSize}, {eccBlockSize - eccParityBytes}) Active
            </span>
          ) : (
            <span className="text-[11px] font-medium bg-stone-100 text-stone-500 px-2 py-0.5 rounded border border-stone-200">
              No ECC
            </span>
          )}
          <span className="text-xs font-mono bg-stone-100 text-stone-600 px-2 py-0.5 rounded border border-stone-200">
            y = 0 • Header Row
          </span>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-3">
        Row 0 is reserved exclusively for the 24-byte binary metadata header. Data payload starts on Row 1 (y = 1).
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
        <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
          <div className="text-stone-400 text-[10px] uppercase font-sans mb-1 flex items-center gap-1">
            <Info className="w-3 h-3 text-stone-400" />
            0-3 • Magic
          </div>
          <div className="text-stone-900 font-bold tracking-wider">VCDC</div>
          <div className="text-stone-400 text-[10px] mt-0.5">0x56 0x43 0x44 0x43</div>
        </div>

        <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
          <div className="text-stone-400 text-[10px] uppercase font-sans mb-1 flex items-center gap-1">
            <Database className="w-3 h-3 text-stone-400" />
            4 • Mode ID
          </div>
          <div className="text-stone-900 font-bold">
            {modeId} ({mode === 'RGB' ? 'RGB' : 'Mono'})
          </div>
          <div className="text-stone-400 text-[10px] mt-0.5">{mode === 'RGB' ? '3B / px' : '1B / px'}</div>
        </div>

        <div className="p-2.5 rounded-lg bg-indigo-50/60 border border-indigo-200 text-indigo-900">
          <div className="text-indigo-600 text-[10px] uppercase font-sans mb-1 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-indigo-600" />
            5-7 • RS ECC
          </div>
          <div className="text-indigo-950 font-bold">
            {eccParityBytes > 0 ? `${eccParityBytes}P / N=${eccBlockSize}` : 'Disabled'}
          </div>
          <div className="text-indigo-600 text-[10px] mt-0.5">Byte 5: P, Bytes 6-7: N</div>
        </div>

        <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200">
          <div className="text-stone-400 text-[10px] uppercase font-sans mb-1 flex items-center gap-1">
            <Hash className="w-3 h-3 text-stone-400" />
            8-15 • Payload Size
          </div>
          <div className="text-stone-900 font-bold">
            {payloadLength.toLocaleString()} B
          </div>
          <div className="text-stone-400 text-[10px] mt-0.5">uint64 Big-Endian</div>
        </div>

        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
          <div className="text-emerald-600 text-[10px] uppercase font-sans mb-1 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            16-19 • CRC32
          </div>
          <div className="font-bold font-mono tracking-wide text-[11px] truncate">{crcHex}</div>
          <div className="text-emerald-700 text-[10px] mt-0.5">20-23: END\0</div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between text-xs text-stone-500 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Header span: <strong>{headerPixels} px</strong> in Row 0</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-stone-300"></span>
          <span>Zero padding: <strong>{paddingPixels} px</strong> in Row 0</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
          <span>Payload capacity: <strong>{((height - 1) * width * (mode === 'RGB' ? 3 : 1)).toLocaleString()} B</strong> (Rows 1..{height - 1})</span>
        </div>
      </div>
    </div>
  );
};
