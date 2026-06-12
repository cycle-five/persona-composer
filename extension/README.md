# persona-composer — browser extension (Phase 2)

A thin Manifest V3 extension for Chromium browsers. It adds a 🎭 button to each
tweet on **x.com** / **twitter.com**; clicking it extracts that post and opens a
panel that streams a persona-voiced reply from your **local persona-composer
endpoints** (the same `/personas` and `/compose` the Phase 1 server/plugin
exposes). You pick a persona, it drafts, you **Copy** or **Insert** into the
reply box and hit Post yourself.

> ⚠️ **Account-safety note.** Reading the X page DOM is against the *letter* of
> X's terms of service. This extension is local-only and **never posts for you** —
> it only drafts. Understand the trade-off before using it. See
> [../docs/PLAN.md](../docs/PLAN.md).

## How it fits together

```
content script ──(message: personas)──▶ background worker ──HTTP──▶ persona-composer
   (x.com DOM)  ◀─(port: compose SSE)──   (host_permissions)        /personas, /compose
```

All network I/O happens in the **background service worker**, which runs with
the extension's `host_permissions` — so reaching `http://127.0.0.1` is free of
the page's CORS / mixed-content restrictions. The server needs **no** changes
and is reused untouched; prompt assembly stays entirely server-side.

- `src/extract.ts` — the only X-DOM-coupled code (selectors, reply insertion).
- `src/content.ts` — button injection + the shadow-DOM panel.
- `src/background.ts` — fetches personas; streams `/compose` SSE over a port.
- `src/popup.ts` — settings: the endpoint base URL, with a Test button.

## Build & load

From the repo root:

```sh
npm install
npm run build:ext          # → extension/dist/   (or: npm run watch:ext)
```

Then in your browser:

1. Make sure a persona-composer endpoint is running (Phase 1 standalone server
   or the SillyTavern plugin) — e.g. `npm start` → `http://127.0.0.1:5859`.
2. Open `chrome://extensions` (or `brave://extensions`).
3. Toggle **Developer mode** on.
4. **Load unpacked** → select `extension/dist`.
5. Click the extension's toolbar icon → set the **Endpoint base URL** if it
   isn't the default `http://127.0.0.1:5859`, hit **Save**, then **Test** to
   confirm it reaches your personas.

> Pointing at a non-localhost endpoint? Add its origin to `host_permissions` in
> `manifest.json` and rebuild — the defaults only cover `127.0.0.1` / `localhost`.

## Use

1. Go to x.com. Each tweet's action bar gets a 🎭 button.
2. Click it → the panel opens with that tweet as the source.
3. Pick a persona + platform, optionally add a direction, hit **Compose**. The
   draft streams in and is editable.
4. **Copy**, or **Insert** to drop it into an open reply box. You hit Post.

## Manual test checklist

The bundles are syntax-checked and typechecked in CI/build, but the X-DOM
coupling can only be exercised live:

- [ ] Popup **Test** reports `✓ reachable — N persona(s)`.
- [ ] 🎭 buttons appear on tweets, including ones loaded by scrolling.
- [ ] Clicking 🎭 fills "Replying to" with the right author + text.
- [ ] Compose streams a draft; the char counter turns red past the limit.
- [ ] Copy works; Insert drops text into an open reply composer.

If X changes its DOM and buttons stop appearing or extraction breaks, the fix is
almost always in `src/extract.ts` (the `data-testid` selectors).
