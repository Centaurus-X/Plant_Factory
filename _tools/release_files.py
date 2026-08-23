#!/usr/bin/env python3
"""Shared functional release file selection for deterministic archives."""

from pathlib import Path


EXCLUDED_PARTS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    '.pytest_cache', '.mypy_cache',
}
EXCLUDED_NAMES = {
    '.DS_Store',
}
EXCLUDED_SUFFIXES = {
    '.pyc', '.pyo', '.swp', '.tmp',
}


def is_release_excluded(path, root):
    """Return whether one path is excluded from release artifacts."""
    relative = path.relative_to(root)
    if EXCLUDED_PARTS.intersection(relative.parts):
        return True
    if any(part.startswith('.release_test.') for part in relative.parts):
        return True
    if any(part.startswith('.release_extract.') for part in relative.parts):
        return True
    if any(part.startswith('.release_build.') for part in relative.parts):
        return True
    if path.name in EXCLUDED_NAMES:
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def release_files(root, exclude_manifest=False):
    """Return sorted regular files included in a release archive."""
    root = Path(root).resolve()
    files = []
    for path in root.rglob('*'):
        if not path.is_file() or path.is_symlink():
            continue
        if is_release_excluded(path, root):
            continue
        if exclude_manifest and path.name == 'SHA256SUMS':
            continue
        files.append(path)
    return sorted(files, key=path_sort_key)


def path_sort_key(path):
    """Return a deterministic POSIX path key without anonymous functions."""
    return path.as_posix()
