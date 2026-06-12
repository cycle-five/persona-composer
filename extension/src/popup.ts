// Settings popup: configure and test the persona-composer endpoint.
import { DEFAULT_SETTINGS, type PersonasResponse, type Settings } from "./types";

const baseUrl = document.getElementById("baseUrl") as HTMLInputElement;
const status = document.getElementById("status") as HTMLElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const testBtn = document.getElementById("test") as HTMLButtonElement;
const autoPost = document.getElementById("autoPost") as HTMLInputElement;

function setStatus(text: string, kind: "" | "ok" | "error" = ""): void {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function load(): Promise<void> {
  const s = (await chrome.storage.local.get(DEFAULT_SETTINGS)) as Settings;
  baseUrl.value = s.baseUrl || DEFAULT_SETTINGS.baseUrl;
  autoPost.checked = s.autoPost === true;
}

saveBtn.addEventListener("click", async () => {
  const url = normalize(baseUrl.value) || DEFAULT_SETTINGS.baseUrl;
  baseUrl.value = url;
  await chrome.storage.local.set({ baseUrl: url, autoPost: autoPost.checked });
  setStatus(autoPost.checked ? "saved — auto-post ON" : "saved", "ok");
});

// Persist the toggle immediately too, so it sticks even without hitting Save.
autoPost.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoPost: autoPost.checked });
});

testBtn.addEventListener("click", async () => {
  // Persist first so the background worker tests the same URL shown here.
  const url = normalize(baseUrl.value) || DEFAULT_SETTINGS.baseUrl;
  baseUrl.value = url;
  await chrome.storage.local.set({ baseUrl: url });
  setStatus("testing…");
  const resp = (await chrome.runtime.sendMessage({ type: "personas" })) as PersonasResponse;
  if (resp.ok) {
    setStatus(`✓ reachable — ${resp.personas.length} persona(s)`, "ok");
  } else {
    setStatus(`✗ ${resp.error}`, "error");
  }
});

void load();
