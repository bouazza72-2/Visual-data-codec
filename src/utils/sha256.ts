/**
 * Fast, pure TypeScript implementation of SHA-256 (FIPS 180-4).
 * Works synchronously in any environment (Browser, Node, Web Worker) without external dependencies.
 */

// Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes)
const H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// SHA-256 round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Helper bitwise operators
function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function ch(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z);
}

function maj(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z);
}

function sigma0(x: number): number {
  return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}

function sigma1(x: number): number {
  return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}

function gamma0(x: number): number {
  return rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
}

function gamma1(x: number): number {
  return rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
}

/**
 * Streaming SHA-256 stateful hasher.
 * Allows calculating SHA-256 incrementally as chunks of bytes arrive.
 */
export class Sha256Hasher {
  private h = new Uint32Array(H_INIT);
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);

  public update(chunk: Uint8Array): this {
    let offset = 0;
    this.totalBytes += chunk.length;

    while (offset < chunk.length) {
      const needed = 64 - this.bufferLength;
      const toCopy = Math.min(needed, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + toCopy), this.bufferLength);
      this.bufferLength += toCopy;
      offset += toCopy;

      if (this.bufferLength === 64) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }

    return this;
  }

  private processBlock(block: Uint8Array): void {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    const w = this.w;

    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      w[i] = (gamma1(w[i - 2]) + w[i - 7] + gamma0(w[i - 15]) + w[i - 16]) >>> 0;
    }

    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];

    for (let i = 0; i < 64; i++) {
      const t1 = (h + sigma1(e) + ch(e, f, g) + K[i] + w[i]) >>> 0;
      const t2 = (sigma0(a) + maj(a, b, c)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  /**
   * Finalizes the hash computation and returns raw 32-byte digest Uint8Array.
   */
  public digest(): Uint8Array {
    // Clone state so caller can keep updating or call multiple times
    const clonedHasher = new Sha256Hasher();
    clonedHasher.h.set(this.h);
    clonedHasher.buffer.set(this.buffer);
    clonedHasher.bufferLength = this.bufferLength;
    clonedHasher.totalBytes = this.totalBytes;

    // Pad message according to FIPS 180-4
    const totalBits = BigInt(clonedHasher.totalBytes) * 8n;
    clonedHasher.buffer[clonedHasher.bufferLength++] = 0x80;

    if (clonedHasher.bufferLength > 56) {
      clonedHasher.buffer.fill(0, clonedHasher.bufferLength, 64);
      clonedHasher.processBlock(clonedHasher.buffer);
      clonedHasher.bufferLength = 0;
    }

    clonedHasher.buffer.fill(0, clonedHasher.bufferLength, 56);
    const view = new DataView(clonedHasher.buffer.buffer, clonedHasher.buffer.byteOffset, 64);
    view.setBigUint64(56, totalBits, false);
    clonedHasher.processBlock(clonedHasher.buffer);

    const result = new Uint8Array(32);
    const resView = new DataView(result.buffer);
    for (let i = 0; i < 8; i++) {
      resView.setUint32(i * 4, clonedHasher.h[i], false);
    }
    return result;
  }

  /**
   * Finalizes the hash and returns lowercase 64-character hex string.
   */
  public hex(): string {
    const raw = this.digest();
    let hex = '';
    for (let i = 0; i < 32; i++) {
      hex += raw[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
}

/**
 * Computes SHA-256 for a byte array and returns the raw 32 bytes.
 */
export function calculateSha256Bytes(data: Uint8Array): Uint8Array {
  const hasher = new Sha256Hasher();
  hasher.update(data);
  return hasher.digest();
}

/**
 * Computes SHA-256 for a byte array and returns lowercase 64-character hex string.
 */
export function calculateSha256Hex(data: Uint8Array): string {
  const hasher = new Sha256Hasher();
  hasher.update(data);
  return hasher.hex();
}

/**
 * Formats a 32-byte Uint8Array into a 64-character hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Parses a 64-character hex string into a 32-byte Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim().toLowerCase().replace(/^0x/, '');
  if (cleanHex.length !== 64) {
    throw new Error(`Invalid SHA-256 hex length: ${cleanHex.length} chars (expected 64)`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
