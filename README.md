# Visual Data Codec

A specialized tool and conceptual framework designed for binary and text visual pixel grid encoding and decoding. It features a 24-byte Row-0 metadata header, CRC32 validation, 10x nearest-neighbor upscaling, and Reed-Solomon Forward Error Correction (FEC) to prevent data corruption during transmission.

## Key Features

- **Lossless Pixel Grid Encoding:** Converts arbitrary text strings or raw binary payloads into a 24-bit RGB or monochrome pixel grid.
- **Row-0 Metadata Header:** Embeds magic bytes (`VCDC`), mapping mode, exact payload size, and IEEE 802.3 CRC32 checksum directly into the first row of the image.
- **Reed-Solomon Error Correction (FEC):** Automatically detects and repairs bit flips, optical color shifts, or compression artifacts before validation.
- **10x Nearest-Neighbor Upscaler:** Enlarges tiny pixel grids without smoothing, anti-aliasing, or color-profile distortion—making them resilient for video transmission or side-channel testing.
- **Robust Decoder:** Parses headers, performs parity checks, and restores original files bit-for-bit.

## Project Structure

- `src/` - Frontend application code and UI components (TypeScript / Vite).
- `public/` - Static assets and web resources.
- `visual_codec.py` - Core Python logic for payload encoding, decoding, and error correction.
- `upscale_png.py` - Lossless nearest-neighbor scaling utility to counter browser color-profile shifts.

## Requirements & Installation

To run the Python backend components locally, ensure you have Python installed along with the required libraries:

    pip install pillow numpy reedsolomon opencv-python

## Concept & Use Case

This project explores side-channel data modulation techniques—mapping raw binary structures and system memory blocks into visual color channels to study data exfiltration and encoding robustness in restricted environments.

## Disclaimer

This software is developed strictly for educational, research, and experimental purposes in data encoding and error correction algorithms.
