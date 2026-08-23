#!/usr/bin/env python3
"""Verify archive safety and the internal SHA-256 manifest."""

import argparse
import hashlib
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


FORBIDDEN_PARTS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    '.pytest_cache', '.mypy_cache',
}


def sha256_file(path):
    """Return the SHA-256 digest of one file."""
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def validate_member(info, expected_root):
    """Validate one ZIP member and return its normalized path."""
    name = info.filename
    path = PurePosixPath(name)
    if path.is_absolute() or name.startswith('/') or name.startswith('\\'):
        raise ValueError('Absolute archive path: ' + name)
    if '..' in path.parts:
        raise ValueError('Path traversal archive entry: ' + name)
    if not path.parts or path.parts[0] != expected_root:
        raise ValueError('Unexpected archive root: ' + name)
    if FORBIDDEN_PARTS.intersection(path.parts):
        raise ValueError('Forbidden release path: ' + name)
    if any(part.startswith('.release_test.') for part in path.parts):
        raise ValueError('Temporary release path: ' + name)
    mode = (info.external_attr >> 16) & 0xFFFF
    if stat.S_ISLNK(mode):
        raise ValueError('Symlink archive entry: ' + name)
    return path


def parse_manifest(path):
    """Return digest/path pairs from SHA256SUMS."""
    entries = []
    for line_number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split('  ', 1)
        if len(parts) != 2 or len(parts[0]) != 64:
            raise ValueError('Invalid SHA256SUMS line %d.' % line_number)
        entries.append((parts[0], parts[1]))
    return entries


def verify_archive(archive_path, expected_root):
    """Verify one release archive and return a summary."""
    with zipfile.ZipFile(archive_path, 'r') as archive:
        infos = archive.infolist()
        seen = set()
        for info in infos:
            path = validate_member(info, expected_root)
            normalized = path.as_posix()
            if normalized in seen:
                raise ValueError('Duplicate archive entry: ' + normalized)
            seen.add(normalized)
        with tempfile.TemporaryDirectory(prefix='plant_factory_release_verify_') as temporary:
            target = Path(temporary)
            archive.extractall(target)
            root = target / expected_root
            manifest = root / 'SHA256SUMS'
            if not manifest.is_file():
                raise ValueError('SHA256SUMS missing from archive.')
            entries = parse_manifest(manifest)
            for expected, relative in entries:
                file_path = root / relative
                if not file_path.is_file():
                    raise ValueError('Manifest file missing: ' + relative)
                actual = sha256_file(file_path)
                if actual != expected:
                    raise ValueError('Digest mismatch: ' + relative)
            extracted_files = [path for path in root.rglob('*') if path.is_file()]
            if len(extracted_files) != len(entries) + 1:
                raise ValueError(
                    'Archive/manifest count mismatch: files=%d entries=%d'
                    % (len(extracted_files), len(entries))
                )
    return {
        'archive_entries': len(infos),
        'files': len(entries) + 1,
        'sha256_entries': len(entries),
    }


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--root-name', default='Automated_SVG_Integration_64_r6')
    return parser.parse_args()


def main():
    """Verify and report one archive."""
    args = parse_args()
    result = verify_archive(Path(args.archive).resolve(), args.root_name)
    print(
        'Release archive verified: %d files, %d SHA-256 entries.'
        % (result['files'], result['sha256_entries'])
    )


if __name__ == '__main__':
    main()
