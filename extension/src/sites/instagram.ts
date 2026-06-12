// Instagram site adapter. IG ships heavily obfuscated, frequently-changing
// markup with almost no stable test hooks, so this is BEST-EFFORT: it anchors
// on structural/semantic cues (article, header link, the comment textarea's
// aria-label) rather than class names. Expect to patch this when IG ships UI
// changes. Extraction failing degrades gracefully — you can still type a source
// by hand, and standalone composing needs no source at all.
import type { CapturedPost, ExtractedPost, SiteAdapter } from "../types";

const POST = "article";

function extract(article: Element): ExtractedPost {
  // Author handle: first profile link in the post header.
  const header = article.querySelector("header");
  const handleLink = header?.querySelector<HTMLAnchorElement>('a[role="link"]');
  const author = handleLink?.textContent?.trim() ?? "";
  const handle = author ? `@${author}` : "";

  // Caption: IG renders the caption as an <h1> in newer layouts, else the first
  // dir="auto" span inside the article. Both are best-effort.
  const cap =
    article.querySelector("h1") ??
    article.querySelector('span[dir="auto"]') ??
    null;
  const text = cap?.textContent?.trim() ?? "";

  const permalink = article.querySelector<HTMLAnchorElement>('a[href*="/p/"]');
  const url = permalink
    ? new URL(permalink.href, location.origin).toString()
    : location.href;

  return { author, handle, text, url };
}

function findMountPoint(article: Element): Element | null {
  // The action bar (like/comment/share) sits in a <section> within the article.
  return article.querySelector("section") ?? article.querySelector("header");
}

function collectPosts(): CapturedPost[] {
  const seen = new Set<string>();
  const out: CapturedPost[] = [];
  for (const el of document.querySelectorAll(POST)) {
    const post = extract(el);
    const key = post.url || post.text;
    if (!post.text || seen.has(key)) continue;
    seen.add(key);
    out.push({ el, post });
  }
  return out;
}

function insertDraft(text: string): boolean {
  // IG's comment box is a React-controlled <textarea aria-label="Add a comment…">.
  // A plain value set won't register — use the native setter then fire `input`
  // so React picks up the change.
  const ta = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label*="comment" i], textarea[aria-label*="Add a comment" i]',
  );
  if (!ta) return false;
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) return false;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function submitPost(): boolean {
  // The comment "Post" control is a role=button with the text "Post".
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('div[role="button"], button'),
  ];
  const post = candidates.find((b) => b.textContent?.trim() === "Post");
  if (post) {
    post.click();
    return true;
  }
  return false;
}

export const igAdapter: SiteAdapter = {
  id: "instagram",
  label: "Instagram",
  postSelector: POST,
  extract,
  findMountPoint,
  collectPosts,
  insertDraft,
  submitPost,
};
