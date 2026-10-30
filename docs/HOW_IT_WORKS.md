# How ReproFlow Works

ReproFlow automates the journey from an observed browser defect to an executable, verified test case. This document details the technical architecture and execution flow.

```
+-------------------------------------------------------------+
|                        Browser Tab                          |
|  DOM Events  *  Console Errors  *  Network Requests (Fetch) |
+------------------------------+------------------------------+
                               | (chrome.runtime messaging)
                               v
+-------------------------------------------------------------+
|               ReproFlow Extension (MV3)                     |
|  - Content Script & Page Hook (interception)                |
|  - Redaction Filter (masks tokens, passwords, secrets)      |
|  - Local Storage (IndexedDB / Dexie)                        |
|  - Test Generator (generates reproduction.spec.ts)          |
+------------------------------+------------------------------+
                               | (HTTP POST /verify)
                               v
+-------------------------------------------------------------+
|                  Local Runner (Node.js)                     |
|  - Launches Playwright Chromium in headless sandbox         |
|  - Replays reproduction.spec.ts against application         |
|  - Classifies: reproduced | not-reproduced | diff-failure   |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                  GitHub Integration                         |
|  - Device Flow OAuth (no secrets stored in client)          |
|  - Creates Issue with structured diagnosis                  |
|  - Uploads spec & screenshots to dedicated reproflow/ branch|
+-------------------------------------------------------------+
```

---

## 1. Recording Phase

When the user activates recording in the Chrome extension popup:
1. **Content Script Injection:** Injects listeners into the active tab to capture user interactions (`click`, `input`, `change`, `submit`, `keydown`, `navigation`).
2. **Page Hook Injection:** Overrides `window.fetch` and `XMLHttpRequest` to capture HTTP status codes, request URLs, and failed responses.
3. **Console & Error Interception:** Listens to `window.onerror` and `console.error` events to collect uncaught exceptions and error messages.
4. **Data Redaction:** The redaction engine (`extension/src/lib/redact.ts`) immediately flags sensitive inputs (fields named `password`, `token`, `secret`, `cvv`, etc.) and masks Bearer/GitHub tokens to prevent credentials from ever entering session storage.

---

## 2. Generation Phase

When recording is stopped, the Playwright Test Generator (`extension/src/lib/generator.ts`):
1. **Normalizes Events:** Filters redundant clicks, resolves navigation events, and aggregates consecutive input keystrokes into `locator.fill()`.
2. **Generates Stable Locators:** Prioritizes accessible selectors (`getByRole`, `getByLabel`, `getByTestId`) over fragile CSS selectors.
3. **Formulates Expectations:** Adds assertions verifying the recorded failure condition (e.g. `expect(page.locator(...)).toBeVisible()`, expected response errors, or specific text).
4. **Emits Playwright Spec:** Writes out a standalone, executable `reproduction.spec.ts` script.

---

## 3. Local Verification Phase

The local runner (`runner/src/server.ts`):
1. **Isolated Execution:** Runs an HTTP verification service on `127.0.0.1:8787`.
2. **Playwright Execution:** Executes the generated test using Playwright in Chromium.
3. **Failure Classification:**
   - **Reproduced:** The replay failed in the exact same manner as the recorded bug.
   - **Not Reproduced:** The replay succeeded without error.
   - **Different Failure:** A different assertion or timeout failed.
   - **Infrastructure Error:** Network unavailable or runner setup issue.

---

## 4. Structured Reporting & GitHub Integration

Once verified:
1. **Evidence Bundle:** Consolidates reproduction steps, console logs, network error logs, and verification output.
2. **Issue Fingerprinting:** Generates a deterministic SHA-256 fingerprint from the failure characteristics to check for existing duplicate issues.
3. **GitHub Issue Filing:** Authenticates using GitHub OAuth Device Flow (Octokit), creates a detailed GitHub issue, and attaches reproduction specs and screenshots to a dedicated `reproflow/<report-id>` branch.
