# persona-composer

Compose social-media posts (X/Twitter, Instagram) in the voice of different AI
**personas**. You paste a post, pick a persona, and the LLM drafts a reply in
that voice — streamed live, editable, one click to copy.

Personas are **SillyTavern-compatible character cards** — a portable JSON schema,
so you can author them anywhere (including SillyTavern itself) and drop them in
`personas/`. The LLM is anything that speaks the OpenAI-compatible
`/chat/completions` protocol: OpenAI, Ollama, koboldcpp, text-generation-webui,
an Anthropic-compatible proxy, or an aggregator like
[LiteLLM](https://github.com/BerriAI/litellm) / [OpenRouter](https://openrouter.ai)
for one endpoint in front of everything. persona-composer itself is a small local
HTTP service.

> **Phase 1 is the core.** It uses **no** social-platform API and carries **no**
> account risk: nothing is read from or posted to any platform — you copy and
> paste. The optional [browser extension](extension/README.md) (Phases 2–3) adds
> DOM-based convenience with documented trade-offs. See [docs/PLAN.md](docs/PLAN.md).

---

## What it is

- **`POST /compose`** → `{ personaId, platform, sourcePost?, extraInstruction? }`
  assembles a prompt from the persona's voice + platform constraints (char
  limit, tone, hashtag/emoji policy) + the source post (if any) + a task
  instruction, calls the LLM, and **streams** the draft back. No `sourcePost`?
  It composes a standalone post in that persona's voice.
- **`GET /personas`** → the list of available personas.
- A **one-page UI** to drive it.

### Architecture

A small TypeScript HTTP service: it loads persona character cards from
`personas/`, assembles a prompt (persona voice + platform rules + source post +
task), and streams a draft from your configured LLM. Prompt assembly, the
persona loader, and the OpenAI-compatible streaming client are small, isolated
modules; the browser extension reuses the same `/personas` and `/compose`
endpoints. Full rationale in [docs/PLAN.md](docs/PLAN.md).

> **On SillyTavern:** the persona format *is* SillyTavern's character-card schema
> (V2/V3), so cards interoperate with that ecosystem — but persona-composer does
> **not** require or run inside SillyTavern. It's a standalone service with its
> own LLM gateway. (Earlier iterations ran as an ST server-plugin; that was
> dropped — it added nothing the gateway doesn't already do, and the card format
> is the only part worth keeping.)

```
src/
  types.ts            shared types
  config.ts           env-driven LLM + path config
  personas.ts         load V2/V3 character cards from personas/
  promptAssembly.ts   persona + platform rules + source + task → chat messages
  llm.ts              OpenAI-compatible streaming client
  routes.ts           /compose, /personas, /reload, /healthz + static UI
  server.ts           HTTP server entry (binds 127.0.0.1)
personas/             example cards: ada, sol, glitch
public/               the one-page UI (index.html, app.js, styles.css)
extension/            optional MV3 browser extension (Phases 2–3)
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
`http://127.0.0.1:11434/v1` with `LLM_API_KEY` blank. To reach providers that
aren't OpenAI-compatible, point `LLM_BASE_URL` at a LiteLLM or OpenRouter proxy.
Optional knobs (`LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`) are
documented in `.env.example`.

**AWS Bedrock** works with no proxy — it has a native OpenAI-compatible endpoint
with bearer-token auth. Set `LLM_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/v1`,
`LLM_API_KEY` to an [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html),
and `LLM_MODEL` to your model id/inference profile (e.g. `us.anthropic.claude-sonnet-4-6`).
See `.env.example` for details.

---

## Run it

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
hit **Compose**, edit the draft, **Copy**. The server binds to `127.0.0.1`, so
it's reachable only from your machine.

Quick endpoint smoke test:

```sh
curl http://127.0.0.1:5859/personas
curl -N -X POST http://127.0.0.1:5859/compose \
  -H 'Content-Type: application/json' \
  -d '{"personaId":"ada","platform":"x","sourcePost":"hot take: tabs > spaces"}'
```

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

Your own persona cards stay local: `personas/` is gitignored except the shipped
example cards, so you can drop real personas in without committing them to this
public repo.

---

## Browser extension (Phases 2–3)

An optional Manifest V3 extension adds a 🎭 button to posts on **x.com** and
**instagram.com**; it extracts the post and drafts a persona-voiced reply by
calling this service's endpoints. Features: single-post compose, **feed triage**
(scan posts, step through or *Draft all*), and an **opt-in, default-off** "Post
for me" button. By default it only drafts; you still hit Post. Build with
`npm run build:ext` and load `extension/dist` unpacked. Full instructions and the
account-safety note in [extension/README.md](extension/README.md).

> ⚠️ Phases 2–3 read the page DOM (against the *letter* of X/IG terms); auto-post
> (off by default) submits on your behalf (real account risk). Phase 1 (above)
> stays clean. See [docs/PLAN.md](docs/PLAN.md).

---

## Develop

```sh
npm run typecheck   # tsc --noEmit (server + extension)
npm run watch       # tsc --watch
npm run dev         # build + start
```

## Contributing

Changes flow through a lightweight branch → PR → squash-merge cadence. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Cycle Five.
