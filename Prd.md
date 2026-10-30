# ReproFlow: Product Requirements Document

**Version:** 1.0 (Draft) | **Status:** For review | **Date:** October 29, 2026 **Tagline:** Record once. Reproduce anywhere. Fix faster.

## 1. Overview

ReproFlow is a local-first, open-source Chrome extension that turns a browser bug into a verified, executable Playwright test. A developer or QA engineer clicks Record, reproduces the issue, and ReproFlow produces a TypeScript Playwright test, screenshot evidence, a sanitized diagnostic bundle and a structured bug report. The test is then run locally to confirm the same failure reproduces. Once the report is ready, ReproFlow can automatically create a GitHub issue in the chosen repository, with the report, evidence and test attached.

The differentiator is **One-Click Verified Reproduction**: Capture the bug, generate the test, run it, verify the failure, and file the issue, all in one flow.

## 2. Problem Statement

Bug reports are slow and unreliable. Reporters forget steps, omit environment details, and attach screenshots that do not let a developer reproduce the problem. Developers lose time asking for clarification, and many bugs are closed as "cannot reproduce."

Existing tools only partly solve this:

- Playwright's recorder and codegen produce test code, but do not verify a failure, collect evidence or file reports.
- Jam and similar tools capture recordings and technical context, but do not produce an executable, verified test.
- Filing the issue is still a manual copy-and-paste step in every tool.

## 3. Goals and Non-Goals

### Goals

1. Reduce time from "found a bug" to "developer can reproduce it" to under 2 minutes.
2. Generate readable Playwright tests that developers would be willing to commit.
3. Verify that a replay reproduces the recorded failure, not merely that the test ran.
4. Create a complete, deduplicated GitHub issue from a verified report with one click (or automatically, if enabled).
5. Keep all data local by default, with explicit consent before anything leaves the machine.

### Non-Goals (v1)

- Cloud recording, team workspaces and billing.
- Jira, Linear and Slack integrations (GitHub only in v1).
- AI-powered automatic bug fixing.
- Cross-browser recording (Chromium only).
- Full video recording and replay.
- Complex authentication flows such as SSO and MFA.

## 4. Target Users

| Persona | Needs |
| --- | --- |
| Frontend / full-stack developer | Quickly capture a bug as a runnable test and file it with the right context |
| QA engineer | Record exploratory-testing findings and hand developers something executable |
| Open-source maintainer | Receive consistent, reproducible issues from contributors |
| Engineering lead | Fewer "cannot reproduce" tickets and faster triage |

## 5. User Flow

1. **Connect (one time):** The user links a GitHub account and selects a default repository.
2. **Record:** The user clicks Record in the extension popup on the active tab and reproduces the bug.
3. **Mark failure:** The user stops recording and describes the expected and actual behavior. The extension captures the failure state (screenshot, console errors, failed network requests).
4. **Generate:** ReproFlow produces `reproduction.spec.ts`, screenshots and a structured report.
5. **Verify:** The local runner executes the test and compares the observed failure with the recorded failure.
6. **Review:** The user sees the report, the redaction preview and the draft GitHub issue.
7. **File issue:** The user clicks Create GitHub Issue (or it is created automatically if enabled). The issue link is stored with the report.

## 6. Functional Requirements

Priority: **P0** = required for v1, **P1** = required for public beta, **P2** = later.

### 6.1 Recording

| ID | Requirement | Priority |
| --- | --- | --- |
| REC-1 | Capture clicks, text input, selection, checkbox and radio changes, keyboard submits, and navigation | P0 |
| REC-2 | Start recording only on explicit user action, using `activeTab` and `scripting` permissions | P0 |
| REC-3 | Keep event order intact across navigation, reloads and service-worker restarts | P0 |
| REC-4 | Persist events to IndexedDB incrementally so a crash does not lose the session | P0 |
| REC-5 | Capture console errors, uncaught exceptions and failed network requests (status and URL only, no bodies) | P0 |
| REC-6 | Handle iframes and shadow DOM | P1 |
| REC-7 | Handle dynamic elements via MutationObserver and wait-for-state detection | P1 |

### 6.2 Test Generation

| ID | Requirement | Priority |
| --- | --- | --- |
| GEN-1 | Generate readable TypeScript Playwright tests (`@playwright/test`) | P0 |
| GEN-2 | Locator priority: `getByRole`, `getByLabel`, `getByTestId`, `getByText`, then CSS fallback | P0 |
| GEN-3 | Verify each locator is unique on the recorded page before emitting it | P0 |
| GEN-4 | Emit an assertion for the observed failure (visible error text, URL, HTTP status or console error) | P0 |
| GEN-5 | 100% of generated tests must pass syntax validation (TypeScript compile check) | P0 |
| GEN-6 | Generation must be deterministic: the same session produces the same test | P0 |
| GEN-7 | Collapse redundant events (repeated keystrokes become one `fill`) | P1 |

### 6.3 Evidence Capture

| ID | Requirement | Priority |
| --- | --- | --- |
| EVD-1 | Screenshot at the start, at each navigation and at the failure state | P0 |
| EVD-2 | Capture browser, OS, viewport, extension version and page URL | P0 |
| EVD-3 | Redact sensitive field values in screenshots (password and flagged fields masked) | P0 |
| EVD-4 | Trace file (Playwright trace) from the verification run | P1 |

### 6.4 Verified Replay

| ID | Requirement | Priority |
| --- | --- | --- |
| VER-1 | A local Node.js runner executes the generated test in an isolated browser context | P0 |
| VER-2 | Classify every result as one of: **Reproduced** (same failure), **Not reproduced** (test passed), **Different failure** or **Infrastructure error** | P0 |
| VER-3 | Re-run up to N times (default 3) to detect flaky reproduction and report a confidence level | P1 |
| VER-4 | The runner accepts only ReproFlow-generated test files and runs no arbitrary commands | P0 |
| VER-5 | Communicate with the extension through Chrome Native Messaging or a localhost service with a per-session token | P0 |

### 6.5 Bug Report

Each report contains:

- Title, summary, expected behavior and actual behavior
- Numbered reproduction steps (human-readable, generated from the recording)
- Environment details
- Verification result and classification
- Screenshots and console/network error summary
- The generated `reproduction.spec.ts`
- Exports: Markdown, JSON and ZIP (P0)

The report schema is versioned (`schemaVersion`) so older reports remain readable.

## 7. GitHub Issue Creation (Key Feature)

When a bug report is generated, ReproFlow creates a GitHub issue in the connected repository containing the report. This is part of the core flow, not an afterthought.

### 7.1 Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| GH-1 | Connect GitHub via a GitHub App (preferred) or OAuth device flow. Personal access tokens are allowed only as a fallback for advanced users | P0 |
| GH-2 | Request least-privilege access: Issues (read/write) and Contents (write) only on the repositories the user selects | P0 |
| GH-3 | Let the user pick a default repository and override it per report | P0 |
| GH-4 | Create the issue automatically after a successful report generation when **Auto-create issue** is on; otherwise show a one-click Create Issue button. Default: off, with a confirmation step | P0 |
| GH-5 | Show a preview of the exact issue title, body, labels and attachments before anything is sent. The user must approve at least once per repository | P0 |
| GH-6 | Apply labels automatically (for example `bug`, `reproflow`, and `reproduced` or `needs-triage` based on the verification result). Create missing labels if permitted | P0 |
| GH-7 | Store the created issue number and URL on the report, and show it in the extension | P0 |
| GH-8 | Prevent duplicates: compute a reproduction fingerprint (hash of normalized steps, failing assertion and page URL). If an open issue already contains the fingerprint, offer to comment on it instead | P0 |
| GH-9 | Support an issue template per repository (custom title format, labels, assignees) in `.reproflow.json` | P1 |
| GH-10 | Queue the issue if the user is offline or rate-limited, and retry with exponential backoff. Creation must be idempotent (retries never create two issues) | P1 |
| GH-11 | Add a comment with the updated verification result when the test is re-run later | P2 |

### 7.2 Attachments

GitHub's REST API has no endpoint for uploading images or files to an issue. ReproFlow therefore uses this approach:

1. **Test file and screenshots:** Committed to a dedicated branch (for example `reproflow/issue-<id>`) under `.reproflow/<report-id>/`, using the Contents API. The issue body links to these files and embeds the screenshots from the branch.
2. **Fallback:** If the user does not grant Contents write access, ReproFlow posts the test as a fenced code block in the issue body (collapsed in `<details>`) and offers the ZIP for manual attachment.
3. **Optional:** A secret gist for large files, only with explicit consent.

### 7.3 Issue Body Template

```
## Summary
<one-paragraph description>

## Expected / Actual
- Expected: ...
- Actual: ...

## Steps to Reproduce
1. ...
2. ...

## Verification
Result: Reproduced (3 of 3 runs)
Failure: <assertion or error message>

## Evidence
<screenshots>

## Reproduction Test
<link to reproduction.spec.ts, plus collapsed code block>

## Environment
Browser, OS, viewport, URL, ReproFlow version

<!-- reproflow:fingerprint=<hash> -->
```

### 7.4 Rules for Safe Issue Creation

- Private data never leaves the machine without approval. The issue is created only from the already-redacted report.
- Issues in **public** repositories show a prominent warning, because screenshots and URLs become publicly visible.
- Only reports classified **Reproduced** are created automatically. Others require manual confirmation and are labeled `needs-triage`.
- The GitHub token is stored in `chrome.storage.session` or encrypted local storage, never in reports, logs or exports.
- The user can disconnect GitHub at any time, which deletes the stored credentials.

## 8. Privacy and Security Requirements

| Area | Requirement |
| --- | --- |
| Data location | All recordings and reports stored locally (IndexedDB) by default |
| Consent | Explicit consent before recording, and before any data is shared (including GitHub) |
| Redaction | Mask passwords, tokens, payment fields and fields matching configurable patterns before persistence. Zero sensitive values in generated fixtures |
| Deletion | One-click deletion of any session, report or all data |
| Network | No telemetry containing page content. Error monitoring (Sentry) must scrub URLs and payloads, and is opt-in |
| Permissions | `activeTab` and `scripting` first; host permissions only when required and requested at runtime |
| Execution | No arbitrary command execution. The runner executes only validated ReproFlow tests |
| Chrome Web Store | Privacy policy, data-use disclosure and minimal permissions per store policy |
| Dependencies | Automated vulnerability scanning in CI. Zero critical vulnerabilities at release |

## 9. Architecture

| Layer | Technology |
| --- | --- |
| Extension | Manifest V3, React, TypeScript, Vite |
| Recording engine | Content scripts, MutationObserver, DOM event listeners |
| Local storage | IndexedDB with Dexie, versioned schemas |
| Test generator | TypeScript module (pure and deterministic, fully unit-tested) |
| Local runner | Node.js service with Playwright, reached via Native Messaging or token-protected localhost |
| GitHub integration | GitHub App / OAuth device flow, Octokit REST client inside the extension service worker |
| Backend (later) | FastAPI, PostgreSQL, Supabase Auth |
| CI/CD | GitHub Actions |
| Monitoring | Sentry or OpenTelemetry (opt-in, scrubbed) |
| Testing | Vitest, Playwright, Pytest |

Key decision: the extension records and orchestrates, but never runs Playwright inside itself. The local runner executes tests, and the extension handles GitHub calls so no backend is needed in v1.

```
Extension (record) -> Generator -> Local Runner (verify) -> Report
                                                              |
                                                  GitHub App -> Issue + branch files
```

## 10. Non-Functional Requirements

- **Reliability:** At least 99% of recording sessions save successfully.
- **Performance:** Recording adds under 50 ms of overhead to page interactions. Test generation completes within 3 seconds for a 100-step session.
- **Accessibility:** The popup and report views meet WCAG 2.1 AA.
- **Compatibility:** Latest two stable Chrome versions, plus Chromium-based browsers where feasible.
- **Observability:** Structured local logs with a user-exportable diagnostics bundle.
- **Quality:** Critical recorder logic test coverage of at least 85%.

## 11. Success Metrics

These are proposed release targets, not existing results.

| Metric | Target |
| --- | --- |
| Sessions saved successfully | At least 99% |
| Supported demo workflows replay successfully | At least 90% |
| Generated tests passing syntax validation | 100% |
| Sensitive values leaked in fixtures or issues | 0 |
| GitHub issues created without duplicates | At least 99% |
| Verified reproduction rate on independent React apps | At least 80% (beta), 90% (launch) |
| Median time from Stop to GitHub issue | Under 60 seconds |
| Critical security vulnerabilities | 0 |

## 12. Milestones

| Phase | Timeline | Scope | Deliverable |
| --- | --- | --- | --- |
| 1. Foundation | 3 days | Extension shell, recording lifecycle, deterministic generator, local persistence, screenshots, report, local runner, **basic GitHub issue creation** (repo selection, issue with embedded test) | End-to-end demo on a controlled website: Record, Generate, Verify, Issue |
| 2. Developer beta | 2 weeks | Selector reliability, dynamic elements, redaction engine, duplicate detection, branch-based attachments, labels, import/export, docs | Version for external developer testing |
| 3. Launch candidate | 4-6 weeks | Cross-site testing, iframes and shadow DOM, offline queue, security review, accessibility, Chrome Web Store submission | Public release candidate |
| 4. Commercial | 2-3 months | Team workspaces, encrypted cloud storage, RBAC, Jira/Linear/Slack, CI execution, billing, audit logs | Early commercial product |

### Phase 1 scope (72 hours)

Build one vertical slice to a high standard, such as a broken checkout or signup flow on a demo site: Record, capture failure, generate Playwright, execute, verify, export report, **create GitHub issue**. GitHub work in Phase 1 is estimated at 4 to 6 hours (device-flow auth, repo picker, issue creation with fingerprint).

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Unstable selectors on real sites | Replay fails | Prefer roles and test IDs, uniqueness checks, fallback chains, validate on real React apps |
| Service-worker restarts lose events | Corrupt sessions | Incremental IndexedDB writes, session recovery on startup |
| Sensitive data in screenshots or issues | Privacy breach, store rejection | Redaction before persistence, preview and approval, public-repo warning |
| GitHub token theft | Account compromise | Least-privilege GitHub App, session storage, easy disconnect |
| Duplicate or noisy issues | Maintainer frustration | Fingerprint, comment-on-existing, auto-create only for verified reproductions |
| GitHub rate limits or outages | Failed issue creation | Queue with backoff, idempotency keys |
| Competing with Playwright codegen and Jam | Weak differentiation | Lead with verified reproduction plus automatic issue filing |
| Untrusted test execution | Security incident | Runner executes only validated generated files, isolated contexts, no shell access |

## 14. Open Questions

1. GitHub App vs OAuth App for v1: the App gives finer permissions but needs a hosted callback. Is a tiny hosted auth relay acceptable for a local-first product?
2. Should screenshots go to a branch in the repo (visible, versioned) or be left out of public repos by default?
3. Native Messaging vs localhost runner: which gives the smoother install for developers?
4. Is the project licensed MIT or Apache-2.0?
5. Which GitHub Enterprise Server versions, if any, need support?

## 15. Out of Scope for v1

Cloud sync, team accounts, non-GitHub trackers, video replay, cross-browser support, auto-fix suggestions and complex authentication flows.

## 16. 3D Animated Frontend

The 3D experience lives on the **marketing and demo site** (landing page plus interactive demo), not inside the extension popup. A WebGL scene inside a 380px popup wastes performance and battery, so the popup uses lightweight CSS and Framer Motion animation in the same visual style.

| Item | Specification |
| --- | --- |
| Stack | React, TypeScript, Vite, Tailwind, Three.js via React Three Fiber, `@react-three/drei`, GSAP ScrollTrigger, Framer Motion |
| Hero scene | A floating browser window that records a click, a bug flash (red glitch), then morphs into a Playwright test card and a GitHub issue card |
| Scroll story | Four scroll-driven stages: Record, Generate, Verify, File Issue. The camera moves between stages and the 3D objects transform at each one |
| Interaction | Mouse parallax, hover tilt on cards, a Replay button that re-runs the scene |
| Style | Dark theme, one accent color, glassmorphism cards, soft bloom on key objects |
| Performance | Target 60 fps on mid-range laptops. Total JS under 300 KB gzipped (excluding lazy-loaded 3D chunk). Use primitives and simple geometry, no heavy GLB models. Lazy-load the canvas. Cap pixel ratio at 2 |
| Fallbacks | Respect `prefers-reduced-motion` (static poster). Show a static image if WebGL is unavailable. Pause rendering when the tab is hidden |
| Accessibility | All content readable without the canvas. Keyboard-accessible controls. WCAG 2.1 AA contrast |