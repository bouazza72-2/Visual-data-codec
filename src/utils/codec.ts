import { CodecHeader, CodecMode, DecodeResult, EncodeResult, PixelInspection } from '../types';
import { calculateCRC32, formatCRC32Hex } from './crc32';
import { encodeReedSolomon, decodeReedSolomon } from './reedSolomon';

export const HEADER_BYTE_SIZE = 24;
export const MAGIC_STRING = 'VCDC';
export const END_MARKER = 'END\0';

/**
 * Creates the 24-byte header buffer matching the Python struct:
 * >4sBBHQI4s (Magic 4s, ModeID 1B, ECC Parity 1B, ECC BlockSize 2B, uint64 len, uint32 crc, 4-byte end)
 */
export function createHeaderBytes(
  payloadLength: number,
  crc32: number,
  mode: CodecMode,
  eccParityBytes: number = 16,
  eccBlockSize: number = 255
): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_BYTE_SIZE);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 1. Magic bytes b'VCDC'
  bytes[0] = 0x56; // 'V'
  bytes[1] = 0x43; // 'C'
  bytes[2] = 0x44; // 'D'
  bytes[3] = 0x43; // 'C'

  // 2. Mode ID: 1 = RGB, 2 = Monochrome (L)
  bytes[4] = mode === 'RGB' ? 1 : 2;

  // 3. ECC Metadata (formerly 3-byte reserved pad)
  // Byte 5: Parity symbols per block (e.g. 16 or 32; 0 = no ECC)
  bytes[5] = eccParityBytes & 0xff;
  // Bytes 6..7: Reed-Solomon Block Size N (uint16 big-endian, e.g. 255; 0 = no ECC)
  view.setUint16(6, eccBlockSize, false);

  // 4. Payload Length: 64-bit unsigned big-endian (unencoded payload length)
  view.setBigUint64(8, BigInt(payloadLength), false);

  // 5. CRC32 Checksum: 32-bit unsigned big-endian (checksum of original payload)
  view.setUint32(16, crc32 >>> 0, false);

  // 6. End Marker b'END\0'
  bytes[20] = 0x45; // 'E'
  bytes[21] = 0x4E; // 'N'
  bytes[22] = 0x44; // 'D'
  bytes[23] = 0x00; // '\0'

  return bytes;
}

/**
 * Parses a 24-byte header buffer.
 */
export function parseHeaderBytes(headerBytes: Uint8Array): CodecHeader {
  if (headerBytes.length < HEADER_BYTE_SIZE) {
    throw new Error(`Invalid header size (${headerBytes.length} bytes). Minimum required is ${HEADER_BYTE_SIZE} bytes.`);
  }

  const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, HEADER_BYTE_SIZE);

  // Magic
  const magic = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (magic !== MAGIC_STRING) {
    throw new Error(`Invalid magic header "${magic}". Expected "${MAGIC_STRING}". This file is not a valid Visual Codec image.`);
  }

  // Mode ID
  const modeId = headerBytes[4];
  let mode: CodecMode;
  if (modeId === 1) {
    mode = 'RGB';
  } else if (modeId === 2) {
    mode = 'L';
  } else {
    throw new Error(`Unsupported mode ID (${modeId}) in image header.`);
  }

  // ECC Parity Bytes & Block Size
  const eccParityBytes = headerBytes[5];
  const eccBlockSize = view.getUint16(6, false);

  // Length & CRC
  const payloadLengthBig = view.getBigUint64(8, false);
  const payloadLength = Number(payloadLengthBig);
  const expectedCrc32 = view.getUint32(16, false) >>> 0;

  // End marker
  const endMarker = String.fromCharCode(headerBytes[20], headerBytes[21], headerBytes[22], headerBytes[23]);
  if (endMarker !== END_MARKER) {
    throw new Error('Header end marker mismatch. The image header may be corrupted.');
  }

  return {
    magic,
    modeId,
    mode,
    eccParityBytes,
    eccBlockSize,
    payloadLength,
    expectedCrc32,
    expectedCrcHex: formatCRC32Hex(expectedCrc32),
    endMarker,
  };
}

/**
 * Encodes arbitrary binary data into an HTMLCanvasElement with Row-0 metadata header,
 * applying Reed-Solomon Forward Error Correction (FEC) parity bytes.
 */
export function encodeBytesToCanvas(
  data: Uint8Array,
  mode: CodecMode = 'RGB',
  minWidth: number = 64,
  eccParityBytes: number = 16,
  eccBlockSize: number = 255
): EncodeResult {
  const payloadLen = data.length;
  const crc = calculateCRC32(data);

  // 1. Generate Reed-Solomon ECC parity bytes and append to payload
  const { encoded, totalParityBytes, blockCount } = encodeReedSolomon(
    data,
    eccParityBytes,
    eccBlockSize
  );
  const totalEncodedBytes = encoded.length;

  // 2. Build Row-0 Header containing metadata + ECC parameters
  const headerBytes = createHeaderBytes(payloadLen, crc, mode, eccParityBytes, eccBlockSize);

  // 3. Calculate grid dimensions dynamically to fit data + ECC parity bytes
  const bytesPerPixel = mode === 'RGB' ? 3 : 1;
  const dataPixelsNeeded = totalEncodedBytes > 0 ? Math.ceil(totalEncodedBytes / bytesPerPixel) : 1;
  const headerPixelsNeeded = Math.ceil(HEADER_BYTE_SIZE / bytesPerPixel);
  const minRequiredWidth = Math.max(minWidth, headerPixelsNeeded);

  let calculatedWidth = Math.ceil(Math.sqrt(dataPixelsNeeded));
  let width = Math.max(minRequiredWidth, calculatedWidth);

  // Align width to multiple of 4
  if (width % 4 !== 0) {
    width += 4 - (width % 4);
  }

  const dataRowsNeeded = dataPixelsNeeded > 0 ? Math.ceil(dataPixelsNeeded / width) : 1;
  const height = 1 + dataRowsNeeded; // Row 0 is header row

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D canvas context');

  const imgData = ctx.createImageData(width, height);
  const pixels = imgData.data;

  // Initialize all pixels to opaque black
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 3] = 255;
  }

  if (mode === 'RGB') {
    // 1. Write Header to Row 0
    let hByteIdx = 0;
    for (let x = 0; x < width && hByteIdx < HEADER_BYTE_SIZE; x++) {
      const pIdx = (0 * width + x) * 4;
      pixels[pIdx] = headerBytes[hByteIdx] ?? 0;
      pixels[pIdx + 1] = headerBytes[hByteIdx + 1] ?? 0;
      pixels[pIdx + 2] = headerBytes[hByteIdx + 2] ?? 0;
      pixels[pIdx + 3] = 255;
      hByteIdx += 3;
    }

    // 2. Write Data Payload + ECC Parity starting from Row 1
    let dataByteIdx = 0;
    for (let y = 1; y < height && dataByteIdx < totalEncodedBytes; y++) {
      for (let x = 0; x < width && dataByteIdx < totalEncodedBytes; x++) {
        const pIdx = (y * width + x) * 4;
        pixels[pIdx] = dataByteIdx < totalEncodedBytes ? encoded[dataByteIdx++] : 0;
        pixels[pIdx + 1] = dataByteIdx < totalEncodedBytes ? encoded[dataByteIdx++] : 0;
        pixels[pIdx + 2] = dataByteIdx < totalEncodedBytes ? encoded[dataByteIdx++] : 0;
        pixels[pIdx + 3] = 255;
      }
    }
  } else {
    // Monochrome ('L') mode: 1 byte per pixel
    // 1. Write Header to Row 0
    for (let x = 0; x < width && x < HEADER_BYTE_SIZE; x++) {
      const pIdx = (0 * width + x) * 4;
      const val = headerBytes[x];
      pixels[pIdx] = val;
      pixels[pIdx + 1] = val;
      pixels[pIdx + 2] = val;
      pixels[pIdx + 3] = 255;
    }

    // 2. Write Data Payload + ECC Parity starting from Row 1
    let dataByteIdx = 0;
    for (let y = 1; y < height && dataByteIdx < totalEncodedBytes; y++) {
      for (let x = 0; x < width && dataByteIdx < totalEncodedBytes; x++) {
        const pIdx = (y * width + x) * 4;
        const val = encoded[dataByteIdx++];
        pixels[pIdx] = val;
        pixels[pIdx + 1] = val;
        pixels[pIdx + 2] = val;
        pixels[pIdx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  return {
    width,
    height,
    totalPixels: width * height,
    payloadBytes: payloadLen,
    mode,
    crc32: crc,
    crcHex: formatCRC32Hex(crc),
    canvas,
    imageDataUrl: canvas.toDataURL('image/png'),
    eccParityBytes,
    eccBlockSize,
    totalParityBytes,
    totalEncodedBytes,
    blockCount,
  };
}

/**
 * Decodes an HTMLCanvasElement image back into raw bytes and metadata.
 * Automatically detects if the image is 1x or has been upscaled by an integer factor
 * (e.g. 10x scale from 64x2 to 640x20) using Nearest Neighbor block center-sampling.
 *
 * Runs Reed-Solomon error correction to repair bit flips or byte corruptions caused
 * by color shifts before validating CRC32.
 */
export function decodeCanvasToBytes(canvas: HTMLCanvasElement): DecodeResult {
  const width = canvas.width;
  const height = canvas.height;

  if (height < 1 || width < 1) {
    throw new Error('Canvas dimensions are 0. Cannot decode image.');
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D canvas context for decoding');

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;

  // List of candidate scale factors to test: 1 (native), then 10, 8, 4, 2, 5, 16, 20
  const candidateScales = [1, 10, 8, 4, 2, 5, 16, 20].filter(
    (s) => width % s === 0 && height % s === 0
  );

  let lastError = 'Unable to detect valid Visual Codec header in Row 0. Ensure this PNG was created with Visual Codec.';

  for (const scale of candidateScales) {
    const origW = width / scale;
    const origH = height / scale;
    const offset = Math.floor(scale / 2);

    // Sample Row 0 with center offset
    const rgbRow0 = new Uint8Array(origW * 3);
    const monoRow0 = new Uint8Array(origW);

    for (let x = 0; x < origW; x++) {
      const srcX = x * scale + offset;
      const srcY = 0 * scale + offset;
      const pIdx = (srcY * width + srcX) * 4;

      rgbRow0[x * 3] = pixels[pIdx];
      rgbRow0[x * 3 + 1] = pixels[pIdx + 1];
      rgbRow0[x * 3 + 2] = pixels[pIdx + 2];
      monoRow0[x] = pixels[pIdx];
    }

    let header: CodecHeader | null = null;
    let detectedMode: CodecMode = 'RGB';

    // Test RGB header
    try {
      const testHeader = parseHeaderBytes(rgbRow0.slice(0, HEADER_BYTE_SIZE));
      if (testHeader.mode === 'RGB') {
        header = testHeader;
        detectedMode = 'RGB';
      }
    } catch (e: unknown) {
      if (e instanceof Error) lastError = e.message;
    }

    // Test Monochrome header if not RGB
    if (!header) {
      try {
        const testHeader = parseHeaderBytes(monoRow0.slice(0, HEADER_BYTE_SIZE));
        if (testHeader.mode === 'L') {
          header = testHeader;
          detectedMode = 'L';
        }
      } catch (e: unknown) {
        if (e instanceof Error) lastError = e.message;
      }
    }

    if (header) {
      // Valid header detected at scale!
      const payloadLen = header.payloadLength;
      const eccParityBytes = header.eccParityBytes ?? 0;
      const eccBlockSize = header.eccBlockSize || 255;

      let totalBytesToExtract = payloadLen;
      if (eccParityBytes > 0) {
        const k = eccBlockSize - eccParityBytes;
        const blockCount = payloadLen > 0 ? Math.ceil(payloadLen / k) : 1;
        totalBytesToExtract = payloadLen + blockCount * eccParityBytes;
      }

      const extractedBytes = new Uint8Array(totalBytesToExtract);
      let outIdx = 0;

      if (detectedMode === 'RGB') {
        for (let y = 1; y < origH && outIdx < totalBytesToExtract; y++) {
          for (let x = 0; x < origW && outIdx < totalBytesToExtract; x++) {
            const srcX = x * scale + offset;
            const srcY = y * scale + offset;
            const pIdx = (srcY * width + srcX) * 4;

            if (outIdx < totalBytesToExtract) extractedBytes[outIdx++] = pixels[pIdx];
            if (outIdx < totalBytesToExtract) extractedBytes[outIdx++] = pixels[pIdx + 1];
            if (outIdx < totalBytesToExtract) extractedBytes[outIdx++] = pixels[pIdx + 2];
          }
        }
      } else {
        for (let y = 1; y < origH && outIdx < totalBytesToExtract; y++) {
          for (let x = 0; x < origW && outIdx < totalBytesToExtract; x++) {
            const srcX = x * scale + offset;
            const srcY = y * scale + offset;
            const pIdx = (srcY * width + srcX) * 4;
            if (outIdx < totalBytesToExtract) extractedBytes[outIdx++] = pixels[pIdx];
          }
        }
      }

      // Step 3: Run Reed-Solomon Error Correction before CRC32 calculation
      let reconstructedBytes: Uint8Array;
      let eccCorrectedCount = 0;
      let eccErrorPositions: number[] = [];
      let eccStatus: 'none' | 'clean' | 'corrected' | 'uncorrectable' = 'none';
      let eccErrorMessage: string | undefined;

      if (eccParityBytes > 0) {
        try {
          const rsResult = decodeReedSolomon(extractedBytes, payloadLen, eccParityBytes, eccBlockSize);
          reconstructedBytes = rsResult.decoded;
          eccCorrectedCount = rsResult.totalCorrected;
          eccErrorPositions = rsResult.errorPositions;
          eccStatus = rsResult.totalCorrected > 0 ? 'corrected' : 'clean';
        } catch (err: unknown) {
          eccStatus = 'uncorrectable';
          eccErrorMessage = err instanceof Error ? err.message : 'Reed-Solomon decoding failed';
          // Fallback to raw extracted payload portion
          reconstructedBytes = extractedBytes.slice(0, payloadLen);
        }
      } else {
        reconstructedBytes = extractedBytes.slice(0, payloadLen);
        eccStatus = 'none';
      }

      // Step 4: Final CRC32 validation on the error-corrected payload
      const calculatedCrc32 = calculateCRC32(reconstructedBytes);
      const calculatedCrcHex = formatCRC32Hex(calculatedCrc32);
      const isChecksumValid = calculatedCrc32 === header.expectedCrc32;
      const utf8Check = tryDecodeUtf8(reconstructedBytes);

      return {
        header,
        reconstructedBytes,
        calculatedCrc32,
        calculatedCrcHex,
        isChecksumValid,
        isUtf8Text: utf8Check.valid,
        decodedText: utf8Check.text,
        dimensions: { width: origW, height: origH },
        upscaleFactor: scale > 1 ? scale : undefined,
        eccCorrectedCount,
        eccErrorPositions,
        eccStatus,
        eccErrorMessage,
      };
    }
  }

  throw new Error(lastError);
}

/**
 * Decodes an uploaded image File using an offscreen Image object & Canvas.
 */
export async function decodeImageFile(file: File): Promise<DecodeResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas context failure'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        try {
          const result = decodeCanvasToBytes(canvas);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image file as PNG.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Attempts UTF-8 text decoding.
 */
export function tryDecodeUtf8(bytes: Uint8Array): { valid: boolean; text?: string } {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text = decoder.decode(bytes);
    return { valid: true, text };
  } catch {
    return { valid: false };
  }
}

/**
 * Returns detailed inspection info for a hovered/selected pixel on the canvas.
 */
export function getPixelInspection(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  mode: CodecMode
): PixelInspection | null {
  if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const pixel = ctx.getImageData(x, y, 1, 1).data;
  const r = pixel[0];
  const g = pixel[1];
  const b = pixel[2];

  const isHeaderRow = y === 0;
  let headerField: string | undefined;
  let payloadByteIndex: number | undefined;

  if (isHeaderRow) {
    const byteOffset = mode === 'RGB' ? x * 3 : x;
    if (byteOffset < 4) {
      headerField = `Magic Identifier ('VCDC') [byte ${byteOffset}..${byteOffset + (mode === 'RGB' ? 2 : 0)}]`;
    } else if (byteOffset === 4) {
      headerField = 'Color Mode ID (1=RGB, 2=Mono)';
    } else if (byteOffset === 5) {
      headerField = 'ECC Parity Bytes / Block (uint8)';
    } else if (byteOffset >= 6 && byteOffset < 8) {
      headerField = `ECC Block Size N uint16 [byte ${byteOffset}]`;
    } else if (byteOffset >= 8 && byteOffset < 16) {
      headerField = `Payload Length uint64 [byte ${byteOffset}]`;
    } else if (byteOffset >= 16 && byteOffset < 20) {
      headerField = `CRC32 Checksum uint32 [byte ${byteOffset}]`;
    } else if (byteOffset >= 20 && byteOffset < 24) {
      headerField = `End Terminator ('END\\0') [byte ${byteOffset}]`;
    } else {
      headerField = 'Row-0 Zero Padding';
    }
  } else {
    // Row 1 onwards
    const bytesPerPx = mode === 'RGB' ? 3 : 1;
    payloadByteIndex = (y - 1) * canvas.width * bytesPerPx + x * bytesPerPx;
  }

  return {
    x,
    y,
    r,
    g,
    b,
    isHeaderRow,
    headerField,
    payloadByteIndex,
  };
}
