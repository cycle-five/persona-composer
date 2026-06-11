# persona-composer — phased plan

A tool to compose social-media posts (X/Twitter, later Instagram) in the voice
of different AI **personas**. The architecture leans on **SillyTavern (ST)** as
the persona + LLM backbone, with a thin tool layer on top.

The phasing is deliberately ordered by **ToS / account risk**, lowest first.

---

## Architecture: why SillyTavern as the backbone

SillyTavern already solves the parts of this problem that are tedious to rebuild:

- **Personas as portable artifacts** — the character-card (V2/V3) format is a
  well-understood JSON schema for "a voice": system prompt, personality,
  example messages, post-history instructions. We reuse it verbatim and tuck
  our platform/style config into the card's `extensions.persona_composer` block,
  so a persona stays a normal, shareable card.
- **LLM connection management** — ST already brokers OpenAI, local (Ollama /
  koboldcpp / text-gen-webui), and proxy backends. We piggyback on the same
  OpenAI-compatible `/chat/completions` denominator.
- **A server-plugin surface** — ST loads server plugins (Express routers mounted
  at `/api/plugins/<id>`) that run unsandboxed in its Node process. That is
  exactly enough to host our two endpoints and a UI, with zero new daemon.

The tool layer itself is small and lives in this repo: prompt assembly, the
persona loader, an OpenAI-compatible streaming client, the HTTP routes, and a
one-page UI. It can run **inside ST** (as a server-plugin) or **standalone**
(a localhost Express server) — same routes either way.

A Rust/axum rewrite of the gateway is a possible *later* optimization. It is
explicitly **not** in scope: Phase 1 prioritizes rapid development, so the whole
thing is TypeScript.

---

## Phase 1 — local compose, zero platform API  ✅ (this repo)

**Risk: none.** No social-platform API, no DOM scraping, no automation. The user
pastes a post, picks a persona, the LLM drafts a reply in that voice, and the
result is copied to the clipboard by hand.

Delivered:

1. **ST server-plugin** (`src/plugin.ts`) exporting `init(router)` / `info` /
   `exit`. Two endpoints (plus helpers):
   - `POST /compose` — `{ personaId, platform, sourcePost?, extraInstruction? }`
     → assembles the prompt, calls the LLM, **streams** the draft back via SSE.
     With no `sourcePost`, composes a standalone post.
   - `GET /personas` — lists available personas (`id, name, description, …`).
2. **Persona store** (`src/personas.ts`) — loads ST-compatible V2/V3 character
   cards from `personas/`. Ships three example personas (Ada, Sol, Glitch).
3. **LLM gateway** (`src/llm.ts`) — a pluggable OpenAI-compatible streaming
   client. Configured by env (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).
4. **One-page web UI** (`public/`) — paste box, persona picker, platform
   selector, Compose button that streams the draft, an editable result, and a
   Copy button. Served from the same mount as the API.
5. **Prompt-assembly module** (`src/promptAssembly.ts`) — the single source of
   truth for prompt shape (persona system prompt + platform rules + source post
   + task + post-history instructions). Isolated so Phase 2 reuses it unchanged.

A standalone dev server (`src/server.ts`) runs the identical routes without ST.

---

## Phase 2 — thin MV3 browser extension  (next)

**Risk: against the letter of X/IG terms** (reading page DOM). Local-only, no
auto-posting yet.

- A Manifest V3 browser extension with a content script that extracts the post
  the user is looking at (author, text) from the X DOM.
- A small popup / inline button: "compose reply with persona X".
- The extension calls the **same** `127.0.0.1` plugin endpoints from Phase 1 and
  drops the streamed draft into the reply box (the user still hits Post).
- Reuses `promptAssembly` and the gateway untouched — the extension only adds a
  DOM-extraction front-end.

---

## Phase 3 — feed view, Instagram, optional auto-post

**Risk: highest** (automation / posting on the user's behalf is squarely against
X/IG terms; opt-in, off by default, clearly fenced).

- A feed view that pulls multiple posts for triage and batch drafting.
- Instagram support (the platform config and prompt layers already account for
  it; this is mostly DOM extraction + caption-shaped output).
- *Optional* auto-post behind an explicit, default-off switch, with loud warnings
  about account risk.

---

## Account-safety note

- **Phase 1 is clean.** It never touches a social platform — you copy/paste.
- **Phase 2+** read page DOM and (optionally, later) post for you. That is
  against the letter of X's and Instagram's terms of service and carries real
  account risk. Those phases are opt-in and clearly fenced; understand the
  trade-off before enabling them.
