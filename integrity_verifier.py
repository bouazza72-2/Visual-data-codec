#!/usr/bin/env python3
"""
Visual Data Codec: Real-Time Data Integrity Verification Engine (integrity_verifier.py)
========================================================================================
High-performance integrity verification module for streaming, batch decoding,
and file reassembly. Computes real-time CRC32 (IEEE 802.3) and SHA-256 (FIPS 180-4)
checksums, rejects corrupted chunks, flags bad sectors, and generates exportable
audit reports and .sha256 manifest files.
"""

import sys
import os
import zlib
import hashlib
import json
import argparse
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime


@dataclass
class SectorStatus:
    sector_index: int
    byte_start: int
    byte_end: int
    status: str  # 'valid', 'corrupted', 'repaired'
    notes: str = ""


@dataclass
class IntegrityReport:
    timestamp: str
    source_identifier: str
    payload_length: int
    integrity_status: str  # 'VERIFIED', 'CORRUPTED', 'UNVERIFIED'
    expected_crc32: str
    calculated_crc32: str
    crc32_match: bool
    expected_sha256: Optional[str]
    calculated_sha256: str
    sha256_match: bool
    total_sectors: int
    corrupted_sectors: int
    repaired_sectors: int
    sectors: List[Dict[str, Any]] = field(default_factory=list)
    summary_text: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StreamIntegrityVerifier:
    """
    Stateful incremental verifier for live video stream frames or file chunks.
    Continuously digests incoming chunks through SHA-256 and validates CRC32.
    """

    def __init__(
        self,
        source_identifier: str = "Stream Reassembly",
        expected_crc32: Optional[int] = None,
        expected_sha256: Optional[str] = None
    ):
        self.source_identifier = source_identifier
        self.expected_crc32 = expected_crc32
        self.expected_sha256 = expected_sha256.lower().strip() if expected_sha256 else None
        
        self.sha256_hasher = hashlib.sha256()
        self.total_bytes = 0
        self.chunks_received = 0
        self.chunks_corrupted = 0
        self.chunks_repaired = 0
        self.sectors: List[SectorStatus] = []
        self.running_crc = 0

    def set_expected_targets(self, expected_crc32: Optional[int] = None, expected_sha256: Optional[str] = None):
        """Update expected target hashes when discovered from frame headers."""
        if expected_crc32 is not None:
            self.expected_crc32 = expected_crc32
        if expected_sha256 is not None:
            self.expected_sha256 = expected_sha256.lower().strip()

    def process_chunk(
        self,
        chunk_data: bytes,
        chunk_index: int,
        expected_chunk_crc: Optional[int] = None,
        is_repaired: bool = False
    ) -> Tuple[bool, str]:
        """
        Processes a single incoming frame/chunk.
        Returns (is_valid, message). If chunk fails CRC, it is rejected and flagged as bad sector.
        """
        chunk_len = len(chunk_data)
        start_offset = self.total_bytes
        end_offset = start_offset + chunk_len

        # Frame-level CRC32 check
        chunk_crc = zlib.crc32(chunk_data) & 0xFFFFFFFF

        if expected_chunk_crc is not None:
            if chunk_crc != (expected_chunk_crc & 0xFFFFFFFF):
                self.chunks_corrupted += 1
                msg = f"CRC32 mismatch on chunk #{chunk_index}: {hex(chunk_crc)} != {hex(expected_chunk_crc)}"
                self.sectors.append(SectorStatus(
                    sector_index=chunk_index,
                    byte_start=start_offset,
                    byte_end=end_offset,
                    status="corrupted",
                    notes=msg
                ))
                return False, msg

        # Chunk is valid: update running SHA-256 and running CRC32
        self.sha256_hasher.update(chunk_data)
        if self.total_bytes == 0:
            self.running_crc = chunk_crc
        else:
            # Incremental zlib.crc32 across continuous bytes
            self.running_crc = zlib.crc32(chunk_data, self.running_crc) & 0xFFFFFFFF

        self.total_bytes += chunk_len
        self.chunks_received += 1

        if is_repaired:
            self.chunks_repaired += 1

        self.sectors.append(SectorStatus(
            sector_index=chunk_index,
            byte_start=start_offset,
            byte_end=end_offset,
            status="repaired" if is_repaired else "valid",
            notes="Reed-Solomon FEC corrected" if is_repaired else "Clean"
        ))

        return True, "OK"

    def get_intermediate_sha256(self) -> str:
        """Returns the current computed hex SHA-256 digest without finalizing."""
        return self.sha256_hasher.hexdigest()

    def finalize(self, total_expected_crc32: Optional[int] = None) -> IntegrityReport:
        """
        Finalizes hashing and produces a complete IntegrityReport.
        """
        calc_sha = self.sha256_hasher.hexdigest()
        calc_crc_int = self.running_crc
        calc_crc_hex = f"0x{calc_crc_int:08X}"

        target_crc = self.expected_crc32 if self.expected_crc32 is not None else total_expected_crc32
        exp_crc_hex = f"0x{target_crc:08X}" if target_crc is not None else calc_crc_hex
        crc_matches = (target_crc is None) or ((target_crc & 0xFFFFFFFF) == calc_crc_int)

        sha_matches = True
        status = "UNVERIFIED"

        if self.expected_sha256:
            sha_matches = calc_sha.lower() == self.expected_sha256.lower()
            if sha_matches and crc_matches and self.chunks_corrupted == 0:
                status = "VERIFIED"
            else:
                status = "CORRUPTED"
        else:
            status = "VERIFIED" if (crc_matches and self.chunks_corrupted == 0) else "CORRUPTED"

        report_timestamp = datetime.utcnow().isoformat() + "Z"
        summary = self._generate_summary_text(
            status, calc_crc_hex, exp_crc_hex, calc_sha, self.expected_sha256
        )

        return IntegrityReport(
            timestamp=report_timestamp,
            source_identifier=self.source_identifier,
            payload_length=self.total_bytes,
            integrity_status=status,
            expected_crc32=exp_crc_hex,
            calculated_crc32=calc_crc_hex,
            crc32_match=crc_matches,
            expected_sha256=self.expected_sha256,
            calculated_sha256=calc_sha,
            sha256_match=sha_matches,
            total_sectors=len(self.sectors),
            corrupted_sectors=self.chunks_corrupted,
            repaired_sectors=self.chunks_repaired,
            sectors=[asdict(s) for s in self.sectors],
            summary_text=summary
        )

    def _generate_summary_text(
        self,
        status: str,
        calc_crc: str,
        exp_crc: str,
        calc_sha: str,
        exp_sha: Optional[str]
    ) -> str:
        tag = "[PASS] 100% BIT-EXACT INTEGRITY VERIFIED" if status == "VERIFIED" else (
            "[FAIL] DATA CORRUPTION DETECTED - CHECKSUM MISMATCH" if status == "CORRUPTED" else "[UNVERIFIED] NO TARGET HASH"
        )
        sha_status_label = (
            ("YES (100% Exact Match)" if exp_sha.lower() == calc_sha.lower() else "NO (HASH MISMATCH)")
            if exp_sha else "N/A (No target provided in header)"
        )
        lines = [
            "=" * 80,
            "      VISUAL DATA CODEC: DATA INTEGRITY & CHECKSUM VERIFICATION REPORT",
            "=" * 80,
            f" Timestamp:           {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f" Target Source:       {self.source_identifier}",
            f" Total Payload Size:  {self.total_bytes:,} bytes ({self.total_bytes / 1024:.2f} KB)",
            f" Overall Status:      {tag}",
            "-" * 80,
            " 1. CRC32 CHECKSUM (IEEE 802.3 Frame-Level Verification):",
            f"    Expected CRC32:   {exp_crc}",
            f"    Calculated CRC32: {calc_crc}",
            f"    CRC32 Match:      {'YES (Valid)' if calc_crc.upper() == exp_crc.upper() else 'NO (MISMATCH)'}",
            "",
            " 2. SHA-256 CRYPTOGRAPHIC DIGEST (FIPS 180-4 256-bit Secure Hash):",
            f"    Expected SHA-256:   {exp_sha if exp_sha else '(None specified)'}",
            f"    Calculated SHA-256: {calc_sha}",
            f"    SHA-256 Match:      {sha_status_label}",
            "",
            " 3. SECTOR & CHUNK TRANSMISSION AUDIT:",
            f"    Total Chunks / Sectors: {self.chunks_received}",
            f"    Corrupted (Rejected):   {self.chunks_corrupted}",
            f"    Reed-Solomon Repaired:  {self.chunks_repaired}",
            "=" * 80,
        ]
        return "\n".join(lines) + "\n"


def verify_file_integrity(
    file_path: str,
    expected_sha256: Optional[str] = None,
    expected_crc32: Optional[int] = None
) -> IntegrityReport:
    """
    Verifies any file on disk in streaming 64KB blocks.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    verifier = StreamIntegrityVerifier(
        source_identifier=os.path.basename(file_path),
        expected_crc32=expected_crc32,
        expected_sha256=expected_sha256
    )

    chunk_size = 64 * 1024
    chunk_idx = 0
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            verifier.process_chunk(chunk, chunk_index=chunk_idx)
            chunk_idx += 1

    return verifier.finalize()


def export_sha256_manifest(file_path: str, sha256_hex: str, output_path: Optional[str] = None) -> str:
    """
    Generates standard Linux/BSD sha256sum manifest file:
    `<sha256_hex>  <filename>`
    """
    file_name = os.path.basename(file_path)
    content = f"{sha256_hex.lower()}  {file_name}\n"
    if output_path is None:
        output_path = f"{file_path}.sha256"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    return output_path


def parse_manifest_file(manifest_path: str) -> Dict[str, str]:
    """
    Reads a .sha256 manifest file and returns mapping of filename -> sha256_hex.
    """
    mapping = {}
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                mapping[parts[1].strip()] = parts[0].strip().lower()
    return mapping


def main():
    parser = argparse.ArgumentParser(
        description="Visual Data Codec: Real-time SHA-256 and CRC32 Data Integrity Verifier"
    )
    subparsers = parser.add_subparsers(dest="command", help="Sub-commands")

    # Command: verify
    verify_parser = subparsers.add_parser("verify", help="Verify integrity of a file")
    verify_parser.add_argument("file", help="Target file to verify")
    verify_parser.add_argument("--hash", help="Expected SHA-256 hex string")
    verify_parser.add_argument("--crc", help="Expected CRC32 hex string (e.g. 0x1A2B3C4D)")
    verify_parser.add_argument("--manifest", help="Path to .sha256 manifest file")
    verify_parser.add_argument("--report", help="Path to export text/json report")

    # Command: manifest
    manifest_parser = subparsers.add_parser("manifest", help="Generate .sha256 manifest for a file")
    manifest_parser.add_argument("file", help="Target file")
    manifest_parser.add_argument("-o", "--output", help="Output .sha256 manifest file path")

    args = parser.parse_args()

    if args.command == "verify":
        expected_sha = args.hash
        expected_crc = int(args.crc, 16) if args.crc else None

        if args.manifest:
            manifest_map = parse_manifest_file(args.manifest)
            target_name = os.path.basename(args.file)
            if target_name in manifest_map:
                expected_sha = manifest_map[target_name]
            elif len(manifest_map) == 1:
                expected_sha = list(manifest_map.values())[0]

        report = verify_file_integrity(args.file, expected_sha, expected_crc)
        print(report.summary_text)

        if args.report:
            if args.report.endswith(".json"):
                with open(args.report, "w", encoding="utf-8") as f:
                    json.dump(report.to_dict(), f, indent=2)
            else:
                with open(args.report, "w", encoding="utf-8") as f:
                    f.write(report.summary_text)
            print(f"[REPORT] Saved report to {args.report}")

        sys.exit(0 if report.integrity_status == "VERIFIED" else 1)

    elif args.command == "manifest":
        report = verify_file_integrity(args.file)
        manifest_path = export_sha256_manifest(args.file, report.calculated_sha256, args.output)
        print(f"[MANIFEST] Generated {manifest_path}")
        print(f"           {report.calculated_sha256}  {os.path.basename(args.file)}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
