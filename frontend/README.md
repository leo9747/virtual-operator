# Virtual Operator frontend

Private React console for preparing and reviewing drafts. It intentionally has no send or publish controls.

## Run

```sh
npm install
npm run dev
npm run build
npm test
```

The app uses same-origin `/api`. Vite development proxies `/api` to `http://127.0.0.1:8000`; change `vite.config.ts` if the local backend uses another address. In production, serve the built `dist/` directory behind the same origin as the API.

## API key

The access-key screen validates the local key before mounting any private views. Every API request, including artifact downloads, sends that key as `X-VO-Key`. It is held in a module-scoped variable only for the current page; no runtime bootstrap script, browser global, URL parameter, cookie, or persistent browser storage contains the key. Reloading requires entering it again. No credential is included in source control.

## Component and API assumptions

- `InboxView` merges `/api/drafts` and `/api/saved-drafts` into one list sorted newest first (`created_at` / `modifiedAt`). Either source can fail without hiding the other. Draft lists may be an array or `{ drafts: [...] }` / `{ items: [...] }`; `contentHash` and `nativeTarget` are accepted as alternatives to snake case.
- `DraftReader` shows the draft itself and edits `payload` in place and `title` and `context` in the Details drawer. Untouched payload fields are sent back unchanged. Inputs and decisions become read-only for acknowledged, rejected, completed, sent, published, or approved statuses, and for drafts with a native target; backend validation is still authoritative.
- `DocumentReader` reads saved files and saves Markdown edits as versions through `/api/saved-drafts/{name}/versions`, sending the base version and original SHA-256 so stale saves are refused.
- `MarkdownEditor` (TipTap, `@tiptap/*` 3.32.2 and `marked` 17.0.6, pinned exactly) round-trips Markdown. `analyzeMarkdown` in `src/markdown.ts` decides whether a document can be edited as rich text without loss; otherwise it opens in Markdown mode. Edits typed while a save is in flight stay marked as unsaved.
- `DetailsDrawer` holds context, versions, hashes, audit events, source task and blocker. Audit events are read from `audit_events`, `audit`, or `events`. Missing values are shown as not recorded rather than replaced with sample data.
- Acknowledge and reject update local review state only. The UI never treats them as sending, publishing, or native delivery.
- Compose maps all six kinds to the requested payload shapes. CSV parsing supports quoted separators, escaped quotes, CRLF, and multiline cells. Agent submissions use `/api/agent/proposals`; failures preserve every form entry.
- Gmail and Google Sheets choices record native-target intent only. The interface explicitly states that native integrations are unavailable until the required scopes are added.
- Downloads are fetched with the API header as blobs, converted to object URLs, and revoked after use.
- Gmail source responses accept an array or `{ messages: [...] }` / `{ items: [...] }`. Airtable and connection/capability responses are rendered recursively as returned, without inventing missing readiness state.

## Interface

Desktop pairs the Inbox list with a reading pane; the Details drawer slides over from the right. Below 920px the list and reader alternate, and below 760px the primary navigation becomes a bottom bar. Controls have visible keyboard focus, 44px touch targets on touch layouts, semantic labels, live status regions, and reduced-motion handling. Fonts and all assets are bundled locally; there are no external CDNs. The editor is built into its own cacheable chunk.
