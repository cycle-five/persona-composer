// persona-composer phase-1 UI. Plain ES modules, no build step.
// All fetches are RELATIVE so this works whether served from "/" (standalone
// server) or "/api/plugins/persona-composer/" (inside SillyTavern).

const $ = (id) => document.getElementById(id);

const els = {
  persona: $("persona"),
  personaDesc: $("persona-desc"),
  platform: $("platform"),
  source: $("source"),
  extra: $("extra"),
  compose: $("compose"),
  status: $("status"),
  result: $("result"),
  charcount: $("charcount"),
  copy: $("copy"),
};

// Resolve API calls relative to the directory this page is served from.
const apiBase = new URL(".", window.location.href);
const api = (path) => new URL(path, apiBase).toString();

let personas = [];
let charLimit = 280;
let streaming = false;

// When served inside SillyTavern, every POST is behind ST's CSRF protection
// (csrf-sync). ST exposes the token at the origin-root `/csrf-token` and expects
// it back in the `X-CSRF-Token` header. On the standalone server that endpoint
// 404s and there's no CSRF, so this gracefully no-ops.
let csrfToken = null;
async function getCsrfToken(force = false) {
  if (csrfToken && !force) return csrfToken;
  try {
    const res = await fetch(new URL("/csrf-token", window.location.origin), {
      credentials: "same-origin",
    });
    if (res.ok) csrfToken = (await res.json()).token || null;
  } catch {
    // standalone server: no /csrf-token, no CSRF — proceed without a token
  }
  return csrfToken;
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = "status" + (kind ? " " + kind : "");
}

function updateCharCount() {
  const len = [...els.result.value].length;
  els.charcount.textContent = `${len} / ${charLimit}`;
  els.charcount.classList.toggle("over", len > charLimit);
  els.copy.disabled = els.result.value.trim().length === 0;
}

function platformLimit(platform) {
  const p = personas.find((x) => x.id === els.persona.value);
  // The server is the source of truth (it sends a `meta` event), but seed a
  // sensible limit from the platform default for the live counter pre-stream.
  return platform === "instagram" ? 2200 : 280;
}

async function loadPersonas() {
  setStatus("loading personas…");
  try {
    const res = await fetch(api("personas"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    personas = data.personas || [];
    els.persona.innerHTML = "";
    for (const p of personas) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      els.persona.appendChild(opt);
    }
    if (personas.length === 0) {
      setStatus("no personas found — add cards to personas/", "error");
    } else {
      setStatus(`${personas.length} persona(s) ready`, "ok");
      onPersonaChange();
    }
  } catch (err) {
    setStatus(`could not load personas: ${err.message}`, "error");
  }
}

function onPersonaChange() {
  const p = personas.find((x) => x.id === els.persona.value);
  els.personaDesc.textContent = p ? p.description : "";
  // Constrain the platform options to what the persona supports, if specified.
  if (p && Array.isArray(p.platforms) && p.platforms.length) {
    for (const opt of els.platform.options) {
      opt.disabled = !p.platforms.includes(opt.value);
    }
    if (els.platform.selectedOptions[0]?.disabled) {
      els.platform.value = p.platforms[0];
    }
  }
  charLimit = platformLimit(els.platform.value);
  updateCharCount();
}

// Parse an SSE stream from a fetch Response body, invoking handlers per event.
async function readSSE(res, handlers) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
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
      let payload;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }
      handlers[event]?.(payload);
    }
  }
}

async function compose() {
  if (streaming) return;
  const personaId = els.persona.value;
  if (!personaId) {
    setStatus("pick a persona first", "error");
    return;
  }
  streaming = true;
  els.compose.disabled = true;
  els.result.value = "";
  updateCharCount();
  setStatus("composing…");

  const body = {
    personaId,
    platform: els.platform.value,
    sourcePost: els.source.value.trim() || undefined,
    extraInstruction: els.extra.value.trim() || undefined,
  };

  try {
    const post = async (token) =>
      fetch(api("compose"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-CSRF-Token": token } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

    let res = await post(await getCsrfToken());
    // A 403 likely means a stale CSRF token (e.g. ST session rotated) — refetch
    // once and retry before giving up.
    if (res.status === 403) {
      const fresh = await getCsrfToken(true);
      if (fresh) res = await post(fresh);
    }
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${txt}`);
    }
    await readSSE(res, {
      meta: (m) => {
        if (typeof m.charLimit === "number") {
          charLimit = m.charLimit;
          updateCharCount();
        }
      },
      delta: (d) => {
        els.result.value += d.text || "";
        updateCharCount();
        els.result.scrollTop = els.result.scrollHeight;
      },
      done: () => setStatus("done", "ok"),
      error: (e) => setStatus(`error: ${e.message}`, "error"),
    });
  } catch (err) {
    setStatus(`compose failed: ${err.message}`, "error");
  } finally {
    streaming = false;
    els.compose.disabled = false;
    updateCharCount();
  }
}

async function copyResult() {
  const text = els.result.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("copied to clipboard", "ok");
  } catch {
    // Fallback for non-secure contexts where the Clipboard API is unavailable.
    els.result.select();
    document.execCommand("copy");
    setStatus("copied", "ok");
  }
}

els.persona.addEventListener("change", onPersonaChange);
els.platform.addEventListener("change", () => {
  charLimit = platformLimit(els.platform.value);
  updateCharCount();
});
els.result.addEventListener("input", updateCharCount);
els.compose.addEventListener("click", compose);
els.copy.addEventListener("click", copyResult);

loadPersonas();
updateCharCount();
