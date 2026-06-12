// X (Twitter) site adapter. All the brittle, X-DOM-coupled bits live here —
// `data-testid` hooks have been comparatively stable. If X reshuffles its DOM,
// this is the file to patch.
import type { CapturedPost, ExtractedPost, SiteAdapter } from "../types";

const TWEET = 'article[data-testid="tweet"]';

// X's reply composer (DraftJS). The primary box has a specific testid; the
// generic role/contenteditable pair is a last resort. Tried in order — a
// comma-selector would return whichever matches first in DOM order (possibly a
// search or DM box).
const REPLY_BOX_SELECTORS = [
  '[data-testid="tweetTextarea_0"]',
  '[role="textbox"][contenteditable="true"]',
];

// Reply/post submit button (inline composer first, then the modal one).
const SUBMIT_SELECTORS = [
  '[data-testid="tweetButtonInline"]',
  '[data-testid="tweetButton"]',
];

function extract(article: Element): ExtractedPost {
  const text =
    article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ??
    "";

  let author = "";
  let handle = "";
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (userName) {
    const spans = [...userName.querySelectorAll("span")].map((s) =>
      (s.textContent ?? "").trim(),
    );
    handle = spans.find((s) => s.startsWith("@")) ?? "";
    author = spans.find((s) => s && !s.startsWith("@") && s !== "·") ?? "";
  }

  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  const url = link ? new URL(link.href, location.origin).toString() : "";
  return { author, handle, text, url };
}

function findMountPoint(article: Element): Element | null {
  // Last [role="group"] in the article is the engagement/action bar.
  const groups = article.querySelectorAll('[role="group"]');
  return groups.length ? groups[groups.length - 1] : null;
}

function collectPosts(): CapturedPost[] {
  const seen = new Set<string>();
  const out: CapturedPost[] = [];
  for (const el of document.querySelectorAll(TWEET)) {
    const post = extract(el);
    const key = post.url || post.text;
    if (!post.text || seen.has(key)) continue;
    seen.add(key);
    out.push({ el, post });
  }
  return out;
}

function insertDraft(text: string): boolean {
  let box: HTMLElement | null = null;
  for (const sel of REPLY_BOX_SELECTORS) {
    box = document.querySelector<HTMLElement>(sel);
    if (box) break;
  }
  if (!box) return false;
  box.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // execCommand is deprecated but remains the reliable path for DraftJS editors.
  return document.execCommand("insertText", false, text);
}

function submitPost(): boolean {
  for (const sel of SUBMIT_SELECTORS) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn && !btn.hasAttribute("aria-disabled")) {
      btn.click();
      return true;
    }
  }
  return false;
}

export const xAdapter: SiteAdapter = {
  id: "x",
  label: "X",
  postSelector: TWEET,
  extract,
  findMountPoint,
  collectPosts,
  insertDraft,
  submitPost,
};
