# persona-composer

Compose social-media posts (X/Twitter, later Instagram) in the voice of
different AI **personas**. You paste a post, pick a persona, and the LLM drafts a
reply in that voice — streamed live, editable, one click to copy.

Personas are [SillyTavern](https://github.com/SillyTavern/SillyTavern) character
cards, and the LLM is anything that speaks the OpenAI-compatible
`/chat/completions` protocol (OpenAI, Ollama, koboldcpp, text-generation-webui,
or an Anthropic-compatible proxy). The tool ships as a **SillyTavern
server-plugin**, and also runs **standalone** for development.

> **Phase 1 is this repo.** It uses **no** social-platform API and carries **no**
> account risk: nothing is read from or posted to any platform — you copy and
> paste. See [docs/PLAN.md](docs/PLAN.md) for the full phased plan and the
> account-safety note about later phases.

---

## What it is

- **`POST /compose`** → `{ personaId, platform, sourcePost?, extraInstruction? }`
  assembles a prompt from the persona's voice + platform constraints (char
  limit, tone, hashtag/emoji policy) + the source post (if any) + a task
  instruction, calls the LLM, and **streams** the draft back. No `sourcePost`?
  It composes a standalone post in that persona's voice.
- **`GET /personas`** → the list of available personas.
- A **one-page UI** to drive it.

### Architecture (the short version)

SillyTavern is the persona + LLM backbone; this repo is a thin layer on top.
Personas are character cards (`personas/*.json`); the tool's platform/style
config lives in each card's `extensions.persona_composer` block. Prompt assembly,
the persona loader, and the OpenAI-compatible streaming client are small, isolated
modules so Phase 2 (a browser extension) can reuse them. Full rationale in
[docs/PLAN.md](docs/PLAN.md).

```
src/
  types.ts            shared types
  config.ts           env-driven LLM + path config
  personas.ts         load V2/V3 character cards from personas/
  promptAssembly.ts   persona + platform rules + source + task → chat messages
  llm.ts              OpenAI-compatible streaming client
  routes.ts           /compose, /personas, /reload, /healthz + static UI
  plugin.ts           SillyTavern server-plugin entry (init/info/exit)
  server.ts           standalone dev server (same routes, mounted at /)
personas/             example cards: ada, sol, glitch
public/               the one-page UI (index.html, app.js, styles.css)
docs/PLAN.md          phased plan + account-safety note
```

---

## Configure the LLM

Copy `.env.example` to `.env` and set three variables:

```sh
cp .env.example .env
```

| Variable        | What                                   | Example                      |
| --------------- | -------------------------------------- | ---------------------------- |
| `LLM_BASE_URL`  | OpenAI-compatible base URL             | `https://api.openai.com/v1`  |
| `LLM_API_KEY`   | API key (blank for most local servers) | `sk-…`                       |
| `LLM_MODEL`     | model name as the endpoint expects     | `gpt-4o-mini`, `llama3.1`    |

Local backends just need their base URL — e.g. Ollama at
`http://127.0.0.1:11434/v1` with `LLM_API_KEY` blank. Optional knobs
(`LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`) are documented in
`.env.example`.

> When running **inside SillyTavern**, set these in the environment that launches
> ST — the plugin reads `process.env` at request time.

---

## Run it — standalone (fastest path)

No SillyTavern needed; the dev server exposes the identical routes at the root.

```sh
npm install
npm run build          # tsc → dist/
LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini npm start
# → http://127.0.0.1:5859/
```

Or, if you keep your config in `.env`, load it for the process:

```sh
node --env-file=.env dist/server.js     # Node 20+ supports --env-file
# (or: set -a; source .env; set +a; npm start)
```

Open <http://127.0.0.1:5859/>, pick a persona, paste a post (or leave it blank),
hit **Compose**, edit the draft, **Copy**.

Quick endpoint smoke test:

```sh
curl http://127.0.0.1:5859/personas
curl -N -X POST http://127.0.0.1:5859/compose \
  -H 'Content-Type: application/json' \
  -d '{"personaId":"ada","platform":"x","sourcePost":"hot take: tabs > spaces"}'
```

---

## Run it — as a SillyTavern server-plugin

1. **Enable server plugins** in SillyTavern's `config.yaml`:

   ```yaml
   enableServerPlugins: true
   ```

2. **Build and install** the plugin into ST's `plugins/` directory. The plugin
   needs the compiled `dist/`, the `personas/`, and `public/` dirs together.
   From this repo:

   ```sh
   npm install && npm run build
   ST=/path/to/SillyTavern
   mkdir -p "$ST/plugins/persona-composer"
   cp -r dist personas public package.json "$ST/plugins/persona-composer/"
   ```

   (A symlink works too: `ln -s "$PWD" "$ST/plugins/persona-composer"`.)
   ST requires `dist/plugin.js` (the package `main`) and mounts its router at
   `/api/plugins/persona-composer`.

3. **Set the LLM env vars** in the shell/service that starts SillyTavern, then
   start ST.

4. Open the UI at
   **`http://<your-ST-host>/api/plugins/persona-composer/`**. The endpoints live
   at `…/personas` and `…/compose` under the same path (the UI uses relative
   URLs, so it just works under the plugin mount).

> Want ST itself to broker the model instead of these env vars? Point
> `LLM_BASE_URL` at ST's own OpenAI-compatible endpoint. The default path keeps
> the gateway independent so it also works standalone.

---

## Personas

Drop SillyTavern V2/V3 character cards (`.json`) into `personas/`. The file name
becomes the persona `id`. Per-platform behavior goes in the card's
`extensions.persona_composer` block:

```jsonc
"extensions": {
  "persona_composer": {
    "platforms": {
      "x":         { "charLimit": 280,  "tone": "terse, lowercase",
                     "hashtagPolicy": "none", "emojiPolicy": "none" },
      "instagram": { "charLimit": 2200, "tone": "warmer, a caption that breathes",
                     "hashtagPolicy": "liberal", "emojiPolicy": "a few, on-theme" }
    },
    "styleNotes": "No buzzwords. Prefer concrete nouns."
  }
}
```

Everything in that block is optional; sensible per-platform defaults fill the
gaps. `hashtagPolicy` is `none | sparing | liberal`. Hot-reload cards without a
restart via `POST /reload`. See `personas/ada.json` for a full example.

---

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm run watch       # tsc --watch
npm run dev         # build + start standalone
```

---

## Browser extension (Phases 2–3)

A thin Manifest V3 extension adds a 🎭 button to posts on **x.com** and
**instagram.com**; it extracts the post and drafts a persona-voiced reply by
calling the **same** local endpoints — no server changes. Site-specific DOM code
lives behind a small adapter interface (`extension/src/sites/`). Features:
single-post compose, **feed triage** (scan posts, step through or *Draft all*),
and an **opt-in, default-off** "Post for me" button. By default it only drafts;
you still hit Post. Build with `npm run build:ext` and load `extension/dist`
unpacked. Full instructions and the account-safety note in
[extension/README.md](extension/README.md).

> ⚠️ Phases 2–3 read the page DOM (against the *letter* of X/IG terms); auto-post
> (off by default) submits on your behalf (real account risk). Phase 1 (above)
> stays clean. See [docs/PLAN.md](docs/PLAN.md).

## Contributing

Changes flow through a lightweight branch → PR → squash-merge cadence. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Cycle Five.
