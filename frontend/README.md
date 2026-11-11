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

- `ReviewView` accepts a draft list as an array or as `{ drafts: [...] }` / `{ items: [...] }`. A detail response may be the draft directly or `{ draft: {...} }`. Draft fields follow the supplied contract; `contentHash` and `nativeTarget` are accepted as alternatives to snake case.
- The inspector edits `title`, `context`, `payload`, and `native_target`. Inputs and review decisions become read-only for acknowledged, rejected, completed, sent, published, or approved statuses. Other statuses remain editable; backend validation is still authoritative.
- Audit events are read from `audit_events`, `audit`, or `events`. Missing versions, hashes, events, and capabilities are shown as unreported rather than replaced with sample data.
- Acknowledge and reject update local review state only. The UI never treats them as sending, publishing, or native delivery.
- Compose maps all six kinds to the requested payload shapes. CSV parsing supports quoted separators, escaped quotes, CRLF, and multiline cells. Agent submissions use `/api/agent/proposals`; failures preserve every form entry.
- Gmail and Google Sheets choices record native-target intent only. The interface explicitly states that native integrations are unavailable until the required scopes are added.
- Spreadsheet artifacts are fetched with the API header as blobs, converted to object URLs, and offered as XLSX downloads. Object URLs are revoked on replacement or unmount.
- Gmail source responses accept an array or `{ messages: [...] }` / `{ items: [...] }`. Airtable and connection/capability responses are rendered recursively as returned, without inventing missing readiness state.

## Interface

The desktop Operate layout pairs a queue with a Command/Inspect pane. Narrow screens switch between queue and detail, and the primary navigation becomes a bottom bar below 760px. Controls have visible keyboard focus, 44px touch targets on mobile, semantic labels, live status regions, and reduced-motion handling. Fonts and all other assets are local system resources; there are no external CDNs or component libraries.
