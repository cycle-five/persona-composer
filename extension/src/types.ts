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
  /** Opt-in, default-off: show a button that submits the post for you.
   *  Posting on your behalf is squarely against X/IG terms — see the panel
   *  warning and extension/README.md. */
  autoPost?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "http://127.0.0.1:5859",
  lastPlatform: "x",
  autoPost: false,
};

/** A post captured from a feed, paired with its source element. */
export interface CapturedPost {
  el: Element;
  post: ExtractedPost;
}

/**
 * Per-site DOM adapter. All site-specific coupling lives behind this interface
 * so the content script stays site-agnostic. Add a site = add one adapter.
 */
export interface SiteAdapter {
  /** Which composing platform this site maps to. */
  id: Platform;
  label: string;
  /** Selector for a single post container (tweet article / IG article). */
  postSelector: string;
  /** Pull author/handle/text/url out of a post container. */
  extract(container: Element): ExtractedPost;
  /** Where to attach the 🎭 button within a post container. */
  findMountPoint(container: Element): Element | null;
  /** All extractable posts currently in the DOM (for feed triage). */
  collectPosts(): CapturedPost[];
  /** Drop a draft into the open reply/comment composer. Returns success. */
  insertDraft(text: string): boolean;
  /** Click the site's own post/submit control. Returns success.
   *  Only ever called behind the opt-in auto-post setting + a confirm. */
  submitPost(): boolean;
}

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
