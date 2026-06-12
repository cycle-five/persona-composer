# persona-composer — browser extension (Phases 2–3)

A thin Manifest V3 extension for Chromium browsers. It adds a 🎭 button to posts
on **x.com** / **twitter.com** and **instagram.com**; clicking it extracts that
post and opens a panel that streams a persona-voiced reply from your **local
persona-composer endpoints** (the same `/personas` and `/compose` the Phase 1
server/plugin exposes). You pick a persona, it drafts, you **Copy** or **Insert**
into the reply/comment box and hit Post yourself.

> ⚠️ **Account-safety note.** Reading the page DOM is against the *letter* of
> X's and Instagram's terms of service. By default this extension is local-only
> and **never posts for you** — it only drafts. The opt-in "Post for me" button
> (off by default) submits on your behalf, which carries real account risk. See
> [../docs/PLAN.md](../docs/PLAN.md).

## How it fits together

```
content script ──(message: personas)──▶ background worker ──HTTP──▶ persona-composer
 (x / instagram) ◀─(port: compose SSE)──   (host_permissions)        /personas, /compose
```

All network I/O happens in the **background service worker**, which runs with
the extension's `host_permissions` — so reaching `http://127.0.0.1` is free of
the page's CORS / mixed-content restrictions. The server needs **no** changes
and is reused untouched; prompt assembly stays entirely server-side.

- `src/sites/` — all site-specific DOM coupling, behind a `SiteAdapter` interface
  (`x.ts`, `instagram.ts`, `index.ts` picks by host). Add a site = add one
  adapter. **This is the only place to patch when X or IG reshuffles its DOM.**
- `src/content.ts` — site-agnostic: button injection, the shadow-DOM panel, feed
  triage, and the opt-in auto-post.
- `src/background.ts` — fetches personas; streams `/compose` SSE over a port.
- `src/popup.ts` — settings: endpoint base URL (with a Test) and the auto-post
  toggle.

## Build & load

From the repo root:

```sh
npm install
npm run build:ext          # → extension/dist/   (or: npm run watch:ext)
```

Then in your browser:

1. Run a persona-composer endpoint (Phase 1 standalone server or the
   SillyTavern plugin) — e.g. `npm start` → `http://127.0.0.1:5859`.
2. Open `chrome://extensions` (or `brave://extensions`).
3. Toggle **Developer mode** on.
4. **Load unpacked** → select `extension/dist`.
5. Click the toolbar icon → set the **Endpoint base URL** if it isn't the
   default `http://127.0.0.1:5859`, **Save**, then **Test**.

> Pointing at a non-localhost endpoint? Add its origin to `host_permissions` in
> `manifest.json` and rebuild — the defaults only cover `127.0.0.1` / `localhost`.

## Use

### Single post
1. On x.com or instagram.com, each post gets a 🎭 button.
2. Click it → the panel opens with that post as the source. The platform
   defaults to the site you're on.
3. Pick a persona, optionally add a direction, hit **Compose**. The draft
   streams in and is editable.
4. **Copy**, or **Insert** to drop it into an open reply/comment box. You Post.

### Feed triage (Phase 3)
- Click **⊞ feed** in the panel header to scan every post currently in view.
- Step through them with ◀ / ▶ and compose a reply for each, **or**
- Hit **Draft all** to draft a reply for every scanned post sequentially; the
  results collect into the draft box (separated by author) for one **Copy**.

### Auto-post (Phase 3 — opt-in, default OFF)
- In the popup, tick **Enable "Post for me" button**. It's off by default.
- When on, the panel shows a red **Post for me** button. It inserts the draft
  into the site's composer, asks you to **confirm**, then clicks the site's own
  post button.
- ⚠️ This submits on your behalf, which is squarely against X/IG terms and
  carries real account risk. Leave it off unless you understand the trade-off.

## Selector smoke test

Site DOMs drift; this is the fast way to check whether the adapters still work
**without** loading the extension. It's built from the real adapters, so a pass
means the extension's extraction works on the current DOM.

1. `npm run build:ext` (produces `extension/dist/smoke.js`).
2. Open x.com or instagram.com, scroll a few posts into view.
3. Open the devtools console, paste the entire contents of
   `extension/dist/smoke.js`, and run it.

It prints how many posts it found and extracted, a sample table
(handle / author / text / url / mount point), and a healthy/needs-attention
verdict. Re-run anytime with `__pcSmoke()`. To also test dropping text into an
**open** reply/comment box, run `__pcSmoke({ testInsert: true })` (it inserts a
marker you then clear).

If the verdict is ✗, patch the selectors in `src/sites/<site>.ts` and rebuild.

## Manual test checklist

The bundles are typechecked, the host→adapter routing is unit-tested, and the
smoke test exercises real extraction, but live insertion/submit can only be
checked in-browser:

- [ ] Popup **Test** reports `✓ reachable — N persona(s)`.
- [ ] 🎭 buttons appear on tweets and IG posts, including ones loaded by scrolling.
- [ ] Clicking 🎭 fills "Replying to" with the right author + text.
- [ ] Compose streams a draft; the char counter turns red past the limit.
- [ ] **⊞ feed** scans posts; ◀ / ▶ navigate; **Draft all** drafts each.
- [ ] Copy works; Insert drops text into an open reply/comment composer.
- [ ] With auto-post **on**: Post for me inserts, confirms, and submits.

If extraction breaks after a site redesign, the fix is in `src/sites/<site>.ts`
(the selectors). Instagram's markup is especially volatile — its adapter is
best-effort and degrades gracefully (you can still compose standalone posts).
