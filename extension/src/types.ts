// Types shared across the extension's content script, background worker, and
// popup. Kept self-contained so the extension build stays decoupled from the
// server's TypeScript project.

export type Platform = "x" | "instagram";

export interface PersonaSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  platforms: Platform[];
}

/** A post extracted from the X DOM. */
export interface ExtractedPost {
  author: string;
  handle: string;
  text: string;
  url: string;
}

/** Persisted settings (chrome.storage.local). */
export interface Settings {
  /** Base URL of the persona-composer endpoints (standalone or ST plugin). */
  baseUrl: string;
  lastPersonaId?: string;
  lastPlatform?: Platform;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "http://127.0.0.1:5859",
  lastPlatform: "x",
};

// --- Messaging contracts -----------------------------------------------------

/** Simple request/response over chrome.runtime.sendMessage. */
export type RuntimeRequest = { type: "personas" } | { type: "ping" };

export type PersonasResponse =
  | { ok: true; personas: PersonaSummary[] }
  | { ok: false; error: string };

/** Payload sent on the long-lived "compose" port to start a stream. */
export interface ComposeStart {
  type: "start";
  personaId: string;
  platform: Platform;
  sourcePost?: string;
  extraInstruction?: string;
}

/** Events streamed back from the background worker over the compose port. */
export type ComposeEvent =
  | { event: "meta"; data: { platform: Platform; charLimit: number } }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { ok: true } }
  | { event: "error"; data: { message: string } };
