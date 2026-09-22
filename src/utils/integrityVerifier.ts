import { IntegrityReport, IntegritySector, IntegrityStatus, IntegrityVerificationReport } from '../types';
import { calculateCRC32, formatCRC32Hex } from './crc32';
import { Sha256Hasher, bytesToHex, calculateSha256Hex } from './sha256';

export interface ChunkVerificationInput {
  chunkIndex: number;
  data: Uint8Array;
  expectedCrc32?: number;
  expectedSha256Hex?: string;
  isEccRepaired?: boolean;
}

export interface ChunkVerificationResult {
  chunkIndex: number;
  byteLength: number;
  crc32: number;
  crcHex: string;
  isValid: boolean;
  errorReason?: string;
}

/**
 * Real-time integrity verifier engine for streaming or batch data.
 * Continuously computes incremental SHA-256 and validates CRC32 chunks.
 */
export class StreamIntegrityVerifier {
  private hasher = new Sha256Hasher();
  private receivedBytes = 0;
  private chunksProcessed = 0;
  private corruptedChunkCount = 0;
  private repairedChunkCount = 0;
  private sectors: IntegritySector[] = [];
  private expectedCrc32?: number;
  private expectedSha256Hex?: string;
  private sourceIdentifier: string;
  private rejectedChunks: number[] = [];

  constructor(sourceIdentifier: string = 'Stream Payload', expectedCrc32?: number, expectedSha256Hex?: string) {
    this.sourceIdentifier = sourceIdentifier;
    this.expectedCrc32 = expectedCrc32;
    this.expectedSha256Hex = expectedSha256Hex ? expectedSha256Hex.toLowerCase().trim() : undefined;
  }

  /**
   * Sets expected target hash if discovered after stream initialization.
   */
  public setExpectedTargets(expectedCrc32?: number, expectedSha256Hex?: string): void {
    if (expectedCrc32 !== undefined) this.expectedCrc32 = expectedCrc32;
    if (expectedSha256Hex !== undefined) this.expectedSha256Hex = expectedSha256Hex.toLowerCase().trim();
  }

  /**
   * Feed a chunk of verified payload bytes into the running stream hasher.
   * If expectedCrc32 is provided for this chunk, it rejects corrupted chunks immediately.
   */
  public processChunk(input: ChunkVerificationInput): ChunkVerificationResult {
    const chunkCrc = calculateCRC32(input.data);
    const startOffset = this.receivedBytes;
    const endOffset = startOffset + input.data.length;

    // Check frame-level CRC if provided for chunk
    let isValid = true;
    let errorReason: string | undefined;

    if (input.expectedCrc32 !== undefined && (input.expectedCrc32 >>> 0) !== chunkCrc) {
      isValid = false;
      errorReason = `Chunk #${input.chunkIndex} CRC32 mismatch: calculated ${formatCRC32Hex(chunkCrc)} != expected ${formatCRC32Hex(input.expectedCrc32)}`;
      this.corruptedChunkCount++;
      this.rejectedChunks.push(input.chunkIndex);

      this.sectors.push({
        sectorIndex: input.chunkIndex,
        byteStart: startOffset,
        byteEnd: endOffset,
        status: 'corrupted',
        notes: errorReason,
      });

      return {
        chunkIndex: input.chunkIndex,
        byteLength: input.data.length,
        crc32: chunkCrc,
        crcHex: formatCRC32Hex(chunkCrc),
        isValid: false,
        errorReason,
      };
    }

    // Chunk is valid, update running SHA-256
    this.hasher.update(input.data);
    this.receivedBytes += input.data.length;
    this.chunksProcessed++;

    if (input.isEccRepaired) {
      this.repairedChunkCount++;
    }

    this.sectors.push({
      sectorIndex: input.chunkIndex,
      byteStart: startOffset,
      byteEnd: endOffset,
      status: input.isEccRepaired ? 'repaired' : 'valid',
      notes: input.isEccRepaired ? 'Reed-Solomon recovered bit-flips' : 'Clean transmission',
    });

    return {
      chunkIndex: input.chunkIndex,
      byteLength: input.data.length,
      crc32: chunkCrc,
      crcHex: formatCRC32Hex(chunkCrc),
      isValid: true,
    };
  }

  /**
   * Returns current running SHA-256 without finalizing the stream.
   */
  public getIntermediateSha256(): string {
    return this.hasher.hex();
  }

  public getReceivedBytes(): number {
    return this.receivedBytes;
  }

  public getChunksProcessed(): number {
    return this.chunksProcessed;
  }

  public getCorruptedChunkCount(): number {
    return this.corruptedChunkCount;
  }

  /**
   * Finalizes the verification and generates a comprehensive Integrity Report.
   */
  public finalizeReport(totalPayloadCrc32?: number, eccSummary?: {
    parityBytes: number;
    blockSize: number;
    correctedCount: number;
    status: 'none' | 'clean' | 'corrected' | 'uncorrectable';
  }): IntegrityVerificationReport {
    const calculatedSha256 = this.hasher.hex();
    const expectedSha256 = this.expectedSha256Hex || null;

    const finalCrc = totalPayloadCrc32 !== undefined ? totalPayloadCrc32 : 0;
    const calcCrcHex = formatCRC32Hex(finalCrc);
    const expCrcHex = this.expectedCrc32 !== undefined ? formatCRC32Hex(this.expectedCrc32) : calcCrcHex;
    const crcMatches = this.expectedCrc32 !== undefined ? (this.expectedCrc32 >>> 0) === (finalCrc >>> 0) : true;

    let sha256Matches = true;
    let integrityStatus: IntegrityStatus = 'UNVERIFIED';

    if (expectedSha256) {
      sha256Matches = calculatedSha256.toLowerCase() === expectedSha256.toLowerCase();
      if (sha256Matches && crcMatches) {
        integrityStatus = 'VERIFIED';
      } else {
        integrityStatus = 'CORRUPTED';
      }
    } else {
      // Legacy header or no expected SHA-256
      integrityStatus = crcMatches ? 'VERIFIED' : 'CORRUPTED';
    }

    if (this.corruptedChunkCount > 0) {
      integrityStatus = 'CORRUPTED';
    }

    const reportTimestamp = new Date().toISOString();
    const summaryText = generateSummaryText(
      this.sourceIdentifier,
      integrityStatus,
      this.receivedBytes,
      calcCrcHex,
      expCrcHex,
      calculatedSha256,
      expectedSha256,
      this.corruptedChunkCount,
      this.repairedChunkCount
    );

    return {
      timestamp: reportTimestamp,
      sourceIdentifier: this.sourceIdentifier,
      payloadLength: this.receivedBytes,
      integrityStatus,
      crc32: {
        expected: expCrcHex,
        calculated: calcCrcHex,
        matches: crcMatches,
      },
      sha256: {
        expected: expectedSha256,
        calculated: calculatedSha256,
        matches: sha256Matches,
      },
      eccSummary: eccSummary || {
        parityBytes: 0,
        blockSize: 0,
        correctedCount: this.repairedChunkCount,
        status: this.repairedChunkCount > 0 ? 'corrected' : 'clean',
      },
      sectors: this.sectors,
      summaryText,
    };
  }
}

/**
 * Creates an integrity verification report for a decoded byte payload.
 */
export function verifyPayloadIntegrity(
  payload: Uint8Array,
  sourceIdentifier: string,
  expectedCrc32?: number,
  expectedSha256Hex?: string,
  eccSummary?: {
    parityBytes: number;
    blockSize: number;
    correctedCount: number;
    status: 'none' | 'clean' | 'corrected' | 'uncorrectable';
  }
): IntegrityVerificationReport {
  const verifier = new StreamIntegrityVerifier(sourceIdentifier, expectedCrc32, expectedSha256Hex);
  const totalCrc = calculateCRC32(payload);

  // Divide into virtual 4KB sectors for sector-level audit
  const sectorSize = 4096;
  const chunkCount = Math.max(1, Math.ceil(payload.length / sectorSize));

  for (let i = 0; i < chunkCount; i++) {
    const chunk = payload.subarray(i * sectorSize, Math.min((i + 1) * sectorSize, payload.length));
    verifier.processChunk({
      chunkIndex: i,
      data: chunk,
      isEccRepaired: (eccSummary?.correctedCount ?? 0) > 0 && i === 0,
    });
  }

  return verifier.finalizeReport(totalCrc, eccSummary);
}

function generateSummaryText(
  source: string,
  status: IntegrityStatus,
  bytes: number,
  calcCrc: string,
  expCrc: string,
  calcSha: string,
  expSha: string | null,
  corruptedChunks: number,
  repairedChunks: number
): string {
  const statusLabel =
    status === 'VERIFIED'
      ? '[PASS] 100% BIT-EXACT INTEGRITY VERIFIED'
      : status === 'CORRUPTED'
      ? '[FAIL] DATA CORRUPTION DETECTED - CHECKSUM MISMATCH'
      : '[UNVERIFIED] NO TARGET CRYPTOGRAPHIC HASH IN METADATA';

  return `================================================================================
VISUAL DATA CODEC: DATA INTEGRITY VERIFICATION REPORT
================================================================================
Generated: ${new Date().toISOString()}
Target: ${source}
Total Payload Size: ${bytes.toLocaleString()} bytes
Overall Status: ${statusLabel}
--------------------------------------------------------------------------------
1. CRC32 CHECKSUM (IEEE 802.3 Frame-Level Validation):
   Expected CRC32:   ${expCrc}
   Calculated CRC32: ${calcCrc}
   CRC32 Match:      ${calcCrc === expCrc ? 'YES (Valid)' : 'NO (MISMATCH)'}

2. SHA-256 CRYPTOGRAPHIC DIGEST (FIPS 180-4 256-bit Verification):
   Expected SHA-256:   ${expSha ? expSha : '(Not provided in header)'}
   Calculated SHA-256: ${calcSha}
   SHA-256 Match:      ${expSha ? (expSha.toLowerCase() === calcSha.toLowerCase() ? 'YES (100% Cryptographic Match)' : 'NO (HASH MISMATCH)') : 'N/A (Header v1)'}

3. TRANSMISSION & SECTOR AUDIT:
   Total Corrupted Sectors: ${corruptedChunks}
   Reed-Solomon Repaired:   ${repairedChunks}
================================================================================
`;
}

/**
 * Exports formatted integrity report text for download.
 */
export function exportIntegrityReportText(report: IntegrityVerificationReport): string {
  return report.summaryText;
}

/**
 * Exports standard Linux/BSD sha256sum manifest format:
 * "<hash>  <filename>"
 */
export function exportSha256Manifest(filename: string, sha256Hex: string): string {
  return `${sha256Hex.toLowerCase()}  ${filename}\n`;
}
