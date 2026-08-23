#!/usr/bin/env python3
"""Build a deterministic Plant Factory ZIP release archive."""

import argparse
import stat
import zipfile
from pathlib import Path

from release_files import release_files


FIXED_TIMESTAMP = (2020, 1, 1, 0, 0, 0)


def archive_mode(path):
    """Return normalized POSIX permissions for one archived file."""
    mode = path.stat().st_mode
    if mode & stat.S_IXUSR:
        return 0o755
    return 0o644


def build_zip(root, output, root_name):
    """Create one deterministic ZIP and return its file count."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    if temporary.exists():
        temporary.unlink()
    files = release_files(root)
    with zipfile.ZipFile(
        temporary,
        mode='w',
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for path in files:
            relative = path.relative_to(root).as_posix()
            info = zipfile.ZipInfo(root_name + '/' + relative, FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (archive_mode(path) & 0xFFFF) << 16
            info.flag_bits |= 0x800
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    temporary.replace(output)
    return len(files)


def parse_args():
    """Parse command-line arguments."""
    default_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(default_root))
    parser.add_argument('--output', required=True)
    parser.add_argument('--root-name', default='Automated_SVG_Integration_64_r6')
    return parser.parse_args()


def main():
    """Build and report the deterministic archive."""
    args = parse_args()
    root = Path(args.root).resolve()
    output = Path(args.output).resolve()
    count = build_zip(root, output, args.root_name)
    print('Deterministic ZIP written: %s (%d files)' % (output, count))


if __name__ == '__main__':
    main()
