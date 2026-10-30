# Contributing to ReproFlow

Thank you for your interest in contributing to ReproFlow! We welcome contributions to make bug recording, reproduction, and triage faster and more reliable for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Repository Structure](#repository-structure)
- [Development Setup](#development-setup)
- [Testing and Quality Assurance](#testing-and-quality-assurance)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Security Issues](#reporting-security-issues)

---

## Code of Conduct

All contributors and participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it to ensure a welcoming and inclusive environment.

---

## Getting Started

1. **Fork the repository** on GitHub: [https://github.com/Suhani1234-5/ReproFlow](https://github.com/Suhani1234-5/ReproFlow).
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/ReproFlow.git
   cd ReproFlow
   ```
3. **Create a topic branch**:
   ```bash
   git checkout -b feat/my-new-feature
   ```

---

## Repository Structure

The ReproFlow project is organized into modular packages:

- `extension/`: Chrome Manifest V3 extension (React, TypeScript, Dexie/IndexedDB, Octokit OAuth Device Flow).
- `runner/`: Local Node.js service that runs Playwright tests and verifies failures.
- `shared/`: Shared TypeScript types, spec formats, and report interfaces.
- `web/`: Promotional and documentation web application built with React, Three.js, GSAP, and TailwindCSS.
- `demo/`: Minimal HTTP demo application for simulating and reproducing bugs locally.

---

## Development Setup

### Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **Google Chrome** or any Chromium-based browser (v115+)

### Installation

Install dependencies across the packages:

```bash
# Install root dependencies
npm install

# Install extension dependencies
npm install --prefix extension

# Install runner dependencies
npm install --prefix runner

# Install web dependencies
npm install --prefix web
```

### Environment Configuration

Copy the example environment file for the extension:

```bash
cp extension/.env.example extension/.env
```

Set your GitHub OAuth Client ID in `extension/.env`:
```env
VITE_GITHUB_CLIENT_ID=your_client_id_here
```

### Building the Extension

```bash
npm run build --prefix extension
```

To load the extension into Chrome:
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `extension/dist` directory.

### Running the Verification Runner

```bash
# Install Chromium for Playwright (first time only)
npm run install:browsers --prefix runner

# Start the local runner
npm run start --prefix runner
```

---

## Testing and Quality Assurance

Before submitting any code changes, ensure all tests pass and code compiles without errors:

```bash
# Run unit and integration tests (Vitest)
npm test

# Build extension
npm run build --prefix extension

# Typecheck runner
npm run typecheck --prefix runner

# Build web portal
npm run build --prefix web
```

---

## Pull Request Guidelines

1. **Keep PRs focused**: Each PR should address a single feature, bug fix, or improvement.
2. **Add tests**: Any new feature or bug fix should include corresponding test coverage.
3. **Write clear commit messages**: Follow conventional commit guidelines (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
4. **No secrets or credentials**: Never include API keys, access tokens, personal tokens, or private credentials in code or commits.
5. **Update documentation**: Keep README, PRD, and docs aligned with code changes.

---

## Reporting Security Issues

Please **do not** report sensitive security vulnerabilities via public GitHub issues. Follow the instructions in our [Security Policy](SECURITY.md) to report security concerns privately and responsibly.
