/**
 * Standard IEEE 802.3 CRC32 Implementation
 * Identical to Python's zlib.crc32(data) & 0xFFFFFFFF
 */

// Pre-computed CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calculates standard 32-bit CRC checksum for a byte array.
 * @param bytes - Uint8Array of binary data
 * @returns unsigned 32-bit integer (0x00000000 to 0xFFFFFFFF)
 */
export function calculateCRC32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Formats a CRC32 integer as an 8-character uppercase hex string (e.g. 0xF7D18982).
 */
export function formatCRC32Hex(crc: number): string {
  return '0x' + (crc >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
