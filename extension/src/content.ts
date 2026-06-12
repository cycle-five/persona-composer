// Content script for x.com / twitter.com / instagram.com. Site-specific DOM
// coupling lives behind a SiteAdapter (src/sites/*); this file is the
// site-agnostic UI: it injects a 🎭 button on each post, and drives a shadow-DOM
// panel that streams a persona-voiced draft from the local persona-composer
// endpoints. It also offers feed triage (step through visible posts / draft all)
// and an opt-in, default-off auto-post.
//
// Nothing is posted automatically unless you explicitly enable auto-post in
// settings AND confirm each time. Default flow: copy or insert, then you Post.
import { getAdapter } from "./sites";
import {
  DEFAULT_SETTINGS,
  type CapturedPost,
  type ComposeEvent,
  type ComposeStart,
  type ExtractedPost,
  type PersonaSummary,
  type Platform,
  type PersonasResponse,
  type Settings,
  type SiteAdapter,
} from "./types";

const adapter: SiteAdapter | null = getAdapter();
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
  if (!adapter) return;
  for (const post of document.querySelectorAll(adapter.postSelector)) {
    if (post.hasAttribute(BTN_FLAG)) continue;
    const mount = adapter.findMountPoint(post);
    if (!mount) continue;
    post.setAttribute(BTN_FLAG, "1");
    const btn = makeButton();
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitFeed();
      openPanel(adapter.extract(post));
    });
    mount.appendChild(btn);
  }
}

// Re-scan on DOM churn (infinite scroll), coalesced to one pass per frame.
if (adapter) {
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
}

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
    status: HTMLElement;
    result: HTMLTextAreaElement;
    count: HTMLElement;
    copy: HTMLButtonElement;
    insert: HTMLButtonElement;
    post: HTMLButtonElement;
    scan: HTMLButtonElement;
    feedNav: HTMLElement;
    feedPrev: HTMLButtonElement;
    feedNext: HTMLButtonElement;
    feedPos: HTMLElement;
    draftAll: HTMLButtonElement;
  };
}

let panel: Panel | null = null;
let personasLoaded = false;
let charLimit = 280;
let streaming = false;
let autoPost = false;
// The in-flight compose port, so closing the panel can abort the upstream
// stream (a runtime port outlives the DOM — removing the panel alone won't).
let activePort: chrome.runtime.Port | null = null;

// Feed triage state.
let feed: CapturedPost[] = [];
let feedIndex = 0;

const PANEL_CSS = `
  :host { all: initial; }
  .wrap {
    position: fixed; right: 20px; bottom: 20px; width: 380px; z-index: 2147483647;
    background: #15181e; color: #e6e9ef; border: 1px solid #2a2f3a; border-radius: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
    box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden;
  }
  header { display:flex; align-items:center; justify-content:space-between;
    padding: 10px 12px; background:#1b1f27; border-bottom:1px solid #2a2f3a; }
  header b { font-weight:600; letter-spacing:.02em; }
  header .hbtns { display:flex; gap:6px; align-items:center; }
  header button { background:none; border:none; color:#8b93a3; cursor:pointer; font-size:14px; }
  header button:hover { color:#e6e9ef; }
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
  .feednav { display:none; align-items:center; gap:8px; }
  .feednav.on { display:flex; }
  .feednav .pos { font-size:11px; color:#8b93a3; min-width:48px; text-align:center; }
  .feednav button { flex:0 0 auto; }
  button.act { cursor:pointer; border-radius:8px; padding:6px 12px; font:inherit; font-size:12px; border:1px solid #2a2f3a; background:#1d212b; color:#e6e9ef; }
  button.primary { background:#3a7bd5; border-color:#3a7bd5; color:#fff; }
  button.primary:disabled, button.act:disabled { opacity:.5; cursor:not-allowed; }
  button.danger { background:#3a1d1d; border-color:#7a3a3a; color:#ff9b9b; }
  button.danger:hover:not(:disabled) { background:#52201f; }
  .foot { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .count { font-size:11px; color:#8b93a3; }
  .count.over { color:#ff6b6b; font-weight:bold; }
  .status { font-size:11px; color:#8b93a3; min-height:1.2em; }
  .status.error { color:#ff6b6b; }
  .status.ok { color:#54d18c; }
  .actions { display:flex; gap:8px; align-items:center; }
  .post-hidden { display:none; }
`;

const PANEL_HTML = `
  <div class="wrap">
    <header>
      <b>🎭 persona composer</b>
      <span class="hbtns">
        <button data-el="scan" title="Scan the feed for posts to triage">⊞ feed</button>
        <button data-el="close" title="Close">×</button>
      </span>
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
      <div class="feednav" data-el="feedNav">
        <button class="act" data-el="feedPrev" title="Previous post">◀</button>
        <span class="pos" data-el="feedPos">0 / 0</span>
        <button class="act" data-el="feedNext" title="Next post">▶</button>
        <button class="act" data-el="draftAll" title="Draft a reply for every post in the feed">Draft all</button>
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
          <button class="act danger post-hidden" data-el="post" title="Submit this post on the site — against its terms">Post for me</button>
          <button class="act" data-el="insert" disabled>Insert</button>
          <button class="act" data-el="copy" disabled>Copy</button>
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
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(PANEL_CSS);
  shadow.adoptedStyleSheets = [sheet];
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
      status: q<HTMLElement>("status"),
      result: q<HTMLTextAreaElement>("result"),
      count: q<HTMLElement>("count"),
      copy: q<HTMLButtonElement>("copy"),
      insert: q<HTMLButtonElement>("insert"),
      post: q<HTMLButtonElement>("post"),
      scan: q<HTMLButtonElement>("scan"),
      feedNav: q<HTMLElement>("feedNav"),
      feedPrev: q<HTMLButtonElement>("feedPrev"),
      feedNext: q<HTMLButtonElement>("feedNext"),
      feedPos: q<HTMLElement>("feedPos"),
      draftAll: q<HTMLButtonElement>("draftAll"),
    },
  };

  (q<HTMLButtonElement>("close")).addEventListener("click", () => {
    activePort?.disconnect(); // abort any in-flight stream
    host.remove();
    panel = null;
    feed = [];
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
    if (!adapter) return;
    const ok = adapter.insertDraft(p.els.result.value);
    setStatus(ok ? "inserted into composer" : "no composer open — use Copy", ok ? "ok" : "error");
  });
  p.els.post.addEventListener("click", () => doAutoPost());
  p.els.scan.addEventListener("click", () => scanFeed());
  p.els.feedPrev.addEventListener("click", () => stepFeed(-1));
  p.els.feedNext.addEventListener("click", () => stepFeed(1));
  p.els.draftAll.addEventListener("click", () => draftAll());
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
  panel.els.post.disabled = !has;
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
  autoPost = settings.autoPost === true;
  panel.els.post.classList.toggle("post-hidden", !autoPost);

  panel.els.persona.innerHTML = "";
  for (const persona of resp.personas as PersonaSummary[]) {
    const opt = document.createElement("option");
    opt.value = persona.id;
    opt.textContent = persona.name;
    panel.els.persona.appendChild(opt);
  }
  if (settings.lastPersonaId) panel.els.persona.value = settings.lastPersonaId;
  // Default platform to the site we're on; fall back to last used.
  panel.els.platform.value = adapter?.id ?? settings.lastPlatform ?? "x";
  charLimit = panel.els.platform.value === "instagram" ? 2200 : 280;
  updateCount();
  personasLoaded = resp.personas.length > 0;
  setStatus(
    personasLoaded ? `${resp.personas.length} persona(s) ready` : "no personas found",
    personasLoaded ? "ok" : "error",
  );
}

function setSource(post: ExtractedPost): void {
  if (!panel) return;
  const who = post.handle || post.author || "this post";
  panel.els.source.textContent = post.text ? `${who}\n${post.text}` : who;
  panel.els.source.dataset.text = post.text;
}

function openPanel(post: ExtractedPost): void {
  if (!panel) panel = buildPanel();
  setSource(post);
  panel.els.result.value = "";
  updateCount();
  if (!personasLoaded) void loadPersonas();
}

// --- feed triage ------------------------------------------------------------

function scanFeed(): void {
  if (!adapter) return;
  if (!panel) panel = buildPanel();
  feed = adapter.collectPosts();
  feedIndex = 0;
  if (feed.length === 0) {
    setStatus("no posts found in view — scroll and rescan", "error");
    panel.els.feedNav.classList.remove("on");
    return;
  }
  panel.els.feedNav.classList.add("on");
  showFeedItem();
  if (!personasLoaded) void loadPersonas();
  setStatus(`scanned ${feed.length} post(s)`, "ok");
}

function showFeedItem(): void {
  if (!panel || feed.length === 0) return;
  feedIndex = Math.max(0, Math.min(feedIndex, feed.length - 1));
  setSource(feed[feedIndex].post);
  panel.els.result.value = "";
  updateCount();
  panel.els.feedPos.textContent = `${feedIndex + 1} / ${feed.length}`;
}

function stepFeed(delta: number): void {
  if (feed.length === 0) return;
  feedIndex = (feedIndex + delta + feed.length) % feed.length;
  showFeedItem();
}

function exitFeed(): void {
  feed = [];
  if (panel) panel.els.feedNav.classList.remove("on");
}

// --- compose ----------------------------------------------------------------

interface ComposeResult {
  text: string;
  error?: string;
}

// Run one compose over a fresh port. Resolves with the accumulated text (and an
// error string if the server reported one). `onDelta` streams partial text for
// live UI; omit it for silent batch drafting.
function composeOne(
  start: ComposeStart,
  onDelta?: (full: string) => void,
): Promise<ComposeResult> {
  return new Promise((resolve) => {
    let acc = "";
    let error: string | undefined;
    const port = chrome.runtime.connect({ name: "compose" });
    activePort = port;
    port.onMessage.addListener((msg: ComposeEvent) => {
      switch (msg.event) {
        case "meta":
          charLimit = msg.data.charLimit;
          break;
        case "delta":
          acc += msg.data.text;
          onDelta?.(acc);
          break;
        case "error":
          error = msg.data.message;
          break;
      }
    });
    // `done` arrives just before the port disconnects; resolve on disconnect so
    // we capture whatever streamed even if the connection drops (e.g. the panel
    // was closed, which disconnects the port and aborts the upstream).
    port.onDisconnect.addListener(() => {
      if (activePort === port) activePort = null;
      resolve({ text: acc, error });
    });
    port.postMessage(start);
  });
}

function currentStart(platform: Platform): ComposeStart {
  return {
    type: "start",
    personaId: panel!.els.persona.value,
    platform,
    sourcePost: panel!.els.source.dataset.text || undefined,
    extraInstruction: panel!.els.extra.value.trim() || undefined,
  };
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

  try {
    const { error } = await composeOne(currentStart(platform), (full) => {
      if (!panel) return;
      panel.els.result.value = full;
      updateCount();
      panel.els.result.scrollTop = panel.els.result.scrollHeight;
    });
    setStatus(error ? error : "done", error ? "error" : "ok");
  } finally {
    streaming = false;
    if (panel) {
      panel.els.compose.disabled = false;
      updateCount();
    }
  }
}

async function draftAll(): Promise<void> {
  if (!panel || streaming || feed.length === 0) return;
  const personaId = panel.els.persona.value;
  if (!personaId) {
    setStatus("pick a persona", "error");
    return;
  }
  const platform = panel.els.platform.value as Platform;
  const total = feed.length;
  streaming = true;
  panel.els.compose.disabled = true;
  panel.els.draftAll.disabled = true;
  void saveLast(personaId, platform);

  const extra = panel.els.extra.value.trim() || undefined;
  const chunks: string[] = [];
  try {
    for (let i = 0; i < feed.length; i++) {
      setStatus(`drafting ${i + 1}/${total}…`);
      const post = feed[i].post;
      const start: ComposeStart = {
        type: "start",
        personaId,
        platform,
        sourcePost: post.text || undefined,
        extraInstruction: extra,
      };
      const { text, error } = await composeOne(start);
      if (!panel) return; // panel closed mid-batch
      const who = post.handle || post.author || `post ${i + 1}`;
      chunks.push(`--- ${who} ---\n${error ? `[error: ${error}]` : text}`);
      panel.els.result.value = chunks.join("\n\n");
      updateCount();
      panel.els.result.scrollTop = panel.els.result.scrollHeight;
    }
    setStatus(`drafted ${total} — Copy to grab them all`, "ok");
  } finally {
    streaming = false;
    if (panel) {
      panel.els.compose.disabled = false;
      panel.els.draftAll.disabled = false;
      updateCount();
    }
  }
}

// --- auto-post (opt-in, default off) ----------------------------------------

function doAutoPost(): void {
  if (!panel || !adapter) return;
  if (!autoPost) {
    setStatus("auto-post is off — enable it in settings", "error");
    return;
  }
  const text = panel.els.result.value.trim();
  if (!text) return;
  // Insert first so the site's composer holds exactly this text, then submit.
  const inserted = adapter.insertDraft(text);
  if (!inserted) {
    setStatus("open the reply/comment box first, then Post", "error");
    return;
  }
  const ok = window.confirm(
    `Post this to ${adapter.label} now?\n\n${text.slice(0, 200)}${text.length > 200 ? "…" : ""}\n\n` +
      `This submits on your behalf, which is against ${adapter.label}'s terms of service.`,
  );
  if (!ok) {
    setStatus("post cancelled", "");
    return;
  }
  const submitted = adapter.submitPost();
  setStatus(
    submitted ? "submitted" : "couldn't find the post button — submit manually",
    submitted ? "ok" : "error",
  );
}
