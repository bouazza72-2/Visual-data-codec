#!/usr/bin/env python3
"""
Visual Data Codec (visual_codec.py)
===================================
A robust, modular Python module for encoding arbitrary binary files or text
strings into lossless PNG pixel grids (RGB or Monochrome), and decoding them
back with strict CRC32 integrity verification.

Features:
- Supports RGB mode (1 pixel = 3 bytes: R, G, B)
- Supports Monochrome mode (1 pixel = 1 byte: 8-bit Grayscale)
- Dedicated Row-0 metadata header containing Magic Bytes, Color Mode,
  exact Payload Byte Length (uint64), and CRC32 Checksum (uint32)
- Dual backend support: PIL (Pillow) and OpenCV (cv2)
- Lossless PNG serialization & deserialization
- Modular API + CLI demonstration
"""

import sys
import os
import math
import zlib
import struct
from typing import Tuple, Dict, Any, Optional

import numpy as np
from PIL import Image

try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False


# ==============================================================================
# HEADER SPECIFICATION CONSTANTS
# ==============================================================================
# Header format (24 bytes total, big-endian):
# Offset | Size | Type      | Description
# -------+------+-----------+----------------------------------------------
# 0      | 4    | 4s (char) | Magic bytes: b'VCDC' (Visual Codec)
# 4      | 1    | B (uint8) | Color mode: 1 = RGB, 2 = Monochrome (L)
# 5      | 3    | 3s (pad)  | Reserved / Alignment padding (b'\\x00\\x00\\x00')
# 8      | 8    | Q (uint64)| Payload byte length
# 16     | 4    | I (uint32)| CRC32 checksum of original payload
# 20     | 4    | 4s (char) | End marker: b'END\\x00'
HEADER_MAGIC = b'VCDC'
HEADER_END = b'END\x00'
HEADER_STRUCT_FORMAT = '>4sB3sQI4s'
HEADER_BYTE_SIZE = struct.calcsize(HEADER_STRUCT_FORMAT)  # Exactly 24 bytes

MODE_RGB = 'RGB'
MODE_MONO = 'L'  # Grayscale / Monochrome

MODE_IDS = {
    MODE_RGB: 1,
    MODE_MONO: 2
}
ID_TO_MODE = {v: k for k, v in MODE_IDS.items()}


# ==============================================================================
# 1. ENCODER FUNCTIONALITY
# ==============================================================================
def create_header(payload_len: int, crc32: int, mode: str) -> bytes:
    """Pack metadata into a strict 24-byte binary header."""
    mode_id = MODE_IDS.get(mode.upper())
    if mode_id is None:
        raise ValueError(f"Unsupported mode '{mode}'. Choose 'RGB' or 'L' (monochrome).")
    
    return struct.pack(
        HEADER_STRUCT_FORMAT,
        HEADER_MAGIC,
        mode_id,
        b'\x00\x00\x00',
        payload_len,
        crc32 & 0xFFFFFFFF,
        HEADER_END
    )


def encode_bytes_to_grid(
    data: bytes,
    mode: str = MODE_RGB,
    min_width: int = 64
) -> np.ndarray:
    """
    Convert raw binary data into a 2D NumPy pixel grid with a Row-0 metadata header.

    :param data: Raw bytes to encode
    :param mode: 'RGB' (3 bytes/pixel) or 'L' (monochrome 1 byte/pixel)
    :param min_width: Minimum pixel width of the generated image (default 64)
    :return: 2D or 3D NumPy array of uint8 pixels (Height x Width [x Channels])
    """
    mode = mode.upper()
    if mode not in MODE_IDS:
        raise ValueError(f"Invalid mode '{mode}'. Use 'RGB' or 'L'.")

    payload_len = len(data)
    crc = zlib.crc32(data) & 0xFFFFFFFF
    header_bytes = create_header(payload_len, crc, mode)

    bytes_per_pixel = 3 if mode == MODE_RGB else 1

    # Total pixels required for payload
    data_pixels_needed = math.ceil(payload_len / bytes_per_pixel) if payload_len > 0 else 1

    # Header is stored strictly in Row 0. Ensure width accommodates header bytes.
    header_pixels_needed = math.ceil(HEADER_BYTE_SIZE / bytes_per_pixel)
    min_required_width = max(min_width, header_pixels_needed)

    # Determine image dimensions: approximately square aspect ratio
    calculated_width = int(math.ceil(math.sqrt(data_pixels_needed)))
    width = max(min_required_width, calculated_width)

    # Round width up to multiple of 4 for memory alignment
    if width % 4 != 0:
        width += (4 - (width % 4))

    # Calculate payload rows (Rows 1 to H-1)
    data_rows_needed = math.ceil(data_pixels_needed / width) if data_pixels_needed > 0 else 1
    height = 1 + data_rows_needed  # Row 0 is dedicated header row

    # Initialize full image grid with zeros
    if mode == MODE_RGB:
        grid = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Populate Row 0 Header
        header_np = np.frombuffer(header_bytes, dtype=np.uint8)
        # Pad header to fill complete pixels if not divisible by 3
        pad_header = (3 - (len(header_np) % 3)) % 3
        if pad_header > 0:
            header_np = np.pad(header_np, (0, pad_header), mode='constant')
        header_pixel_count = len(header_np) // 3
        grid[0, :header_pixel_count, :] = header_np.reshape((header_pixel_count, 3))

        # Populate Payload Rows (Row 1 to height-1)
        if payload_len > 0:
            payload_np = np.frombuffer(data, dtype=np.uint8)
            total_payload_bytes_capacity = (height - 1) * width * 3
            pad_data = total_payload_bytes_capacity - payload_len
            if pad_data > 0:
                payload_np = np.pad(payload_np, (0, pad_data), mode='constant')
            grid[1:, :, :] = payload_np.reshape((height - 1, width, 3))

    else:  # Monochrome / Grayscale (1 byte per pixel)
        grid = np.zeros((height, width), dtype=np.uint8)

        # Populate Row 0 Header
        header_np = np.frombuffer(header_bytes, dtype=np.uint8)
        grid[0, :len(header_np)] = header_np

        # Populate Payload Rows (Row 1 to height-1)
        if payload_len > 0:
            payload_np = np.frombuffer(data, dtype=np.uint8)
            total_payload_bytes_capacity = (height - 1) * width
            pad_data = total_payload_bytes_capacity - payload_len
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
    """
    Save the NumPy pixel grid as a lossless PNG using either PIL or OpenCV.

    :param grid: NumPy array from encode_bytes_to_grid
    :param output_path: Destination .png filepath
    :param mode: 'RGB' or 'L'
    :param backend: 'PIL' or 'OPENCV'
    """
    mode = mode.upper()
    backend = backend.upper()

    if backend == 'OPENCV':
        if not OPENCV_AVAILABLE:
            raise RuntimeError("OpenCV (cv2) is not installed. Use backend='PIL' instead.")
        if mode == MODE_RGB:
            # OpenCV expects BGR channel ordering for colored images
            bgr_grid = cv2.cvtColor(grid, cv2.COLOR_RGB2BGR)
            cv2.imwrite(output_path, bgr_grid, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        else:
            cv2.imwrite(output_path, grid, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    else:
        # Default: PIL (Pillow)
        pil_mode = 'RGB' if mode == MODE_RGB else 'L'
        img = Image.fromarray(grid, mode=pil_mode)
        img.save(output_path, format='PNG', optimize=True)


def encode_data(
    input_data: bytes | str,
    output_png_path: str,
    mode: str = MODE_RGB,
    backend: str = 'PIL',
    min_width: int = 64
) -> Dict[str, Any]:
    """
    High-level encoder: Encodes text string or binary bytes into a lossless PNG.

    :param input_data: String or raw bytes
    :param output_png_path: Path to save the PNG file
    :param mode: 'RGB' (3 bytes/px) or 'L' (1 byte/px)
    :param backend: 'PIL' or 'OPENCV'
    :param min_width: Minimum width of image
    :return: Dictionary containing metadata (dimensions, payload length, CRC32, etc.)
    """
    if isinstance(input_data, str):
        raw_bytes = input_data.encode('utf-8')
    elif isinstance(input_data, (bytes, bytearray)):
        raw_bytes = bytes(input_data)
    else:
        raise TypeError("input_data must be bytes, bytearray, or str.")

    grid = encode_bytes_to_grid(raw_bytes, mode=mode, min_width=min_width)
    save_grid_to_png(grid, output_png_path, mode=mode, backend=backend)

    height, width = grid.shape[:2]
    crc = zlib.crc32(raw_bytes) & 0xFFFFFFFF

    return {
        "output_path": output_png_path,
        "mode": mode,
        "width": width,
        "height": height,
        "total_pixels": width * height,
        "payload_bytes": len(raw_bytes),
        "crc32": f"0x{crc:08X}",
        "backend": backend
    }


def encode_file(
    input_file_path: str,
    output_png_path: str,
    mode: str = MODE_RGB,
    backend: str = 'PIL'
) -> Dict[str, Any]:
    """Read a binary/text file from disk and encode it into a lossless PNG."""
    with open(input_file_path, 'rb') as f:
        file_bytes = f.read()
    return encode_data(file_bytes, output_png_path, mode=mode, backend=backend)


# ==============================================================================
# 2. DECODER FUNCTIONALITY
# ==============================================================================
def load_grid_from_png(image_path: str, backend: str = 'PIL') -> Tuple[np.ndarray, str]:
    """
    Load an image from disk using PIL or OpenCV and return a NumPy array + detected mode.

    :param image_path: Path to the PNG image
    :param backend: 'PIL' or 'OPENCV'
    :return: (NumPy array, mode string 'RGB' or 'L')
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at {image_path}")

    backend = backend.upper()

    if backend == 'OPENCV':
        if not OPENCV_AVAILABLE:
            raise RuntimeError("OpenCV (cv2) is not installed. Use backend='PIL' instead.")
        # Load unchanged to preserve original channels (Grayscale or Color)
        cv_img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        if cv_img is None:
            raise ValueError(f"Failed to load image from {image_path} with OpenCV.")
        
        if len(cv_img.shape) == 2:
            return cv_img, MODE_MONO
        elif len(cv_img.shape) == 3:
            # OpenCV loads color as BGR, convert to RGB
            rgb_img = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
            return rgb_img, MODE_RGB
        else:
            raise ValueError(f"Unexpected image shape: {cv_img.shape}")
    else:
        # Default: PIL (Pillow)
        with Image.open(image_path) as img:
            if img.mode in ('RGB', 'RGBA'):
                rgb_img = img.convert('RGB')
                return np.array(rgb_img, dtype=np.uint8), MODE_RGB
            elif img.mode in ('L', '1', 'P'):
                l_img = img.convert('L')
                return np.array(l_img, dtype=np.uint8), MODE_MONO
            else:
                # Default fallback conversion to RGB
                return np.array(img.convert('RGB'), dtype=np.uint8), MODE_RGB


def decode_grid_to_bytes(grid: np.ndarray) -> Tuple[bytes, Dict[str, Any]]:
    """
    Parse the Row-0 header from a pixel grid, extract payload, and verify CRC32.

    :param grid: NumPy array representing image pixels
    :return: (reconstructed_bytes, metadata_dict)
    """
    if grid.ndim == 3 and grid.shape[2] == 3:
        # RGB Mode: Flatten Row 0 to extract header
        row0_bytes = grid[0, :, :].tobytes()
    elif grid.ndim == 2:
        # Monochrome Mode: Row 0 direct bytes
        row0_bytes = grid[0, :].tobytes()
    else:
        raise ValueError(f"Invalid grid dimensions {grid.shape}. Expected 2D or 3D array.")

    if len(row0_bytes) < HEADER_BYTE_SIZE:
        raise ValueError(f"Image width ({grid.shape[1]}) is too small to contain the {HEADER_BYTE_SIZE}-byte header.")

    # Unpack Header
    try:
        magic, mode_id, _, payload_len, expected_crc, end_marker = struct.unpack(
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

    # Reconstruct Payload Bytes starting from Row 1
    if grid.shape[0] < 2 and payload_len > 0:
        raise ValueError("Image has only 1 row (header) but specifies non-zero payload length.")

    if mode == MODE_RGB:
        payload_data_block = grid[1:, :, :].tobytes()
    else:
        payload_data_block = grid[1:, :].tobytes()

    if len(payload_data_block) < payload_len:
        raise ValueError(
            f"Image payload buffer ({len(payload_data_block)} bytes) is smaller than "
            f"header payload size ({payload_len} bytes)."
        )

    # Slice exact original byte length (removes row-padding zeroes)
    reconstructed_bytes = payload_data_block[:payload_len]

    # Verify Checksum Integrity
    calculated_crc = zlib.crc32(reconstructed_bytes) & 0xFFFFFFFF
    if calculated_crc != expected_crc:
        raise ValueError(
            f"CRC32 Checksum Mismatch!\n"
            f"  Expected:   0x{expected_crc:08X}\n"
            f"  Calculated: 0x{calculated_crc:08X}\n"
            f"The image data has been modified or corrupted."
        )

    metadata = {
        "mode": mode,
        "payload_bytes": payload_len,
        "expected_crc32": f"0x{expected_crc:08X}",
        "calculated_crc32": f"0x{calculated_crc:08X}",
        "checksum_verified": True,
        "dimensions": (grid.shape[1], grid.shape[0])
    }

    return reconstructed_bytes, metadata


def decode_image(
    image_path: str,
    backend: str = 'PIL'
) -> Tuple[bytes, Dict[str, Any]]:
    """
    High-level decoder: Reads a PNG file, verifies header & CRC32, and returns payload.

    :param image_path: Path to the encoded PNG
    :param backend: 'PIL' or 'OPENCV'
    :return: (reconstructed_bytes, metadata_dict)
    """
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
# 3. DEMONSTRATION & CLI
# ==============================================================================
def run_demonstration():
    """Run a comprehensive demonstration showing text and binary roundtrip."""
    print("=" * 70)
    print("      VISUAL DATA CODEC: DEMONSTRATION & VERIFICATION")
    print("=" * 70)

    # 1. Text Demonstration
    sample_text = (
        "Hello, World! This is a visual data encoding and decoding demonstration.\n"
        "Data is mapped directly into pixel channels: 1 pixel = 3 bytes in RGB mode,\n"
        "or 1 pixel = 1 byte in monochrome mode.\n"
        "Row 0 stores a 24-byte binary header containing Magic Bytes (VCDC),\n"
        "Mode ID, 64-bit Payload Length, and a 32-bit CRC32 checksum for verification."
    )

    demo_rgb_png = "demo_text_rgb.png"
    demo_mono_png = "demo_text_mono.png"
    demo_bin_png = "demo_binary_rgb.png"

    print("\n[Step 1] Encoding sample text to RGB image...")
    meta_enc_rgb = encode_data(sample_text, demo_rgb_png, mode=MODE_RGB)
    print(f"  -> Encoded {meta_enc_rgb['payload_bytes']} bytes into {demo_rgb_png}")
    print(f"  -> Dimensions: {meta_enc_rgb['width']}x{meta_enc_rgb['height']} px | CRC32: {meta_enc_rgb['crc32']}")

    print("\n[Step 2] Decoding image back to text and verifying CRC32...")
    decoded_text, meta_dec_rgb = decode_to_text(demo_rgb_png)
    print(f"  -> Decoded Bytes: {meta_dec_rgb['payload_bytes']}")
    print(f"  -> Checksum Verified: {meta_dec_rgb['checksum_verified']} ({meta_dec_rgb['calculated_crc32']})")
    assert decoded_text == sample_text, "Text mismatch!"
    print("  -> Text integrity verification: SUCCESS! (Decoded matches original perfectly)")

    print("\n[Step 3] Encoding sample text to Monochrome (Grayscale) image...")
    meta_enc_mono = encode_data(sample_text, demo_mono_png, mode=MODE_MONO)
    print(f"  -> Encoded {meta_enc_mono['payload_bytes']} bytes into {demo_mono_png}")
    print(f"  -> Dimensions: {meta_enc_mono['width']}x{meta_enc_mono['height']} px | Mode: Monochrome")

    print("\n[Step 4] Decoding Monochrome image back to text...")
    decoded_mono_text, meta_dec_mono = decode_to_text(demo_mono_png)
    assert decoded_mono_text == sample_text, "Monochrome text mismatch!"
    print(f"  -> Checksum Verified: {meta_dec_mono['checksum_verified']} ({meta_dec_mono['calculated_crc32']})")
    print("  -> Monochrome verification: SUCCESS!")

    # 2. Binary Roundtrip Demonstration
    print("\n[Step 5] Binary File Roundtrip Demonstration (256 random bytes)...")
    np.random.seed(42)
    binary_payload = np.random.bytes(256)
    encode_data(binary_payload, demo_bin_png, mode=MODE_RGB)
    reconstructed_bin, meta_bin = decode_image(demo_bin_png)
    assert reconstructed_bin == binary_payload, "Binary payload mismatch!"
    print(f"  -> Binary Checksum: {meta_bin['calculated_crc32']} (Match: {reconstructed_bin == binary_payload})")
    print("  -> Binary verification: SUCCESS!")

    # 3. OpenCV Backend test if available
    if OPENCV_AVAILABLE:
        print("\n[Step 6] Testing OpenCV Backend Interoperability...")
        cv_demo_png = "demo_opencv_rgb.png"
        encode_data("Testing OpenCV backend interoperability!", cv_demo_png, mode=MODE_RGB, backend='OPENCV')
        cv_decoded, cv_meta = decode_to_text(cv_demo_png, backend='OPENCV')
        print(f"  -> OpenCV Decoded Text: '{cv_decoded}'")
        print(f"  -> OpenCV Checksum Verified: {cv_meta['checksum_verified']}")

    # 4. Lossless 10x Nearest Neighbor Upscale Demonstration
    print("\n[Step 7] Testing 10x Nearest Neighbor Lossless Upscale (64x2 -> 640x20)...")
    tiny_64x2_png = "encoded_data_rgb.png"
    upscaled_640x20_png = "encoded_data_rgb_10x.png"
    # Ensure sample 64x2 image exists
    encode_data("Tiny 64x2 visual codec transmission test payload.", tiny_64x2_png, mode=MODE_RGB, min_width=64)
    res_up = upscale_png(tiny_64x2_png, upscaled_640x20_png, scale_factor=10)
    print(f"  -> Upscaled: {res_up['original_dimensions'][0]}x{res_up['original_dimensions'][1]} -> {res_up['upscaled_dimensions'][0]}x{res_up['upscaled_dimensions'][1]} px")
    v_up = verify_lossless_integrity(tiny_64x2_png, upscaled_640x20_png, scale_factor=10)
    print(f"  -> Verification: {v_up['integrity_status']} (Non-matching blocks: {v_up['non_matching_blocks']})")
    assert v_up['verified'], "Upscaled integrity verification failed!"

    print("\n" + "=" * 70)
    print("ALL TESTS PASSED SUCCESSFULLY! Lossless PNG Codec is fully operational.")
    print("=" * 70)


# ==============================================================================
# 4. LOSSLESS UPSCALER / DOWNSCALER (NEAREST NEIGHBOR)
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

    :param input_path: Path to tiny input PNG (e.g. 64x2 pixels).
    :param output_path: Destination path for enlarged PNG (e.g. 640x20 pixels).
    :param scale_factor: Integer scaling factor (default: 10).
    :param backend: 'auto', 'pillow', or 'opencv'.
    :return: Dictionary containing execution details and dimensions.
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
        # Pillow implementation (default and fallback)
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
    """
    Downsamples an upscaled PNG back to 1x by center-sampling each (scale x scale) block.
    """
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
    """
    Verifies that all pixels in every (scale x scale) block of the upscaled image
    are 100% identical to the source pixel with zero color shifting.
    """
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
        "color_shift_detected": non_matching > 0,
        "integrity_status": "100% BIT-EXACT MATCH" if verified else "CORRUPTED"
    }


def print_cli_help():
    print("""
Visual Data Codec CLI Usage:
----------------------------
Encode text:
    python visual_codec.py encode -t "Hello World" -o output.png [--mode RGB|L]

Encode file:
    python visual_codec.py encode -i input.dat -o output.png [--mode RGB|L]

Decode to text:
    python visual_codec.py decode -i output.png

Decode to file:
    python visual_codec.py decode -i output.png -o restored_file.dat

Lossless Upscale (Nearest Neighbor 10x):
    python visual_codec.py upscale -i encoded_data_rgb.png -o upscaled_640x20.png [--scale 10]

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
            elif arg in ('-m', '--mode') and i + 1 < len(sys.argv):
                mode = sys.argv[i + 1].upper()
                i += 2
            elif arg in ('-b', '--backend') and i + 1 < len(sys.argv):
                backend = sys.argv[i + 1].upper()
                i += 2
            else:
                i += 1

        if input_file:
            res = encode_file(input_file, out_path, mode=mode, backend=backend)
            print(f"Encoded file '{input_file}' -> '{out_path}' ({res['width']}x{res['height']}, CRC: {res['crc32']})")
        elif input_text is not None:
            res = encode_data(input_text, out_path, mode=mode, backend=backend)
            print(f"Encoded text -> '{out_path}' ({res['width']}x{res['height']}, CRC: {res['crc32']})")
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
            print(f"Decoded to file '{out_path}'. CRC32: {meta['calculated_crc32']} (Verified: {meta['checksum_verified']})")
        else:
            raw_bytes, meta = decode_image(in_path, backend=backend)
            print(f"Decoded {meta['payload_bytes']} bytes. CRC32: {meta['calculated_crc32']} (Verified: {meta['checksum_verified']})")
            try:
                text = raw_bytes.decode('utf-8')
                print("Decoded Text Preview:\n" + ("-" * 40))
                print(text)
                print("-" * 40)
            except UnicodeDecodeError:
                print(f"Binary data (non UTF-8). Hex preview: {raw_bytes[:64].hex()}...")

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
            print_cli_help()
            sys.exit(1)

        res = upscale_png(in_path, out_path, scale_factor=scale, backend=backend)
        print(f"Upscaled '{in_path}' -> '{out_path}' ({res['original_dimensions'][0]}x{res['original_dimensions'][1]} to {res['upscaled_dimensions'][0]}x{res['upscaled_dimensions'][1]} px, scale={scale}x, algorithm={res['algorithm']})")
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
            print("Error: Specify -i upscaled.png -o restored_1x.png [--scale 10]")
            print_cli_help()
            sys.exit(1)

        res = downscale_png(in_path, out_path, scale_factor=scale)
        print(f"Downscaled '{in_path}' -> '{out_path}' (Restored: {res['restored_dimensions'][0]}x{res['restored_dimensions'][1]} px)")
    else:
        print_cli_help()
