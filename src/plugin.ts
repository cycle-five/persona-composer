import type { Router } from "express";
import { registerRoutes } from "./routes";

/**
 * SillyTavern server-plugin entry point.
 *
 * SillyTavern loads server plugins (when `enableServerPlugins: true` in its
 * config.yaml) by requiring this module and calling `init(router)` with an
 * Express Router that it mounts at `/api/plugins/<info.id>`. Plugins run
 * unsandboxed in ST's Node process, so this has full access to process.env for
 * LLM configuration.
 *
 * Resulting endpoints (with the id below):
 *   GET  /api/plugins/persona-composer/personas
 *   POST /api/plugins/persona-composer/compose
 *   GET  /api/plugins/persona-composer/            (the web UI)
 */

export const info = {
  id: "persona-composer",
  name: "Persona Composer",
  description:
    "Compose X/Instagram posts in the voice of your character cards via any OpenAI-compatible LLM.",
};

export async function init(router: Router): Promise<void> {
  await registerRoutes(router);
  console.log(
    `[persona-composer] plugin initialized — UI at /api/plugins/${info.id}/`,
  );
}

export async function exit(): Promise<void> {
  console.log("[persona-composer] plugin exiting");
}

// SillyTavern's loader reads the CommonJS default export shape.
export default { info, init, exit };
