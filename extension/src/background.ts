// MV3 service worker. All network traffic to the persona-composer endpoints
// goes through here: the worker runs with the extension's host_permissions, so
// fetching http://127.0.0.1 is not subject to the page's CORS or mixed-content
// rules. The content script talks to it via messages (personas) and a
// long-lived port (compose streaming).
import {
  DEFAULT_SETTINGS,
  type ComposeStart,
  type PersonaSummary,
  type PersonasResponse,
  type Settings,
} from "./types";

async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(DEFAULT_SETTINGS)) as Settings;
  return { ...DEFAULT_SETTINGS, ...stored };
}

function endpoint(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

// When the endpoint is a SillyTavern plugin, ST guards every POST with its
// csrf-sync protection: a token from the origin-root `/csrf-token`, returned in
// the `X-CSRF-Token` header, bound to the ST session cookie. We fetch with
// credentials so the session cookie round-trips. On the standalone server this
// endpoint 404s and there's no CSRF, so it gracefully returns null.
async function fetchCsrfToken(baseUrl: string): Promise<string | null> {
  try {
    const origin = new URL(baseUrl).origin;
    const res = await fetch(`${origin}/csrf-token`, { credentials: "include" });
    if (res.ok) return ((await res.json()) as { token?: string }).token ?? null;
  } catch {
    // standalone endpoint has no /csrf-token — fine
  }
  return null;
}

async function fetchPersonas(): Promise<PersonasResponse> {
  const { baseUrl } = await getSettings();
  try {
    const res = await fetch(endpoint(baseUrl, "/personas"), {
      credentials: "include",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { personas?: PersonaSummary[] };
    return { ok: true, personas: data.personas ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: `cannot reach ${baseUrl} — is persona-composer running? (${(err as Error).message})`,
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "personas") {
    fetchPersonas().then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (msg?.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// Parse an OpenAI-style SSE stream and forward each framed event to `onEvent`.
async function pipeSSE(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let dataLine = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        onEvent(event, JSON.parse(dataLine));
      } catch {
        // ignore unparsable keep-alive frames
      }
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "compose") return;

  // Closing the panel disconnects the port; abort the upstream stream so the
  // server (and its LLM) stop generating output nobody will read.
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener(async (msg: ComposeStart) => {
    if (msg.type !== "start") return;
    const { baseUrl } = await getSettings();
    const post = (data: unknown) => {
      try {
        port.postMessage(data);
      } catch {
        // port may have closed if the user navigated away mid-stream
      }
    };

    const body = JSON.stringify({
      personaId: msg.personaId,
      platform: msg.platform,
      sourcePost: msg.sourcePost,
      extraInstruction: msg.extraInstruction,
    });
    const doPost = (token: string | null) =>
      fetch(endpoint(baseUrl, "/compose"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-CSRF-Token": token } : {}),
        },
        credentials: "include",
        body,
        signal: abort.signal,
      });

    try {
      let res = await doPost(await fetchCsrfToken(baseUrl));
      // 403 likely means a stale/absent CSRF token under ST — refetch and retry.
      if (res.status === 403) {
        const fresh = await fetchCsrfToken(baseUrl);
        if (fresh) res = await doPost(fresh);
      }
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        post({ event: "error", data: { message: `HTTP ${res.status} ${detail}` } });
        port.disconnect();
        return;
      }
      await pipeSSE(res, (event, data) => post({ event, data }));
      port.disconnect();
    } catch (err) {
      if (abort.signal.aborted) return; // panel closed; nothing to report
      post({
        event: "error",
        data: {
          message: `cannot reach ${baseUrl} — is persona-composer running? (${(err as Error).message})`,
        },
      });
      port.disconnect();
    }
  });
});
