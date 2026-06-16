# persona-composer — phased plan

A tool to compose social-media posts (X/Twitter, Instagram) in the voice of
different AI **personas**: a small standalone TypeScript HTTP service plus an
optional browser extension.

The phasing is deliberately ordered by **ToS / account risk**, lowest first.

---

## Architecture

A small TypeScript HTTP service owns the whole pipeline: load persona cards →
assemble a prompt → stream a draft from the configured LLM. The pieces are
isolated modules (prompt assembly, persona loader, OpenAI-compatible streaming
client, HTTP routes, one-page UI) so the browser extension can reuse the same
endpoints. A Rust/axum rewrite of the gateway is a possible *later* optimization,
explicitly **not** in scope — Phase 1 prioritizes rapid development, so it's all
TypeScript.

Two design choices that look like SillyTavern (ST) dependencies but aren't:

- **Personas are SillyTavern-compatible character cards** (V2/V3) — a
  well-understood JSON schema for "a voice" (system prompt, personality, example
  messages, post-history instructions). We keep this format for **interop**: a
  card authored in ST drops straight into `personas/`. Our per-platform style
  config lives in the card's `extensions.persona_composer` block. This is a
  format choice, not a runtime dependency — we parse the JSON ourselves.
- **An OpenAI-compatible LLM gateway** (`src/llm.ts`) talks `/chat/completions`
  to OpenAI, Ollama, koboldcpp, text-generation-webui, an Anthropic-compatible
  proxy, or an aggregator (LiteLLM/OpenRouter) for one endpoint over everything.

> **Why not SillyTavern as a backbone?** An earlier iteration ran as an ST
> *server-plugin*. In practice it leveraged nothing from ST: we parse cards
> ourselves and we own the LLM gateway, so the plugin was just an Express router
> in ST's process (and a source of CSRF friction). ST's provider-connection
> management lives in its *frontend/session*, reachable only from a *UI*
> extension — a heavier path that would couple us to ST's browser app — not from
> a server plugin. Since the OpenAI-compatible gateway already gives us
> any-provider support, the ST runtime was dropped. The card **format** is the
> one piece worth keeping, and it has no runtime cost.

---

## Phase 1 — local compose, zero platform API  ✅ (this repo)

**Risk: none.** No social-platform API, no DOM scraping, no automation. The user
pastes a post, picks a persona, the LLM drafts a reply in that voice, and the
result is copied to the clipboard by hand.

Delivered:

1. **HTTP service** (`src/server.ts` + `src/routes.ts`) — endpoints (plus helpers):
   - `POST /compose` — `{ personaId, platform, sourcePost?, extraInstruction? }`
     → assembles the prompt, calls the LLM, **streams** the draft back via SSE.
     With no `sourcePost`, composes a standalone post.
   - `GET /personas` — lists available personas (`id, name, description, …`).
   - Binds `127.0.0.1`; serves the UI from the same mount.
2. **Persona store** (`src/personas.ts`) — loads SillyTavern-compatible V2/V3
   character cards from `personas/`. Ships three example personas (Ada, Sol, Glitch).
3. **LLM gateway** (`src/llm.ts`) — a pluggable OpenAI-compatible streaming
   client. Configured by env (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).
4. **One-page web UI** (`public/`) — paste box, persona picker, platform
   selector, Compose button that streams the draft, an editable result, and a
   Copy button. Served from the same mount as the API.
5. **Prompt-assembly module** (`src/promptAssembly.ts`) — the single source of
   truth for prompt shape (persona system prompt + platform rules + source post
   + task + post-history instructions). Isolated so the extension reuses it.

---

## Phase 2 — thin MV3 browser extension  ✅ (`extension/`)

**Risk: against the letter of X/IG terms** (reading page DOM). Local-only, no
auto-posting yet.

Delivered (see [../extension/README.md](../extension/README.md)):

- A Manifest V3 extension whose content script injects a 🎭 button on every tweet
  and extracts the post (author, handle, text, permalink) from the X DOM (the
  X-coupled selectors, later moved into `extension/src/sites/x.ts` in Phase 3).
- A shadow-DOM panel (persona picker, platform, source preview, streamed +
  editable draft, char counter, **Copy** / **Insert**). Nothing is auto-posted.
- A settings popup for the endpoint base URL with a connection **Test**.
- All network I/O runs in the background service worker under `host_permissions`,
  calling the **same** `/personas` and `/compose` endpoints from Phase 1 — the
  server is reused **untouched**, prompt assembly stays server-side, so the
  whole gateway and `promptAssembly` are shared verbatim.
- Built with esbuild (`npm run build:ext` → `extension/dist/`, loaded unpacked).

---

## Phase 3 — feed view, Instagram, optional auto-post  ✅ (`extension/`)

**Risk: highest** (automation / posting on the user's behalf is squarely against
X/IG terms; opt-in, off by default, clearly fenced).

Delivered:

- **Site-adapter refactor** — all site-specific DOM coupling now lives behind a
  `SiteAdapter` interface (`extension/src/sites/`, one file per site, picked by
  host). The content script is site-agnostic.
- **Instagram support** — an IG adapter (`sites/instagram.ts`) extracts caption +
  author and inserts into the comment box (React-controlled, via the native
  value setter). The manifest now matches instagram.com. IG markup is volatile,
  so the adapter is best-effort and degrades gracefully. The platform/prompt
  layers already accounted for Instagram, so no server changes were needed.
- **Feed triage** — a **⊞ feed** scan collects every post in view; step through
  with ◀ / ▶ to compose per post, or **Draft all** to draft every post
  sequentially into one copyable block.
- **Optional auto-post** — an opt-in, **default-off** setting reveals a fenced
  "Post for me" button that inserts the draft, requires a confirm, then clicks
  the site's own post control. Loud warnings about account risk throughout.

---

## Account-safety note

- **Phase 1 is clean.** It never touches a social platform — you copy/paste.
- **Phase 2+** read page DOM and (optionally, later) post for you. That is
  against the letter of X's and Instagram's terms of service and carries real
  account risk. Those phases are opt-in and clearly fenced; understand the
  trade-off before enabling them.
