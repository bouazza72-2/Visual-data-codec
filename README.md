# Visual Data Codec

A specialized tool and conceptual framework designed for binary and text visual pixel grid encoding and decoding. It features a 56-byte Row-0 V2 metadata header, dual-layer CRC32 and SHA-256 validation, 10x nearest-neighbor upscaling, and Reed-Solomon Forward Error Correction (FEC) to prevent data corruption during transmission.

## Key Features

- **Lossless Pixel Grid Encoding:** Converts arbitrary text strings or raw binary payloads into a 24-bit RGB or monochrome 8-bit pixel grid.
- **Row-0 V2 Metadata Header:** Embeds magic bytes (`VCDC`), mapping mode, exact payload size, IEEE 802.3 CRC32 checksum, and a 32-byte SHA-256 hash directly into the first row of the image (56 Bytes total).
- **Reed-Solomon Error Correction (FEC):** Automatically detects and repairs bit flips, optical color shifts, or compression artifacts before validation, with adjustable overhead levels (Standard, Robust, Light).
- **Batch Processor:** Ingest an entire directory or folder of sequential VCDC frames, decode multi-scale pixel grids (1x to 10x), auto-repair corrupted bytes, and export the combined reconstructed data stream or a JSON manifest.
- **Live Video Stream Decoding:** High-frequency optical streaming (1080p60/720p60) from webcams or HDMI capture cards with an OpenCV HUD overlay for real-time metrics.
- **10x Nearest-Neighbor Upscaler:** Enlarges tiny pixel grids by a factor of 10 without smoothing or color-profile distortion (0% color shift), making them resilient for video transmission.
- **Embedded Systems Export:** Generates ready-to-use C header arrays (`.h`) directly from the UI for STM32, ESP32, and Arduino integration.

## Project Structure

- `src/` - Frontend application code and UI components (TypeScript / Vite).
- `src/components/BatchProcessorView.tsx` - Batch frame ingestion, auto-decoding, and sequential reassembly.
- `public/` - Static assets and web resources.
- `visual_codec.py` - Core Python logic for payload encoding, decoding, error correction, and batch directory processing.
- `live_stream_decoder.py` - Real-time video capture and frame decoding with OpenCV and HUD overlay.
- `upscale_png.py` - Lossless nearest-neighbor scaling utility to counter browser color-profile shifts.
- `key_parser.py` - Academic cryptographic and key-value parser.

## Requirements & Installation

To run the Python backend components locally, ensure you have Python 3.8+ installed along with the required libraries:

```bash
pip install pillow numpy reedsolomon opencv-python
```

## Concept & Use Case

This project explores side-channel data modulation techniques—mapping raw binary structures and system memory blocks into visual color channels to study data exfiltration and encoding robustness in restricted environments.

## Disclaimer

This software is developed strictly for educational, research, and experimental purposes in data encoding and error correction algorithms.
