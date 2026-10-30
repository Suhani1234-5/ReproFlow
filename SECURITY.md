# Security Policy

## Supported Versions

ReproFlow actively maintains and patches security vulnerabilities for the latest version:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

The ReproFlow team takes the security of our extension and tooling seriously. If you discover a security vulnerability, we appreciate your help in disclosing it to us responsibly.

**Please do NOT file public GitHub issues for security vulnerabilities.**

### How to Report

To report a security issue:

1. **Email us directly:** Send details of the vulnerability to [suhanigarg59@gmail.com](mailto:suhanigarg59@gmail.com).
2. **GitHub Private Vulnerability Reporting:** If enabled on the repository, you can submit an advisory through [GitHub Security Advisory Submission](https://github.com/Suhani1234-5/ReproFlow/security/advisories/new).

Please include as much information as possible:
- A description of the vulnerability and its potential impact.
- Step-by-step instructions or proof-of-concept to reproduce the issue.
- Operating system, browser version, and extension version used.
- Any suggested remediations or mitigations.

### Our Commitment

- We will acknowledge receipt of your report within 48 hours.
- We will provide a timeline for assessing and addressing the vulnerability.
- We will coordinate public disclosure with you after the fix is released.

## Security Architecture & Privacy Principles

ReproFlow is designed with privacy and security as core requirements:
- **Local-First Storage:** All recordings and test artifacts are stored in local IndexedDB and never transmitted to external cloud servers by default.
- **Explicit User Consent:** Network requests and GitHub issue creation occur only after explicit user interaction.
- **Sensitive Data Redaction:** Passwords, authorization tokens (`Bearer`, `ghp_`, etc.), session cookies, and credit card fields are masked before generation or export.
- **Scoped Permissions:** OAuth authorization scopes are restricted to the minimum required for issue creation and repository attachments.
