import path from "node:path";

/** Resolved LLM gateway configuration, read from the environment. */
export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Read LLM config fresh from process.env. Read per-request rather than cached
 *  so the operator can change env (e.g. swap models) without a restart. */
export function getLLMConfig(): LLMConfig {
  const baseUrl = (
    process.env.LLM_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    temperature: num(process.env.LLM_TEMPERATURE),
    maxTokens: num(process.env.LLM_MAX_TOKENS),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS) ?? 60_000,
  };
}

/** Directory to load persona cards from. Defaults to the `personas/` dir that
 *  ships next to the build (dist/../personas == repo root /personas). */
export function getPersonasDir(): string {
  const override = process.env.PERSONA_COMPOSER_PERSONAS_DIR;
  if (override && override.trim() !== "") return path.resolve(override);
  // __dirname is dist/ after compilation; personas/ lives one level up.
  return path.resolve(__dirname, "..", "personas");
}

/** Port for the HTTP server. */
export function getServerPort(): number {
  return num(process.env.PERSONA_COMPOSER_PORT) ?? 5859;
}
