export type CodecMode = 'RGB' | 'L'; // RGB (3 bytes/px) or L (monochrome 1 byte/px)

export interface CodecHeader {
  magic: string;            // Should be 'VCDC'
  modeId: number;           // 1 for RGB, 2 for Monochrome (L)
  mode: CodecMode;
  eccParityBytes: number;   // Parity bytes per RS block (e.g., 16 or 32; 0 = no ECC)
  eccBlockSize: number;     // RS block size N (e.g., 255; 0 = no ECC)
  payloadLength: number;    // uint64 byte length of original unencoded payload
  expectedCrc32: number;    // uint32 CRC32 checksum of original unencoded payload
  expectedCrcHex: string;   // e.g. 0xF7D18982
  expectedSha256Hex?: string; // 64-character lowercase hex string if embedded in header
  hasEmbeddedSha256: boolean; // True if header is 56-byte format with SHA-256
  endMarker: string;        // 'END\0'
}

export interface EncodeResult {
  width: number;
  height: number;
  totalPixels: number;
  payloadBytes: number;
  mode: CodecMode;
  crc32: number;
  crcHex: string;
  sha256Hex: string;
  sha256ManifestText: string; // standard <hash>  <filename> format
  canvas: HTMLCanvasElement;
  imageDataUrl: string;
  eccParityBytes: number;
  eccBlockSize: number;
  totalParityBytes: number;
  totalEncodedBytes: number;
  blockCount: number;
}

export type IntegrityStatus = 'VERIFIED' | 'CORRUPTED' | 'UNVERIFIED';

export interface IntegritySector {
  sectorIndex: number;
  byteStart: number;
  byteEnd: number;
  status: 'valid' | 'corrupted' | 'repaired';
  notes?: string;
}

export interface IntegrityVerificationReport {
  timestamp: string;
  sourceIdentifier: string;
  payloadLength: number;
  integrityStatus: IntegrityStatus;
  crc32: {
    expected: string;
    calculated: string;
    matches: boolean;
  };
  sha256: {
    expected: string | null;
    calculated: string;
    matches: boolean;
  };
  eccSummary: {
    parityBytes: number;
    blockSize: number;
    correctedCount: number;
    status: 'none' | 'clean' | 'corrected' | 'uncorrectable';
  };
  sectors: IntegritySector[];
  summaryText: string;
}

export type IntegrityReport = IntegrityVerificationReport;

export interface DecodeResult {
  header: CodecHeader;
  reconstructedBytes: Uint8Array;
  calculatedCrc32: number;
  calculatedCrcHex: string;
  isChecksumValid: boolean;
  calculatedSha256Hex: string;
  expectedSha256Hex?: string;
  isSha256Valid: boolean;
  integrityStatus: IntegrityStatus;
  isUtf8Text: boolean;
  decodedText?: string;
  dimensions: { width: number; height: number };
  upscaleFactor?: number; // e.g. 10 if auto-detected and downsampled from 640x20
  eccCorrectedCount: number;
  eccErrorPositions: number[];
  eccStatus: 'none' | 'clean' | 'corrected' | 'uncorrectable';
  eccErrorMessage?: string;
  integrityReport?: IntegrityVerificationReport;
}

export interface PixelInspection {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  isHeaderRow: boolean;
  headerField?: string;
  payloadByteIndex?: number;
}
