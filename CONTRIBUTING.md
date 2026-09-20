# Contributing to Veil

Keep the downloadable app self-contained and offline. Use only clearly fictional documents in tests, screenshots and issues. Never submit real CVs, customer records, saved private sessions, credentials or local machine paths.

## Repository contents

- `src/`: original application, deterministic detection, document processing and UI sources.
- `build.mjs`, `package.json`, `package-lock.json`: reproducible build inputs and pinned dependencies.
- `dist/`: the standalone app and its hash/version manifest.
- `tests/`: maintained unit tests, offline browser harness and explicitly reviewed fictional regression fixtures.
- `vendor/`, `licenses/`, `LICENSE`, `THIRD_PARTY_NOTICES.md`: required bundled code and licence information.
- `docs/`: current screenshot and branding assets.

Some conversion and PDF reflow modules remain for saved-work compatibility, regression coverage and future development. Their presence does not enable Word/email uploads or PDF text sharing in this release. Do not remove them without checking imports and compatibility tests.

## Verification

Run the build and both test commands documented in README against the same artifact. Browser checks require an installed browser; `VEIL_BROWSER_PATH` can select Chrome/Edge. No service is required. Install optional dependencies too: the PDF tests use the native canvas package supplied by PDF.js; installs with `--omit=optional` cannot run the full suite. Test hidden text, stale sessions and malformed replies when touching privacy boundaries. Test the actual downloaded output, not just an on-screen rectangle. Do not weaken failing tests to hide a defect.

The maintained commands are `npm test` and `npm run test:hardening`. Historical scripts tied to withdrawn interfaces are excluded from publication. The synthetic fixture README explains provenance. Generated fixtures and outputs stay under ignored `evidence/`.

## Publication hygiene

`.gitignore` is an explicit public-file allowlist. Add a new source, test or fixture path only after reviewing it. Future PDFs/DOCX/.veil files are ignored unless their exact path has been approved; do not add broad exceptions. The allowlist intentionally excludes local instructions, internal review prompts, working notes, node_modules, evidence, editor state and private documents.

Ignoring a previously tracked file does not remove it from Git. Inspect `git status`, `git ls-files`, the staged diff and history before publishing. Never force-add ignored private material or use a blanket add without checking the candidate list. Confirm the HTML hash matches its manifest and that all build sources and licence notices are included. A clean rebuild must not need ignored project files.

Publication and repository visibility changes are separate decisions. No build or test command publishes anything.
