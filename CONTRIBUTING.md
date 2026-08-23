# Contributing

Thank you for helping improve Plant Factory. Changes to engineering models,
exports and visual contracts can affect downstream HMI and runtime behavior, so
focused, reviewable and evidence-backed contributions are preferred.

## Development setup

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm install
./test_all.sh
```

## Project rules

- Do not add classes, decorators, Python lambdas or JavaScript arrow functions.
- Use `functools.partial()` or explicit functional binding.
- Preserve the canonical project model and additive release contracts.
- Keep SVG, assembly and filesystem trust boundaries fail closed.
- Add regression coverage for success, rejection and round-trip behavior.
- Do not include credentials, customer drawings, plant topology or controller data.
- Support performance claims with a reproducible fixture and environment.

## Pull request checklist

- [ ] Scope and user outcome are explained.
- [ ] Model, export and compatibility effects are documented.
- [ ] `./test_all.sh` passes on Linux.
- [ ] No cache, runtime state, secrets or private plant data are included.
- [ ] Documentation, screenshots and `CHANGELOG.md` are current.
- [ ] Safety and security claims remain appropriately bounded.

Contributions are submitted under the repository's GPL-3.0-only terms. No
copyright assignment is implied. Discuss substantial work with the maintainer
before investing heavily, especially where separate commercial licensing may
need a written contribution agreement.
