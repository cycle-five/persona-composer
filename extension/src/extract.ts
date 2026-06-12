// X (Twitter) DOM extraction. Isolated from the rest of the content script so
// the brittle bits live in one place — X ships obfuscated class names, but the
// `data-testid` hooks below have been comparatively stable. If X reshuffles its
// DOM, this is the file to patch.
import type { ExtractedPost } from "./types";

/** The article element representing a single tweet. */
export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** The engagement/action bar within a tweet (reply/retweet/like/…). */
const ACTION_BAR_SELECTOR = '[role="group"]';

/** X's reply composer (DraftJS contenteditable). The primary tweet box has a
 *  specific testid; the generic role/contenteditable pair is a last resort.
 *  Queried in this order (not as one comma-selector, which would return
 *  whichever matches first in DOM order — possibly a search or DM box). */
const REPLY_BOX_SELECTORS = [
  '[data-testid="tweetTextarea_0"]',
  '[role="textbox"][contenteditable="true"]',
];

/** Pull author, handle, text, and permalink out of a tweet article. */
export function extractTweet(article: Element): ExtractedPost {
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

/** Find the action bar to attach our button to (last group = engagement bar). */
export function findActionBar(article: Element): Element | null {
  const groups = article.querySelectorAll(ACTION_BAR_SELECTOR);
  return groups.length ? groups[groups.length - 1] : null;
}

/**
 * Drop `text` into the currently-open reply composer, if any. Returns true on
 * success. X's editor is DraftJS, so a plain value-set won't register —
 * focusing, selecting all, and execCommand("insertText") is what its event
 * model actually picks up. The user still reviews and clicks Post.
 */
export function insertIntoReply(text: string): boolean {
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
