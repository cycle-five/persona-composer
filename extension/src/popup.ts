// Settings popup: configure and test the persona-composer endpoint.
import { DEFAULT_SETTINGS, type PersonasResponse, type Settings } from "./types";

const baseUrl = document.getElementById("baseUrl") as HTMLInputElement;
const status = document.getElementById("status") as HTMLElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const testBtn = document.getElementById("test") as HTMLButtonElement;

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
}

saveBtn.addEventListener("click", async () => {
  const url = normalize(baseUrl.value) || DEFAULT_SETTINGS.baseUrl;
  baseUrl.value = url;
  await chrome.storage.local.set({ baseUrl: url });
  setStatus("saved", "ok");
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
