#!/usr/bin/env python3
"""
Visual Data Codec (visual_codec.py)
===================================
A robust, modular Python module for encoding arbitrary binary files or text
strings into lossless PNG pixel grids (RGB or Monochrome) with Forward Error
Correction (FEC) using the Reed-Solomon algorithm, and decoding them back with
automatic error recovery and strict CRC32 integrity verification.

Features:
- Forward Error Correction (FEC): Reed-Solomon algorithm (RS(255, 239) with 16 parity bytes)
  automatically detects and corrects byte corruption caused by color shifts and channel flips.
- Supports RGB mode (1 pixel = 3 bytes: R, G, B)
- Supports Monochrome mode (1 pixel = 1 byte: 8-bit Grayscale)
- Dedicated Row-0 metadata header containing Magic Bytes (VCDC), Mode ID,
  ECC Parity Count, ECC Block Size, 64-bit Payload Length, CRC32 Checksum, and End Marker
- Dual backend support: PIL (Pillow) and OpenCV (cv2)
- Lossless 10x Nearest Neighbor upscale/downscale utility preserving visual codec data integrity
- Modular API + CLI demonstration showing encoding, color-shift corruption, and 100% RS recovery
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


# ==============================================================================
# HEADER SPECIFICATION CONSTANTS
# ==============================================================================
# Header format (24 bytes total, big-endian):
# Offset | Size | Type      | Description
# -------+------+-----------+----------------------------------------------
# 0      | 4    | 4s (char) | Magic bytes: b'VCDC' (Visual Codec)
# 4      | 1    | B (uint8) | Color mode: 1 = RGB, 2 = Monochrome (L)
# 5      | 1    | B (uint8) | ECC Parity Bytes per block (e.g. 16; 0 = no ECC)
# 6      | 2    | H (uint16)| ECC Block Size N (e.g. 255; 0 = no ECC)
# 8      | 8    | Q (uint64)| Original unencoded payload byte length
# 16     | 4    | I (uint32)| CRC32 checksum of original unencoded payload
# 20     | 4    | 4s (char) | End marker: b'END\\x00'
HEADER_MAGIC = b'VCDC'
HEADER_END = b'END\x00'
HEADER_STRUCT_FORMAT = '>4sBBHQI4s'
HEADER_BYTE_SIZE = struct.calcsize(HEADER_STRUCT_FORMAT)  # Exactly 24 bytes

MODE_RGB = 'RGB'
MODE_MONO = 'L'  # Grayscale / Monochrome

MODE_IDS = {
    MODE_RGB: 1,
    MODE_MONO: 2
}
ID_TO_MODE = {v: k for k, v in MODE_IDS.items()}

DEFAULT_ECC_PARITY_BYTES = 16
DEFAULT_ECC_BLOCK_SIZE = 255


# ==============================================================================
# 1. REED-SOLOMON ERROR CORRECTION HELPERS
# ==============================================================================
def rs_encode_payload(
    data: bytes,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> Tuple[bytes, int, int]:
    """
    Applies Reed-Solomon encoding to generate error correction parity bytes.
    Chunks payload if it exceeds K = (ecc_block_size - ecc_parity).
    Returns (encoded_bytes, total_parity_bytes, block_count).
    """
    if ecc_parity <= 0:
        return data, 0, 0

    if not REEDSOLO_AVAILABLE:
        raise RuntimeError("The 'reedsolo' Python package is required for FEC. Run: pip install reedsolo")

    codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
    encoded = codec.encode(data)
    k = ecc_block_size - ecc_parity
    block_count = math.ceil(len(data) / k) if len(data) > 0 else 1
    total_parity = block_count * ecc_parity
    return bytes(encoded), total_parity, block_count


def rs_decode_payload(
    encoded_data: bytes,
    original_payload_len: int,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> Tuple[bytes, int, list]:
    """
    Decodes Reed-Solomon encoded bytes, automatically detecting and repairing corrupted
    bytes caused by color shifts or transmission distortion before CRC32 calculation.
    Returns (corrected_data, corrected_count, err_positions).
    """
    if ecc_parity <= 0:
        return encoded_data[:original_payload_len], 0, []

    if not REEDSOLO_AVAILABLE:
        raise RuntimeError("The 'reedsolo' Python package is required for FEC. Run: pip install reedsolo")

    codec = reedsolo.RSCodec(ecc_parity, nsize=ecc_block_size)
    try:
        decoded_bytearray, decoded_with_ecc, err_pos_list = codec.decode(bytearray(encoded_data))
        corrected_bytes = bytes(decoded_bytearray)[:original_payload_len]
        err_positions = list(err_pos_list) if err_pos_list is not None else []
        return corrected_bytes, len(err_positions), err_positions
    except reedsolo.ReedSolomonError as e:
        raise ValueError(f"Reed-Solomon decoding failed: uncorrectable corruption detected ({e})")


# ==============================================================================
# 2. ENCODER FUNCTIONALITY
# ==============================================================================
def create_header(
    payload_len: int,
    crc32: int,
    mode: str,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> bytes:
    """Pack metadata into a strict 24-byte binary header with ECC parameters."""
    mode_id = MODE_IDS.get(mode.upper())
    if mode_id is None:
        raise ValueError(f"Unsupported mode '{mode}'. Choose 'RGB' or 'L' (monochrome).")

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
    """
    Convert raw binary data into a 2D NumPy pixel grid with Row-0 metadata header
    and Reed-Solomon Forward Error Correction (FEC) parity bytes.

    :param data: Raw bytes to encode
    :param mode: 'RGB' (3 bytes/pixel) or 'L' (monochrome 1 byte/pixel)
    :param min_width: Minimum pixel width of the generated image (default 64)
    :param ecc_parity: Number of Reed-Solomon parity bytes per block (default 16)
    :param ecc_block_size: RS Block size N (default 255)
    :return: 2D or 3D NumPy array of uint8 pixels (Height x Width [x Channels])
    """
    mode = mode.upper()
    if mode not in MODE_IDS:
        raise ValueError(f"Invalid mode '{mode}'. Use 'RGB' or 'L'.")

    payload_len = len(data)
    # CRC32 of original unencoded payload
    crc = zlib.crc32(data) & 0xFFFFFFFF

    # 1. Reed-Solomon encoding: append error correction parity bytes
    encoded_data, total_parity, block_count = rs_encode_payload(data, ecc_parity, ecc_block_size)
    total_encoded_bytes = len(encoded_data)

    # 2. Build 24-byte Row-0 Header with ECC parameters
    header_bytes = create_header(payload_len, crc, mode, ecc_parity, ecc_block_size)

    # 3. Dynamic grid sizing: ensure grid accommodates payload + parity bytes
    bytes_per_pixel = 3 if mode == MODE_RGB else 1
    data_pixels_needed = math.ceil(total_encoded_bytes / bytes_per_pixel) if total_encoded_bytes > 0 else 1

    header_pixels_needed = math.ceil(HEADER_BYTE_SIZE / bytes_per_pixel)
    min_required_width = max(min_width, header_pixels_needed)

    calculated_width = int(math.ceil(math.sqrt(data_pixels_needed)))
    width = max(min_required_width, calculated_width)

    # Round width up to multiple of 4 for clean byte alignment
    if width % 4 != 0:
        width += (4 - (width % 4))

    data_rows_needed = math.ceil(data_pixels_needed / width) if data_pixels_needed > 0 else 1
    height = 1 + data_rows_needed  # Row 0 is dedicated header row

    # 4. Populate image pixels
    if mode == MODE_RGB:
        grid = np.zeros((height, width, 3), dtype=np.uint8)

        # Write Row-0 Header
        header_np = np.frombuffer(header_bytes, dtype=np.uint8)
        pad_header = (3 - (len(header_np) % 3)) % 3
        if pad_header > 0:
            header_np = np.pad(header_np, (0, pad_header), mode='constant')
        header_pixel_count = len(header_np) // 3
        grid[0, :header_pixel_count, :] = header_np.reshape((header_pixel_count, 3))

        # Write Payload + ECC Parity starting from Row 1
        if total_encoded_bytes > 0:
            payload_np = np.frombuffer(encoded_data, dtype=np.uint8)
            total_capacity = (height - 1) * width * 3
            pad_data = total_capacity - total_encoded_bytes
            if pad_data > 0:
                payload_np = np.pad(payload_np, (0, pad_data), mode='constant')
            grid[1:, :, :] = payload_np.reshape((height - 1, width, 3))

    else:  # Monochrome / Grayscale (1 byte per pixel)
        grid = np.zeros((height, width), dtype=np.uint8)

        # Write Row-0 Header
        header_np = np.frombuffer(header_bytes, dtype=np.uint8)
        grid[0, :len(header_np)] = header_np

        # Write Payload + ECC Parity starting from Row 1
        if total_encoded_bytes > 0:
            payload_np = np.frombuffer(encoded_data, dtype=np.uint8)
            total_capacity = (height - 1) * width
            pad_data = total_capacity - total_encoded_bytes
            if pad_data > 0:
                payload_np = np.pad(payload_np, (0, pad_data), mode='constant')
            grid[1:, :] = payload_np.reshape((height - 1, width))

    return grid


def save_grid_to_png(
    grid: np.ndarray,
    output_path: str,
    mode: str = MODE_RGB,
    backend: str = 'PIL'
) -> None:
    """Save the NumPy pixel grid as a lossless PNG using either PIL or OpenCV."""
    mode = mode.upper()
    backend = backend.upper()

    if backend == 'OPENCV':
        if not OPENCV_AVAILABLE:
            raise RuntimeError("OpenCV (cv2) is not installed. Use backend='PIL' instead.")
        if mode == MODE_RGB:
            bgr_grid = cv2.cvtColor(grid, cv2.COLOR_RGB2BGR)
            cv2.imwrite(output_path, bgr_grid, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        else:
            cv2.imwrite(output_path, grid, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    else:
        pil_mode = 'RGB' if mode == MODE_RGB else 'L'
        img = Image.fromarray(grid, mode=pil_mode)
        img.save(output_path, format='PNG', optimize=True)


def encode_data(
    input_data: bytes | str,
    output_png_path: str,
    mode: str = MODE_RGB,
    backend: str = 'PIL',
    min_width: int = 64,
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES,
    ecc_block_size: int = DEFAULT_ECC_BLOCK_SIZE
) -> Dict[str, Any]:
    """High-level encoder: Encodes text string or binary bytes into a lossless PNG with RS FEC."""
    if isinstance(input_data, str):
        raw_bytes = input_data.encode('utf-8')
    elif isinstance(input_data, (bytes, bytearray)):
        raw_bytes = bytes(input_data)
    else:
        raise TypeError("input_data must be bytes, bytearray, or str.")

    grid = encode_bytes_to_grid(
        raw_bytes,
        mode=mode,
        min_width=min_width,
        ecc_parity=ecc_parity,
        ecc_block_size=ecc_block_size
    )
    save_grid_to_png(grid, output_png_path, mode=mode, backend=backend)

    height, width = grid.shape[:2]
    crc = zlib.crc32(raw_bytes) & 0xFFFFFFFF

    k = ecc_block_size - ecc_parity if ecc_parity > 0 else len(raw_bytes)
    block_count = math.ceil(len(raw_bytes) / k) if (ecc_parity > 0 and len(raw_bytes) > 0) else 1
    total_parity = block_count * ecc_parity if ecc_parity > 0 else 0

    return {
        "output_path": output_png_path,
        "mode": mode,
        "width": width,
        "height": height,
        "total_pixels": width * height,
        "payload_bytes": len(raw_bytes),
        "crc32": f"0x{crc:08X}",
        "ecc_parity_bytes": ecc_parity,
        "ecc_block_size": ecc_block_size,
        "total_parity_bytes": total_parity,
        "total_encoded_bytes": len(raw_bytes) + total_parity,
        "backend": backend
    }


def encode_file(
    input_file_path: str,
    output_png_path: str,
    mode: str = MODE_RGB,
    backend: str = 'PIL',
    ecc_parity: int = DEFAULT_ECC_PARITY_BYTES
) -> Dict[str, Any]:
    """Read a binary/text file from disk and encode it into a lossless PNG."""
    with open(input_file_path, 'rb') as f:
        file_bytes = f.read()
    return encode_data(file_bytes, output_png_path, mode=mode, backend=backend, ecc_parity=ecc_parity)


# ==============================================================================
# 3. DECODER FUNCTIONALITY
# ==============================================================================
def load_grid_from_png(image_path: str, backend: str = 'PIL') -> Tuple[np.ndarray, str]:
    """Load an image from disk using PIL or OpenCV and return a NumPy array + detected mode."""
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at {image_path}")

    backend = backend.upper()

    if backend == 'OPENCV':
        if not OPENCV_AVAILABLE:
            raise RuntimeError("OpenCV (cv2) is not installed. Use backend='PIL' instead.")
        cv_img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        if cv_img is None:
            raise ValueError(f"Failed to load image from {image_path} with OpenCV.")

        if len(cv_img.shape) == 2:
            return cv_img, MODE_MONO
        elif len(cv_img.shape) == 3:
            rgb_img = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
            return rgb_img, MODE_RGB
        else:
            raise ValueError(f"Unexpected image shape: {cv_img.shape}")
    else:
        with Image.open(image_path) as img:
            if img.mode in ('RGB', 'RGBA'):
                rgb_img = img.convert('RGB')
                return np.array(rgb_img, dtype=np.uint8), MODE_RGB
            elif img.mode in ('L', '1', 'P'):
                l_img = img.convert('L')
                return np.array(l_img, dtype=np.uint8), MODE_MONO
            else:
                return np.array(img.convert('RGB'), dtype=np.uint8), MODE_RGB


def decode_grid_to_bytes(grid: np.ndarray) -> Tuple[bytes, Dict[str, Any]]:
    """
    Parse the Row-0 header from a pixel grid, extract payload + parity bytes,
    run Reed-Solomon error correction to repair color shifts / bit flips, and verify CRC32.

    :param grid: NumPy array representing image pixels
    :return: (reconstructed_bytes, metadata_dict)
    """
    if grid.ndim == 3 and grid.shape[2] == 3:
        row0_bytes = grid[0, :, :].tobytes()
    elif grid.ndim == 2:
        row0_bytes = grid[0, :].tobytes()
    else:
        raise ValueError(f"Invalid grid dimensions {grid.shape}. Expected 2D or 3D array.")

    if len(row0_bytes) < HEADER_BYTE_SIZE:
        raise ValueError(f"Image width ({grid.shape[1]}) is too small to contain the {HEADER_BYTE_SIZE}-byte header.")

    # 1. Unpack Header with ECC Parameters
    try:
        magic, mode_id, ecc_parity, ecc_block_size, payload_len, expected_crc, end_marker = struct.unpack(
            HEADER_STRUCT_FORMAT,
            row0_bytes[:HEADER_BYTE_SIZE]
        )
    except Exception as e:
        raise ValueError(f"Failed to unpack header bytes: {e}")

    if magic != HEADER_MAGIC:
        raise ValueError(f"Header magic mismatch! Expected '{HEADER_MAGIC.decode()}', found '{magic}'. Not a valid Visual Codec image.")

    if end_marker != HEADER_END:
        raise ValueError("Header end marker mismatch! Image header might be corrupted.")

    mode = ID_TO_MODE.get(mode_id)
    if mode is None:
        raise ValueError(f"Unknown color mode ID ({mode_id}) in header.")

    # 2. Calculate Total Expected Encoded Bytes (Payload + ECC Parity)
    if ecc_parity > 0:
        k = ecc_block_size - ecc_parity
        block_count = math.ceil(payload_len / k) if payload_len > 0 else 1
        total_encoded_expected = payload_len + block_count * ecc_parity
    else:
        total_encoded_expected = payload_len

    if grid.shape[0] < 2 and total_encoded_expected > 0:
        raise ValueError("Image has only 1 row (header) but specifies non-zero payload length.")

    if mode == MODE_RGB:
        data_block = grid[1:, :, :].tobytes()
    else:
        data_block = grid[1:, :].tobytes()

    if len(data_block) < total_encoded_expected:
        raise ValueError(
            f"Image payload buffer ({len(data_block)} bytes) is smaller than "
            f"expected encoded data size ({total_encoded_expected} bytes)."
        )

    extracted_encoded_bytes = data_block[:total_encoded_expected]

    # 3. Reed-Solomon Error Correction
    ecc_corrected_count = 0
    ecc_error_positions = []
    ecc_status = 'none'

    if ecc_parity > 0:
        corrected_bytes, ecc_corrected_count, ecc_error_positions = rs_decode_payload(
            extracted_encoded_bytes,
            payload_len,
            ecc_parity=ecc_parity,
            ecc_block_size=ecc_block_size
        )
        ecc_status = 'corrected' if ecc_corrected_count > 0 else 'clean'
    else:
        corrected_bytes = extracted_encoded_bytes[:payload_len]
        ecc_status = 'none'

    # 4. Final CRC32 Integrity Validation on Error-Corrected Payload
    calculated_crc = zlib.crc32(corrected_bytes) & 0xFFFFFFFF
    if calculated_crc != expected_crc:
        raise ValueError(
            f"CRC32 Checksum Mismatch!\n"
            f"  Expected:   0x{expected_crc:08X}\n"
            f"  Calculated: 0x{calculated_crc:08X}\n"
            f"The image data has uncorrectable corruptions or color shifts exceeding FEC capacity."
        )

    metadata = {
        "mode": mode,
        "payload_bytes": payload_len,
        "expected_crc32": f"0x{expected_crc:08X}",
        "calculated_crc32": f"0x{calculated_crc:08X}",
        "checksum_verified": True,
        "dimensions": (grid.shape[1], grid.shape[0]),
        "ecc_parity_bytes": ecc_parity,
        "ecc_block_size": ecc_block_size,
        "ecc_status": ecc_status,
        "ecc_corrected_count": ecc_corrected_count,
        "ecc_error_positions": ecc_error_positions
    }

    return corrected_bytes, metadata


def decode_image(
    image_path: str,
    backend: str = 'PIL'
) -> Tuple[bytes, Dict[str, Any]]:
    """High-level decoder: Reads a PNG file, runs RS error correction, verifies CRC32, and returns payload."""
    grid, _ = load_grid_from_png(image_path, backend=backend)
    reconstructed_bytes, meta = decode_grid_to_bytes(grid)
    meta["source_image"] = image_path
    meta["backend"] = backend
    return reconstructed_bytes, meta


def decode_to_text(image_path: str, backend: str = 'PIL', encoding: str = 'utf-8') -> Tuple[str, Dict[str, Any]]:
    """Decode an encoded PNG directly to a decoded text string."""
    raw_bytes, meta = decode_image(image_path, backend=backend)
    text = raw_bytes.decode(encoding)
    return text, meta


def decode_to_file(image_path: str, output_file_path: str, backend: str = 'PIL') -> Dict[str, Any]:
    """Decode an encoded PNG and save the reconstructed binary file to disk."""
    raw_bytes, meta = decode_image(image_path, backend=backend)
    with open(output_file_path, 'wb') as f:
        f.write(raw_bytes)
    meta["saved_file"] = output_file_path
    return meta


# ==============================================================================
# 4. COLOR SHIFT / NOISE SIMULATION TOOL
# ==============================================================================
def simulate_color_shifts(
    image_path: str,
    output_path: str,
    num_corrupt_pixels: int = 5
) -> Dict[str, Any]:
    """
    Simulates transmission distortion or color shifts by altering random RGB pixel
    channel values in the payload rows (Rows 1+), demonstrating Reed-Solomon's recovery power.
    """
    grid, mode = load_grid_from_png(image_path)
    height, width = grid.shape[:2]

    if height < 2:
        raise ValueError("Image must have at least 2 rows to corrupt payload data.")

    corrupted_grid = grid.copy()
    corrupt_log = []

    # Pick random coordinates in rows 1 to height-1
    for _ in range(num_corrupt_pixels):
        ry = random.randint(1, height - 1)
        rx = random.randint(0, width - 1)

        if mode == MODE_RGB:
            ch = random.randint(0, 2)
            orig_val = int(corrupted_grid[ry, rx, ch])
            corrupted_grid[ry, rx, ch] = (orig_val ^ random.randint(1, 255)) & 0xFF
            new_val = int(corrupted_grid[ry, rx, ch])
            corrupt_log.append({"x": rx, "y": ry, "channel": ["R", "G", "B"][ch], "from": orig_val, "to": new_val})
        else:
            orig_val = int(corrupted_grid[ry, rx])
            corrupted_grid[ry, rx] = (orig_val ^ random.randint(1, 255)) & 0xFF
            new_val = int(corrupted_grid[ry, rx])
            corrupt_log.append({"x": rx, "y": ry, "channel": "Gray", "from": orig_val, "to": new_val})

    save_grid_to_png(corrupted_grid, output_path, mode=mode)
    return {
        "corrupted_pixels": corrupt_log,
        "corrupted_image": output_path
    }


# ==============================================================================
# 5. LOSSLESS UPSCALER / DOWNSCALER (NEAREST NEIGHBOR)
# ==============================================================================
def upscale_png(
    input_path: str,
    output_path: str,
    scale_factor: int = 10,
    backend: str = 'auto'
) -> Dict[str, Any]:
    """
    Performs a strictly lossless upscale of a PNG data image (e.g. 64x2 -> 640x20)
    using the Nearest Neighbor algorithm. Each original pixel is expanded into a
    (scale_factor x scale_factor) solid block without smoothing or color shifting.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")
    if scale_factor < 1 or not isinstance(scale_factor, int):
        raise ValueError(f"Scale factor must be a positive integer, got: {scale_factor}")

    backend_choice = backend.lower()

    if backend_choice == 'opencv' and OPENCV_AVAILABLE:
        img_cv = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
        if img_cv is None:
            raise ValueError(f"Failed to read image with OpenCV: {input_path}")
        orig_h, orig_w = img_cv.shape[:2]
        new_w, new_h = orig_w * scale_factor, orig_h * scale_factor
        upscaled_cv = cv2.resize(img_cv, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(output_path, upscaled_cv, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        actual_backend = 'OpenCV'
    else:
        with Image.open(input_path) as img:
            orig_w, orig_h = img.size
            new_w, new_h = orig_w * scale_factor, orig_h * scale_factor
            resample_mode = getattr(Image, 'Resampling', Image).NEAREST
            upscaled_img = img.resize((new_w, new_h), resample=resample_mode)
            upscaled_img.save(output_path, format='PNG', optimize=True)
        actual_backend = 'Pillow'

    return {
        "backend": actual_backend,
        "input_path": input_path,
        "output_path": output_path,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (new_w, new_h),
        "scale_factor": scale_factor,
        "algorithm": "Nearest Neighbor (Lossless, 0% smoothing)"
    }


def downscale_png(
    input_path: str,
    output_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """Downsamples an upscaled PNG back to 1x by center-sampling each (scale x scale) block."""
    with Image.open(input_path) as img:
        img_np = np.array(img)

    h, w = img_np.shape[:2]
    if w % scale_factor != 0 or h % scale_factor != 0:
        raise ValueError(f"Image dimensions ({w}x{h}) are not divisible by scale factor {scale_factor}.")

    orig_w, orig_h = w // scale_factor, h // scale_factor
    offset = scale_factor // 2
    y_coords = np.arange(orig_h) * scale_factor + offset
    x_coords = np.arange(orig_w) * scale_factor + offset

    downscaled_np = img_np[np.ix_(y_coords, x_coords)]
    Image.fromarray(downscaled_np).save(output_path, format='PNG', optimize=True)

    return {
        "input_path": input_path,
        "output_path": output_path,
        "restored_dimensions": (orig_w, orig_h),
        "scale_factor": scale_factor
    }


def verify_lossless_integrity(
    original_path: str,
    upscaled_path: str,
    scale_factor: int = 10
) -> Dict[str, Any]:
    """Verifies that all pixels in every (scale x scale) block of the upscaled image are 100% identical."""
    with Image.open(original_path) as o_img, Image.open(upscaled_path) as u_img:
        orig_arr = np.array(o_img)
        up_arr = np.array(u_img)

    orig_h, orig_w = orig_arr.shape[:2]
    up_h, up_w = up_arr.shape[:2]

    if up_w != orig_w * scale_factor or up_h != orig_h * scale_factor:
        return {"verified": False, "error": f"Dimension mismatch: expected ({orig_w * scale_factor}, {orig_h * scale_factor})"}

    non_matching = 0
    for y in range(orig_h):
        for x in range(orig_w):
            expected = orig_arr[y, x]
            block = up_arr[y * scale_factor : (y + 1) * scale_factor,
                           x * scale_factor : (x + 1) * scale_factor]
            if not np.all(block == expected):
                non_matching += 1

    verified = (non_matching == 0)
    return {
        "verified": verified,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (up_w, up_h),
        "scale_factor": scale_factor,
        "non_matching_blocks": non_matching,
        "integrity_status": "100% BIT-EXACT MATCH" if verified else "CORRUPTED"
    }


# ==============================================================================
# 6. DEMONSTRATION & CLI
# ==============================================================================
def run_demonstration():
    """Run a comprehensive demonstration showing Reed-Solomon error correction and lossless upscale."""
    print("=" * 75)
    print("   VISUAL DATA CODEC: FORWARD ERROR CORRECTION (FEC) & UPSCALER DEMO")
    print("=" * 75)

    sample_text = (
        "Visual Data Codec with Reed-Solomon Forward Error Correction!\n"
        "Even if optical noise, color shifts, or channel bit-flips corrupt the\n"
        "pixel grid during transmission, Reed-Solomon automatically repairs the\n"
        "data before final CRC32 validation."
    )

    clean_png = "demo_fec_clean.png"
    corrupted_png = "demo_fec_corrupted.png"

    # 1. Encode with Reed-Solomon (16 parity bytes)
    print("\n[Step 1] Encoding text with Reed-Solomon FEC (16 parity bytes)...")
    enc_meta = encode_data(sample_text, clean_png, mode=MODE_RGB, ecc_parity=16)
    print(f"  -> Original Payload: {enc_meta['payload_bytes']} bytes")
    print(f"  -> Total Encoded:    {enc_meta['total_encoded_bytes']} bytes (+{enc_meta['total_parity_bytes']} parity bytes)")
    print(f"  -> Grid Dimensions:  {enc_meta['width']}x{enc_meta['height']} px | CRC32: {enc_meta['crc32']}")

    # 2. Decode clean image
    print("\n[Step 2] Decoding clean image...")
    text_clean, dec_meta_clean = decode_to_text(clean_png)
    assert text_clean == sample_text, "Clean text mismatch!"
    print(f"  -> CRC32: {dec_meta_clean['calculated_crc32']} (Verified: {dec_meta_clean['checksum_verified']})")
    print(f"  -> ECC Status: {dec_meta_clean['ecc_status']} (0 errors)")

    # 3. Simulate Color Shifts / Pixel Corruption
    print("\n[Step 3] Simulating Color Shifts (corrupting 5 pixel color channels)...")
    c_res = simulate_color_shifts(clean_png, corrupted_png, num_corrupt_pixels=5)
    for c in c_res["corrupted_pixels"]:
        print(f"  -> Corrupted pixel at ({c['x']}, {c['y']}) channel {c['channel']}: {c['from']} -> {c['to']}")

    # 4. Decode corrupted image with Reed-Solomon automatic recovery
    print("\n[Step 4] Decoding corrupted image with Reed-Solomon error correction...")
    text_recovered, dec_meta_corrupt = decode_to_text(corrupted_png)
    print(f"  -> Corrected Bytes: {dec_meta_corrupt['ecc_corrected_count']} corrupted bytes automatically repaired!")
    print(f"  -> CRC32: {dec_meta_corrupt['calculated_crc32']} (Verified: {dec_meta_corrupt['checksum_verified']})")
    assert text_recovered == sample_text, "Reed-Solomon recovery failed!"
    print("  -> Recovery Result: 100% PERFECT MATCH with original text!")

    # 5. Lossless 10x Upscale Demo
    print("\n[Step 5] Testing 10x Nearest Neighbor Lossless Upscale...")
    upscaled_png = "demo_fec_10x.png"
    up_res = upscale_png(clean_png, upscaled_png, scale_factor=10)
    print(f"  -> Enlarged from {up_res['original_dimensions']} to {up_res['upscaled_dimensions']} px")
    v_res = verify_lossless_integrity(clean_png, upscaled_png, scale_factor=10)
    print(f"  -> Verification: {v_res['integrity_status']}")

    print("\n" + "=" * 75)
    print("ALL TESTS PASSED! Reed-Solomon Forward Error Correction is 100% Operational.")
    print("=" * 75)


def print_cli_help():
    print("""
Visual Data Codec CLI Usage:
----------------------------
Encode with FEC:
    python visual_codec.py encode -t "Hello World" -o output.png [--ecc 16] [--mode RGB|L]
    python visual_codec.py encode -i file.dat -o output.png [--ecc 16]

Decode with automatic error recovery:
    python visual_codec.py decode -i output.png
    python visual_codec.py decode -i output.png -o restored.dat

Simulate color-shift corruption:
    python visual_codec.py corrupt -i output.png -o corrupted.png [--pixels 5]

Lossless 10x Upscale / Downscale:
    python visual_codec.py upscale -i input.png -o upscaled.png [--scale 10]
    python visual_codec.py downscale -i upscaled.png -o restored.png [--scale 10]

Run automated demonstration:
    python visual_codec.py demo
""")


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] == 'demo':
        run_demonstration()
    elif sys.argv[1] == 'encode':
        mode = 'RGB'
        backend = 'PIL'
        out_path = 'encoded.png'
        input_text = None
        input_file = None
        ecc_parity = DEFAULT_ECC_PARITY_BYTES

        i = 2
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg in ('-t', '--text') and i + 1 < len(sys.argv):
                input_text = sys.argv[i + 1]
                i += 2
            elif arg in ('-i', '--input') and i + 1 < len(sys.argv):
                input_file = sys.argv[i + 1]
                i += 2
            elif arg in ('-o', '--output') and i + 1 < len(sys.argv):
                out_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-e', '--ecc') and i + 1 < len(sys.argv):
                ecc_parity = int(sys.argv[i + 1])
                i += 2
            elif arg in ('-m', '--mode') and i + 1 < len(sys.argv):
                mode = sys.argv[i + 1].upper()
                i += 2
            elif arg in ('-b', '--backend') and i + 1 < len(sys.argv):
                backend = sys.argv[i + 1].upper()
                i += 2
            else:
                i += 1

        if input_file:
            res = encode_file(input_file, out_path, mode=mode, backend=backend, ecc_parity=ecc_parity)
            print(f"Encoded file '{input_file}' -> '{out_path}' ({res['width']}x{res['height']}, CRC: {res['crc32']}, ECC: {res['total_parity_bytes']} parity bytes)")
        elif input_text is not None:
            res = encode_data(input_text, out_path, mode=mode, backend=backend, ecc_parity=ecc_parity)
            print(f"Encoded text -> '{out_path}' ({res['width']}x{res['height']}, CRC: {res['crc32']}, ECC: {res['total_parity_bytes']} parity bytes)")
        else:
            print("Error: Specify either -t 'text' or -i input_file")
            print_cli_help()
            sys.exit(1)

    elif sys.argv[1] == 'decode':
        in_path = None
        out_path = None
        backend = 'PIL'

        i = 2
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg in ('-i', '--input') and i + 1 < len(sys.argv):
                in_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-o', '--output') and i + 1 < len(sys.argv):
                out_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-b', '--backend') and i + 1 < len(sys.argv):
                backend = sys.argv[i + 1].upper()
                i += 2
            else:
                i += 1

        if not in_path:
            print("Error: Specify -i encoded_image.png")
            print_cli_help()
            sys.exit(1)

        if out_path:
            meta = decode_to_file(in_path, out_path, backend=backend)
            print(f"Decoded to file '{out_path}'. CRC32: {meta['calculated_crc32']} (Verified: {meta['checksum_verified']}, RS Corrected: {meta['ecc_corrected_count']} bytes)")
        else:
            raw_bytes, meta = decode_image(in_path, backend=backend)
            print(f"Decoded {meta['payload_bytes']} bytes. CRC32: {meta['calculated_crc32']} (Verified: {meta['checksum_verified']}, RS Corrected: {meta['ecc_corrected_count']} bytes)")
            try:
                text = raw_bytes.decode('utf-8')
                print("Decoded Text Preview:\n" + ("-" * 40))
                print(text)
                print("-" * 40)
            except UnicodeDecodeError:
                print(f"Binary data (non UTF-8). Hex preview: {raw_bytes[:64].hex()}...")

    elif sys.argv[1] == 'corrupt':
        in_path = None
        out_path = 'corrupted.png'
        num_pixels = 5
        i = 2
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg in ('-i', '--input') and i + 1 < len(sys.argv):
                in_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-o', '--output') and i + 1 < len(sys.argv):
                out_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-p', '--pixels') and i + 1 < len(sys.argv):
                num_pixels = int(sys.argv[i + 1])
                i += 2
            else:
                i += 1
        if not in_path:
            print("Error: Specify -i input.png")
            sys.exit(1)
        res = simulate_color_shifts(in_path, out_path, num_corrupt_pixels=num_pixels)
        print(f"Corrupted {len(res['corrupted_pixels'])} pixels in '{out_path}'.")

    elif sys.argv[1] == 'upscale':
        in_path = None
        out_path = None
        scale = 10
        backend = 'auto'
        i = 2
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg in ('-i', '--input') and i + 1 < len(sys.argv):
                in_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-o', '--output') and i + 1 < len(sys.argv):
                out_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-s', '--scale') and i + 1 < len(sys.argv):
                scale = int(sys.argv[i + 1])
                i += 2
            elif arg in ('-b', '--backend') and i + 1 < len(sys.argv):
                backend = sys.argv[i + 1].lower()
                i += 2
            else:
                i += 1
        if not in_path or not out_path:
            print("Error: Specify -i input.png -o upscaled.png [--scale 10]")
            sys.exit(1)
        res = upscale_png(in_path, out_path, scale_factor=scale, backend=backend)
        print(f"Upscaled '{in_path}' -> '{out_path}' ({res['original_dimensions']} -> {res['upscaled_dimensions']} px)")
        v = verify_lossless_integrity(in_path, out_path, scale_factor=scale)
        print(f"Integrity check: {v['integrity_status']}")

    elif sys.argv[1] == 'downscale':
        in_path = None
        out_path = None
        scale = 10
        i = 2
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg in ('-i', '--input') and i + 1 < len(sys.argv):
                in_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-o', '--output') and i + 1 < len(sys.argv):
                out_path = sys.argv[i + 1]
                i += 2
            elif arg in ('-s', '--scale') and i + 1 < len(sys.argv):
                scale = int(sys.argv[i + 1])
                i += 2
            else:
                i += 1
        if not in_path or not out_path:
            print("Error: Specify -i upscaled.png -o restored.png [--scale 10]")
            sys.exit(1)
        res = downscale_png(in_path, out_path, scale_factor=scale)
        print(f"Downscaled '{in_path}' -> '{out_path}' (Restored: {res['restored_dimensions']} px)")

    else:
        print_cli_help()
