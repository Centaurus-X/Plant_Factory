#!/usr/bin/env python3
"""Verify the repository's functional Python style contract."""

import ast
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_PARTS = {'.git', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache'}


def is_excluded(path):
    return bool(EXCLUDED_PARTS.intersection(path.parts)) or any(
        part.startswith('.release_test.') for part in path.parts
    )


def python_files(root):
    return sorted(
        path
        for path in root.rglob('*.py')
        if not is_excluded(path)
    )


def inspect_file(path):
    findings = []
    try:
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    except SyntaxError as exc:
        return [('syntax', exc.lineno or 0, str(exc))]

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            findings.append(('class', node.lineno, node.name))
        elif isinstance(node, ast.Lambda):
            findings.append(('lambda', node.lineno, ast.unparse(node)))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
            decorator_names = ', '.join(ast.unparse(item) for item in node.decorator_list)
            findings.append(('decorator', node.lineno, decorator_names))
    return findings


def main():
    findings = []
    for path in python_files(ROOT):
        for kind, line, detail in inspect_file(path):
            findings.append((path.relative_to(ROOT), kind, line, detail))

    if findings:
        for path, kind, line, detail in findings:
            print('%s:%s: %s: %s' % (path, line, kind, detail), file=sys.stderr)
        return 1

    print('Functional Python style verified: no classes, lambdas or decorators.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
