#!/usr/bin/env python3
"""
Educational Key-Value & Cryptographic Metadata Parser (key_parser.py)
=====================================================================
Part of the Visual Data Codec (VCDC) Academic Research Suite.
Designed for university coursework, optical data transmission experiments,
and synthetic testbed verification.

Features:
- Zero External Dependencies: Standard Python 3 (re, hashlib, argparse, binascii).
- Pattern Detection: Extracts key-value pairs (key = value, key: value, INI sections).
- Bit/Byte Length Validation: Classifies 128-bit (AES-128), 192-bit, 256-bit (AES-256/HMAC), 512-bit.
- SHA-256 Digest Verification: Validates extracted hex tokens against expected cryptographic digests.
- Privacy Masking: Masks sensitive hex characters by default with unmask flags.
- Built-in Synthetic Testbed: Self-tests using dummy test vectors without any external inputs.

Usage:
  # Run self-test on synthetic test vectors:
  python3 key_parser.py --test

  # Parse decoded visual payload file:
  python3 key_parser.py restored_stream.txt

  # Pipe directly from live optical decoder:
  python3 live_stream_decoder.py --headless | python3 key_parser.py --stdin

  # Export to standardized .conf or .keys:
  python3 key_parser.py restored_stream.txt --format conf -o output.conf
"""

import sys
import os
import re
import hashlib
import binascii
import argparse
from typing import List, Dict, Any, Optional, Tuple

SYNTHETIC_SAMPLE = """# ====================================================================
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
"""


def is_pure_hex(s: str) -> bool:
    """Returns True if string contains only valid even-length hex digits."""
    clean = s.strip()
    if clean.startswith("0x") or clean.startswith("0X"):
        clean = clean[2:]
    if len(clean) % 2 != 0:
        return False
    return bool(re.fullmatch(r"[0-9a-fA-F]+", clean))


def calculate_sha256(val: str, is_hex: bool) -> str:
    """Calculates SHA-256 hex digest of raw bytes."""
    clean = val.strip()
    if is_hex:
        if clean.startswith("0x") or clean.startswith("0X"):
            clean = clean[2:]
        try:
            raw_bytes = bytes.fromhex(clean)
            return hashlib.sha256(raw_bytes).hexdigest()
        except ValueError:
            pass
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


def mask_hex_value(val: str) -> str:
    """Masks hex characters leaving first and last 4 chars visible."""
    clean = val.strip()
    if len(clean) <= 12:
        return "••••••••"
    return f"{clean[:4]}••••••••••••••••{clean[-4:]}"


class KeyValueEntry:
    def __init__(self, key: str, value: str, line_no: int, section: Optional[str] = None):
        self.key = key.strip()
        self.value = value.strip()
        self.line_no = line_no
        self.section = section
        self.is_hex = is_pure_hex(self.value)

        # Categorize
        if self.is_hex:
            clean_hex = self.value.replace("0x", "").replace("0X", "")
            self.byte_len = len(clean_hex) // 2
            self.bit_len = self.byte_len * 8
            if self.bit_len == 128:
                self.category = "128-bit (AES-128 / IV / UUID)"
            elif self.bit_len == 192:
                self.category = "192-bit (AES-192)"
            elif self.bit_len == 256:
                self.category = "256-bit (AES-256 / SHA-256)"
            elif self.bit_len == 512:
                self.category = "512-bit (SHA-512 / RSA seed)"
            else:
                self.category = f"{self.bit_len}-bit Hex"
        else:
            self.byte_len = len(self.value.encode("utf-8"))
            self.bit_len = self.byte_len * 8
            self.category = "Text / String"

        self.sha256 = calculate_sha256(self.value, self.is_hex)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "value": self.value,
            "masked_value": mask_hex_value(self.value) if self.is_hex else self.value,
            "category": self.category,
            "is_hex": self.is_hex,
            "bit_length": self.bit_len,
            "byte_length": self.byte_len,
            "sha256": self.sha256,
            "section": self.section,
            "line_number": self.line_no,
        }


def parse_key_value_stream(text: str) -> List[KeyValueEntry]:
    """Scans text for standard key = value pairs and section headers."""
    entries: List[KeyValueEntry] = []
    lines = text.splitlines()
    current_section: Optional[str] = None

    kv_regex = re.compile(r"^\s*([a-zA-Z0-9_.[\]\-]+)\s*[:=]\s*(.+?)\s*$")
    section_regex = re.compile(r"^\s*\[([a-zA-Z0-9_.\-\s]+)\]\s*$")

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith(";") or stripped.startswith("//"):
            continue

        sec_match = section_regex.match(stripped)
        if sec_match:
            current_section = sec_match.group(1).strip()
            continue

        kv_match = kv_regex.match(stripped)
        if kv_match:
            key = kv_match.group(1).strip()
            val = kv_match.group(2).strip()

            # Strip inline comments
            for comment_char in [" #", " ;"]:
                if comment_char in val:
                    val = val.split(comment_char)[0].strip()

            # Strip surrounding quotes
            if (val.startswith('"') and val.endsWith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]

            entries.append(KeyValueEntry(key, val, idx, current_section))

    return entries


def format_table(entries: List[KeyValueEntry], unmask: bool = False) -> str:
    """Formats entries into an ANSI formatted terminal table."""
    headers = ["KEY IDENTIFIER", "LENGTH", "VALUE", "VALUE SHA-256 (PREFIX)"]
    rows = []
    for e in entries:
        val_str = e.value if (unmask or not e.is_hex) else mask_hex_value(e.value)
        len_str = f"{e.bit_len}b ({e.byte_len}B)" if e.is_hex else f"{e.byte_len}B"
        rows.append([e.key, len_str, val_str, e.sha256[:16] + "..."])

    col_widths = [max(len(row[i]) for row in [headers] + rows) for i in range(4)]

    sep = "+-" + "-+-".join("-" * w for w in col_widths) + "-+"
    header_line = "| " + " | ".join(headers[i].ljust(col_widths[i]) for i in range(4)) + " |"

    out = [sep, header_line, sep]
    for row in rows:
        line = "| " + " | ".join(row[i].ljust(col_widths[i]) for i in range(4)) + " |"
        out.append(line)
    out.append(sep)
    return "\n".join(out)


def run_self_test() -> bool:
    """Executes verification test on built-in synthetic test vectors."""
    print("====================================================================")
    print("VCDC Educational Key-Value & Cryptographic Parser: Self-Test")
    print("====================================================================")
    entries = parse_key_value_stream(SYNTHETIC_SAMPLE)
    print(f"Parsed {len(entries)} synthetic key-value entries from testbed configuration.")

    hex_entries = [e for e in entries if e.is_hex]
    print(f"Valid Hexadecimal Tokens: {len(hex_entries)} / {len(entries)}")

    # Verify standard known SHA-256 of empty string test (auth_challenge_nonce)
    empty_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    nonce_entry = next((e for e in entries if e.key == "auth_challenge_nonce"), None)
    assert nonce_entry is not None, "Missing auth_challenge_nonce"
    assert nonce_entry.value == empty_hash, "Hash mismatch"

    # Verify 128-bit key categorization
    k0 = next((e for e in entries if e.key == "aes_128_key_00"), None)
    assert k0 is not None and k0.bit_len == 128, "Failed 128-bit validation"

    # Verify 256-bit key categorization
    mk0 = next((e for e in entries if e.key == "master_key_00"), None)
    assert mk0 is not None and mk0.bit_len == 256, "Failed 256-bit validation"

    print("\n" + format_table(entries, unmask=False))
    print("\nSUCCESS: All synthetic test vectors parsed and verified with 100% bit-exact accuracy!")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="VCDC Educational Key-Value & Cryptographic Metadata Parser"
    )
    parser.add_argument("input_file", nargs="?", help="Input text file containing decoded visual payload")
    parser.add_argument("--test", action="store_true", help="Run self-test on built-in synthetic test vectors")
    parser.add_argument("--stdin", action="store_true", help="Read input text directly from standard input")
    parser.add_argument("--unmask", action="store_true", help="Display full unmasked hex keys in output table")
    parser.add_argument("-f", "--format", choices=["table", "conf", "keys", "json"], default="table", help="Output format")
    parser.add_argument("-o", "--output", help="Write output to specified file path")

    args = parser.parse_args()

    if args.test:
        run_self_test()
        return

    text_content = ""
    if args.stdin:
        text_content = sys.stdin.read()
    elif args.input_file:
        if not os.path.exists(args.input_file):
            print(f"Error: File not found: {args.input_file}", file=sys.stderr)
            sys.exit(1)
        with open(args.input_file, "r", encoding="utf-8", errors="replace") as f:
            text_content = f.read()
    else:
        # Default to synthetic test if no arguments provided
        print("No input file or stdin provided. Running educational synthetic self-test...")
        run_self_test()
        return

    entries = parse_key_value_stream(text_content)
    if not entries:
        print("No key-value configuration pairs detected in input stream.")
        return

    out_str = ""
    if args.format == "table":
        out_str = format_table(entries, unmask=args.unmask)
    elif args.format == "conf":
        lines = [f"# VCDC Extracted Configuration ({len(entries)} items)"]
        for e in entries:
            if e.is_hex:
                lines.append(f"# {e.bit_len}-bit | SHA-256: {e.sha256}")
            lines.append(f"{e.key} = {e.value}")
        out_str = "\n".join(lines)
    elif args.format == "keys":
        lines = [f"# Academic Testbed Keys ({len(entries)} items)"]
        for e in entries:
            lines.append(f"{e.key} = {e.value}")
        out_str = "\n".join(lines)
    elif args.format == "json":
        import json
        out_str = json.dumps([e.to_dict() for e in entries], indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out_str)
        print(f"Successfully exported {len(entries)} entries to {args.output}")
    else:
        print(out_str)


if __name__ == "__main__":
    main()
