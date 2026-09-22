import { calculateSha256Hex } from './sha256';

export type KeyCategory =
  | '128_bit_hex'
  | '192_bit_hex'
  | '256_bit_hex'
  | '512_bit_hex'
  | 'generic_hex'
  | 'text'
  | 'numeric';

export interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
  rawLine: string;
  lineNumber: number;
  category: KeyCategory;
  bitLength?: number;
  byteLength?: number;
  isHex: boolean;
  sha256Hex: string; // SHA-256 of value
  expectedSha256Hex?: string;
  isHashValid?: boolean;
  section?: string;
}

export interface KeyValueParseResult {
  entries: KeyValueEntry[];
  totalLines: number;
  totalKeys: number;
  hexCount: number;
  hex128Count: number;
  hex256Count: number;
  hasEntries: boolean;
  sections: string[];
}

/**
 * Checks if a string is a valid hexadecimal sequence without prefixes.
 */
export function isPureHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
}

/**
 * Converts a hex string into a Uint8Array.
 */
export function parseHexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  const len = Math.floor(clean.length / 2);
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return u8;
}

/**
 * Categorizes a parsed value string.
 */
export function categorizeValue(val: string): {
  category: KeyCategory;
  bitLength?: number;
  byteLength?: number;
  isHex: boolean;
} {
  const cleanVal = val.trim().replace(/^0x/i, '');

  if (isPureHex(cleanVal)) {
    const bytes = cleanVal.length / 2;
    const bits = bytes * 8;

    if (bits === 128) {
      return { category: '128_bit_hex', bitLength: 128, byteLength: 16, isHex: true };
    }
    if (bits === 192) {
      return { category: '192_bit_hex', bitLength: 192, byteLength: 24, isHex: true };
    }
    if (bits === 256) {
      return { category: '256_bit_hex', bitLength: 256, byteLength: 32, isHex: true };
    }
    if (bits === 512) {
      return { category: '512_bit_hex', bitLength: 512, byteLength: 64, isHex: true };
    }
    return { category: 'generic_hex', bitLength: bits, byteLength: bytes, isHex: true };
  }

  if (/^-?\d+(\.\d+)?$/.test(val.trim())) {
    return { category: 'numeric', isHex: false };
  }

  return { category: 'text', isHex: false };
}

/**
 * Scans decoded payload text for standard key-value configuration pairs.
 * Supports syntax:
 *   key = value
 *   key: value
 *   [section_header]
 */
export function parseKeyValueStream(
  rawText: string,
  manifestHashes?: Record<string, string>
): KeyValueParseResult {
  const lines = rawText.split(/\r?\n/);
  const entries: KeyValueEntry[] = [];
  const sections: string[] = [];
  let currentSection: string | undefined = undefined;

  let hexCount = 0;
  let hex128Count = 0;
  let hex256Count = 0;

  // Pattern: key = value or key: value
  // Allows keys with letters, numbers, underscores, dashes, dots, brackets
  const kvRegex = /^\s*([a-zA-Z0-9_.[\]\-]+)\s*[:=]\s*(.+?)\s*$/;
  const sectionRegex = /^\s*\[([a-zA-Z0-9_.\-\s]+)\]\s*$/;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Skip empty lines and full-line comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('//')) {
      return;
    }

    // Check for INI section headers
    const sectionMatch = trimmed.match(sectionRegex);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections.includes(currentSection)) {
        sections.push(currentSection);
      }
      return;
    }

    // Check for key-value pair
    const match = trimmed.match(kvRegex);
    if (match) {
      const rawKey = match[1].trim();
      let rawValue = match[2].trim();

      // Strip trailing comments (e.g. key = value # comment)
      const commentIdx = rawValue.search(/\s+[#;]/);
      if (commentIdx !== -1) {
        rawValue = rawValue.substring(0, commentIdx).trim();
      }

      // Strip surrounding quotes if present
      if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        rawValue = rawValue.slice(1, -1);
      }

      const { category, bitLength, byteLength, isHex } = categorizeValue(rawValue);

      // Compute SHA-256 of the value
      let sha256Hex: string;
      if (isHex) {
        // Hash the actual binary bytes of the hex string
        const bytes = parseHexToBytes(rawValue);
        sha256Hex = calculateSha256Hex(bytes);
      } else {
        const encoder = new TextEncoder();
        sha256Hex = calculateSha256Hex(encoder.encode(rawValue));
      }

      // Check against optional expected manifest hashes
      const expectedHash = manifestHashes
        ? manifestHashes[rawKey] || manifestHashes[rawKey.toLowerCase()]
        : undefined;

      const isHashValid = expectedHash
        ? expectedHash.toLowerCase().trim() === sha256Hex.toLowerCase().trim()
        : undefined;

      if (isHex) {
        hexCount++;
        if (bitLength === 128) hex128Count++;
        if (bitLength === 256) hex256Count++;
      }

      entries.push({
        id: `kv_${index}_${rawKey}`,
        key: rawKey,
        value: rawValue,
        rawLine: line,
        lineNumber: index + 1,
        category,
        bitLength,
        byteLength,
        isHex,
        sha256Hex,
        expectedSha256Hex: expectedHash,
        isHashValid,
        section: currentSection,
      });
    }
  });

  return {
    entries,
    totalLines: lines.length,
    totalKeys: entries.length,
    hexCount,
    hex128Count,
    hex256Count,
    hasEntries: entries.length > 0,
    sections,
  };
}

/**
 * Masks a hex or sensitive string for display: keeps first 4 and last 4 characters.
 */
export function maskValue(val: string): string {
  if (val.length <= 12) {
    return '••••••••';
  }
  const start = val.substring(0, 4);
  const end = val.substring(val.length - 4);
  return `${start}••••••••••••••••${end}`;
}

/**
 * Exports parsed entries to a standard .conf format.
 */
export function exportToConfFile(entries: KeyValueEntry[], title: string = 'VCDC Test Configuration'): string {
  const timestamp = new Date().toISOString();
  let content = `# ====================================================================\n`;
  content += `# ${title}\n`;
  content += `# Generated by Visual Data Codec Educational Parser\n`;
  content += `# Timestamp: ${timestamp}\n`;
  content += `# Total Extracted Key-Value Pairs: ${entries.length}\n`;
  content += `# ====================================================================\n\n`;

  let currentSection: string | undefined = undefined;

  for (const entry of entries) {
    if (entry.section && entry.section !== currentSection) {
      currentSection = entry.section;
      content += `\n[${currentSection}]\n`;
    }

    if (entry.isHex) {
      content += `# Length: ${entry.bitLength}-bit (${entry.byteLength}B) | SHA-256: ${entry.sha256Hex}\n`;
    }
    content += `${entry.key} = ${entry.value}\n`;
  }

  return content;
}

/**
 * Exports parsed entries to a standard .keys format.
 */
export function exportToKeysFile(entries: KeyValueEntry[], title: string = 'Synthetic Testbed Keys'): string {
  const timestamp = new Date().toISOString();
  let content = `# Visual Data Codec - Academic Keys & Cryptographic Test Parameters\n`;
  content += `# Timestamp: ${timestamp}\n`;
  content += `# Purpose: Synthetic Educational Testbed & Optical Verification\n\n`;

  for (const entry of entries) {
    content += `${entry.key} = ${entry.value}\n`;
  }

  return content;
}

/**
 * Generates an educational sample of synthetic test vectors with verifiable SHA-256 digests.
 */
export function generateSyntheticKeySample(): string {
  return `# ====================================================================
# Synthetic Cryptographic Testbed Configuration (Academic Sample)
# Visual Data Codec - Optical Data Transmission Test
# ====================================================================

[system_metadata]
experiment_id = exp_2026_visual_vcdc_01
author = Academic Research Testbed
protocol_version = 2.0

[symmetric_ciphers]
# Standard 128-bit AES Test Vectors (16 bytes / 32 hex chars)
aes_128_key_00 = 2b7e151628aed2a6abf7158809cf4f3c
aes_128_iv_00 = 000102030405060708090a0b0c0d0e0f
aes_128_key_01 = 00112233445566778899aabbccddeeff

# Standard 256-bit AES / HMAC Test Vectors (32 bytes / 64 hex chars)
master_key_00 = 603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4
master_key_01 = f58c4c04d6e5f1ba779eabfb5f7bf462749424bcf969eed3ec59fe781bc17d2f
hmac_sha256_secret = 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20

[session_tokens]
session_token_128 = 4a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d
auth_challenge_nonce = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
`;
}
