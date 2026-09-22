#!/usr/bin/env python3
"""
Live Stream Video Decoder for Visual Data Codec (live_stream_decoder.py)
=======================================================================
Captures live video frames continuously from a connected HDMI capture card,
webcam, or synthetic test stream using OpenCV. Detects visual pixel data grids,
scans Row 0 for the VCDC metadata header, repairs optical color shifts and
bit-flips via Reed-Solomon (ECC) Forward Error Correction, validates CRC32
checksums, and reassembles the sequential data stream in real time.

Features:
- Video Capture Setup: Uses OpenCV cv2.VideoCapture with configurable resolution,
  framerate, buffer sizing, and backend selection (V4L2, DirectShow, AVFoundation).
- Multi-Scale Frame Detection: Center-samples candidate scales (e.g. 10x, 8x, 4x, 2x, 1x)
  and detects rectangular bounding boxes to isolate visual data grids.
- Reed-Solomon Forward Error Correction (FEC): Automatically repairs transmission
  color shifts (e.g. from HDMI 4:2:2/4:2:0 chroma subsampling or camera sensor noise).
- Real-Time HUD Overlay: Live OpenCV window displaying current FPS, data transfer
  rate (KB/s), Reed-Solomon repair statistics, status badge, and decoded text ticker.
- Stream Reassembler: Assembles sequential data chunks, deduplicates repeated frames,
  and logs restored output to disk and console.
- Synthetic Test Generator: Built-in --test flag generates simulated HDMI stream
  with injected color shifts to test the entire pipeline without hardware.

Requirements:
- opencv-python (cv2)
- numpy
- pillow (PIL)
- reedsolo (for Reed-Solomon error recovery)

Usage:
  # Capture from HDMI capture card or webcam (device 0)
  python3 live_stream_decoder.py --camera 0

  # Capture at 1080p60
  python3 live_stream_decoder.py --camera 0 --width 1920 --height 1080 --fps 60

  # Run synthetic stream self-test (no camera required)
  python3 live_stream_decoder.py --test

  # Run headless (ideal for servers or background capture)
  python3 live_stream_decoder.py --test --headless
"""

import sys
import os
import time
import math
import zlib
import hashlib
import struct
import argparse
from collections import deque
from typing import Tuple, Dict, Any, Optional, List

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    class _DummyNumpy:
        ndarray = Any
        uint8 = int
    np = _DummyNumpy()
    NUMPY_AVAILABLE = False
    print("[ERROR] numpy is required. Install via: pip install numpy opencv-python pillow reedsolo", file=sys.stderr)

# Optional imports with friendly error reporting
try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False
    print("[ERROR] OpenCV is required. Install via: pip install opencv-python", file=sys.stderr)

try:
    import reedsolo
    REEDSOLO_AVAILABLE = True
except ImportError:
    reedsolo = None
    REEDSOLO_AVAILABLE = False

# Import codec helpers if available in current directory
try:
    import visual_codec
    HAS_LOCAL_CODEC = True
except ImportError:
    HAS_LOCAL_CODEC = False

# Import integrity verification module if available
try:
    import integrity_verifier
    from integrity_verifier import StreamIntegrityVerifier
    HAS_VERIFIER_MODULE = True
except ImportError:
    HAS_VERIFIER_MODULE = False


# ==============================================================================
# HEADER SPECIFICATION CONSTANTS
# ==============================================================================
HEADER_MAGIC = b'VCDC'
HEADER_END = b'END\x00'

# Legacy Header (v1): 24 bytes
# Magic(4s), Mode(B), ECC Parity(B), ECC Block Size(H), Payload Len(Q), CRC32(I), End Marker(4s)
HEADER_STRUCT_FORMAT_V1 = '>4sBBHQI4s'
HEADER_BYTE_SIZE_V1 = struct.calcsize(HEADER_STRUCT_FORMAT_V1)  # 24 bytes

# Extended Header (v2 with 32-byte SHA-256): 56 bytes
# Magic(4s), Mode(B), ECC Parity(B), ECC Block Size(H), Payload Len(Q), CRC32(I), SHA256(32s), End Marker(4s)
HEADER_STRUCT_FORMAT_V2 = '>4sBBHQI32s4s'
HEADER_BYTE_SIZE_V2 = struct.calcsize(HEADER_STRUCT_FORMAT_V2)  # 56 bytes

HEADER_STRUCT_FORMAT = HEADER_STRUCT_FORMAT_V2
HEADER_BYTE_SIZE = HEADER_BYTE_SIZE_V2

MODE_RGB = 'RGB'
MODE_MONO = 'L'
MODE_IDS = {MODE_RGB: 1, MODE_MONO: 2}
ID_TO_MODE = {v: k for k, v in MODE_IDS.items()}
DEFAULT_ECC_PARITY_BYTES = 16
DEFAULT_ECC_BLOCK_SIZE = 255


# ==============================================================================
# 1. REED-SOLOMON ERROR CORRECTION HELPERS
# ==============================================================================
def rs_decode_payload(
    encoded_data: bytes,
    original_payload_len: int,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> Tuple[bytes, int, List[int]]:
    """
    Decodes Reed-Solomon encoded bytes, automatically detecting and repairing corrupted
    bytes caused by color shifts or transmission distortion before CRC32 calculation.
    """
    if ecc_parity <= 0:
        return encoded_data[:original_payload_len], 0, []

    if not REEDSOLO_AVAILABLE:
        return encoded_data[:original_payload_len], 0, []

    codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
    k = ecc_block_size - ecc_parity
    block_count = math.ceil(original_payload_len / k) if original_payload_len > 0 else 1
    chunk_size = ecc_block_size

    corrected_blocks = []
    total_corrected = 0
    all_err_positions = []

    for b in range(block_count):
        block_start = b * chunk_size
        block_end = min(block_start + chunk_size, len(encoded_data))
        block_bytes = encoded_data[block_start:block_end]

        if len(block_bytes) < ecc_parity:
            corrected_blocks.append(block_bytes)
            continue

        try:
            decoded_chunk, _, err_pos = codec.decode(bytearray(block_bytes))
            corrected_blocks.append(bytes(decoded_chunk))
            if err_pos is not None and len(err_pos) > 0:
                total_corrected += len(err_pos)
                all_err_positions.extend([p + b * k for p in err_pos])
        except reedsolo.ReedSolomonError:
            # Uncorrectable block: extract raw uncorrected data chunk
            data_len_in_block = max(0, len(block_bytes) - ecc_parity)
            corrected_blocks.append(block_bytes[:data_len_in_block])

    assembled = b"".join(corrected_blocks)
    return assembled[:original_payload_len], total_corrected, all_err_positions


# ==============================================================================
# 2. FRAME-BY-FRAME GRID DETECTOR & HEADER SCANNER
# ==============================================================================
class VisualGridDetector:
    """
    Scans a captured BGR video frame for the Visual Data Codec pixel grid,
    determines the upscale factor, center-samples pixel blocks, and extracts
    the raw payload and Row-0 metadata header.
    """

    def __init__(self, expected_scale: Optional[int] = None):
        self.expected_scale = expected_scale
        # Common upscale multipliers to test
        self.candidate_scales = [10, 8, 5, 4, 16, 2, 1, 20]
        if expected_scale and expected_scale in self.candidate_scales:
            self.candidate_scales.remove(expected_scale)
            self.candidate_scales.insert(0, expected_scale)

        # Cache previously locked coordinates for ultra-fast tracking
        self.last_lock: Optional[Dict[str, int]] = None
        self.lock_fail_count = 0

    def scan_and_decode(self, frame_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Main detection entrypoint:
        1. Fast-Path: Test previously locked (x, y, scale, width) coordinates (< 0.1ms).
        2. Fast-Scan: Locate VCDC magic pixel clusters via cv2.inRange (< 2ms).
        3. Direct multi-scale center-sampling (full-frame / pre-cropped).
        4. Contour ROI detection (cameras aimed at screens / cards).
        """
        # Strategy 1: Fast-Path from previously locked coordinates
        if self.last_lock is not None:
            res = self._try_decode_at_coords(
                frame_bgr,
                self.last_lock["x"],
                self.last_lock["y"],
                self.last_lock["scale"],
                self.last_lock.get("width")
            )
            if res is not None and res["is_crc_valid"]:
                self.lock_fail_count = 0
                return res
            else:
                self.lock_fail_count += 1
                if self.lock_fail_count > 3:
                    self.last_lock = None  # Lost lock, run full scan

        # Strategy 2: Fast Magic Pixel Cluster Scan
        res = self._try_magic_pixel_scan(frame_bgr)
        if res is not None and res["is_crc_valid"]:
            self.last_lock = {
                "x": res["roi"][0],
                "y": res["roi"][1],
                "scale": res["scale"],
                "width": res["grid_dims"][0]
            }
            self.lock_fail_count = 0
            return res

        # Strategy 3: Direct multi-scale center-sampling (full frame)
        h, w = frame_bgr.shape[:2]
        res = self._try_decode_region(frame_bgr, 0, 0, w, h)
        if res is not None:
            return res

        # Strategy 4: Contour detection
        contour_res = self._try_contour_detection(frame_bgr)
        if contour_res is not None:
            return contour_res

        return None

    def _try_magic_pixel_scan(self, frame_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Locates the VCDC magic header start pixel.
        Byte 0-2 (V, C, D) in RGB is (86, 67, 68), which is (68, 67, 86) in BGR.
        Scans with +/- 14 tolerance to handle HDMI/webcam color shifts.
        """
        # BGR range for 'V','C','D'
        lower = np.array([68 - 14, 67 - 14, 86 - 14], dtype=np.uint8)
        upper = np.array([68 + 14, 67 + 14, 86 + 14], dtype=np.uint8)
        mask = cv2.inRange(frame_bgr, lower, upper)

        # If too many pixels match (e.g. noisy frame), skip to contour/region scan
        if np.count_nonzero(mask) > 15000:
            return None

        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            bx, by, bw, bh = cv2.boundingRect(c)
            # Candidate scales: bw, bh, or user-requested scale
            scales_to_try = [bw]
            if bh != bw and bh > 0:
                scales_to_try.append(bh)
            if self.expected_scale and self.expected_scale not in scales_to_try:
                scales_to_try.append(self.expected_scale)
            for default_s in [10, 8, 4, 2, 1, 16]:
                if default_s not in scales_to_try:
                    scales_to_try.append(default_s)

            for scale in scales_to_try:
                if scale <= 0:
                    continue
                res = self._try_decode_at_coords(frame_bgr, bx, by, scale)
                if res is not None and res["is_crc_valid"]:
                    return res

        return None

    def _try_decode_at_coords(
        self,
        frame_bgr: np.ndarray,
        x: int,
        y: int,
        scale: int,
        preferred_width: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """Samples header at (x, y) with block size scale, then tests candidate widths."""
        fh, fw = frame_bgr.shape[:2]
        offset = scale // 2

        # Check RGB: requires at least 8 pixels (v1 24B) up to 19 pixels (v2 56B)
        max_rgb_pixels = min(19, (fw - x) // scale) if scale > 0 else 0
        if max_rgb_pixels < 8 or y + scale > fh:
            return None

        # Sample candidate header pixels
        sample_x = [x + i * scale + offset for i in range(max_rgb_pixels)]
        sample_y = y + offset
        sampled_bgr = frame_bgr[sample_y, sample_x, :]
        row0_rgb = sampled_bgr[:, [2, 1, 0]].tobytes()

        has_sha256 = False
        expected_sha256 = None
        magic = None
        mode = None

        if len(row0_rgb) >= 4 and row0_rgb[:4] == HEADER_MAGIC:
            mode = MODE_RGB
            # Check for 56-byte V2 header first
            if len(row0_rgb) >= HEADER_BYTE_SIZE_V2 and row0_rgb[52:56] == HEADER_END:
                try:
                    magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, raw_sha, end_marker = struct.unpack(
                        HEADER_STRUCT_FORMAT_V2,
                        row0_rgb[:HEADER_BYTE_SIZE_V2]
                    )
                    has_sha256 = True
                    expected_sha256 = raw_sha.hex().lower()
                except Exception:
                    magic = None
            # Check for 24-byte V1 legacy header
            elif len(row0_rgb) >= HEADER_BYTE_SIZE_V1 and row0_rgb[20:24] == HEADER_END:
                try:
                    magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
                        HEADER_STRUCT_FORMAT_V1,
                        row0_rgb[:HEADER_BYTE_SIZE_V1]
                    )
                except Exception:
                    magic = None

        # Check Monochrome mode if not RGB magic
        if magic is None or magic != HEADER_MAGIC:
            max_mono_pixels = min(56, (fw - x) // scale) if scale > 0 else 0
            if max_mono_pixels < 24 or y + scale > fh:
                return None
            sample_mono_x = [x + i * scale + offset for i in range(max_mono_pixels)]
            row0_mono = frame_bgr[sample_y, sample_mono_x, 0].tobytes()

            if len(row0_mono) >= 4 and row0_mono[:4] == HEADER_MAGIC:
                mode = MODE_MONO
                if len(row0_mono) >= HEADER_BYTE_SIZE_V2 and row0_mono[52:56] == HEADER_END:
                    try:
                        magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, raw_sha, end_marker = struct.unpack(
                            HEADER_STRUCT_FORMAT_V2,
                            row0_mono[:HEADER_BYTE_SIZE_V2]
                        )
                        has_sha256 = True
                        expected_sha256 = raw_sha.hex().lower()
                    except Exception:
                        return None
                elif len(row0_mono) >= HEADER_BYTE_SIZE_V1 and row0_mono[20:24] == HEADER_END:
                    try:
                        magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
                            HEADER_STRUCT_FORMAT_V1,
                            row0_mono[:HEADER_BYTE_SIZE_V1]
                        )
                    except Exception:
                        return None
                else:
                    return None
            else:
                return None

        # Calculate Total Expected Encoded Bytes
        if ecc_parity > 0:
            k = ecc_block_size - ecc_parity
            block_count = math.ceil(payload_len / k) if payload_len > 0 else 1
            total_expected = payload_len + block_count * ecc_parity
        else:
            total_expected = payload_len

        bytes_per_pix = 3 if mode == MODE_RGB else 1
        total_data_pixels = math.ceil(total_expected / bytes_per_pix) if total_expected > 0 else 1

        # Candidate grid widths to evaluate
        cand_widths = [64, 32, 128, 48, 80, 96, 16, 256]
        if preferred_width and preferred_width in cand_widths:
            cand_widths.remove(preferred_width)
            cand_widths.insert(0, preferred_width)
        elif preferred_width:
            cand_widths.insert(0, preferred_width)

        for w_cand in cand_widths:
            h_cand = 1 + math.ceil(total_data_pixels / w_cand)
            # Check if grid fits inside the frame
            grid_px_w = w_cand * scale
            grid_px_h = h_cand * scale
            if x + grid_px_w > fw or y + grid_px_h > fh:
                continue

            y_pts = [y + r * scale + offset for r in range(1, h_cand)]
            x_pts = [x + c_idx * scale + offset for c_idx in range(w_cand)]

            if not y_pts or not x_pts:
                data_bytes = b""
            else:
                sampled_block = frame_bgr[np.ix_(y_pts, x_pts)]
                if mode == MODE_RGB:
                    data_bytes = sampled_block[:, :, [2, 1, 0]].tobytes()[:total_expected]
                else:
                    data_bytes = sampled_block[:, :, 0].tobytes()[:total_expected]

            # Reed-Solomon Error Correction
            corrected_payload, corrected_count, err_pos = rs_decode_payload(
                data_bytes,
                payload_len,
                ecc_parity,
                ecc_block_size
            )

            # Checksum Verification
            calculated_crc = zlib.crc32(corrected_payload) & 0xFFFFFFFF
            is_crc_valid = (calculated_crc == expected_crc)

            # Real-Time SHA-256 Digest Calculation & Verification
            calculated_sha256 = hashlib.sha256(corrected_payload).hexdigest().lower()
            is_sha256_valid = True
            if has_sha256 and expected_sha256 and expected_sha256 != ("00" * 32):
                is_sha256_valid = (calculated_sha256 == expected_sha256)

            if is_crc_valid:
                return {
                    "header": {
                        "magic": magic.decode(errors='ignore') if isinstance(magic, (bytes, bytearray)) else str(magic),
                        "mode": ID_TO_MODE.get(mode_id, 'UNKNOWN'),
                        "ecc_parity": ecc_parity,
                        "ecc_block_size": ecc_block_size,
                        "payload_len": payload_len,
                        "expected_crc": expected_crc,
                        "expected_crc_hex": f"0x{expected_crc:08X}",
                        "expected_sha256": expected_sha256,
                        "has_sha256": has_sha256,
                    },
                    "calculated_crc": calculated_crc,
                    "calculated_crc_hex": f"0x{calculated_crc:08X}",
                    "calculated_sha256": calculated_sha256,
                    "is_crc_valid": True,
                    "is_sha256_valid": is_sha256_valid,
                    "scale": scale,
                    "grid_dims": (w_cand, h_cand),
                    "roi": (x, y, grid_px_w, grid_px_h),
                    "corrected_count": corrected_count,
                    "err_positions": err_pos,
                    "payload": corrected_payload,
                    "raw_bytes_extracted": len(data_bytes),
                    "is_repaired": (corrected_count > 0),
                }

        return None

    def _try_decode_region(
        self,
        frame_bgr: np.ndarray,
        roi_x: int,
        roi_y: int,
        roi_w: int,
        roi_h: int
    ) -> Optional[Dict[str, Any]]:
        """Attempt to decode a region at candidate scale factors."""
        region = frame_bgr[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]
        rh, rw = region.shape[:2]

        for scale in self.candidate_scales:
            if rw % scale != 0 or rh % scale != 0:
                continue

            orig_w = rw // scale
            orig_h = rh // scale

            # Row 0 needs at least 8 pixels (RGB) or 24 pixels (Mono) for header
            if orig_w < 8 or orig_h < 1:
                continue

            offset = scale // 2
            # Sample Row 0
            row0_bgr = region[offset, offset::scale, :]  # Shape: (orig_w, 3)
            # Convert to RGB bytes
            row0_rgb = row0_bgr[:, [2, 1, 0]].tobytes()

            has_sha256 = False
            expected_sha256 = None
            magic = None
            mode = None

            if len(row0_rgb) >= 4 and row0_rgb[:4] == HEADER_MAGIC:
                mode = MODE_RGB
                if len(row0_rgb) >= HEADER_BYTE_SIZE_V2 and row0_rgb[52:56] == HEADER_END:
                    try:
                        magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, raw_sha, end_marker = struct.unpack(
                            HEADER_STRUCT_FORMAT_V2,
                            row0_rgb[:HEADER_BYTE_SIZE_V2]
                        )
                        has_sha256 = True
                        expected_sha256 = raw_sha.hex().lower()
                    except Exception:
                        magic = None
                elif len(row0_rgb) >= HEADER_BYTE_SIZE_V1 and row0_rgb[20:24] == HEADER_END:
                    try:
                        magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
                            HEADER_STRUCT_FORMAT_V1,
                            row0_rgb[:HEADER_BYTE_SIZE_V1]
                        )
                    except Exception:
                        magic = None

            if magic is None or magic != HEADER_MAGIC:
                # Also check monochrome (Luminance channel)
                mono_row0 = region[offset, offset::scale, 0].tobytes()
                if len(mono_row0) >= 4 and mono_row0[:4] == HEADER_MAGIC:
                    mode = MODE_MONO
                    if len(mono_row0) >= HEADER_BYTE_SIZE_V2 and mono_row0[52:56] == HEADER_END:
                        try:
                            magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, raw_sha, end_marker = struct.unpack(
                                HEADER_STRUCT_FORMAT_V2,
                                mono_row0[:HEADER_BYTE_SIZE_V2]
                            )
                            has_sha256 = True
                            expected_sha256 = raw_sha.hex().lower()
                        except Exception:
                            continue
                    elif len(mono_row0) >= HEADER_BYTE_SIZE_V1 and mono_row0[20:24] == HEADER_END:
                        try:
                            magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
                                HEADER_STRUCT_FORMAT_V1,
                                mono_row0[:HEADER_BYTE_SIZE_V1]
                            )
                        except Exception:
                            continue
                    else:
                        continue
                else:
                    continue

            # Valid header found! Extract all rows using center sampling
            extracted = self._extract_payload(region, orig_w, orig_h, scale, mode, payload_len, ecc_parity, ecc_block_size)
            if extracted is None:
                continue

            raw_encoded_bytes, total_encoded_expected = extracted

            # Reed-Solomon Error Recovery
            corrected_payload, corrected_count, err_pos = rs_decode_payload(
                raw_encoded_bytes,
                payload_len,
                ecc_parity,
                ecc_block_size
            )

            # CRC32 Verification
            calculated_crc = zlib.crc32(corrected_payload) & 0xFFFFFFFF
            is_crc_valid = (calculated_crc == expected_crc)

            # Real-Time SHA-256 Digest Calculation & Verification
            calculated_sha256 = hashlib.sha256(corrected_payload).hexdigest().lower()
            is_sha256_valid = True
            if has_sha256 and expected_sha256 and expected_sha256 != ("00" * 32):
                is_sha256_valid = (calculated_sha256 == expected_sha256)

            return {
                "header": {
                    "magic": magic.decode(errors='ignore') if isinstance(magic, (bytes, bytearray)) else str(magic),
                    "mode": ID_TO_MODE.get(mode_id, 'UNKNOWN'),
                    "ecc_parity": ecc_parity,
                    "ecc_block_size": ecc_block_size,
                    "payload_len": payload_len,
                    "expected_crc": expected_crc,
                    "expected_crc_hex": f"0x{expected_crc:08X}",
                    "expected_sha256": expected_sha256,
                    "has_sha256": has_sha256,
                },
                "calculated_crc": calculated_crc,
                "calculated_crc_hex": f"0x{calculated_crc:08X}",
                "calculated_sha256": calculated_sha256,
                "is_crc_valid": is_crc_valid,
                "is_sha256_valid": is_sha256_valid,
                "scale": scale,
                "grid_dims": (orig_w, orig_h),
                "roi": (roi_x, roi_y, roi_w, roi_h),
                "corrected_count": corrected_count,
                "err_positions": err_pos,
                "payload": corrected_payload,
                "raw_bytes_extracted": len(raw_encoded_bytes),
                "is_repaired": (corrected_count > 0 and is_crc_valid),
            }

        return None

    def _extract_payload(
        self,
        region: np.ndarray,
        orig_w: int,
        orig_h: int,
        scale: int,
        mode: str,
        payload_len: int,
        ecc_parity: int,
        ecc_block_size: int
    ) -> Optional[Tuple[bytes, int]]:
        """Extracts payload + parity bytes from Row 1 onwards via center-sampling."""
        if ecc_parity > 0:
            k = ecc_block_size - ecc_parity
            block_count = math.ceil(payload_len / k) if payload_len > 0 else 1
            total_expected = payload_len + block_count * ecc_parity
        else:
            total_expected = payload_len

        offset = scale // 2
        # Sample all rows from 1 to orig_h - 1
        y_indices = [y * scale + offset for y in range(1, orig_h)]
        x_indices = [x * scale + offset for x in range(orig_w)]

        if not y_indices or not x_indices:
            return b"", total_expected

        sampled = region[np.ix_(y_indices, x_indices)]  # Shape: (orig_h - 1, orig_w, 3)

        if mode == MODE_RGB:
            # Convert BGR to RGB
            sampled_rgb = sampled[:, :, [2, 1, 0]]
            flat_bytes = sampled_rgb.tobytes()
        else:
            sampled_mono = sampled[:, :, 0]
            flat_bytes = sampled_mono.tobytes()

        return flat_bytes[:total_expected], total_expected

    def _try_contour_detection(self, frame_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
        """Detects high-contrast rectangular cards/screens in the camera feed."""
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 50, 150)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (frame_bgr.shape[0] * frame_bgr.shape[1]) * 0.01

        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            if cv2.contourArea(cnt) < min_area:
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            # Ensure within frame bounds
            if w < 64 or h < 10:
                continue
            res = self._try_decode_region(frame_bgr, x, y, w, h)
            if res is not None:
                return res

        return None


# ==============================================================================
# 3. METRICS TRACKER & PERFORMANCE MONITOR
# ==============================================================================
class MetricsTracker:
    """Calculates instantaneous & rolling FPS, data throughput (KB/s), and FEC stats."""

    def __init__(self, window_seconds: float = 1.0):
        self.window_seconds = window_seconds
        self.frame_times = deque()
        self.byte_events = deque()  # (timestamp, byte_count)

        self.start_time = time.time()
        self.total_frames_captured = 0
        self.total_frames_decoded = 0
        self.total_frames_repaired = 0
        self.total_frames_corrupted = 0
        self.total_bytes_received = 0
        self.total_errors_corrected = 0

        self.current_fps = 0.0
        self.current_kbps = 0.0

    def record_frame(self):
        """Record a captured video frame for FPS calculation."""
        now = time.time()
        self.total_frames_captured += 1
        self.frame_times.append(now)

        # Evict old timestamps
        cutoff = now - self.window_seconds
        while self.frame_times and self.frame_times[0] < cutoff:
            self.frame_times.popleft()

        if len(self.frame_times) > 1:
            duration = self.frame_times[-1] - self.frame_times[0]
            self.current_fps = (len(self.frame_times) - 1) / max(0.001, duration)

    def record_decoded_payload(self, byte_count: int, corrected_errors: int, is_valid: bool):
        """Record a successfully decoded payload for throughput & FEC stats."""
        now = time.time()
        if is_valid:
            self.total_frames_decoded += 1
            self.total_bytes_received += byte_count
            self.total_errors_corrected += corrected_errors
            if corrected_errors > 0:
                self.total_frames_repaired += 1
            self.byte_events.append((now, byte_count))
        else:
            self.total_frames_corrupted += 1

        # Evict old byte events
        cutoff = now - self.window_seconds
        while self.byte_events and self.byte_events[0][0] < cutoff:
            self.byte_events.popleft()

        window_bytes = sum(b for _, b in self.byte_events)
        self.current_kbps = (window_bytes / 1024.0) / max(0.001, self.window_seconds)

    def get_stats_summary(self) -> Dict[str, Any]:
        uptime = max(0.1, time.time() - self.start_time)
        return {
            "fps": self.current_fps,
            "throughput_kbps": self.current_kbps,
            "total_bytes_kb": self.total_bytes_received / 1024.0,
            "total_decoded_frames": self.total_frames_decoded,
            "total_repaired_frames": self.total_frames_repaired,
            "total_errors_corrected": self.total_errors_corrected,
            "uptime_seconds": uptime,
            "avg_kbps": (self.total_bytes_received / 1024.0) / uptime,
        }


# ==============================================================================
# 4. HUD OVERLAY RENDERER
# ==============================================================================
class HUDOverlayRenderer:
    """Draws a clean, professional broadcast HUD overlay on the live OpenCV window."""

    # Color Palette (BGR)
    COLOR_DARK_BG = (22, 22, 26)
    COLOR_PANEL_BG = (35, 36, 42)
    COLOR_BORDER = (60, 62, 72)
    COLOR_WHITE = (245, 245, 250)
    COLOR_EMERALD = (80, 200, 120)
    COLOR_AMBER = (50, 180, 245)
    COLOR_ROSE = (70, 70, 235)
    COLOR_INDIGO = (220, 140, 90)
    COLOR_MUTED = (160, 160, 175)

    def draw(
        self,
        frame: np.ndarray,
        decode_res: Optional[Dict[str, Any]],
        metrics: MetricsTracker,
        source_label: str,
        last_text_snippet: str
    ) -> np.ndarray:
        h, w = frame.shape[:2]
        canvas = frame.copy()

        # 1. Top Header Banner
        cv2.rectangle(canvas, (0, 0), (w, 48), self.COLOR_DARK_BG, -1)
        cv2.line(canvas, (0, 48), (w, 48), self.COLOR_BORDER, 1)

        # Title & Device Info
        cv2.putText(canvas, "VISUAL DATA CODEC", (16, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, self.COLOR_AMBER, 2, cv2.LINE_AA)
        cv2.putText(canvas, f"LIVE DECODER | {source_label} ({w}x{h})", (195, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.42, self.COLOR_MUTED, 1, cv2.LINE_AA)

        # Top Right: FPS Indicator
        fps_text = f"FPS: {metrics.current_fps:04.1f}"
        cv2.putText(canvas, fps_text, (w - 125, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, self.COLOR_WHITE, 2, cv2.LINE_AA)

        # 2. Status Badge
        badge_y = 38
        if decode_res is not None and decode_res["is_crc_valid"]:
            if not decode_res.get("is_sha256_valid", True):
                badge_text = "SHA-256 REJECTED (BIT MISMATCH)"
                badge_color = self.COLOR_ROSE
            elif decode_res["corrected_count"] > 0:
                badge_text = f"LOCKED: RS REPAIRED (+{decode_res['corrected_count']}B) | SHA-256 PASS"
                badge_color = self.COLOR_AMBER
            elif decode_res.get("has_sha256"):
                badge_text = "LOCKED: CRC32 & SHA-256 VERIFIED"
                badge_color = self.COLOR_EMERALD
            else:
                badge_text = "LOCKED: CRC32 VERIFIED"
                badge_color = self.COLOR_EMERALD
        elif decode_res is not None and not decode_res["is_crc_valid"]:
            badge_text = "CRC32 MISMATCH / NOISE OVERLOAD"
            badge_color = self.COLOR_ROSE
        else:
            badge_text = "SCANNING FOR VCDC HEADER..."
            badge_color = self.COLOR_MUTED

        cv2.circle(canvas, (24, badge_y), 5, badge_color, -1)
        cv2.putText(canvas, badge_text, (36, badge_y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.40, badge_color, 1, cv2.LINE_AA)

        # 3. Bottom HUD Metrics Panel
        panel_h = 76
        panel_y = h - panel_h
        cv2.rectangle(canvas, (0, panel_y), (w, h), self.COLOR_DARK_BG, -1)
        cv2.line(canvas, (0, panel_y), (w, panel_y), self.COLOR_BORDER, 1)

        # Metric Column 1: Throughput
        cv2.putText(canvas, "DATA TRANSFER RATE", (20, panel_y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.38, self.COLOR_MUTED, 1, cv2.LINE_AA)
        rate_str = f"{metrics.current_kbps:06.1f} KB/s"
        cv2.putText(canvas, rate_str, (20, panel_y + 46), cv2.FONT_HERSHEY_SIMPLEX, 0.75, self.COLOR_EMERALD, 2, cv2.LINE_AA)
        total_str = f"Total: {metrics.total_bytes_received / 1024.0:04.1f} KB ({metrics.total_frames_decoded} frames)"
        cv2.putText(canvas, total_str, (20, panel_y + 64), cv2.FONT_HERSHEY_SIMPLEX, 0.35, self.COLOR_MUTED, 1, cv2.LINE_AA)

        # Metric Column 2: Reed-Solomon (FEC) Stats
        col2_x = max(240, w // 4)
        cv2.putText(canvas, "REED-SOLOMON (FEC)", (col2_x, panel_y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.38, self.COLOR_MUTED, 1, cv2.LINE_AA)
        fec_str = f"{metrics.total_errors_corrected} Corrupted Bytes Fixed"
        cv2.putText(canvas, fec_str, (col2_x, panel_y + 44), cv2.FONT_HERSHEY_SIMPLEX, 0.50, self.COLOR_INDIGO, 1, cv2.LINE_AA)
        fec_sub = f"Repaired Frames: {metrics.total_frames_repaired} | Clean: {metrics.total_frames_decoded - metrics.total_frames_repaired}"
        cv2.putText(canvas, fec_sub, (col2_x, panel_y + 64), cv2.FONT_HERSHEY_SIMPLEX, 0.35, self.COLOR_MUTED, 1, cv2.LINE_AA)

        # Metric Column 3: Live Decoded Content Ticker
        col3_x = max(520, w // 2)
        cv2.putText(canvas, "DECODED STREAM CONTENT", (col3_x, panel_y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.38, self.COLOR_MUTED, 1, cv2.LINE_AA)
        snippet_clean = (last_text_snippet.replace("\n", " ").replace("\r", ""))[:50]
        if not snippet_clean:
            snippet_clean = "Waiting for data..."
        cv2.putText(canvas, f'"{snippet_clean}"', (col3_x, panel_y + 45), cv2.FONT_HERSHEY_SIMPLEX, 0.45, self.COLOR_WHITE, 1, cv2.LINE_AA)

        if decode_res is not None:
            sha_sub = f" | SHA: {decode_res['calculated_sha256'][:8]}.." if decode_res.get('calculated_sha256') else ""
            crc_info = f"CRC: {decode_res['calculated_crc_hex']}{sha_sub} | Scale: {decode_res['scale']}x | Grid: {decode_res['grid_dims'][0]}x{decode_res['grid_dims'][1]}"
            cv2.putText(canvas, crc_info, (col3_x, panel_y + 64), cv2.FONT_HERSHEY_SIMPLEX, 0.35, self.COLOR_MUTED, 1, cv2.LINE_AA)

        # 4. Target Bounding Box
        if decode_res is not None and "roi" in decode_res:
            rx, ry, rw, rh = decode_res["roi"]
            box_color = self.COLOR_EMERALD if decode_res["is_crc_valid"] else self.COLOR_ROSE
            cv2.rectangle(canvas, (rx, ry), (rx + rw, ry + rh), box_color, 2)
            # Corner markers
            cl = 14
            cv2.line(canvas, (rx, ry), (rx + cl, ry), box_color, 3)
            cv2.line(canvas, (rx, ry), (rx, ry + cl), box_color, 3)
            cv2.line(canvas, (rx + rw, ry), (rx + rw - cl, ry), box_color, 3)
            cv2.line(canvas, (rx + rw, ry), (rx + rw, ry + cl), box_color, 3)
            cv2.line(canvas, (rx, ry + rh), (rx + cl, ry + rh), box_color, 3)
            cv2.line(canvas, (rx, ry + rh), (rx, ry + rh - cl), box_color, 3)
            cv2.line(canvas, (rx + rw, ry + rh), (rx + rw - cl, ry + rh), box_color, 3)
            cv2.line(canvas, (rx + rw, ry + rh), (rx + rw, ry + rh - cl), box_color, 3)

        return canvas


# ==============================================================================
# 5. SYNTHETIC VIDEO CAPTURE (FOR SELF-TEST & SIMULATION)
# ==============================================================================
class SyntheticStreamCapture:
    """
    Generates realistic 1080p60 video frames carrying live Visual Data Codec
    payloads with configurable optical noise / color shifts. Allows complete
    real-time testing without requiring physical HDMI or webcam hardware.
    """

    def __init__(self, width: int = 1280, height: int = 720, noise_rate: float = 0.30):
        self.width = width
        self.height = height
        self.noise_rate = noise_rate
        self.chunk_index = 0
        self.last_frame_time = time.time()
        self.scale = 10

        self.messages = [
            "HDMI Capture Stream Test: Packet #{seq:04d} | Timestamp: {ts}",
            "Real-Time Visual Codec transmission active! Bitrate: 45.2 KB/s | Seq: {seq:04d} | Ts: {ts}",
            "Reed-Solomon FEC operational! Channel noise resilience test block #{seq:04d} | Ts: {ts}",
            "Streaming 1080p visual pixel grid over HDMI link | Frame #{seq:04d} | Status: SYNC | Ts: {ts}",
            "High-throughput optical data link | Verified IEEE 802.3 CRC32 | Chk: {seq:04d} | Ts: {ts}",
        ]

    def read(self) -> Tuple[bool, np.ndarray]:
        # Throttle to approx 30-60 FPS simulation
        elapsed = time.time() - self.last_frame_time
        if elapsed < 0.016:
            time.sleep(max(0.001, 0.016 - elapsed))
        self.last_frame_time = time.time()

        self.chunk_index += 1
        msg_template = self.messages[self.chunk_index % len(self.messages)]
        msg_text = msg_template.format(seq=self.chunk_index, ts=time.strftime("%H:%M:%S"))
        data_bytes = msg_text.encode('utf-8')

        # Encode bytes using visual_codec or internal RS encoder
        if HAS_LOCAL_CODEC:
            grid_rgb = visual_codec.encode_bytes_to_grid(
                data_bytes,
                mode=visual_codec.MODE_RGB,
                min_width=64,
                ecc_parity=16
            )
        else:
            # Fallback direct grid creation
            grid_rgb = self._make_mock_grid(data_bytes)

        gh, gw = grid_rgb.shape[:2]
        # Upscale 10x using nearest neighbor
        scaled_w = gw * self.scale
        scaled_h = gh * self.scale
        upscaled_rgb = cv2.resize(grid_rgb, (scaled_w, scaled_h), interpolation=cv2.INTER_NEAREST)

        # Convert to BGR for OpenCV
        upscaled_bgr = cv2.cvtColor(upscaled_rgb, cv2.COLOR_RGB2BGR)

        # Inject simulated optical transmission noise (color shifts / bit flips)
        if np.random.rand() < self.noise_rate:
            # Corrupt 2-5 pixel color values in Row 1 (data row)
            num_corruptions = np.random.randint(2, 6)
            row1_y_start = 1 * self.scale
            row1_y_end = 2 * self.scale
            for _ in range(num_corruptions):
                cx = np.random.randint(0, scaled_w)
                cy = np.random.randint(row1_y_start, min(row1_y_end, scaled_h))
                channel = np.random.randint(0, 3)
                upscaled_bgr[cy, cx, channel] = (int(upscaled_bgr[cy, cx, channel]) + 113) % 256

        # Create full video frame with realistic background and place upscaled grid in center
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        frame[:] = (18, 18, 22)  # Dark studio background

        # Place in center
        paste_x = (self.width - scaled_w) // 2
        paste_y = (self.height - scaled_h) // 2

        # Draw framing guide
        cv2.rectangle(frame, (paste_x - 4, paste_y - 4), (paste_x + scaled_w + 4, paste_y + scaled_h + 4), (55, 55, 65), 1)

        frame[paste_y:paste_y + scaled_h, paste_x:paste_x + scaled_w] = upscaled_bgr
        return True, frame

    def _make_mock_grid(self, data: bytes) -> np.ndarray:
        """Internal fallback encoder if visual_codec is not imported."""
        payload_len = len(data)
        crc = zlib.crc32(data) & 0xFFFFFFFF
        ecc_parity = 16
        ecc_block_size = 255

        # Reed-Solomon encode
        if REEDSOLO_AVAILABLE:
            codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
            encoded = bytes(codec.encode(data))
        else:
            encoded = data

        total_bytes = len(encoded)
        sha_bytes = hashlib.sha256(data).digest()
        header_bytes = struct.pack(
            HEADER_STRUCT_FORMAT_V2,
            HEADER_MAGIC,
            MODE_IDS[MODE_RGB],
            ecc_parity,
            ecc_block_size,
            payload_len,
            crc,
            sha_bytes,
            HEADER_END
        )

        data_pixels = math.ceil(total_bytes / 3) if total_bytes > 0 else 1
        width = max(64, int(math.ceil(math.sqrt(data_pixels))))
        if width % 4 != 0:
            width += (4 - (width % 4))
        height = 1 + math.ceil(data_pixels / width)

        grid = np.zeros((height, width, 3), dtype=np.uint8)
        hdr_np = np.frombuffer(header_bytes, dtype=np.uint8)
        pad_hdr = (3 - (len(hdr_np) % 3)) % 3
        if pad_hdr > 0:
            hdr_np = np.pad(hdr_np, (0, pad_hdr), mode='constant')
        grid[0, :len(hdr_np)//3, :] = hdr_np.reshape((-1, 3))

        p_np = np.frombuffer(encoded, dtype=np.uint8)
        pad_p = ((height - 1) * width * 3) - len(p_np)
        if pad_p > 0:
            p_np = np.pad(p_np, (0, pad_p), mode='constant')
        grid[1:, :, :] = p_np.reshape((height - 1, width, 3))
        return grid

    def release(self):
        pass


# ==============================================================================
# 6. MAIN LIVE STREAM DECODER CONTROLLER
# ==============================================================================
def run_live_stream_decoder(
    camera_index: Any = 0,
    width: int = 1920,
    height: int = 1080,
    fps: int = 60,
    scale: Optional[int] = None,
    output_file_path: Optional[str] = None,
    log_file_path: Optional[str] = None,
    headless: bool = False,
    synthetic: bool = False,
    max_frames: Optional[int] = None,
    expected_sha256: Optional[str] = None
):
    """
    Main loop for live video stream decoding.
    Captures frames, detects visual data grids, recovers bytes with Reed-Solomon,
    verifies CRC32 & SHA-256 integrity, displays live HUD overlays, and writes reconstructed output.
    """
    if not NUMPY_AVAILABLE:
        print("[FATAL] numpy is not installed. Please install it with: pip install numpy", file=sys.stderr)
        sys.exit(1)

    if not OPENCV_AVAILABLE:
        print("[FATAL] OpenCV (cv2) is not installed. Please install it with: pip install opencv-python", file=sys.stderr)
        sys.exit(1)

    print("=" * 78)
    print("      VISUAL DATA CODEC: REAL-TIME VIDEO STREAM DECODER")
    print("=" * 78)
    print(f" Source: {'SYNTHETIC STREAM (Self-Test Mode)' if synthetic else f'Camera / HDMI Device [{camera_index}]'}")
    print(f" Target Resolution: {width}x{height} @ {fps} FPS")
    print(f" Reed-Solomon FEC: {'ENABLED (reedsolo available)' if REEDSOLO_AVAILABLE else 'DISABLED (pip install reedsolo)'}")
    print(f" Display Mode: {'HEADLESS (Terminal Dashboard)' if headless else 'GUI (OpenCV Window)'}")
    if expected_sha256:
        print(f" Target SHA-256: {expected_sha256.lower()}")
    if output_file_path:
        print(f" Output Reassembly File: {output_file_path}")
    print("=" * 78)

    # 1. Initialize Capture Device
    if synthetic:
        cap = SyntheticStreamCapture(width=width, height=height)
        source_label = "Synthetic Stream Generator"
    else:
        # Try integer index or video file path
        try:
            device_id = int(camera_index)
        except ValueError:
            device_id = camera_index

        cap = cv2.VideoCapture(device_id)
        if not cap.isOpened():
            print(f"[ERROR] Could not open video device {camera_index}!", file=sys.stderr)
            print("Falling back to synthetic test stream so you can observe decoding...")
            cap = SyntheticStreamCapture(width=width, height=height)
            source_label = "Synthetic Fallback Stream"
        else:
            # Configure capture properties for low latency and high resolution
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            cap.set(cv2.CAP_PROP_FPS, fps)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Low latency frame buffer
            actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            source_label = f"Device [{camera_index}] ({actual_w}x{actual_h})"

    # 2. Components
    detector = VisualGridDetector(expected_scale=scale)
    metrics = MetricsTracker(window_seconds=1.0)
    hud = HUDOverlayRenderer()

    # Initialize Real-Time Data Integrity Verifier
    if HAS_VERIFIER_MODULE:
        verifier = StreamIntegrityVerifier(
            source_identifier=source_label,
            expected_sha256=expected_sha256
        )
    else:
        verifier = None

    # Reassembly state
    last_crc = None
    last_text_snippet = ""
    output_handle = None
    if output_file_path:
        output_handle = open(output_file_path, "wb")

    log_handle = None
    if log_file_path:
        log_handle = open(log_file_path, "w")
        log_handle.write("timestamp,fps,kbps,payload_bytes,crc32,sha256,ecc_errors_fixed,status\n")

    window_title = "Visual Data Codec - Live Video Stream Decoder"
    gui_active = not headless

    try:
        frame_counter = 0
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                print("[WARN] Frame read timeout or end of stream.")
                break

            frame_counter += 1
            metrics.record_frame()

            # 3. Detect and Decode Visual Data Grid
            decode_res = detector.scan_and_decode(frame)

            if decode_res is not None and decode_res["is_crc_valid"]:
                payload = decode_res["payload"]
                curr_crc = decode_res["header"]["expected_crc"]

                # Check for new unique chunk (deduplication)
                is_new_chunk = (curr_crc != last_crc)
                if is_new_chunk:
                    last_crc = curr_crc

                    # Check chunk-level SHA-256 if embedded in V2 header
                    chunk_sha_valid = decode_res.get("is_sha256_valid", True)
                    calc_sha = decode_res.get("calculated_sha256", "")
                    hdr_sha = decode_res["header"].get("expected_sha256")

                    if not chunk_sha_valid:
                        # Automatically reject corrupted chunks or flag bad sectors
                        metrics.record_decoded_payload(0, 0, is_valid=False)
                        print(f"[{time.strftime('%H:%M:%S')}] [SHA-256 REJECTED] Mismatch on chunk! Expected: {hdr_sha} != Calc: {calc_sha}")
                        continue

                    # Feed into StreamIntegrityVerifier
                    if verifier is not None:
                        is_valid_chunk, v_msg = verifier.process_chunk(
                            chunk_data=payload,
                            chunk_index=metrics.total_frames_decoded,
                            expected_chunk_crc=curr_crc,
                            is_repaired=decode_res.get("is_repaired", False)
                        )
                        if not is_valid_chunk:
                            metrics.record_decoded_payload(0, 0, is_valid=False)
                            print(f"[{time.strftime('%H:%M:%S')}] [STREAM VERIFIER REJECTED] {v_msg}")
                            continue

                    metrics.record_decoded_payload(
                        len(payload),
                        decode_res["corrected_count"],
                        is_valid=True
                    )

                    # Try decoding UTF-8 text for display
                    try:
                        text_str = payload.decode('utf-8')
                        last_text_snippet = text_str
                        status_str = f"[RECV TEXT] {text_str.strip()}"
                    except UnicodeDecodeError:
                        last_text_snippet = f"Binary ({len(payload)} bytes)"
                        status_str = f"[RECV BINARY] {len(payload)} bytes | CRC: {decode_res['calculated_crc_hex']}"

                    if decode_res.get("has_sha256") and hdr_sha:
                        status_str += f" | SHA-256: {calc_sha[:10]}... (PASS)"

                    if decode_res["corrected_count"] > 0:
                        status_str += f" | (RS FEC Repaired {decode_res['corrected_count']} corrupted bytes!)"

                    print(f"[{time.strftime('%H:%M:%S')}] {status_str}")

                    # Append to output file
                    if output_handle:
                        output_handle.write(payload)
                        output_handle.flush()

                    # Write log entry
                    if log_handle:
                        log_handle.write(f"{time.time():.3f},{metrics.current_fps:.1f},{metrics.current_kbps:.2f},{len(payload)},{decode_res['calculated_crc_hex']},{calc_sha[:16]},{decode_res['corrected_count']},OK\n")
                        log_handle.flush()
            elif decode_res is not None and not decode_res["is_crc_valid"]:
                metrics.record_decoded_payload(0, 0, is_valid=False)
                print(f"[{time.strftime('%H:%M:%S')}] [CRC MISMATCH] Expected: {decode_res['header']['expected_crc_hex']} | Calc: {decode_res['calculated_crc_hex']}")

            # 4. Render Live HUD & Display Window
            if gui_active:
                annotated_frame = hud.draw(frame, decode_res, metrics, source_label, last_text_snippet)
                try:
                    cv2.imshow(window_title, annotated_frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord('q') or key == 27:  # 'q' or ESC
                        print("\n[INFO] User requested exit (ESC/q pressed).")
                        break
                except cv2.error as e:
                    print(f"[WARN] GUI display not available ({e}). Switching to headless mode.")
                    gui_active = False

            # Terminal periodic status (every 60 frames)
            if frame_counter % 60 == 0:
                stats = metrics.get_stats_summary()
                print(f"[STATUS] FPS: {stats['fps']:04.1f} | Rate: {stats['throughput_kbps']:05.1f} KB/s | Decoded: {stats['total_decoded_frames']} frames ({stats['total_bytes_kb']:04.1f} KB) | RS Repaired: {stats['total_errors_corrected']} bytes")

            if max_frames and frame_counter >= max_frames:
                print(f"[INFO] Reached requested frame limit ({max_frames}).")
                break

    except KeyboardInterrupt:
        print("\n[INFO] Capture interrupted by user (Ctrl+C).")
    finally:
        cap.release()
        if gui_active:
            try:
                cv2.destroyAllWindows()
            except Exception:
                pass
        if output_handle:
            output_handle.close()
            print(f"[INFO] Reassembled stream saved to: {output_file_path}")
        if log_handle:
            log_handle.close()

    # Print final summary
    print("\n" + "=" * 78)
    print("                   LIVE STREAM DECODING SESSION SUMMARY")
    print("=" * 78)
    final_stats = metrics.get_stats_summary()
    print(f" Total Frames Processed:    {metrics.total_frames_captured}")
    print(f" Unique Payloads Decoded:  {final_stats['total_decoded_frames']}")
    print(f" Cumulative Data Received: {final_stats['total_bytes_kb']:.2f} KB ({metrics.total_bytes_received} bytes)")
    print(f" Average Transfer Rate:    {final_stats['avg_kbps']:.2f} KB/s")
    print(f" Average Framerate:        {final_stats['fps']:.1f} FPS")
    print(f" RS Repaired Frames:       {metrics.total_frames_repaired}")
    print(f" Total RS Bytes Corrected: {metrics.total_errors_corrected} corrupted bytes repaired")

    if verifier is not None:
        report = verifier.finalize()
        print(f" Cumulative Stream SHA-256: {report.calculated_sha256}")
        if report.expected_sha256:
            print(f" Target Stream SHA-256:     {report.expected_sha256}")
            print(f" SHA-256 Integrity Match:   {'PASS (100% Bit-Exact)' if report.sha256_match else 'FAIL (Hash Mismatch!)'}")
        print(f" Stream Integrity Status:   {report.integrity_status}")
    print("=" * 78)


# ==============================================================================
# 7. CLI ARGUMENT PARSER
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Real-Time Video Stream Decoder for Visual Data Codec using OpenCV and Reed-Solomon FEC."
    )
    parser.add_argument(
        "--camera", "-c",
        default="0",
        help="Camera device index (e.g. 0, 1), video file path, or stream URL (default: 0)"
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1920,
        help="Requested capture width in pixels (default: 1920)"
    )
    parser.add_argument(
        "--height",
        type=int,
        default=1080,
        help="Requested capture height in pixels (default: 1080)"
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=60,
        help="Requested capture framerate in FPS (default: 60)"
    )
    parser.add_argument(
        "--scale",
        type=int,
        default=None,
        help="Expected visual pixel block scale (e.g. 10 for 10x upscale; default: auto-detect)"
    )
    parser.add_argument(
        "--sha256",
        type=str,
        default=None,
        help="Target SHA-256 cryptographic hash (64-char hex) to verify end-to-end payload integrity"
    )
    parser.add_argument(
        "--output-file", "-o",
        default="restored_stream.txt",
        help="Path where reassembled sequential payload data will be saved (default: restored_stream.txt)"
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Optional CSV log file path to record FPS, throughput, and error stats"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=False,
        help="Run without displaying an OpenCV GUI window (ideal for servers or background capture)"
    )
    parser.add_argument(
        "--test", "--synthetic",
        action="store_true",
        default=False,
        help="Run in self-test synthetic mode with simulated HDMI transmission and color shifts"
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Maximum number of frames to process before exiting (useful for testing)"
    )

    args = parser.parse_args()
    run_live_stream_decoder(
        camera_index=args.camera,
        width=args.width,
        height=args.height,
        fps=args.fps,
        scale=args.scale,
        output_file_path=args.output_file,
        log_file_path=args.log_file,
        headless=args.headless,
        synthetic=args.test,
        max_frames=args.max_frames,
        expected_sha256=args.sha256
    )


if __name__ == "__main__":
    main()
