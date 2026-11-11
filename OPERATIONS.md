# Virtual Operator operations

## 1. Non-negotiable phase boundary

This is a local draft-and-approval console, not a delivery system.

- The only enabled outcome is a local draft, a new draft version, a local acknowledgement, or a confirmed rejection.
- Acknowledgement means a person has reviewed the work locally. It does not mean a message was sent, a page was published, a spreadsheet was created in Google Drive, or a CRM record was updated.
- There are no send, publish, or external-update API endpoints. `externalWritesEnabled` is false, and that field alone is not a permission switch.
- Hermes receives `-t ""`, `--max-turns 1`, and `--ignore-rules`. The prompt arrives on stdin, not in process arguments. The child environment is allowlisted. The application, not the model, persists a validated local proposal.
- Draft kinds include Notion, Slack, WhatsApp, and Airtable only as local structured content. Those names do not imply that a live service integration exists.
- Spreadsheet creation and editing produce local XLSX artifacts. Google Sheets is not a live write target.
- Browser QA uses a fixture-managed ephemeral loopback port, an isolated temporary `VO_DATA_DIR`, a test-only API key, and reserved destinations. Its drafts are not inserted into the live queue.

The only intended external network operations are explicitly requested read-only source calls, model-provider requests made by the configured Hermes CLI, and any provider authentication necessary for those configured services. None of these authorizes a send, publish, or record change.

## 2. Runtime layout

    app/main.py           HTTP routes, authentication, trusted hosts, response headers
    app/agent.py         One-turn, tool-free Hermes structured proposals
    app/store.py         SQLite drafts, versions, audits, local decisions
    app/integrations.py  Read-only Gmail/Airtable adapters and capability declarations
    app/models.py        Request and structured payload validation
    app/workbooks.py     Local XLSX generation
    app/saved_review.py    Owner-only, INDEX-allowlisted local document reads
    frontend/            React source, tests, and production build
    data/                Private live database, key, and XLSX artifacts (ignored by git)
    qa/                  Rendering and isolated real-browser journeys

`requirements.txt` is a pinned snapshot of the installed Python backend and QA environment. `frontend/package-lock.json` is the npm dependency lockfile. Rebuild `frontend/dist` after a frontend change; the server serves that build rather than recompiling it at request time.

The CLI runs foreground Uvicorn through `start.sh`. It is not a boot-time service or a public hosted deployment. Start it again after a host/service restart.

## 3. Configuration and credentials

Defaults:

- `VO_HOST`: `127.0.0.1`.
- `VO_PORT`: `8765`.
- `VO_DATA_DIR`: `data/` under the project.
- `VO_FRONTEND_DIST`: `frontend/dist/` under the project.
- `HERMES_HOME`: the normal Hermes home, normally `~/.hermes`.
- `VO_REVIEW_DIR`: the saved-document root, normally `~/operator-drafts`.
- `VO_HERMES_BIN`: optional Hermes executable override; otherwise Hermes is found on PATH.
- `VO_GOOGLE_PYTHON`: optional interpreter for the installed Google read-adapter script; otherwise a suitable `python` is found on PATH.

Use the generated `data/api.key` unless there is a deliberate reason to set `VO_API_KEY`. If using an environment-supplied key, do not place it in a committed file, command output, URL, or shell history. Rotating the key requires an explicit choice: set a new environment key, or remove the generated key file and restart so a new one is created. Keep a private backup of `data/` first if the queue matters.

The access-key screen validates the key before mounting private views. Browser requests then supply it as `X-VO-Key`, and the server compares it using a constant-time comparison. The key is held only in a module-scoped variable for the page; it is not delivered by runtime JavaScript, exposed as a frontend global, placed in a URL, or persisted in cookies or browser storage. Reloading requires entering it again. This is application-local bearer access, not a signed multi-user session, enterprise SSO, or a cryptographic request-signature protocol.

Permission expectations:

- `data/`, the artifacts directory, and the QA temporary data directory: owner-only directories.
- `data/api.key`, `data/operator.db`, and server-generated XLSX files: owner-only files.
- Existing provider credential files stay under the appropriate Hermes account profile, not the project’s public frontend directory.
- References to account paths and scoped credentials may appear in local documentation; credential values do not.

Check local key ownership without printing the key:

    stat -c '%n %a' data data/api.key data/operator.db

Expected directory/file modes are `700`, `600`, and `600`. Artifacts are checked by `tests/test_private_files.py` under a permissive umask.

Validate the running local API without printing the key:

    curl --silent --show-error --fail \
      --header "X-VO-Key: $(< data/api.key)" \
      http://127.0.0.1:8765/api/health

`http://127.0.0.1:8765/` is the primary surface. A missing-key request returns 401. With a valid API key, an untrusted Host header returns 400; public HTML also rejects an untrusted Host with 400. API responses contain `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, and a restrictive Content-Security-Policy. Only fingerprinted frontend assets and local font files use public caching.

Do not bind this application to `0.0.0.0` and call it production hosting. Public or LAN access would need explicit user authorization, real per-user identity, TLS, appropriate session/cookie/CSRF/CORS design, rate limiting, secret rotation, and an independent security review. Those features are deliberately not improvised here.

## 4. Gmail, Airtable, and Hermes

Current source adapters:

- Gmail: recent-message search through an installed Google read adapter, using an explicit read-only grant in the selected Hermes account profile.
- Airtable: accessible-base listing and schema inspection through a scoped personal access token. Read access is not permission to update records.
- Notion: available in the user's broader Hermes environment; this application's agent has no tools and no Notion write route.
- Slack and WhatsApp pairing: not configured for live operations; local drafting is available.

The browser source journey limits each Gmail account's check to five recent messages. Source responses can contain private subjects, addresses, or snippets. The test writes only aggregate counts and does not capture screenshots of source contents. Actual provider access remains read-only in this phase.

Keep each Google account's token in its own appropriately scoped Hermes home, preserve existing grants, and do not expand scopes for this application. Do not give the agent a broad Google, Notion, or Airtable token merely to compensate for a missing narrow grant.

`hermes doctor` can diagnose the CLI installation. The application does not run its repair mode or rewrite profile settings. If a model response fails, the form retains its values and the backend reports the CLI diagnostic rather than creating an empty proposal. A provider/runtime error is not a successful draft.

Private local drafts do not guarantee private model inference. The configured Hermes provider receives the proposal context. Use a deliberately isolated Hermes profile and a provider/model that matches the sensitivity of the content. No existing skills, parent-session identifier, or broad service tools are enabled for generation. If using a non-default `HERMES_HOME`, ensure that profile has its own correctly installed runtime/provider configuration; do not assume the default profile’s sessions or credentials transfer.

## 5. Saved document review

`GET /api/saved-drafts` lists only indexed documents. `GET /api/saved-drafts/{file_name}/content` reads an indexed Markdown, CSV or XLSX document, and `GET /api/saved-drafts/{file_name}/download` returns the exact original file as an attachment. All three routes require the same private `X-VO-Key` used by the existing API. The authenticated browser code uses its in-memory, user-entered key; no key belongs in React source, a runtime bootstrap response, or a URL.

The index is the allowlist. Each accepted path must be absolute, name an ordinary owner-only file directly under the resolved `VO_REVIEW_DIR`, and have a `.md`, `.csv` or `.xlsx` suffix. Paths outside that root, symbolic links, duplicate file IDs and unsupported files fail closed. `INDEX.md` and everything else, including `.work`, are not content targets. The root must be owned by the service user and have no group/other permissions; indexed files have the same ownership rule. Expected modes are `0700` and `0600`.

The catalog preserves the task title, source URL, local status, priority, due date and blocker/open question from `INDEX.md`. `completed` in the source is displayed as **Ready locally**. It means document readiness only; it must not be represented as task completion, approval or execution. The document view contains no approval or external-delivery controls. It is separate from the database-backed review queue and never updates that queue or Notion.

Markdown is rendered as React text and elements, not inserted as raw HTML. Raw script tags remain inert text; only explicit HTTP/HTTPS links become navigable. Markdown images become textual source links rather than automatic requests. Links open only when the user chooses them, with `noopener noreferrer`. Body text, table cells and filenames are treated as untrusted data. CSV is parsed with quoted comma and multiline-cell preservation. XLSX uses read-only OpenPyXL with stored formulas (`data_only=False`) and external links disabled (`keep_links=False`). Previewing never evaluates formulas or loads workbook links.

Inline text/csv files are limited to 2,000,000 bytes. Workbooks are limited to 20,000,000 source bytes, a 20,000,000-byte largest expanded ZIP member and 50,000,000 total expanded bytes. Preview caps are 30 sheets, 200 data rows per sheet and 40 columns per sheet. These are preview boundaries, not limits on an intentional authenticated download of an indexed original file.

The document view reads local files only. It does not call Gmail, Notion, a model provider or any other external source itself. Downloads return local copies to the browser; they do not export to a cloud destination or write back to the source document.

Browser QA uses only the synthetic files generated by `qa/saved_review_fixture.py` under `qa/output/saved-review-source`. The QA server receives these through `VO_REVIEW_DIR`, isolated from the production database and the real `~/operator-drafts`. Fixtures include an inert script string, a `javascript:` link, quoted commas, multiline CSV cells, two Markdown files belonging to one entry, and two workbook sheets with a stored formula. Test browser requests must stay on the isolated origin or use a local download blob. Do not substitute Leo's actual documents for browser QA or screenshots.

## 6. Verification

Backend and frontend:

    .venv/bin/python -m pytest tests/ -q
    cd frontend
    npm test -- --run
    npm run build
    npm audit --audit-level=high
    cd ..

Backend coverage includes API authentication, native-target rejection, all six draft types, structured payload validation, pinned Hermes destination/account, tool-free Hermes invocation, versioned editing, audit events, acknowledgement/rejection, XLSX content, response security, untrusted hosts, database/artifact permissions, and saved-document allowlisting/content/download access. Saved-file tests cover unauthenticated and unlisted-path rejection, absolute-path rebasing prevention, quoted comma/multiline CSV cells, exact original XLSX download bytes, and unevaluated formula text.

Browser tests use Playwright's managed headless Chromium:

    .venv/bin/python -m playwright install chromium --only-shell
    .venv/bin/python -m pytest qa/ -q --tb=short

`VO_CHROMIUM` optionally overrides the browser executable; otherwise Playwright uses its managed installation. `qa/test_browser_rendering.py` creates a local fontconfig file for the self-hosted Liberation fonts. On a host missing browser libraries, use `playwright install-deps chromium` when system package installation is authorized, or extract the required packages into a user-owned prefix and pass its library directory through `LD_LIBRARY_PATH`. The QA launcher preserves that path without passing credentials or the full process environment to the browser. No host-specific extracted-library path is a project requirement.

Run only the eight isolated application journeys when private source reads and the real model request are not intended:

    .venv/bin/python -m pytest qa/test_browser_rendering.py qa/test_browser_journeys.py \
      qa/test_saved_drafts_browser.py -q -k 'not real_hermes and not source_adapters'

The full browser suite checks rendering, form validation, all six types, editing/version 2/audit events, exact XLSX contents, local acknowledgement, rejection confirmation, source status and aggregate counts, write locks, a real Hermes proposal, JavaScript errors, 390px and 768px layouts, minimum 44px targets, horizontal overflow, keyboard focus, and mobile queue/inspector navigation. It does not perform external sends or mutations.

Browser-generated files and synthetic screenshots are under `qa/output/`. That directory is ignored by git. Live review data remains in `data/`; the isolated server is terminated by the fixture after each module.

For spreadsheet inspection without assuming a CSV sidecar exists, the test reads XLSX directly as JSON using the installed Microsoft Office skill helper and verifies comma-bearing and multiline cell values.

## 7. Backup, recovery, and promotion

Back up `data/` and the current build together. Back up the configured `VO_REVIEW_DIR` separately with its `INDEX.md` and owner-only permissions. Its absolute indexed paths are part of its access rules; restoring elsewhere requires restoring or deliberately rebuilding the same path/index relationship, not bypassing the allowlist.

The SQLite database, audit history, and generated XLSX files are local operational records, not a cryptographically tamper-proof audit ledger. Saved documents likewise remain local review material rather than proof of external task completion. Keep provider OAuth credentials in their own profile backups, with restricted access, separately from any exported draft review.

Do not promote browser QA artifacts into the live queue. If recreating isolated QA data is useful, repeat the test using the same brief; do not copy temporary IDs, reviewer keys, or provider messages into the production database.

## 8. Future permission expansion — only after explicit authorization

Do not implement delivery or an external mutation by enabling a global write flag, giving Hermes tools, reusing a broad personal token, or changing `externalWritesEnabled` to true. No such flag would create a safe delivery permission.

Use a separately authorized write phase with the following gates:

1. Identify the exact action and destination: for example, create a Gmail *draft*, not send; create one Airtable record, not update a whole base; create one Google spreadsheet, not grant broad Drive access. Keep sending, publishing, and destructive operations as separate later decisions.
2. Request only the required, revocable credential grant. Gmail draft creation needs `gmail.compose`; sending needs the separately sensitive `gmail.send` grant and explicit user authorization. For only app-created/opened Drive files, prefer `drive.file` over Drive-wide access; do not replace required read scopes without testing. Notion and Airtable must be restricted to explicitly selected pages/bases/tables/records and the minimum OAuth/token scopes.
3. Keep generation tool-free. A future write API must be a normal, separately authorized persistence/provider call after a person approves an exact redacted request summary. The model must never receive the write credential.
4. Add a typed write request, server-side destination/account validation, an immutable request digest, per-action audit intent/result, provider request id, precise error handling, and a test for transport failure versus confirmed success. Do not conflate HTTP success with a completed downstream effect.
5. Add a new, conspicuous external-action confirmation and an idempotency/retry policy. Keep the existing local acknowledgement distinct from an external action. Preserve the source/read phase and current write locks until this new phase has passed its own review.
6. Use synthetic destinations and dedicated test bases/pages/accounts. Verify that unauthorized targets are rejected, missing per-action authorization fails closed, retries do not duplicate writes, and every granted scope is actually necessary. Read back the exact external result before reporting success.
7. Revoke temporary test grants and keep a rollback that disables the new write route without discarding local drafts. External action audit records should be retained separately from ephemeral test provider data.

No permission expansion described in this section has been performed. The delivered application remains local-only with read-only Gmail/Airtable source adapters.
