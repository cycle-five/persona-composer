import express from "express";
import type { Request, Response, Router } from "express";
import path from "node:path";
import { getLLMConfig, getPersonasDir } from "./config";
import { loadPersonas, summarize } from "./personas";
import { assemblePrompt } from "./promptAssembly";
import { streamChatCompletion, LLMError } from "./llm";
import type { ComposeRequest, Persona, Platform } from "./types";

const VALID_PLATFORMS: Platform[] = ["x", "instagram"];

interface Store {
  personas: Map<string, Persona>;
  dir: string;
}

async function buildStore(): Promise<Store> {
  const dir = getPersonasDir();
  const personas = await loadPersonas(dir);
  console.log(
    `[persona-composer] loaded ${personas.size} persona(s) from ${dir}`,
  );
  return { personas, dir };
}

/** Register the persona-composer routes and static UI onto `router`.
 *  Shared by the SillyTavern plugin and the standalone dev server. */
export async function registerRoutes(router: Router): Promise<void> {
  const store = await buildStore();

  router.use(express.json({ limit: "256kb" }));

  router.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, personas: store.personas.size });
  });

  // Reload cards from disk without restarting the host process.
  router.post("/reload", async (_req: Request, res: Response) => {
    store.personas = await loadPersonas(store.dir);
    res.json({ ok: true, personas: store.personas.size });
  });

  router.get("/personas", (_req: Request, res: Response) => {
    const list = [...store.personas.values()]
      .map(summarize)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ personas: list });
  });

  router.post("/compose", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<ComposeRequest>;
    const { personaId, platform } = body;

    if (!personaId || typeof personaId !== "string") {
      res.status(400).json({ error: "personaId is required" });
      return;
    }
    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      res
        .status(400)
        .json({ error: `platform must be one of ${VALID_PLATFORMS.join(", ")}` });
      return;
    }
    const persona = store.personas.get(personaId);
    if (!persona) {
      res.status(404).json({ error: `unknown persona "${personaId}"` });
      return;
    }

    const { messages, meta } = assemblePrompt({
      card: persona.card,
      platform,
      sourcePost: typeof body.sourcePost === "string" ? body.sourcePost : undefined,
      extraInstruction:
        typeof body.extraInstruction === "string" ? body.extraInstruction : undefined,
    });

    // If the client hangs up (closes the panel/tab) abort the upstream LLM
    // stream rather than driving it to completion for output nobody will read.
    // Note: listen on `res`, not `req` — in modern Node `req`'s "close" fires
    // when the request *body* finishes being read, not on disconnect. `res`'s
    // "close" fires on disconnect; guard with writableEnded so our own res.end()
    // (normal completion) doesn't look like a hang-up.
    const llmAbort = new AbortController();
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        llmAbort.abort();
      }
    });

    // Server-Sent Events stream back to the browser.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      if (clientGone || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("meta", meta);

    try {
      for await (const delta of streamChatCompletion(
        messages,
        getLLMConfig(),
        llmAbort.signal,
      )) {
        send("delta", { text: delta });
      }
      send("done", { ok: true });
    } catch (err) {
      if (!clientGone) {
        const message =
          err instanceof LLMError ? err.message : (err as Error).message;
        console.error("[persona-composer] compose failed:", message);
        send("error", { message });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // Serve the one-page UI from the same mount, so its relative fetches resolve
  // correctly whether mounted at "/" (standalone) or under ST's plugin path.
  const publicDir = path.resolve(__dirname, "..", "public");
  router.use(express.static(publicDir));
}
