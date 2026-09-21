/**
 * Reed-Solomon Forward Error Correction (FEC) over GF(2^8)
 * Compatible with standard NASA CCSDS / QR-Code / Python reedsolo library.
 *
 * Parameters:
 * - Primitive Polynomial: 0x11D (285 = x^8 + x^4 + x^3 + x^2 + 1)
 * - Field: GF(2^8), 8-bit symbols (bytes 0..255)
 * - Generator base: 2 (alpha)
 * - First consecutive root (fcr): 0
 * - Default Block Size (N): 255
 * - Default Parity Symbols (P): 16 (corrects up to P/2 = 8 corrupted bytes per block)
 */

const PRIMITIVE_POLYNOMIAL = 0x11d; // 285

// Precompute Galois Field tables
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

let x = 1;
for (let i = 0; i < 255; i++) {
  gfExp[i] = x;
  gfLog[x] = i;
  x <<= 1;
  if (x >= 256) {
    x ^= PRIMITIVE_POLYNOMIAL;
  }
}
for (let i = 255; i < 512; i++) {
  gfExp[i] = gfExp[i - 255];
}

/** Multiplication in GF(2^8) */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[gfLog[a] + gfLog[b]];
}

/** Division in GF(2^8) */
export function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  if (b === 0) throw new Error('Division by zero in GF(2^8)');
  return gfExp[(gfLog[a] - gfLog[b] + 255) % 255];
}

/** Polynomial addition (bitwise XOR in GF(2^8)) */
export function gfPolyAdd(p: Uint8Array, q: Uint8Array): Uint8Array {
  const len = Math.max(p.length, q.length);
  const r = new Uint8Array(len);
  for (let i = 0; i < p.length; i++) {
    r[i + len - p.length] ^= p[i];
  }
  for (let i = 0; i < q.length; i++) {
    r[i + len - q.length] ^= q[i];
  }
  return r;
}

/** Polynomial multiplication in GF(2^8) */
export function gfPolyMul(p: Uint8Array, q: Uint8Array): Uint8Array {
  const r = new Uint8Array(p.length + q.length - 1);
  for (let j = 0; j < q.length; j++) {
    for (let i = 0; i < p.length; i++) {
      r[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return r;
}

/** Scale polynomial by scalar constant in GF(2^8) */
export function gfPolyScale(p: Uint8Array, s: number): Uint8Array {
  const r = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) {
    r[i] = gfMul(p[i], s);
  }
  return r;
}

/** Evaluate polynomial at x using Horner's method */
export function gfPolyEval(p: Uint8Array, at: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) {
    y = gfMul(y, at) ^ p[i];
  }
  return y;
}

/** Generate generator polynomial for nsym parity symbols with fcr = 0 */
export function rsGeneratorPoly(nsym: number, fcr: number = 0): Uint8Array {
  let g: Uint8Array<any> = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    const root = gfExp[(fcr + i) % 255];
    g = gfPolyMul(g, new Uint8Array([1, root]));
  }
  return g;
}

/**
 * Encode a single block of raw message bytes, generating nsym parity bytes.
 * Uses synthetic polynomial division.
 */
export function rsEncodeBlock(msg: Uint8Array, nsym: number, fcr: number = 0): Uint8Array {
  const gen = rsGeneratorPoly(nsym, fcr);
  const rem = new Uint8Array(nsym);
  for (let i = 0; i < msg.length; i++) {
    const feedback = msg[i] ^ rem[0];
    for (let j = 0; j < nsym - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], feedback);
    }
    rem[nsym - 1] = gfMul(gen[nsym], feedback);
  }
  return rem;
}

/** Calculate syndromes for a received block */
export function rsCalcSyndromes(msg: Uint8Array, nsym: number, fcr: number = 0): Uint8Array {
  const synd = new Uint8Array(nsym + 1);
  for (let i = 0; i < nsym; i++) {
    synd[i + 1] = gfPolyEval(msg, gfExp[(fcr + i) % 255]);
  }
  return synd;
}

/** Berlekamp-Massey algorithm to find the error locator polynomial */
export function rsFindErrorLocator(synd: Uint8Array, nsym: number): Uint8Array {
  let errLoc: Uint8Array<any> = new Uint8Array([1]);
  let oldLoc: Uint8Array<any> = new Uint8Array([1]);

  for (let i = 0; i < nsym; i++) {
    const K = i;
    let delta = synd[K + 1];
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[K + 1 - j]);
    }
    oldLoc = new Uint8Array([...oldLoc, 0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = gfPolyScale(oldLoc, delta);
        oldLoc = gfPolyScale(errLoc, gfDiv(1, delta));
        errLoc = newLoc;
      }
      errLoc = gfPolyAdd(errLoc, gfPolyScale(oldLoc, delta));
    }
  }

  // Drop leading zeros
  let start = 0;
  while (start < errLoc.length - 1 && errLoc[start] === 0) start++;
  return errLoc.slice(start);
}

/** Chien search to find the positions of errors */
export function rsFindErrors(errLoc: Uint8Array, n: number): number[] {
  const errs = errLoc.length - 1;
  const errPos: number[] = [];
  for (let i = 0; i < n; i++) {
    if (gfPolyEval(errLoc, gfExp[i % 255]) === 0) {
      errPos.push(n - 1 - i);
    }
  }
  if (errPos.length !== errs) {
    throw new Error(`Too many errors to correct (detected ${errPos.length}, locator degree ${errs})`);
  }
  return errPos;
}

/** Compute errata locator from error positions */
export function rsFindErrataLocator(coefPos: number[]): Uint8Array {
  let eLoc: Uint8Array<any> = new Uint8Array([1]);
  for (const pos of coefPos) {
    const root = gfExp[pos % 255];
    eLoc = gfPolyMul(eLoc, gfPolyAdd(new Uint8Array([1]), new Uint8Array([root, 0])));
  }
  return eLoc;
}

/**
 * Forney algorithm to compute error magnitudes and correct corrupted bytes.
 */
export function rsCorrectErrata(
  msgIn: Uint8Array,
  synd: Uint8Array,
  errPos: number[],
  fcr: number = 0
): Uint8Array {
  const coefPos = errPos.map((p) => msgIn.length - 1 - p);
  const errLoc = rsFindErrataLocator(coefPos);

  const syndRev = new Uint8Array(synd.length);
  for (let i = 0; i < synd.length; i++) {
    syndRev[i] = synd[synd.length - 1 - i];
  }
  const fullMul = gfPolyMul(syndRev, errLoc);
  const remainderLen = errLoc.length;
  const errEvalRev = fullMul.slice(fullMul.length - remainderLen);

  const X = coefPos.map((p) => gfExp[p % 255]);
  const msg = new Uint8Array(msgIn);

  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = gfDiv(1, Xi);
    let errLocPrime = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) {
        errLocPrime = gfMul(errLocPrime, 1 ^ gfMul(XiInv, X[j]));
      }
    }
    if (errLocPrime === 0) {
      throw new Error('Forney algorithm denominator evaluates to 0.');
    }
    const y = gfPolyEval(errEvalRev, XiInv);
    const yAdj = gfMul(Xi, y);
    const magnitude = gfDiv(yAdj, errLocPrime);
    msg[errPos[i]] ^= magnitude;
  }
  return msg;
}

/**
 * Decodes a single block of received codeword (data + nsym parity bytes).
 * Automatically detects errors, calculates error locations, and repairs corrupted bytes.
 */
export function rsCorrectBlock(
  msgIn: Uint8Array,
  nsym: number,
  fcr: number = 0
): { corrected: Uint8Array; errCount: number; errPositions: number[] } {
  if (msgIn.length <= nsym) {
    throw new Error(`Codeword length (${msgIn.length}) must be strictly greater than parity size (${nsym})`);
  }

  const synd = rsCalcSyndromes(msgIn, nsym, fcr);
  let hasError = false;
  for (let i = 1; i <= nsym; i++) {
    if (synd[i] !== 0) {
      hasError = true;
      break;
    }
  }

  // Clean block with 0 errors
  if (!hasError) {
    return {
      corrected: msgIn.slice(0, msgIn.length - nsym),
      errCount: 0,
      errPositions: [],
    };
  }

  // Errors detected! Run Berlekamp-Massey to find error locator polynomial
  const errLoc = rsFindErrorLocator(synd, nsym);
  const errLocRev = new Uint8Array(errLoc.length);
  for (let i = 0; i < errLoc.length; i++) {
    errLocRev[i] = errLoc[errLoc.length - 1 - i];
  }

  // Run Chien search to find error positions
  const errPos = rsFindErrors(errLocRev, msgIn.length);

  // Run Forney algorithm to calculate magnitudes and correct errors
  const correctedFull = rsCorrectErrata(msgIn, synd, errPos, fcr);

  // Verify that syndromes of repaired codeword are now completely zero
  const checkSynd = rsCalcSyndromes(correctedFull, nsym, fcr);
  for (let i = 1; i <= nsym; i++) {
    if (checkSynd[i] !== 0) {
      throw new Error('Reed-Solomon correction failed: residual uncorrectable errors present in block.');
    }
  }

  return {
    corrected: correctedFull.slice(0, correctedFull.length - nsym),
    errCount: errPos.length,
    errPositions: errPos,
  };
}

/**
 * Encodes an arbitrary byte payload using Reed-Solomon with block chunking.
 *
 * For payloads exceeding K = (nsize - nsym), the data is divided into blocks of max K bytes,
 * and nsym parity bytes are generated for each block.
 * Codeword = [block_0_data, block_0_parity, block_1_data, block_1_parity, ...]
 */
export function encodeReedSolomon(
  payload: Uint8Array,
  nsym: number = 16,
  nsize: number = 255
): {
  encoded: Uint8Array;
  totalParityBytes: number;
  blockCount: number;
} {
  if (nsym <= 0) {
    return {
      encoded: new Uint8Array(payload),
      totalParityBytes: 0,
      blockCount: 0,
    };
  }

  const k = nsize - nsym; // Data bytes per block
  if (k <= 0) {
    throw new Error(`Invalid RS configuration: nsym (${nsym}) must be less than block size (${nsize})`);
  }

  const payloadLen = payload.length;
  const blockCount = payloadLen > 0 ? Math.ceil(payloadLen / k) : 1;
  const totalParityBytes = blockCount * nsym;
  const totalEncodedBytes = payloadLen + totalParityBytes;

  const encoded = new Uint8Array(totalEncodedBytes);
  let inOffset = 0;
  let outOffset = 0;

  for (let b = 0; b < blockCount; b++) {
    const chunkLen = Math.min(k, payloadLen - inOffset);
    const chunk = payload.subarray(inOffset, inOffset + chunkLen);
    const parity = rsEncodeBlock(chunk, nsym);

    // Copy data chunk
    encoded.set(chunk, outOffset);
    outOffset += chunkLen;

    // Append parity bytes
    encoded.set(parity, outOffset);
    outOffset += nsym;

    inOffset += chunkLen;
  }

  return {
    encoded,
    totalParityBytes,
    blockCount,
  };
}

/**
 * Decodes a Reed-Solomon protected byte stream, detecting and correcting byte corruptions
 * caused by color shifts or transmission distortion.
 */
export function decodeReedSolomon(
  encodedData: Uint8Array,
  originalPayloadLen: number,
  nsym: number = 16,
  nsize: number = 255
): {
  decoded: Uint8Array;
  totalCorrected: number;
  errorPositions: number[];
  isClean: boolean;
} {
  if (nsym <= 0) {
    // ECC disabled or bypassed
    return {
      decoded: encodedData.slice(0, originalPayloadLen),
      totalCorrected: 0,
      errorPositions: [],
      isClean: true,
    };
  }

  const k = nsize - nsym;
  const blockCount = originalPayloadLen > 0 ? Math.ceil(originalPayloadLen / k) : 1;
  const decoded = new Uint8Array(originalPayloadLen);

  let inOffset = 0;
  let outOffset = 0;
  let totalCorrected = 0;
  const allErrPositions: number[] = [];

  for (let b = 0; b < blockCount; b++) {
    const chunkLen = Math.min(k, originalPayloadLen - outOffset);
    const blockSize = chunkLen + nsym;

    if (inOffset + blockSize > encodedData.length) {
      throw new Error(
        `Insufficient encoded data for RS block ${b + 1}/${blockCount}. Expected at least ${inOffset + blockSize} bytes, got ${encodedData.length}.`
      );
    }

    const block = encodedData.subarray(inOffset, inOffset + blockSize);
    const { corrected, errCount, errPositions } = rsCorrectBlock(block, nsym);

    decoded.set(corrected, outOffset);

    if (errCount > 0) {
      totalCorrected += errCount;
      for (const pos of errPositions) {
        allErrPositions.push(inOffset + pos);
      }
    }

    inOffset += blockSize;
    outOffset += chunkLen;
  }

  return {
    decoded,
    totalCorrected,
    errorPositions: allErrPositions,
    isClean: totalCorrected === 0,
  };
}
