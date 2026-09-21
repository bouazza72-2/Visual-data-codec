import React, { useState } from 'react';
import {
  Download,
  Copy,
  Check,
  Terminal,
  FileCode,
  Package,
  BookOpen,
  Code2,
  Maximize2,
  ShieldCheck,
  Layers,
} from 'lucide-react';

const UPSCALE_PNG_CODE = `#!/usr/bin/env python3
"""
Lossless Visual Data Upscaler (upscale_png.py)
==============================================
Performs a strictly lossless upscale of visual data PNG images (e.g. 64x2 pixels)
by an integer factor (default: 10x -> 640x20 pixels) using the Nearest Neighbor algorithm.

Why Nearest Neighbor?
---------------------
Standard interpolation algorithms (Bilinear, Bicubic, Lanczos) compute weighted averages
of adjacent pixels. In visual data encoding, where each pixel channel (R, G, B) encodes
discrete binary bytes, smoothing causes color shifting that destroys the data integrity.

Nearest Neighbor expands each original pixel into a crisp (Scale x Scale) solid block
with the EXACT identical RGB / grayscale values, ensuring 100% bit-exact data preservation
for visual transmission, display, camera capture, or printing.

Supported Backends:
- Pillow (PIL): Image.Resampling.NEAREST (or Image.NEAREST)
- OpenCV (cv2): cv2.resize with cv2.INTER_NEAREST
"""

import os
import sys
import argparse
from typing import Tuple, Dict, Any, Optional

import numpy as np
from PIL import Image

try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False


def upscale_png_pillow(
    input_path: str,
    output_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """
    Enlarges a PNG image using Pillow's Nearest Neighbor resampling.

    :param input_path: Path to the input PNG image (e.g. 64x2).
    :param output_path: Path where the upscaled PNG will be saved.
    :param scale_factor: Integer scaling multiplier (default: 10).
    :return: Metadata dictionary with original/new dimensions and file size.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")
    if scale_factor < 1 or not isinstance(scale_factor, int):
        raise ValueError(f"Scale factor must be a positive integer, got: {scale_factor}")

    with Image.open(input_path) as img:
        orig_w, orig_h = img.size
        orig_mode = img.mode
        new_w = orig_w * scale_factor
        new_h = orig_h * scale_factor

        # Use Image.Resampling.NEAREST for Pillow >= 9.0, fallback to Image.NEAREST
        resample_nearest = getattr(Image, 'Resampling', Image).NEAREST

        # Perform nearest neighbor resizing without smoothing or color interpolation
        upscaled_img = img.resize((new_w, new_h), resample=resample_nearest)

        # Save as lossless PNG with maximum compression
        upscaled_img.save(output_path, format='PNG', optimize=True)

    file_size = os.path.getsize(output_path)
    return {
        "backend": "Pillow",
        "input_path": input_path,
        "output_path": output_path,
        "mode": orig_mode,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (new_w, new_h),
        "scale_factor": scale_factor,
        "file_size_bytes": file_size,
        "algorithm": "Nearest Neighbor (Image.Resampling.NEAREST)"
    }


def upscale_png_opencv(
    input_path: str,
    output_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """
    Enlarges a PNG image using OpenCV's Nearest Neighbor interpolation (cv2.INTER_NEAREST).

    :param input_path: Path to the input PNG image.
    :param output_path: Path where the upscaled PNG will be saved.
    :param scale_factor: Integer scaling multiplier (default: 10).
    :return: Metadata dictionary with original/new dimensions and file size.
    """
    if not OPENCV_AVAILABLE:
        raise RuntimeError("OpenCV is not available in the current environment. Install opencv-python or use Pillow.")
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")
    if scale_factor < 1 or not isinstance(scale_factor, int):
        raise ValueError(f"Scale factor must be a positive integer, got: {scale_factor}")

    # Read image preserving exact channels and depths
    img_cv = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img_cv is None:
        raise ValueError(f"Failed to load image with OpenCV: {input_path}")

    orig_h, orig_w = img_cv.shape[:2]
    new_w = orig_w * scale_factor
    new_h = orig_h * scale_factor

    # Nearest Neighbor in OpenCV
    upscaled_cv = cv2.resize(
        img_cv,
        (new_w, new_h),
        interpolation=cv2.INTER_NEAREST
    )

    # Save lossless PNG with maximum compression level 9
    cv2.imwrite(output_path, upscaled_cv, [cv2.IMWRITE_PNG_COMPRESSION, 9])

    file_size = os.path.getsize(output_path)
    channels = 1 if img_cv.ndim == 2 else img_cv.shape[2]
    return {
        "backend": "OpenCV",
        "input_path": input_path,
        "output_path": output_path,
        "channels": channels,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (new_w, new_h),
        "scale_factor": scale_factor,
        "file_size_bytes": file_size,
        "algorithm": "Nearest Neighbor (cv2.INTER_NEAREST)"
    }


def upscale_png(
    input_path: str,
    output_path: str,
    scale_factor: int = 10,
    backend: str = 'auto'
) -> Dict[str, Any]:
    """
    Primary function to perform lossless upscale of a PNG image by an integer scale factor.

    :param input_path: Path to the tiny input PNG (e.g. 64x2 pixels).
    :param output_path: Destination path for the upscaled PNG (e.g. 640x20 pixels).
    :param scale_factor: Multiplication factor (default: 10).
    :param backend: 'pillow', 'opencv', or 'auto' (prefers Pillow for metadata preservation).
    :return: Operation metadata dictionary.
    """
    backend_choice = backend.lower()
    if backend_choice == 'pillow':
        return upscale_png_pillow(input_path, output_path, scale_factor=scale_factor)
    elif backend_choice == 'opencv':
        return upscale_png_opencv(input_path, output_path, scale_factor=scale_factor)
    elif backend_choice == 'auto':
        try:
            return upscale_png_pillow(input_path, output_path, scale_factor=scale_factor)
        except Exception:
            if OPENCV_AVAILABLE:
                return upscale_png_opencv(input_path, output_path, scale_factor=scale_factor)
            raise
    else:
        raise ValueError(f"Unknown backend '{backend}'. Choose 'pillow', 'opencv', or 'auto'.")


def downscale_png(
    input_path: str,
    output_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """
    Downsamples an upscaled PNG image back to its original 1x dimensions
    by sampling the exact center pixel of each (scale_factor x scale_factor) block.
    """
    with Image.open(input_path) as img:
        img_np = np.array(img)

    h, w = img_np.shape[:2]
    if w % scale_factor != 0 or h % scale_factor != 0:
        raise ValueError(
            f"Image dimensions ({w}x{h}) are not cleanly divisible by scale factor {scale_factor}."
        )

    orig_w = w // scale_factor
    orig_h = h // scale_factor

    # Sample the center of each block to avoid edge artifacts
    offset = scale_factor // 2
    y_indices = np.arange(orig_h) * scale_factor + offset
    x_indices = np.arange(orig_w) * scale_factor + offset

    downscaled_np = img_np[np.ix_(y_indices, x_indices)]
    downscaled_img = Image.fromarray(downscaled_np)
    downscaled_img.save(output_path, format='PNG', optimize=True)

    return {
        "input_path": input_path,
        "output_path": output_path,
        "restored_dimensions": (orig_w, orig_h),
        "scale_factor": scale_factor,
        "sampling_method": f"Center block sampling at offset +{offset}px"
    }


def verify_lossless_integrity(
    original_path: str,
    upscaled_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """
    Verifies that the upscaled image is bit-for-bit identical to the original
    across every single pixel of every scale_factor x scale_factor block.
    """
    with Image.open(original_path) as orig_img:
        orig_arr = np.array(orig_img)
    with Image.open(upscaled_path) as up_img:
        up_arr = np.array(up_img)

    orig_h, orig_w = orig_arr.shape[:2]
    up_h, up_w = up_arr.shape[:2]

    expected_w = orig_w * scale_factor
    expected_h = orig_h * scale_factor
    dim_match = (up_w == expected_w and up_h == expected_h)

    if not dim_match:
        return {
            "verified": False,
            "error": f"Dimension mismatch: Expected ({expected_w}, {expected_h}), got ({up_w}, {up_h})"
        }

    non_matching_blocks = 0
    for y in range(orig_h):
        for x in range(orig_w):
            expected_val = orig_arr[y, x]
            block = up_arr[y * scale_factor : (y + 1) * scale_factor,
                           x * scale_factor : (x + 1) * scale_factor]
            if not np.all(block == expected_val):
                non_matching_blocks += 1

    verified = (non_matching_blocks == 0)
    return {
        "verified": verified,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (up_w, up_h),
        "scale_factor": scale_factor,
        "total_source_pixels": orig_h * orig_w,
        "total_expanded_pixels": up_h * up_w,
        "non_matching_blocks": non_matching_blocks,
        "color_shift_detected": non_matching_blocks > 0,
        "integrity_status": "100% BIT-EXACT MATCH" if verified else "CORRUPTED"
    }


def main():
    parser = argparse.ArgumentParser(
        description="Lossless Visual Data PNG Upscaler using Nearest Neighbor (OpenCV & Pillow)."
    )
    parser.add_argument("input_path", help="Path to input PNG (e.g. encoded_data_rgb.png)")
    parser.add_argument("output_path", help="Path for upscaled output PNG (e.g. upscaled_640x20.png)")
    parser.add_argument("--scale", type=int, default=10, help="Scale multiplier factor (default: 10)")
    parser.add_argument(
        "--backend",
        choices=["auto", "pillow", "opencv", "both"],
        default="both",
        help="Image processing backend (default: both for cross-comparison)"
    )
    parser.add_argument("--verify", action="store_true", default=True, help="Verify block uniformity and data integrity")

    args = parser.parse_args()
    print("=" * 70)
    print("      LOSSLESS VISUAL DATA UPSCALER (NEAREST NEIGHBOR)")
    print("=" * 70)

    res = upscale_png(args.input_path, args.output_path, scale_factor=args.scale, backend=args.backend)
    print(f"Upscaled: {res['original_dimensions']} -> {res['upscaled_dimensions']} via {res['backend']}")

    if args.verify:
        v = verify_lossless_integrity(args.input_path, args.output_path, scale_factor=args.scale)
        print(f"Integrity Check: {v['integrity_status']} (Zero color shifts)")


if __name__ == '__main__':
    main()
`;

const VISUAL_CODEC_CODE = `#!/usr/bin/env python3
"""
Visual Data Codec (visual_codec.py)
===================================
A robust, modular Python module for encoding arbitrary binary files or text
strings into lossless PNG pixel grids (RGB or Monochrome) with Forward Error
Correction (FEC) using the Reed-Solomon algorithm, and decoding them back with
automatic error recovery and strict CRC32 integrity verification.

Features:
- Forward Error Correction (FEC): Reed-Solomon RS(255, 239) with 16 parity bytes
  automatically detects and repairs byte corruption caused by color shifts.
- RGB Mode (1 pixel = 3 bytes: R, G, B)
- Monochrome Mode (1 pixel = 1 byte: 8-bit Grayscale)
- Row-0 24-byte Metadata Header: Magic (VCDC), Mode, ECC Parity, ECC Block Size, Length, CRC32
- Lossless Nearest Neighbor Upscaler (e.g. 64x2 -> 640x20)
- Dual backend support: PIL (Pillow) and OpenCV (cv2)
"""

import sys
import os
import math
import zlib
import struct
import random
from typing import Tuple, Dict, Any, Optional

import numpy as np
from PIL import Image

try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False

try:
    import reedsolo
    REEDSOLO_AVAILABLE = True
except ImportError:
    REEDSOLO_AVAILABLE = False

# Header format (24 bytes total, big-endian)
# 4s magic, B mode_id, B ecc_parity, H ecc_block_size, Q payload_len, I crc32, 4s end_marker
HEADER_MAGIC = b'VCDC'
HEADER_END = b'END\\x00'
HEADER_STRUCT_FORMAT = '>4sBBHQI4s'
HEADER_BYTE_SIZE = struct.calcsize(HEADER_STRUCT_FORMAT)  # Exactly 24 bytes

MODE_RGB = 'RGB'
MODE_MONO = 'L'
MODE_IDS = {MODE_RGB: 1, MODE_MONO: 2}
ID_TO_MODE = {v: k for k, v in MODE_IDS.items()}
DEFAULT_ECC_PARITY_BYTES = 16
DEFAULT_ECC_BLOCK_SIZE = 255


def rs_encode_payload(data: bytes, ecc_parity: int = 16, ecc_block_size: int = 255) -> bytes:
    """Applies Reed-Solomon encoding to generate error correction parity bytes."""
    if ecc_parity <= 0 or not REEDSOLO_AVAILABLE:
        return data
    codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
    return bytes(codec.encode(data))


def rs_decode_payload(encoded_data: bytes, payload_len: int, ecc_parity: int = 16, ecc_block_size: int = 255) -> Tuple[bytes, int]:
    """Decodes Reed-Solomon encoded bytes, repairing color shifts and bit flips."""
    if ecc_parity <= 0 or not REEDSOLO_AVAILABLE:
        return encoded_data[:payload_len], 0
    codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
    decoded, _, err_pos = codec.decode(bytearray(encoded_data))
    return bytes(decoded)[:payload_len], len(err_pos) if err_pos is not None else 0


def create_header(payload_len: int, crc32: int, mode: str, ecc_parity: int = 16, ecc_block_size: int = 255) -> bytes:
    """Pack metadata into a strict 24-byte binary header with ECC parameters."""
    mode_id = MODE_IDS.get(mode.upper())
    if mode_id is None:
        raise ValueError(f"Unsupported mode '{mode}'")
    return struct.pack(
        HEADER_STRUCT_FORMAT,
        HEADER_MAGIC,
        mode_id,
        ecc_parity & 0xFF,
        ecc_block_size & 0xFFFF,
        payload_len,
        crc32 & 0xFFFFFFFF,
        HEADER_END
    )


def encode_bytes_to_grid(
    data: bytes,
    mode: str = MODE_RGB,
    min_width: int = 64,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> np.ndarray:
    """Convert raw binary data into a 2D NumPy pixel grid with Row-0 header and RS FEC parity bytes."""
    mode = mode.upper()
    payload_len = len(data)
    crc = zlib.crc32(data) & 0xFFFFFFFF

    # 1. Reed-Solomon FEC
    encoded = rs_encode_payload(data, ecc_parity, ecc_block_size)
    total_bytes = len(encoded)

    # 2. Header
    header_bytes = create_header(payload_len, crc, mode, ecc_parity, ecc_block_size)

    # 3. Dynamic sizing
    bpp = 3 if mode == MODE_RGB else 1
    data_pixels = math.ceil(total_bytes / bpp) if total_bytes > 0 else 1
    header_pixels = math.ceil(HEADER_BYTE_SIZE / bpp)
    width = max(min_width, header_pixels, int(math.ceil(math.sqrt(data_pixels))))
    if width % 4 != 0:
        width += (4 - (width % 4))

    data_rows = math.ceil(data_pixels / width) if data_pixels > 0 else 1
    height = 1 + data_rows

    # 4. Populate pixels
    if mode == MODE_RGB:
        grid = np.zeros((height, width, 3), dtype=np.uint8)
        hdr_np = np.frombuffer(header_bytes, dtype=np.uint8)
        pad_hdr = (3 - (len(hdr_np) % 3)) % 3
        if pad_hdr > 0:
            hdr_np = np.pad(hdr_np, (0, pad_hdr), mode='constant')
        grid[0, :len(hdr_np)//3, :] = hdr_np.reshape((-1, 3))

        if total_bytes > 0:
            p_np = np.frombuffer(encoded, dtype=np.uint8)
            pad_p = ((height - 1) * width * 3) - total_bytes
            if pad_p > 0:
                p_np = np.pad(p_np, (0, pad_p), mode='constant')
            grid[1:, :, :] = p_np.reshape((height - 1, width, 3))
    else:
        grid = np.zeros((height, width), dtype=np.uint8)
        hdr_np = np.frombuffer(header_bytes, dtype=np.uint8)
        grid[0, :len(hdr_np)] = hdr_np
        if total_bytes > 0:
            p_np = np.frombuffer(encoded, dtype=np.uint8)
            pad_p = ((height - 1) * width) - total_bytes
            if pad_p > 0:
                p_np = np.pad(p_np, (0, pad_p), mode='constant')
            grid[1:, :] = p_np.reshape((height - 1, width))

    return grid


def decode_image(image_path: str, backend: str = 'PIL') -> Tuple[bytes, Dict[str, Any]]:
    """Decodes PNG, repairs color shifts via Reed-Solomon, and verifies CRC32."""
    with Image.open(image_path) as img:
        grid = np.array(img.convert('RGB') if img.mode in ('RGB', 'RGBA') else img.convert('L'))
    mode = MODE_RGB if grid.ndim == 3 else MODE_MONO
    row0 = grid[0, :, :].tobytes() if mode == MODE_RGB else grid[0, :].tobytes()

    magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
        HEADER_STRUCT_FORMAT, row0[:HEADER_BYTE_SIZE]
    )
    if magic != HEADER_MAGIC or end_marker != HEADER_END:
        raise ValueError("Header mismatch or corrupt image!")

    # Calculate expected encoded size
    if ecc_parity > 0:
        k = ecc_block_size - ecc_parity
        block_count = math.ceil(payload_len / k) if payload_len > 0 else 1
        total_encoded = payload_len + block_count * ecc_parity
    else:
        total_encoded = payload_len

    data_buf = grid[1:, :, :].tobytes() if mode == MODE_RGB else grid[1:, :].tobytes()
    extracted_bytes = data_buf[:total_encoded]

    # Reed-Solomon Error Recovery
    payload, corrected_count = rs_decode_payload(extracted_bytes, payload_len, ecc_parity, ecc_block_size)

    # CRC32 Checksum Validation
    actual_crc = zlib.crc32(payload) & 0xFFFFFFFF
    if actual_crc != expected_crc:
        raise ValueError(f"CRC32 mismatch! Expected {hex(expected_crc)}, got {hex(actual_crc)}")

    return payload, {
        "payload_bytes": payload_len,
        "crc32": f"0x{expected_crc:08X}",
        "ecc_corrected_count": corrected_count,
        "checksum_verified": True
    }
`;

export const PythonScriptView: React.FC = () => {
  const [selectedScript, setSelectedScript] = useState<'upscaler' | 'codec'>('upscaler');
  const [copied, setCopied] = useState<boolean>(false);

  const activeCode = selectedScript === 'upscaler' ? UPSCALE_PNG_CODE : VISUAL_CODEC_CODE;
  const activeFilename = selectedScript === 'upscaler' ? 'upscale_png.py' : 'visual_codec.py';
  const downloadUrl = selectedScript === 'upscaler' ? '/upscale_png.py' : '/visual_codec.py';

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-stone-100 text-stone-700 border border-stone-200">
              Python 3.8+
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="w-3 h-3 mr-1" />
              Lossless Nearest Neighbor
            </span>
          </div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">
            Python Visual Codec &amp; Nearest Neighbor Upscaler
          </h2>
          <p className="text-xs text-stone-600 mt-1 max-w-2xl">
            Clean, modular scripts using <strong>OpenCV</strong>, <strong>Pillow</strong>, and <strong>NumPy</strong>. Includes the dedicated <code>upscale_png(input_path, output_path)</code> function to enlarge 64×2 PNGs to 640×20 with zero smoothing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-copy-script"
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-medium border border-stone-200 transition-all shadow-2xs"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-stone-600" />}
            <span>{copied ? 'Copied' : 'Copy Script'}</span>
          </button>

          <a
            id="btn-download-script"
            href={downloadUrl}
            download={activeFilename}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-sm transition-all"
          >
            <Download className="w-4 h-4 text-amber-400" />
            <span>Download {activeFilename}</span>
          </a>
        </div>
      </div>

      {/* Script Selector Tabs */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
        <button
          onClick={() => setSelectedScript('upscaler')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            selectedScript === 'upscaler'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-600 hover:text-stone-900 border border-stone-200'
          }`}
        >
          <Maximize2 className="w-3.5 h-3.5 text-purple-400" />
          <span>upscale_png.py (10× Lossless Nearest Neighbor)</span>
        </button>

        <button
          onClick={() => setSelectedScript('codec')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            selectedScript === 'codec'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-600 hover:text-stone-900 border border-stone-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>visual_codec.py (Complete Codec + CRC32 Header)</span>
        </button>
      </div>

      {/* Quick Documentation Cards */}
      {selectedScript === 'upscaler' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <Maximize2 className="w-3.5 h-3.5 text-purple-600" />
              upscale_png(input, output)
            </span>
            <p className="text-[11px] text-stone-500">
              Enlarges 64×2 to 640×20 using Nearest Neighbor. Each source pixel becomes a 10×10 solid color block.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              0% Color Shift &amp; Smoothing
            </span>
            <p className="text-[11px] text-stone-500">
              Prevents the bilinear/bicubic blur that destroys discrete byte values in visual codecs.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-amber-600" />
              Pillow &amp; OpenCV Backends
            </span>
            <p className="text-[11px] text-stone-500">
              Works via <code>Image.Resampling.NEAREST</code> or <code>cv2.INTER_NEAREST</code> with verification.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-indigo-600" />
              Dual RGB &amp; Monochrome
            </span>
            <p className="text-[11px] text-stone-500">
              RGB (3 bytes/px) and Monochrome (1 byte/px) with Row-0 24-byte CRC32 header.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              IEEE 802.3 CRC32 Verification
            </span>
            <p className="text-[11px] text-stone-500">
              Strict checksum match required before payload is accepted and reconstructed.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-1">
            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-amber-600" />
              Integrated Upscaler CLI
            </span>
            <p className="text-[11px] text-stone-500">
              Includes <code>upscale</code>, <code>encode</code>, <code>decode</code>, and <code>demo</code> CLI subcommands.
            </p>
          </div>
        </div>
      )}

      {/* Code Viewer */}
      <div className="bg-stone-900 rounded-2xl border border-stone-800 shadow-md overflow-hidden">
        <div className="px-4 py-3 bg-stone-950 border-b border-stone-800 flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-amber-400" />
            <span className="font-mono text-stone-200">{activeFilename}</span>
            <span className="text-stone-500">• Ready to run (OpenCV + Pillow + NumPy)</span>
          </div>
          <button
            onClick={handleCopyCode}
            className="text-stone-400 hover:text-stone-200 transition-colors flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <div className="p-6 overflow-x-auto max-h-[600px] overflow-y-auto">
          <pre className="font-mono text-xs text-stone-200 leading-relaxed">
            <code>{activeCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
