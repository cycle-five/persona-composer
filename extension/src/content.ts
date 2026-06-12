// Content script injected into x.com / twitter.com. It adds a small "compose"
// button to each tweet's action bar; clicking it extracts that tweet and opens
// a self-contained panel (in a shadow root, to stay insulated from X's CSS)
// that streams a persona-voiced draft from the local persona-composer endpoints.
//
// Nothing is ever posted automatically. The draft is yours to copy or drop into
// the reply box; you click Post.
import {
  TWEET_SELECTOR,
  extractTweet,
  findActionBar,
  insertIntoReply,
} from "./extract";
import {
  DEFAULT_SETTINGS,
  type ComposeEvent,
  type ComposeStart,
  type ExtractedPost,
  type PersonaSummary,
  type Platform,
  type PersonasResponse,
  type Settings,
} from "./types";

const BTN_FLAG = "data-pc-injected";

// --- settings ---------------------------------------------------------------

async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(DEFAULT_SETTINGS)) as Settings;
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveLast(personaId: string, platform: Platform): Promise<void> {
  await chrome.storage.local.set({ lastPersonaId: personaId, lastPlatform: platform });
}

// --- button injection -------------------------------------------------------

function makeButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "🎭";
  btn.title = "Compose a reply with a persona";
  btn.setAttribute("aria-label", "Compose a reply with a persona");
  Object.assign(btn.style, {
    cursor: "pointer",
    background: "transparent",
    border: "none",
    fontSize: "15px",
    lineHeight: "1",
    padding: "0 8px",
    opacity: "0.75",
  } satisfies Partial<CSSStyleDeclaration>);
  btn.addEventListener("mouseenter", () => (btn.style.opacity = "1"));
  btn.addEventListener("mouseleave", () => (btn.style.opacity = "0.75"));
  return btn;
}

function injectButtons(): void {
  for (const article of document.querySelectorAll(TWEET_SELECTOR)) {
    if (article.hasAttribute(BTN_FLAG)) continue;
    const bar = findActionBar(article);
    if (!bar) continue;
    article.setAttribute(BTN_FLAG, "1");
    const btn = makeButton();
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(extractTweet(article));
    });
    bar.appendChild(btn);
  }
}

// Re-scan on DOM churn (infinite scroll), coalesced to one pass per frame.
let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    injectButtons();
  });
});
observer.observe(document.body, { childList: true, subtree: true });
injectButtons();

// --- panel (shadow DOM singleton) -------------------------------------------

interface Panel {
  host: HTMLElement;
  shadow: ShadowRoot;
  els: {
    persona: HTMLSelectElement;
    platform: HTMLSelectElement;
    source: HTMLElement;
    extra: HTMLInputElement;
    compose: HTMLButtonElement;
    result: HTMLTextAreaElement;
    status: HTMLElement;
    count: HTMLElement;
    copy: HTMLButtonElement;
    insert: HTMLButtonElement;
  };
}

let panel: Panel | null = null;
let personasLoaded = false;
let charLimit = 280;
let streaming = false;

const PANEL_HTML = `
  <style>
    :host { all: initial; }
    .wrap {
      position: fixed; right: 20px; bottom: 20px; width: 360px; z-index: 2147483647;
      background: #15181e; color: #e6e9ef; border: 1px solid #2a2f3a; border-radius: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
      box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden;
    }
    header { display:flex; align-items:center; justify-content:space-between;
      padding: 10px 12px; background:#1b1f27; border-bottom:1px solid #2a2f3a; }
    header b { font-weight:600; letter-spacing:.02em; }
    header button { background:none; border:none; color:#8b93a3; cursor:pointer; font-size:16px; }
    .body { padding: 12px; display:flex; flex-direction:column; gap:8px; }
    .row { display:flex; gap:8px; }
    .row > * { flex:1; }
    label { font-size:11px; color:#8b93a3; display:block; margin-bottom:3px; }
    select, textarea, input {
      width:100%; box-sizing:border-box; background:#0f1115; color:#e6e9ef;
      border:1px solid #2a2f3a; border-radius:8px; padding:6px 8px; font:inherit; font-size:12px; resize:vertical;
    }
    select:focus, textarea:focus, input:focus { outline:none; border-color:#5b9dff; }
    .src { font-size:11px; color:#8b93a3; max-height:64px; overflow:auto;
      background:#0f1115; border:1px solid #2a2f3a; border-radius:8px; padding:6px 8px; white-space:pre-wrap; }
    button.act { cursor:pointer; border-radius:8px; padding:6px 12px; font:inherit; font-size:12px; border:1px solid #2a2f3a; }
    button.primary { background:#3a7bd5; border-color:#3a7bd5; color:#fff; }
    button.primary:disabled { opacity:.5; cursor:not-allowed; }
    button.ghost { background:#1d212b; color:#e6e9ef; }
    button.ghost:disabled { opacity:.5; cursor:not-allowed; }
    .foot { display:flex; align-items:center; justify-content:space-between; }
    .count { font-size:11px; color:#8b93a3; }
    .count.over { color:#ff6b6b; font-weight:bold; }
    .status { font-size:11px; color:#8b93a3; min-height:1.2em; }
    .status.error { color:#ff6b6b; }
    .status.ok { color:#54d18c; }
    .actions { display:flex; gap:8px; }
  </style>
  <div class="wrap">
    <header>
      <b>🎭 persona composer</b>
      <button data-el="close" title="Close">×</button>
    </header>
    <div class="body">
      <div class="row">
        <div><label>Persona</label><select data-el="persona"></select></div>
        <div><label>Platform</label>
          <select data-el="platform">
            <option value="x">X (280)</option>
            <option value="instagram">Instagram</option>
          </select>
        </div>
      </div>
      <div><label>Replying to</label><div class="src" data-el="src"></div></div>
      <div><label>Extra direction (optional)</label><input data-el="extra" placeholder="e.g. keep it dry…" /></div>
      <div class="actions">
        <button class="act primary" data-el="compose">Compose</button>
        <span class="status" data-el="status"></span>
      </div>
      <div><label>Draft (editable)</label><textarea data-el="result" rows="5"></textarea></div>
      <div class="foot">
        <span class="count" data-el="count"></span>
        <div class="actions">
          <button class="act ghost" data-el="insert" disabled>Insert</button>
          <button class="act ghost" data-el="copy" disabled>Copy</button>
        </div>
      </div>
    </div>
  </div>
`;

function buildPanel(): Panel {
  const host = document.createElement("div");
  host.id = "persona-composer-panel";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = PANEL_HTML;
  document.body.appendChild(host);

  const q = <T extends Element>(name: string) =>
    shadow.querySelector(`[data-el="${name}"]`) as T;

  const p: Panel = {
    host,
    shadow,
    els: {
      persona: q<HTMLSelectElement>("persona"),
      platform: q<HTMLSelectElement>("platform"),
      source: q<HTMLElement>("src"),
      extra: q<HTMLInputElement>("extra"),
      compose: q<HTMLButtonElement>("compose"),
      result: q<HTMLTextAreaElement>("result"),
      status: q<HTMLElement>("status"),
      count: q<HTMLElement>("count"),
      copy: q<HTMLButtonElement>("copy"),
      insert: q<HTMLButtonElement>("insert"),
    },
  };

  (q<HTMLButtonElement>("close")).addEventListener("click", () => {
    host.remove();
    panel = null;
  });
  p.els.compose.addEventListener("click", () => runCompose());
  p.els.result.addEventListener("input", () => updateCount());
  p.els.platform.addEventListener("change", () => {
    charLimit = p.els.platform.value === "instagram" ? 2200 : 280;
    updateCount();
  });
  p.els.copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(p.els.result.value).catch(() => {});
    setStatus("copied", "ok");
  });
  p.els.insert.addEventListener("click", () => {
    const ok = insertIntoReply(p.els.result.value);
    setStatus(ok ? "inserted into reply box" : "no reply box open — use Copy", ok ? "ok" : "error");
  });
  return p;
}

function setStatus(text: string, kind: "" | "ok" | "error" = ""): void {
  if (!panel) return;
  panel.els.status.textContent = text;
  panel.els.status.className = "status" + (kind ? " " + kind : "");
}

function updateCount(): void {
  if (!panel) return;
  const len = [...panel.els.result.value].length;
  panel.els.count.textContent = `${len} / ${charLimit}`;
  panel.els.count.classList.toggle("over", len > charLimit);
  const has = panel.els.result.value.trim().length > 0;
  panel.els.copy.disabled = !has;
  panel.els.insert.disabled = !has;
}

async function loadPersonas(): Promise<void> {
  if (!panel) return;
  setStatus("loading personas…");
  const resp = (await chrome.runtime.sendMessage({ type: "personas" })) as PersonasResponse;
  if (!panel) return;
  if (!resp.ok) {
    setStatus(resp.error, "error");
    return;
  }
  const settings = await getSettings();
  panel.els.persona.innerHTML = "";
  for (const p of resp.personas as PersonaSummary[]) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    panel.els.persona.appendChild(opt);
  }
  if (settings.lastPersonaId) panel.els.persona.value = settings.lastPersonaId;
  if (settings.lastPlatform) panel.els.platform.value = settings.lastPlatform;
  charLimit = panel.els.platform.value === "instagram" ? 2200 : 280;
  updateCount();
  personasLoaded = resp.personas.length > 0;
  setStatus(personasLoaded ? `${resp.personas.length} persona(s) ready` : "no personas found", personasLoaded ? "ok" : "error");
}

function openPanel(post: ExtractedPost): void {
  if (!panel) panel = buildPanel();
  const who = post.handle || post.author || "this post";
  panel.els.source.textContent = post.text ? `${who}\n${post.text}` : who;
  // Stash the source text on the element for compose().
  panel.els.source.dataset.text = post.text;
  panel.els.result.value = "";
  updateCount();
  if (!personasLoaded) void loadPersonas();
}

async function runCompose(): Promise<void> {
  if (!panel || streaming) return;
  const personaId = panel.els.persona.value;
  if (!personaId) {
    setStatus("pick a persona", "error");
    return;
  }
  const platform = panel.els.platform.value as Platform;
  streaming = true;
  panel.els.compose.disabled = true;
  panel.els.result.value = "";
  updateCount();
  setStatus("composing…");
  void saveLast(personaId, platform);

  const start: ComposeStart = {
    type: "start",
    personaId,
    platform,
    sourcePost: panel.els.source.dataset.text || undefined,
    extraInstruction: panel.els.extra.value.trim() || undefined,
  };

  const port = chrome.runtime.connect({ name: "compose" });
  const finish = () => {
    streaming = false;
    if (panel) panel.els.compose.disabled = false;
    updateCount();
  };
  port.onMessage.addListener((msg: ComposeEvent) => {
    if (!panel) return;
    switch (msg.event) {
      case "meta":
        charLimit = msg.data.charLimit;
        updateCount();
        break;
      case "delta":
        panel.els.result.value += msg.data.text;
        updateCount();
        panel.els.result.scrollTop = panel.els.result.scrollHeight;
        break;
      case "done":
        setStatus("done", "ok");
        break;
      case "error":
        setStatus(msg.data.message, "error");
        break;
    }
  });
  port.onDisconnect.addListener(finish);
  port.postMessage(start);
}
