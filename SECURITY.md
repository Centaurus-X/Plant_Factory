# Security policy

Plant Factory processes engineering drawings, automation configuration and
potentially sensitive plant metadata. Use coordinated disclosure and never put
vulnerability details, credentials or real plant information in a public issue.

## Supported version

| Version | Support |
|---|---|
| `64_r6` | Current public engineering release; best-effort security fixes |
| Older releases | Historical compatibility evidence only |

## Reporting

Use **Security → Report a vulnerability** in this GitHub repository. Include
the affected version/commit, safe lab reproduction, impact, sanitized evidence
and a suggested mitigation if available. If private reporting is unavailable,
contact the maintainer through the Centaurus-X profile and agree on a private
channel before sharing sensitive details.

High-priority examples include SVG sanitizer bypass, path traversal, arbitrary
file write/read, active-content execution, unauthorized project mutation,
binding confusion that targets a different device, or export corruption that
can change runtime behavior.

## Deployment baseline

- Bind locally unless remote access is explicitly required.
- Put shared access behind authenticated TLS and authorization.
- Keep projects, templates and backups readable only by intended operators.
- Never import untrusted SVG or project data directly into a live workflow.
- Review generated runtime/I/O artifacts before deployment.
- Use isolated test equipment and never research against live machinery without authorization.

This project does not claim an independent penetration test, safety
certification or compliance certification.
