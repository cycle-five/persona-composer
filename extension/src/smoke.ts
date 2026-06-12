// Selector smoke test.
//
// Paste the built `extension/dist/smoke.js` into your browser devtools console
// while on x.com or instagram.com to check whether the site adapters still find
// and extract posts after a site redesign. It uses the REAL adapters
// (extension/src/sites/*), so it can never drift from the production selectors —
// if this passes, the extension's extraction works on the current DOM.
//
// Non-mutating by default. It auto-runs once on paste, and exposes
// `window.__pcSmoke(opts)` for re-runs. Pass `{ testInsert: true }` to also drop
// a marker string into an OPEN reply/comment box (then clear it yourself).
import { getAdapter } from "./sites";

interface SmokeOpts {
  /** Also test inserting a marker into an open composer (mutates — opt-in). */
  testInsert?: boolean;
  /** How many extracted posts to show in the sample table (default 3). */
  samples?: number;
}

declare global {
  interface Window {
    __pcSmoke?: (opts?: SmokeOpts) => void;
  }
}

const TAG = "%c[persona-composer smoke]";
const STYLE = "color:#5b9dff;font-weight:bold";

function runSmoke(opts: SmokeOpts = {}): void {
  const { testInsert = false, samples = 3 } = opts;

  const adapter = getAdapter();
  if (!adapter) {
    console.log(`${TAG} not a supported site (${location.hostname})`, STYLE);
    return;
  }
  console.log(`${TAG} site=${adapter.id} host=${location.hostname}`, STYLE);

  const containers = document.querySelectorAll(adapter.postSelector);
  const collected = adapter.collectPosts();
  console.log(`  post containers (${adapter.postSelector}): ${containers.length}`);
  console.log(`  extractable (with text): ${collected.length}`);

  if (collected.length === 0) {
    console.warn(
      "  ⚠️ no posts extracted — selectors may be stale, or no posts are in view. Scroll some posts into view and re-run __pcSmoke().",
    );
  }

  const rows = collected.slice(0, samples).map(({ el, post }) => ({
    handle: post.handle || "(none)",
    author: post.author || "(none)",
    text: post.text
      ? post.text.slice(0, 60) + (post.text.length > 60 ? "…" : "")
      : "(none)",
    url: post.url ? post.url.slice(0, 48) : "(none)",
    mount: adapter.findMountPoint(el) ? "yes" : "NO",
  }));
  if (rows.length) console.table(rows);

  const noMount = collected.filter((c) => !adapter.findMountPoint(c.el)).length;
  if (noMount > 0) {
    console.warn(
      `  ⚠️ ${noMount}/${collected.length} posts have no mount point — the 🎭 button can't attach to those.`,
    );
  }

  if (testInsert) {
    const marker = "[persona-composer smoke — delete me]";
    const ok = adapter.insertDraft(marker);
    console.log(
      ok
        ? "  insertDraft → ✓ inserted (clear the marker manually)"
        : "  insertDraft → ✗ no open composer found — open a reply/comment box first",
    );
  } else {
    console.log(
      "  (insertion not tested — open a reply/comment box, then run __pcSmoke({ testInsert: true }))",
    );
  }

  const healthy = collected.length > 0 && noMount < collected.length;
  console.log(
    `${TAG} ${
      healthy
        ? "✓ selectors look healthy"
        : `✗ selectors need attention — patch extension/src/sites/${adapter.id}.ts`
    }`,
    STYLE,
  );
}

window.__pcSmoke = runSmoke;
runSmoke();
