import React from 'react';
import { Layers, ShieldCheck, Binary, Cpu, HelpCircle, CheckCircle2 } from 'lucide-react';

export const HeaderSpecView: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Spec Hero */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Row-0 Metadata Header Specification (24 Bytes)
            </h2>
            <p className="text-xs text-stone-500">
              Binary layout, byte packing, and pixel channel alignment standard
            </p>
          </div>
        </div>

        <p className="text-xs text-stone-600 mt-3 leading-relaxed">
          To ensure 100% interoperability between Python (NumPy/PIL/OpenCV) and the browser, the first row of every image (Row 0, y = 0) is reserved as the dedicated metadata header row. The image payload bytes always begin on Row 1 (y = 1, x = 0).
        </p>

        {/* Byte Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse border border-stone-200 rounded-xl overflow-hidden">
            <thead className="bg-stone-50 text-stone-700 font-semibold border-b border-stone-200">
              <tr>
                <th className="py-2.5 px-3">Offset</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Field Name</th>
                <th className="py-2.5 px-3">Value / Example</th>
                <th className="py-2.5 px-3">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 font-mono text-[11px]">
              <tr className="bg-amber-50/40">
                <td className="py-2.5 px-3 font-bold text-amber-900">0..3</td>
                <td className="py-2.5 px-3">4 bytes</td>
                <td className="py-2.5 px-3">char[4]</td>
                <td className="py-2.5 px-3 font-bold">Magic Bytes</td>
                <td className="py-2.5 px-3 text-amber-800">b'VCDC' (0x56 0x43 0x44 0x43)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Visual Codec file format identifier</td>
              </tr>
              <tr className="bg-indigo-50/40">
                <td className="py-2.5 px-3 font-bold text-indigo-900">4</td>
                <td className="py-2.5 px-3">1 byte</td>
                <td className="py-2.5 px-3">uint8</td>
                <td className="py-2.5 px-3 font-bold">Color Mode ID</td>
                <td className="py-2.5 px-3 text-indigo-800">1 = RGB (3B/px), 2 = Monochrome (1B/px)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Pixel color mapping mode</td>
              </tr>
              <tr className="bg-purple-50/40">
                <td className="py-2.5 px-3 font-bold text-purple-900">5</td>
                <td className="py-2.5 px-3">1 byte</td>
                <td className="py-2.5 px-3">uint8</td>
                <td className="py-2.5 px-3 font-bold">ECC Parity Bytes</td>
                <td className="py-2.5 px-3 text-purple-800">16 (0 = Disabled, 16 = RS(255, 239))</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Reed-Solomon parity bytes per codeword block</td>
              </tr>
              <tr className="bg-purple-50/30">
                <td className="py-2.5 px-3 font-bold text-purple-900">6..7</td>
                <td className="py-2.5 px-3">2 bytes</td>
                <td className="py-2.5 px-3">uint16</td>
                <td className="py-2.5 px-3 font-bold">ECC Block Size N</td>
                <td className="py-2.5 px-3 text-purple-800">&gt;H: 255 (GF(2^8) max block length)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Total codeword length (Data K + Parity P)</td>
              </tr>
              <tr className="bg-blue-50/40">
                <td className="py-2.5 px-3 font-bold text-blue-900">8..15</td>
                <td className="py-2.5 px-3">8 bytes</td>
                <td className="py-2.5 px-3">uint64</td>
                <td className="py-2.5 px-3 font-bold">Payload Byte Length</td>
                <td className="py-2.5 px-3 text-blue-800">&gt;Q (Big-Endian unsigned 64-bit)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Exact byte count of original unpadded file</td>
              </tr>
              <tr className="bg-emerald-50/40">
                <td className="py-2.5 px-3 font-bold text-emerald-900">16..19</td>
                <td className="py-2.5 px-3">4 bytes</td>
                <td className="py-2.5 px-3">uint32</td>
                <td className="py-2.5 px-3 font-bold">CRC32 Checksum</td>
                <td className="py-2.5 px-3 text-emerald-800">&gt;I (IEEE 802.3 32-bit unsigned)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Integrity check of original payload data</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 text-stone-500">20..23</td>
                <td className="py-2.5 px-3">4 bytes</td>
                <td className="py-2.5 px-3">char[4]</td>
                <td className="py-2.5 px-3 font-bold">End Marker</td>
                <td className="py-2.5 px-3 text-stone-700">b'END\x00' (0x45 0x4E 0x44 0x00)</td>
                <td className="py-2.5 px-3 font-sans text-stone-600">Validates header parsing boundary</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Grid Comparison: RGB vs Monochrome */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <h3 className="text-sm font-bold text-stone-900">
              Mode 1: RGB Color Grid (3 Bytes / Pixel)
            </h3>
          </div>
          <p className="text-xs text-stone-600 mb-4 leading-relaxed">
            Each pixel carries 3 bytes of information across its Red, Green, and Blue channels.
          </p>
          <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 font-mono text-xs space-y-2">
            <div><strong>Pixel (x, y)</strong>:</div>
            <div className="text-stone-700 pl-3">
              <code>Red   = Byte[i]</code><br />
              <code>Green = Byte[i + 1]</code><br />
              <code>Blue  = Byte[i + 2]</code>
            </div>
            <div className="text-stone-500 pt-2 border-t border-stone-200">
              Header in Row 0 takes: <strong>8 pixels</strong> (24 bytes ÷ 3)
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 rounded-full bg-stone-500"></span>
            <h3 className="text-sm font-bold text-stone-900">
              Mode 2: Monochrome / Grayscale (1 Byte / Pixel)
            </h3>
          </div>
          <p className="text-xs text-stone-600 mb-4 leading-relaxed">
            Each pixel carries 1 byte of information represented as an 8-bit gray intensity (0 to 255).
          </p>
          <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 font-mono text-xs space-y-2">
            <div><strong>Pixel (x, y)</strong>:</div>
            <div className="text-stone-700 pl-3">
              <code>Luminance (Gray) = Byte[i]</code>
            </div>
            <div className="text-stone-500 pt-2 border-t border-stone-200">
              Header in Row 0 takes: <strong>24 pixels</strong> (24 bytes ÷ 1)
            </div>
          </div>
        </div>
      </div>

      {/* Reed-Solomon Forward Error Correction (FEC) */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-bold text-stone-900">
            Reed-Solomon Forward Error Correction (FEC)
          </h3>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          Optical noise, camera sensor artifacts, monitor gamma distortion, and channel bit flips can cause subtle color shifts in pixels. Reed-Solomon FEC operates over Galois Field GF(2^8) to mathematically detect and correct errors:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
            <span className="text-[11px] font-bold text-stone-900 block mb-1">Codeword Structure</span>
            <p className="text-[11px] text-stone-600">
              Each block has size <strong>N = 255</strong> bytes with <strong>K = N - 2t</strong> data bytes and <strong>2t</strong> parity bytes.
            </p>
          </div>
          <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200 text-indigo-950">
            <span className="text-[11px] font-bold block mb-1 text-indigo-900">Correction Capacity</span>
            <p className="text-[11px] text-indigo-800">
              With <strong>16 parity bytes</strong>, RS can automatically recover up to <strong>8 corrupted bytes</strong> (or 2-3 corrupted RGB pixels) per block.
            </p>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
            <span className="text-[11px] font-bold text-stone-900 block mb-1">Order of Operations</span>
            <p className="text-[11px] text-stone-600">
              Decoder parses header &rarr; extracts pixel bytes &rarr; runs RS error correction &rarr; verifies CRC32 checksum on reconstructed data.
            </p>
          </div>
        </div>
      </div>

      {/* Checksum & Lossless Guarantee */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h3 className="text-sm font-bold text-stone-900">
            Why Lossless PNG + CRC32 Verification?
          </h3>
        </div>
        <ul className="text-xs text-stone-600 space-y-2 list-disc pl-5 leading-relaxed">
          <li>
            <strong>PNG Deflate Compression:</strong> Unlike lossy formats (JPEG/WebP) which alter pixel values via DCT compression, PNG utilizes lossless DEFLATE, guaranteeing 100% bit-exact pixel preservation.
          </li>
          <li>
            <strong>IEEE 802.3 CRC32:</strong> Computed on the exact unpadded payload. The decoder extracts the payload, computes CRC32, and strictly validates it against the header. Any modified pixel immediately triggers a verification failure.
          </li>
          <li>
            <strong>Row 0 Decoupling:</strong> Placing the header entirely in Row 0 simplifies decoding, prevents sub-row offset math bugs, and allows clean memory-mapped NumPy slicing (<code>grid[1:, :, :]</code>).
          </li>
        </ul>
      </div>

    </div>
  );
};
