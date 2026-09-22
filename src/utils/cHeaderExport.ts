import { EncodeResult } from '../types';

export type CPixelFormat = 'RGB888' | 'RGBA8888' | 'MONO8' | 'RAW_PAYLOAD';
export type CStorageQualifier = 'static_const' | 'progmem' | 'arm_aligned' | 'rodata' | 'const';

export interface CHeaderExportOptions {
  identifier?: string;
  format?: CPixelFormat;
  qualifier?: CStorageQualifier;
  includeHelper?: boolean;
  sourceFilename?: string;
  rawPayloadBytes?: Uint8Array;
}

/**
 * Sanitizes a string into a valid C language identifier (letters, numbers, underscores).
 */
export function sanitizeCIdentifier(name: string): string {
  const cleaned = name
    .replace(/\.[^/.]+$/, '') // remove file extension
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([0-9])/, '_$1'); // cannot start with digit
  return cleaned.length > 0 ? cleaned.toLowerCase() : 'vcdc_payload';
}

/**
 * Formats a byte array as indented C hex literals (e.g. 0x56, 0x43, ...)
 */
function formatHexLines(bytes: Uint8Array, bytesPerLine: number = 12, indent: string = '    '): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const chunk: string[] = [];
    const end = Math.min(i + bytesPerLine, bytes.length);
    for (let j = i; j < end; j++) {
      chunk.push(`0x${bytes[j].toString(16).padStart(2, '0').toUpperCase()}`);
    }
    const isLast = end === bytes.length;
    lines.push(`${indent}${chunk.join(', ')}${isLast ? '' : ','}`);
  }
  return lines.join('\n');
}

/**
 * Generates a ready-to-use C99 / C++11 header file buffer string
 * representing the VCDC visual payload for embedded systems.
 */
export function generateCHeader(
  encodeResult: EncodeResult,
  options: CHeaderExportOptions = {}
): {
  code: string;
  filename: string;
  bufferSize: number;
  identifier: string;
  format: CPixelFormat;
  qualifierStr: string;
} {
  const {
    identifier = sanitizeCIdentifier(options.sourceFilename || 'vcdc_payload'),
    format = encodeResult.mode === 'RGB' ? 'RGB888' : 'MONO8',
    qualifier = 'static_const',
    includeHelper = true,
    sourceFilename = 'encoded_payload.bin',
    rawPayloadBytes,
  } = options;

  const width = encodeResult.width;
  const height = encodeResult.height;
  const upperIdent = identifier.toUpperCase();
  const guardName = `${upperIdent}_VCDC_H`;

  // Read pixel data from the canvas
  const ctx = encodeResult.canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire 2D context from canvas');
  }
  const imgData = ctx.getImageData(0, 0, width, height);
  const rgba = imgData.data;

  // Build target byte array based on format
  let buffer: Uint8Array;
  let bytesPerPixel = 3;
  let formatDesc = '24-bit RGB (3 bytes per pixel: [R, G, B])';

  if (format === 'RAW_PAYLOAD') {
    buffer = rawPayloadBytes || new Uint8Array(0);
    bytesPerPixel = 1;
    formatDesc = 'Raw unencoded binary payload bytes';
  } else if (format === 'RGBA8888') {
    buffer = new Uint8Array(width * height * 4);
    bytesPerPixel = 4;
    formatDesc = '32-bit RGBA (4 bytes per pixel: [R, G, B, A=255]) - 32-bit aligned';
    for (let i = 0; i < width * height; i++) {
      buffer[i * 4 + 0] = rgba[i * 4 + 0];
      buffer[i * 4 + 1] = rgba[i * 4 + 1];
      buffer[i * 4 + 2] = rgba[i * 4 + 2];
      buffer[i * 4 + 3] = 255;
    }
  } else if (format === 'MONO8') {
    buffer = new Uint8Array(width * height);
    bytesPerPixel = 1;
    formatDesc = '8-bit Monochrome / Grayscale (1 byte per pixel)';
    for (let i = 0; i < width * height; i++) {
      buffer[i] = rgba[i * 4 + 0];
    }
  } else {
    // RGB888
    buffer = new Uint8Array(width * height * 3);
    bytesPerPixel = 3;
    formatDesc = '24-bit RGB (3 bytes per pixel: [R, G, B]) - Standard VCDC';
    for (let i = 0; i < width * height; i++) {
      buffer[i * 3 + 0] = rgba[i * 4 + 0];
      buffer[i * 3 + 1] = rgba[i * 4 + 1];
      buffer[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }

  // Storage qualifier mapping
  let qualifierDecl = 'static const uint8_t';
  let qualifierNotes = 'Standard C99 static const read-only buffer';

  switch (qualifier) {
    case 'progmem':
      qualifierDecl = 'static const uint8_t PROGMEM';
      qualifierNotes = 'AVR / Arduino flash memory (PROGMEM) - saves RAM';
      break;
    case 'arm_aligned':
      qualifierDecl = 'static const uint8_t __attribute__((aligned(4)))';
      qualifierNotes = 'ARM Cortex-M / STM32 / ESP32 32-bit DMA aligned buffer';
      break;
    case 'rodata':
      qualifierDecl = 'const uint8_t __attribute__((section(".rodata")))';
      qualifierNotes = 'GCC/Clang .rodata flash section';
      break;
    case 'const':
      qualifierDecl = 'const uint8_t';
      qualifierNotes = 'Global const buffer (extern linkage)';
      break;
    case 'static_const':
    default:
      qualifierDecl = 'static const uint8_t';
      qualifierNotes = 'Header-safe static const buffer';
      break;
  }

  // Generate row-annotated code blocks
  let bufferHexContent = '';

  if (format === 'RAW_PAYLOAD') {
    bufferHexContent = `    /* Raw Unencoded Payload Data (${buffer.length} bytes) */\n` +
      formatHexLines(buffer, 16, '    ');
  } else {
    // Break down Row 0 (Header row) and Data rows
    const bytesPerRow = width * bytesPerPixel;
    const row0Bytes = buffer.subarray(0, bytesPerRow);
    
    // Header breakdown comment
    const row0Hex = formatHexLines(row0Bytes, bytesPerPixel === 3 ? 12 : 16, '    ');
    
    bufferHexContent += `    /* ========================================================================\n`;
    bufferHexContent += `     * ROW 0: VCDC STANDARD METADATA HEADER (y = 0, Width = ${width} px, ${bytesPerRow} bytes)\n`;
    bufferHexContent += `     * - Magic: "VCDC" (0x56, 0x43, 0x44, 0x43)\n`;
    bufferHexContent += `     * - Mode: ${encodeResult.mode === 'RGB' ? '1 (RGB888)' : '2 (Mono)'}\n`;
    bufferHexContent += `     * - ECC: RS(${encodeResult.eccBlockSize}, ${encodeResult.eccBlockSize - encodeResult.eccParityBytes}) Parity=${encodeResult.eccParityBytes}B\n`;
    bufferHexContent += `     * - Payload Size: ${encodeResult.payloadBytes} bytes (uint64 big-endian)\n`;
    bufferHexContent += `     * - CRC32: ${encodeResult.crcHex} (uint32 big-endian)\n`;
    bufferHexContent += `     * - SHA-256: ${encodeResult.sha256Hex}\n`;
    bufferHexContent += `     * - End Marker: "END\\0" (0x45, 0x4E, 0x44, 0x00)\n`;
    bufferHexContent += `     * ======================================================================== */\n`;
    bufferHexContent += `${row0Hex},\n\n`;

    // Data rows
    const dataBytes = buffer.subarray(bytesPerRow);
    if (dataBytes.length > 0) {
      bufferHexContent += `    /* ========================================================================\n`;
      bufferHexContent += `     * ROWS 1..${height - 1}: ENCODED PAYLOAD DATA + ECC PARITY (${height - 1} rows, ${dataBytes.length} bytes)\n`;
      bufferHexContent += `     * ======================================================================== */\n`;
      bufferHexContent += formatHexLines(dataBytes, bytesPerPixel === 3 ? 12 : 16, '    ');
    }
  }

  // Build the complete C Header File
  const code = `/**
 * @file ${identifier}_vcdc.h
 * @brief VCDC Visual Data Framebuffer & Payload Buffer for Embedded Systems
 *
 * Generated automatically by Visual Data Codec Studio
 * Source: ${sourceFilename}
 * Target: ${formatDesc}
 * Memory Qualifier: ${qualifierNotes}
 *
 * VCDC SPECIFICATION:
 * - Magic: 'V', 'C', 'D', 'C' (0x56, 0x43, 0x44, 0x43)
 * - Row 0: Standard VCDC Metadata Header with IEEE 802.3 CRC32 & SHA-256
 * - Rows 1..${height - 1}: Encoded Data Payload with Reed-Solomon RS(${encodeResult.eccBlockSize}, ${encodeResult.eccBlockSize - encodeResult.eccParityBytes}) FEC
 * - Frame Dimensions: ${width} x ${height} px (${width * height} total pixels)
 */

#ifndef ${guardName}
#define ${guardName}

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * VCDC FRAME METADATA & CONSTANTS
 * ============================================================================ */

#define ${upperIdent}_WIDTH               ${width}U
#define ${upperIdent}_HEIGHT              ${height}U
#define ${upperIdent}_TOTAL_PIXELS        ${width * height}U
#define ${upperIdent}_COLOR_MODE          ${encodeResult.mode === 'RGB' ? 1 : 2}U /* 1=RGB, 2=Mono */
#define ${upperIdent}_BYTES_PER_PIXEL     ${bytesPerPixel}U
#define ${upperIdent}_FRAMEBUFFER_SIZE    ${buffer.length}U /* bytes */

#define ${upperIdent}_PAYLOAD_BYTES       ${encodeResult.payloadBytes}ULL
#define ${upperIdent}_ENCODED_BYTES       ${encodeResult.totalEncodedBytes}ULL
#define ${upperIdent}_CRC32               ${encodeResult.crcHex}U
#define ${upperIdent}_SHA256              "${encodeResult.sha256Hex}"

#define ${upperIdent}_ECC_PARITY_BYTES    ${encodeResult.eccParityBytes}U
#define ${upperIdent}_ECC_BLOCK_SIZE      ${encodeResult.eccBlockSize}U

/* ============================================================================
 * EMBEDDED FRAMEBUFFER / PAYLOAD DATA BUFFER
 * ============================================================================ */

${qualifierDecl} ${identifier}_pixels[${buffer.length}] = {
${bufferHexContent}
};

/* ============================================================================
 * EMBEDDED FRAME DESCRIPTOR
 * ============================================================================ */

typedef struct {
    const char *name;
    uint16_t width;
    uint16_t height;
    uint8_t mode;             /* 1 = RGB, 2 = Mono */
    uint8_t bytes_per_pixel;  /* 3 = RGB888, 4 = RGBA8888, 1 = Mono */
    size_t payload_bytes;     /* Raw unencoded payload size */
    size_t encoded_bytes;     /* Payload + RS parity bytes */
    size_t buffer_size;       /* Total byte length of pixel buffer */
    uint3232_t crc32;
    const char *sha256;
    const uint8_t *pixels;
} ${identifier}_frame_desc_t;

static const ${identifier}_frame_desc_t ${identifier}_frame = {
    .name = "${identifier}",
    .width = ${upperIdent}_WIDTH,
    .height = ${upperIdent}_HEIGHT,
    .mode = ${upperIdent}_COLOR_MODE,
    .bytes_per_pixel = ${upperIdent}_BYTES_PER_PIXEL,
    .payload_bytes = ${upperIdent}_PAYLOAD_BYTES,
    .encoded_bytes = ${upperIdent}_ENCODED_BYTES,
    .buffer_size = ${upperIdent}_FRAMEBUFFER_SIZE,
    .crc32 = ${upperIdent}_CRC32,
    .sha256 = ${upperIdent}_SHA256,
    .pixels = ${identifier}_pixels
};

#if ${includeHelper ? '1' : '0'}
/* ============================================================================
 * HELPER: Interop with visual_tx.h (HDMI Framebuffer Generator)
 * ============================================================================ */

/**
 * If you are using visual_tx.h, you can pass this embedded grid directly
 * into vcdc_render_framebuffer() or low-level DMA blitters:
 *
 * Example:
 *   #include "visual_tx.h"
 *   #include "${identifier}_vcdc.h"
 *
 *   vcdc_grid_t grid = {
 *       .width = ${upperIdent}_WIDTH,
 *       .height = ${upperIdent}_HEIGHT,
 *       .payload_bytes = ${upperIdent}_PAYLOAD_BYTES,
 *       .encoded_bytes = ${upperIdent}_ENCODED_BYTES,
 *       .crc32 = ${upperIdent}_CRC32,
 *       .rgb_pixels = (uint8_t *)${identifier}_pixels,
 *       .rgb_pixels_capacity = ${upperIdent}_FRAMEBUFFER_SIZE
 *   };
 *
 *   vcdc_color_t bg = { 0x11, 0x11, 0x11, 0xFF };
 *   vcdc_render_framebuffer(&grid, hdmi_fb, 1920, 1080, -1, -1, 10, VCDC_FMT_RGB888, bg);
 */
#endif

#ifdef __cplusplus
}
#endif

#endif /* ${guardName} */
`;

  return {
    code: code.replace('uint3232_t', 'uint32_t'),
    filename: `${identifier}_vcdc.h`,
    bufferSize: buffer.length,
    identifier,
    format,
    qualifierStr: qualifierDecl,
  };
}
