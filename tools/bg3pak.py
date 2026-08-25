#!/usr/bin/env python3
"""bg3pak -- build and inspect Baldur's Gate 3 .pak archives (LSPK v18).

Why this exists: BG3 Mod Manager works with .pak files, and the usual way to
make one is LSLib's divine.exe, which needs .NET and Windows. This is a
dependency-light equivalent for the packing half.

The format is implemented from LSLib's own source (Norbyte/lslib,
LSLib/LS/PackageFormat.cs and PackageWriter.cs), not from guesswork:

  file layout
    0x00  "LSPK"                                    4 bytes
    0x04  LSPKHeader16                             36 bytes, Pack=1
            uint32  Version            = 18
            uint64  FileListOffset
            uint32  FileListSize
            uint8   Flags
            uint8   Priority
            uint8   Md5[16]
            uint16  NumParts
    0x28  file data, concatenated
    ...   file list:
            uint32  NumFiles
            uint32  CompressedSize
            LZ4 raw block of NumFiles x FileEntry18

  FileEntry18                                     272 bytes, Pack=1
            uint8   Name[256]      UTF-8, NUL padded, forward slashes
            uint32  OffsetInFile1  low 32 bits of the absolute data offset
            uint16  OffsetInFile2  bits 32..47 of that offset
            uint8   ArchivePart
            uint8   Flags          CompressionFlags
            uint32  SizeOnDisk     bytes actually stored
            uint32  UncompressedSize  0 when the method is None

Two details that are easy to get wrong and are worth stating: the name field is
256 bytes because FileNameBlittable carries [InlineArray(256)] -- the struct
body itself is a single byte and reads as 1 byte if you skip the attribute. And
the LZ4 here is a raw block with no frame header and no stored size; the reader
recovers the length as 272 * NumFiles.

Usage
  bg3pak.py build <source-dir> <out.pak> [--store]
  bg3pak.py list   <pak>
  bg3pak.py verify <pak>            structural check; works on real game paks
  bg3pak.py extract <pak> <dest>
  bg3pak.py selftest                round-trips generated data through both
                                    compression paths
"""

import argparse
import hashlib
import os
import struct
import sys

try:
    import lz4.block as lz4block
except ImportError:
    sys.exit("bg3pak needs the 'lz4' module:  pip install lz4")

SIGNATURE = b"LSPK"
VERSION = 18

HEADER_FORMAT = "<IQIBB16sH"          # LSPKHeader16
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)
ENTRY_FORMAT = "<256sIHBBII"          # FileEntry18
ENTRY_SIZE = struct.calcsize(ENTRY_FORMAT)
DATA_START = len(SIGNATURE) + HEADER_SIZE

# CompressionFlags, from LSLib/LS/Enums/Compression.cs
METHOD_NONE = 0x00
METHOD_LZ4 = 0x02
LEVEL_DEFAULT = 0x20

assert HEADER_SIZE == 36, HEADER_SIZE
assert ENTRY_SIZE == 272, ENTRY_SIZE


class PakError(Exception):
    pass


def _compress(payload, store):
    """Returns (stored_bytes, flags, uncompressed_size)."""
    if store or not payload:
        return payload, METHOD_NONE, 0
    packed = lz4block.compress(payload, store_size=False)
    if len(packed) >= len(payload):
        # Compression made it bigger, which happens on tiny or already-dense
        # files. Storing is both smaller and cheaper to read.
        return payload, METHOD_NONE, 0
    return packed, METHOD_LZ4 | LEVEL_DEFAULT, len(payload)


def _decompress(stored, flags, uncompressed_size):
    method = flags & 0x0F
    if method == METHOD_NONE:
        return stored
    if method == METHOD_LZ4:
        return lz4block.decompress(stored, uncompressed_size=uncompressed_size)
    raise PakError(f"unsupported compression method {method} "
                   "(this tool handles none and lz4)")


def collect(source_dir):
    """Every file under source_dir, as (archive_name, absolute_path) pairs.

    Archive names use forward slashes and are relative to source_dir, which is
    what puts Mods/<Name>/meta.lsx at the path the game and BG3MM look for.
    """
    entries = []
    for root, _dirs, files in os.walk(source_dir):
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, source_dir).replace(os.sep, "/")
            encoded = rel.encode("utf-8")
            if len(encoded) > 255:
                raise PakError(f"path too long for the 256-byte name field: {rel}")
            entries.append((rel, full))
    entries.sort(key=lambda pair: pair[0])
    return entries


def build(source_dir, out_path, store=False, quiet=False):
    if not os.path.isdir(source_dir):
        raise PakError(f"not a directory: {source_dir}")
    entries = collect(source_dir)
    if not entries:
        raise PakError(f"no files found under {source_dir}")

    records = []
    with open(out_path, "wb") as pak:
        # Placeholder; the real header is written once the file list is placed.
        pak.write(SIGNATURE)
        pak.write(b"\0" * HEADER_SIZE)

        for rel, full in entries:
            with open(full, "rb") as handle:
                payload = handle.read()
            stored, flags, uncompressed = _compress(payload, store)
            offset = pak.tell()
            if offset >= (1 << 48):
                raise PakError("archive exceeds the 48-bit offset field")
            pak.write(stored)
            records.append({
                "name": rel,
                "offset": offset,
                "flags": flags,
                "size_on_disk": len(stored),
                "uncompressed": uncompressed,
                "original": len(payload),
            })

        file_list_offset = pak.tell()
        table = b"".join(
            struct.pack(
                ENTRY_FORMAT,
                record["name"].encode("utf-8"),
                record["offset"] & 0xFFFFFFFF,
                (record["offset"] >> 32) & 0xFFFF,
                0,                       # ArchivePart: single-part archive
                record["flags"],
                record["size_on_disk"],
                record["uncompressed"],
            )
            for record in records
        )
        compressed_table = lz4block.compress(table, store_size=False)
        pak.write(struct.pack("<I", len(records)))
        pak.write(struct.pack("<I", len(compressed_table)))
        pak.write(compressed_table)
        file_list_size = pak.tell() - file_list_offset

        pak.seek(len(SIGNATURE))
        pak.write(struct.pack(
            HEADER_FORMAT,
            VERSION,
            file_list_offset,
            file_list_size,
            0,                  # Flags
            0,                  # Priority
            b"\0" * 16,         # Md5: LSLib writes zeros unless hashing is on
            1,                  # NumParts
        ))

    if not quiet:
        raw = sum(r["original"] for r in records)
        print(f"  {len(records)} file(s), {raw:,} bytes -> "
              f"{os.path.getsize(out_path):,} bytes  {out_path}")
    return out_path


def read_index(path):
    """Parses the header and file list. Returns (header_dict, [entry_dict])."""
    with open(path, "rb") as pak:
        blob = pak.read()

    if len(blob) < DATA_START:
        raise PakError("file is too small to be a pak")
    if blob[:4] != SIGNATURE:
        raise PakError(f"bad signature {blob[:4]!r}, expected {SIGNATURE!r}")

    (version, file_list_offset, file_list_size, flags, priority, md5,
     num_parts) = struct.unpack_from(HEADER_FORMAT, blob, 4)

    if version != VERSION:
        raise PakError(f"this tool writes and reads LSPK v18; found v{version}")
    if file_list_offset + 8 > len(blob):
        raise PakError("file list offset points past the end of the archive")

    num_files, compressed_size = struct.unpack_from("<II", blob, file_list_offset)
    start = file_list_offset + 8
    compressed = blob[start:start + compressed_size]
    if len(compressed) != compressed_size:
        raise PakError("file list is truncated")

    table = lz4block.decompress(compressed, uncompressed_size=ENTRY_SIZE * num_files)

    entries = []
    for index in range(num_files):
        (name, off_low, off_high, archive_part, entry_flags, size_on_disk,
         uncompressed) = struct.unpack_from(ENTRY_FORMAT, table, index * ENTRY_SIZE)
        entries.append({
            "name": name.split(b"\0", 1)[0].decode("utf-8"),
            "offset": off_low | (off_high << 32),
            "archive_part": archive_part,
            "flags": entry_flags,
            "size_on_disk": size_on_disk,
            "uncompressed": uncompressed,
        })

    header = {
        "version": version, "file_list_offset": file_list_offset,
        "file_list_size": file_list_size, "flags": flags, "priority": priority,
        "md5": md5.hex(), "num_parts": num_parts, "num_files": num_files,
        "total_size": len(blob),
    }
    return header, entries


def read_file(path, entry):
    with open(path, "rb") as pak:
        pak.seek(entry["offset"])
        stored = pak.read(entry["size_on_disk"])
    if len(stored) != entry["size_on_disk"]:
        raise PakError(f"{entry['name']}: data is truncated")
    return _decompress(stored, entry["flags"], entry["uncompressed"])


def verify(path):
    """Structural check. Deliberately also useful on a real game .pak, which is
    the only ground truth available for whether this tool reads the format
    correctly."""
    header, entries = read_index(path)
    print(f"  {os.path.basename(path)}")
    print(f"    version        {header['version']}")
    print(f"    files          {header['num_files']:,}")
    print(f"    parts          {header['num_parts']}")
    print(f"    file list      offset {header['file_list_offset']:,} "
          f"size {header['file_list_size']:,}")
    print(f"    md5 field      {header['md5']}")

    problems = []
    if header["num_parts"] != 1:
        problems.append(f"multi-part archive ({header['num_parts']} parts); "
                        "this tool only reads part 0")

    methods = {}
    for entry in entries:
        method = entry["flags"] & 0x0F
        methods[method] = methods.get(method, 0) + 1
        end = entry["offset"] + entry["size_on_disk"]
        if entry["archive_part"] != 0:
            continue  # lives in another part file; nothing to check here
        if end > header["total_size"]:
            problems.append(f"{entry['name']}: data runs past end of file")
        if entry["offset"] < DATA_START:
            problems.append(f"{entry['name']}: offset overlaps the header")
        if end > header["file_list_offset"] > entry["offset"]:
            problems.append(f"{entry['name']}: data overlaps the file list")

    names = {0: "stored", 1: "zlib", 2: "lz4", 3: "zstd"}
    summary = ", ".join(f"{count} {names.get(method, method)}"
                        for method, count in sorted(methods.items()))
    print(f"    compression    {summary}")

    # Actually decode a sample rather than trusting the table.
    readable = 0
    sample = entries[:25]
    for entry in sample:
        if entry["archive_part"] != 0:
            continue
        try:
            payload = read_file(path, entry)
            expected = entry["uncompressed"] or entry["size_on_disk"]
            if len(payload) != expected:
                problems.append(f"{entry['name']}: decoded {len(payload)} bytes, "
                                f"table says {expected}")
            else:
                readable += 1
        except Exception as exc:  # noqa: BLE001 - report, do not crash
            problems.append(f"{entry['name']}: {exc}")
    print(f"    decoded ok     {readable}/{len(sample)} sampled")

    if problems:
        print("    PROBLEMS:")
        for problem in problems[:20]:
            print(f"      - {problem}")
        return False
    print("    structure OK")
    return True


def list_files(path):
    header, entries = read_index(path)
    print(f"  {header['num_files']} file(s) in {os.path.basename(path)}")
    for entry in entries:
        method = {0: "stored", 2: "lz4"}.get(entry["flags"] & 0x0F,
                                             str(entry["flags"] & 0x0F))
        size = entry["uncompressed"] or entry["size_on_disk"]
        print(f"    {size:>10,}  {method:<6}  {entry['name']}")


def extract(path, dest):
    _header, entries = read_index(path)
    for entry in entries:
        target = os.path.join(dest, *entry["name"].split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(read_file(path, entry))
    print(f"  extracted {len(entries)} file(s) to {dest}")


def selftest():
    """Round-trips generated content through both compression paths.

    This proves the writer and reader agree with each other. It does NOT prove
    either agrees with Larian -- for that, run `verify` against one of the
    game's own .pak files, which is the only real ground truth.
    """
    import random
    import shutil
    import tempfile

    random.seed(20260823)
    root = tempfile.mkdtemp(prefix="bg3pak-selftest-")
    failures = []
    try:
        source = os.path.join(root, "src")
        cases = {
            "Mods/Test/meta.lsx": b"<?xml version='1.0'?><save/>",
            "Mods/Test/ScriptExtender/Lua/Boot.lua": b"-- lua\nprint('x')\n" * 40,
            "Public/Test/empty.txt": b"",
            "Public/Test/incompressible.bin":
                bytes(random.getrandbits(8) for _ in range(8192)),
            "Public/Test/compressible.bin": b"A" * 200000,
            "Public/Test/deep/a/b/c/d/nested.txt": b"nested\n",
            "Public/Test/unicode-éè.txt": "café\n".encode("utf-8"),
        }
        for name, payload in cases.items():
            target = os.path.join(source, *name.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as handle:
                handle.write(payload)

        for label, store in (("lz4", False), ("stored", True)):
            pak = os.path.join(root, f"test-{label}.pak")
            build(source, pak, store=store, quiet=True)

            header, entries = read_index(pak)
            if header["num_files"] != len(cases):
                failures.append(f"{label}: expected {len(cases)} entries, "
                                f"got {header['num_files']}")

            for entry in entries:
                expected = cases[entry["name"]]
                actual = read_file(pak, entry)
                if actual != expected:
                    failures.append(f"{label}: {entry['name']} did not round-trip")
                if store and (entry["flags"] & 0x0F) != METHOD_NONE:
                    failures.append(f"{label}: {entry['name']} should be stored")

            # Offsets must be inside the data region and never overlap the
            # file list -- the two mistakes that produce a pak which parses but
            # yields corrupt files.
            for entry in entries:
                if entry["offset"] < DATA_START:
                    failures.append(f"{label}: {entry['name']} offset in header")
                if entry["offset"] + entry["size_on_disk"] > header["file_list_offset"]:
                    failures.append(f"{label}: {entry['name']} runs into the file list")

            if not verify_quiet(pak):
                failures.append(f"{label}: structural verify failed")

        # An empty directory must be refused rather than producing a pak with
        # no file list, which crashes readers.
        empty = os.path.join(root, "empty")
        os.makedirs(empty)
        try:
            build(empty, os.path.join(root, "empty.pak"), quiet=True)
            failures.append("an empty source directory should have been rejected")
        except PakError:
            pass
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print(f"  header {HEADER_SIZE} bytes, entry {ENTRY_SIZE} bytes, "
          f"data starts at {DATA_START}")
    if failures:
        print("  SELFTEST FAILED")
        for failure in failures:
            print(f"    - {failure}")
        return False
    print("  selftest passed: both compression paths round-trip exactly")
    return True


def verify_quiet(path):
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        return verify(path)


def main():
    parser = argparse.ArgumentParser(
        description="Build and inspect Baldur's Gate 3 .pak archives (LSPK v18).")
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build", help="pack a directory into a .pak")
    p_build.add_argument("source")
    p_build.add_argument("output")
    p_build.add_argument("--store", action="store_true",
                         help="store files uncompressed instead of LZ4")

    for name, help_text in (("list", "list the contents"),
                            ("verify", "structural check")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("pak")

    p_extract = sub.add_parser("extract", help="extract everything")
    p_extract.add_argument("pak")
    p_extract.add_argument("dest")

    sub.add_parser("selftest", help="round-trip generated content")

    args = parser.parse_args()
    try:
        if args.command == "build":
            build(args.source, args.output, store=args.store)
        elif args.command == "list":
            list_files(args.pak)
        elif args.command == "verify":
            return 0 if verify(args.pak) else 1
        elif args.command == "extract":
            extract(args.pak, args.dest)
        elif args.command == "selftest":
            return 0 if selftest() else 1
    except PakError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
