# Virtual Operator

A private, local-first response desk. Review, edit, acknowledge, or reject proposed work without sending email, publishing pages, or modifying Slack, WhatsApp, Airtable, or Notion.

The application has no external-write endpoint or delivery control. “Acknowledge locally” and “Reject” only update the local draft and audit history.

## What is included

- Six local draft types: email, Notion page, Slack, WhatsApp, spreadsheet, and Airtable.
- Versioned editing, per-draft audit events, and protected XLSX downloads.
- Optional Hermes-only structured proposal generation. Hermes receives one turn and no tools; the local application creates and owns every draft.
- Explicit read-only Gmail and Airtable source checks, with loading, error, empty, and connection-readiness states.
- One Inbox for queued drafts and the locally generated task documents, newest first, with Messages / Documents / Updates filters and search.
- Draft-first reading: each item opens as the content itself. Context, versions, hashes, audit history, source task and blocker sit in a Details drawer, shown only on request.
- A rich-text Markdown editor (TipTap, pinned) for email bodies and saved Markdown documents, with a raw Markdown mode. Slack and WhatsApp use a plain editor with a formatting preview; Notion and Airtable show before/after changes; spreadsheets show tables.
- Saved documents are edited as versioned copies in the local database. The original files are never written.
- Responsive layout, accessible mobile navigation, and visible keyboard focus.
- Loopback hosting, a generated local API key, security headers, trusted-host validation, and owner-only runtime data.

Private here means local storage and no external mutation. Hermes proposals use the model provider configured in your selected Hermes profile. Draft context may go to that provider; local-only storage does not imply local-only inference.

## Inbox

Open http://127.0.0.1:8765/. The Inbox lists queued drafts (from the local database) and saved documents (from `INDEX.md`) together, newest first. Acknowledged, rejected and skipped items are hidden unless "Include reviewed and skipped" is ticked. Old `#review` and `#saved` links open the Inbox. Compose, Sources and Connections remain under Tools.

Unsaved edits are guarded: switching item or view, or leaving the page, asks before discarding them. Ctrl/Cmd+S saves.

## Saved documents

The default document root is `~/operator-drafts`; set `VO_REVIEW_DIR` in the server environment to use another private root. The interface reads only Markdown, CSV and XLSX files whose absolute paths in that root's `INDEX.md` point directly to files inside the same root. It does not expose the index itself, `.work`, arbitrary paths, or unlisted files. The directory must be owner-only (`0700`) and indexed files owner-only (`0600`).

Use the list to search or filter by local status and priority. Open an entry to see its document, source-task link, and blocker/open question. Entries with multiple files have a document selector. Markdown remains readable text rather than executable HTML. Unsafe links are not made navigable, images are not fetched automatically, and workbook formulas are displayed without evaluation or external-link loading. CSV and workbook tables are bounded previews; the download button returns the authenticated original file locally.

Ready means a usable draft was saved. It does not mean the underlying Notion task is complete, approved, sent, or submitted. Saved documents have no approval, sending or publishing controls. Selecting a document only reads it.

Markdown documents can be edited. Saving stores a new edited version in the application database (`data/operator.db`), numbered from 1; the file under `VO_REVIEW_DIR` is never modified, and Download always returns the original. Each version records the SHA-256 of the original it was based on. If another window saved a newer version, or the original file changed since it was opened, the save is refused and the editor keeps your text, with options to save it as the next version or to load the newest. Versions are append-only, so neither option deletes text. Documents containing constructs the rich editor cannot represent exactly (raw HTML, images, link reference definitions, table alignment) open in Markdown mode so nothing is silently dropped. CSV and XLSX files are read-only previews.

## Install

Verified on this host with Python 3.14.9, Node.js 26.12.1, and npm 12.0.2. Run commands from the project root.

    python3 -m venv .venv
    .venv/bin/python -m pip install --requirement requirements.txt
    cd frontend
    npm ci
    npm run build
    cd ..

Hermes CLI must be installed and configured separately. Do not copy provider credentials or broad-service OAuth tokens into this project. Keep them in the appropriate owner-only Hermes profile. The existing Google read adapters use the scripts and tokens under the selected Hermes home.

## Start

    ./start.sh

Open http://127.0.0.1:8765/ in your own browser and enter the local access key from `data/api.key`. Stop the foreground server with Ctrl-C. Re-run the script after a host or terminal restart; no system service, public deployment, TLS, or multi-user login is configured by this project.
The default bind address is 127.0.0.1. Do not expose the app to a LAN or the internet using the current local-key design.

To reach a remote server from your own host, keep this binding and use a local SSH forward. Replace `USER@VPS` only with the SSH destination you already control:

    ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8765:127.0.0.1:8765 USER@VPS

Keep that SSH connection open and open http://127.0.0.1:8765/ on your host. Do not put an API key in an SSH command or URL.

The first run generates `data/api.key` unless `VO_API_KEY` is supplied. The browser asks you to enter that key and holds it only in page memory for authenticated requests. It is not served through runtime JavaScript, exposed as a frontend global, put in the URL, or persisted in cookies or browser storage; reloading asks for it again. The key grants local application access, not access to Google, Notion, or any model provider.

## Work safely

1. Use Compose to create one of the six draft types, or select Generate with agent.
2. For agent proposals, supply the facts and exact destination in the form. Never ask the agent to send or publish; that is outside its permitted tools and outside this application’s phase boundary.
3. Review and edit the draft in the Inbox. Saving creates a new version and an audit event; Details shows the context, versions and audit history.
4. Download spreadsheet artifacts only locally, as XLSX.
5. Acknowledge locally when reviewed, or reject with confirmation. Neither action delivers the draft.
6. Use Sources to inspect Gmail or Airtable only when that read is intentional. Native Gmail and Google Sheets targets remain unavailable; do not interpret a local draft or local acknowledgement as a successful external action.

See OPERATIONS.md for configuration, source credentials, tests, backup/recovery, and the approved process for any future permission expansion.

## Verify

    .venv/bin/python -m pytest tests/ -q
    cd frontend
    npm test -- --run
    npm run build
    cd ..

Browser QA uses a fixture-managed ephemeral loopback port, an isolated temporary store, and synthetic review documents. The complete suite also includes intentional private-source reads and a real model request, so run it only when those are appropriate:

    .venv/bin/python -m playwright install chromium --only-shell
    .venv/bin/python -m pytest qa/ -q

To exercise only the eight application journeys without private-source reads or the real model request:

    .venv/bin/python -m pytest qa/test_browser_rendering.py qa/test_browser_journeys.py \
      qa/test_saved_drafts_browser.py -q -k 'not real_hermes and not source_adapters'

The agent browser journey uses reserved example.com/example.net destinations and synthetic facts. API failure tests are isolated too; read-only Gmail/Airtable results are not copied into screenshots. See OPERATIONS.md for Chromium dependencies, optional executable overrides, and verification records.
