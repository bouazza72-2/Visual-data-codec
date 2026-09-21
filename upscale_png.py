#!/usr/bin/env python3
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
        # Default to Pillow for robust PNG metadata handling, fallback to OpenCV
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

    :param input_path: Path to upscaled PNG (e.g. 640x20).
    :param output_path: Destination path for restored 1x PNG (e.g. 64x2).
    :param scale_factor: Integer scaling factor used during upscaling (default: 10).
    :return: Operation metadata dictionary.
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

    # Sample the center of each block to avoid edge artifacts:
    # offset = scale_factor // 2
    offset = scale_factor // 2
    y_indices = np.arange(orig_h) * scale_factor + offset
    x_indices = np.arange(orig_w) * scale_factor + offset

    # Slicing the grid at the center coordinates
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

    :param original_path: Path to original tiny 1x image (e.g. 64x2).
    :param upscaled_path: Path to upscaled image (e.g. 640x20).
    :param scale_factor: Scale factor used (default: 10).
    :return: Verification results including uniformity check and exact pixel match.
    """
    with Image.open(original_path) as orig_img:
        orig_arr = np.array(orig_img)
    with Image.open(upscaled_path) as up_img:
        up_arr = np.array(up_img)

    orig_h, orig_w = orig_arr.shape[:2]
    up_h, up_w = up_arr.shape[:2]

    # Check dimensions
    expected_w = orig_w * scale_factor
    expected_h = orig_h * scale_factor
    dim_match = (up_w == expected_w and up_h == expected_h)

    if not dim_match:
        return {
            "verified": False,
            "error": f"Dimension mismatch: Expected ({expected_w}, {expected_h}), got ({up_w}, {up_h})"
        }

    # Verify every pixel inside each (scale_factor x scale_factor) block is uniform
    # and exactly equal to orig_arr[y, x]
    total_pixels = orig_h * orig_w
    non_matching_blocks = 0
    non_uniform_blocks = 0

    for y in range(orig_h):
        for x in range(orig_w):
            expected_val = orig_arr[y, x]
            block = up_arr[y * scale_factor : (y + 1) * scale_factor,
                           x * scale_factor : (x + 1) * scale_factor]

            # Check if block is uniform
            if not np.all(block == expected_val):
                non_matching_blocks += 1

    verified = (non_matching_blocks == 0 and non_uniform_blocks == 0)

    return {
        "verified": verified,
        "original_dimensions": (orig_w, orig_h),
        "upscaled_dimensions": (up_w, up_h),
        "scale_factor": scale_factor,
        "total_source_pixels": total_pixels,
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
    parser.add_argument("--demo", action="store_true", help="Generate a sample 64x2 image and test 10x upscale")

    args = parser.parse_args()

    print("=" * 70)
    print("      LOSSLESS VISUAL DATA UPSCALER (NEAREST NEIGHBOR)")
    print("=" * 70)

    input_file = args.input_path
    output_file = args.output_path
    scale = args.scale

    if args.backend == "both":
        print(f"\n[1] Upscaling with Pillow (Nearest Neighbor, scale={scale}x)...")
        res_pil = upscale_png_pillow(input_file, output_file, scale_factor=scale)
        print(f"    -> Output saved: {output_file} ({res_pil['upscaled_dimensions'][0]}x{res_pil['upscaled_dimensions'][1]} px)")

        if OPENCV_AVAILABLE:
            cv_output = os.path.splitext(output_file)[0] + "_opencv.png"
            print(f"\n[2] Upscaling with OpenCV (cv2.INTER_NEAREST, scale={scale}x)...")
            res_cv = upscale_png_opencv(input_file, cv_output, scale_factor=scale)
            print(f"    -> Output saved: {cv_output} ({res_cv['upscaled_dimensions'][0]}x{res_cv['upscaled_dimensions'][1]} px)")
        else:
            print("\n[2] OpenCV not available, skipping OpenCV secondary export.")
    else:
        print(f"\nUpscaling with backend '{args.backend}' (scale={scale}x)...")
        res = upscale_png(input_file, output_file, scale_factor=scale, backend=args.backend)
        print(f"    -> Output saved: {output_file} ({res['upscaled_dimensions'][0]}x{res['upscaled_dimensions'][1]} px)")

    if args.verify:
        print("\n[3] Verifying bit-level integrity against original image...")
        v_res = verify_lossless_integrity(input_file, output_file, scale_factor=scale)
        print(f"    -> Original Size:  {v_res['original_dimensions'][0]}x{v_res['original_dimensions'][1]} px")
        print(f"    -> Upscaled Size:  {v_res['upscaled_dimensions'][0]}x{v_res['upscaled_dimensions'][1]} px")
        print(f"    -> Expanded Pixels: {v_res['total_expanded_pixels']} px ({scale*scale} pixels per source pixel)")
        print(f"    -> Integrity:      {v_res['integrity_status']}")
        print(f"    -> Color Shift:    {v_res['color_shift_detected']}")
        assert v_res['verified'], "Integrity check failed!"

    print("\n" + "=" * 70)
    print("SUCCESS: Lossless upscale complete with zero color shifting or smoothing.")
    print("=" * 70)


if __name__ == '__main__':
    # If no arguments provided, run self-test with a 64x2 test image
    if len(sys.argv) == 1:
        print("No arguments provided. Running self-test demonstration with a 64x2 PNG...")
        test_img_path = "encoded_data_rgb.png"
        upscaled_img_path = "encoded_data_rgb_10x.png"

        # Generate a test 64x2 RGB pattern if not present
        if not os.path.exists(test_img_path):
            print(f"Creating sample 64x2 test image: {test_img_path}")
            np.random.seed(42)
            # Create a 64x2 RGB array
            sample_grid = np.random.randint(0, 256, size=(2, 64, 3), dtype=np.uint8)
            # Row 0 first 8 pixels set to distinctive test values
            sample_grid[0, 0] = [86, 67, 68]  # 'VCD'
            sample_grid[0, 1] = [67, 1, 0]    # 'C', mode=1, pad=0
            Image.fromarray(sample_grid, mode='RGB').save(test_img_path, format='PNG')

        # Run upscale
        res_pil = upscale_png_pillow(test_img_path, upscaled_img_path, scale_factor=10)
        print(f"Upscaled {test_img_path} (64x2) -> {upscaled_img_path} (640x20)")

        if OPENCV_AVAILABLE:
            cv_out = "encoded_data_rgb_10x_opencv.png"
            upscale_png_opencv(test_img_path, cv_out, scale_factor=10)
            print(f"OpenCV generated: {cv_out} (640x20)")

        # Verify
        v_res = verify_lossless_integrity(test_img_path, upscaled_img_path, scale_factor=10)
        print(f"Verification: {v_res['integrity_status']} (Non-matching blocks: {v_res['non_matching_blocks']})")

        # Downscale and verify match
        downscaled_out = "encoded_data_rgb_restored_1x.png"
        downscale_png(upscaled_img_path, downscaled_out, scale_factor=10)
        orig_bytes = open(test_img_path, 'rb').read()
        restored_bytes = open(downscaled_out, 'rb').read()
        with Image.open(test_img_path) as i1, Image.open(downscaled_out) as i2:
            pixel_match = np.array_equal(np.array(i1), np.array(i2))
        print(f"Downscale center-sampling restoration bit-exact: {pixel_match}")
    else:
        main()
