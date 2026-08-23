#!/usr/bin/env python3
"""Create the deterministic internal SHA-256 release manifest."""

import argparse
import hashlib
from pathlib import Path

from release_files import release_files


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


def build_lines(root):
    """Return deterministic manifest lines for all release files except itself."""
    lines = []
    for path in release_files(root, exclude_manifest=True):
        relative = path.relative_to(root).as_posix()
        lines.append('%s  %s' % (sha256_file(path), relative))
    return lines


def write_manifest(root, output):
    """Write one normalized SHA256SUMS file."""
    lines = build_lines(root)
    output.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    return len(lines)


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--output', default='SHA256SUMS')
    parser.add_argument('--check', action='store_true')
    return parser.parse_args()


def main():
    """Create or verify the internal release manifest."""
    args = parse_args()
    root = Path(args.root).resolve()
    output = Path(args.output)
    if not output.is_absolute():
        output = root / output
    expected = '\n'.join(build_lines(root)) + '\n'
    if args.check:
        actual = output.read_text(encoding='utf-8') if output.is_file() else ''
        if actual != expected:
            raise SystemExit('SHA256SUMS is not current.')
        print('SHA256SUMS verified: %d entries.' % len(expected.splitlines()))
        return
    output.write_text(expected, encoding='utf-8', newline='\n')
    print('SHA256SUMS written: %d entries.' % len(expected.splitlines()))


if __name__ == '__main__':
    main()
