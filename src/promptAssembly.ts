import type {
  ChatMessage,
  CharacterCardData,
  PlatformConfig,
  Platform,
} from "./types";

/** Built-in platform defaults, used when a card omits per-platform config. */
const PLATFORM_DEFAULTS: Record<Platform, Required<PlatformConfig>> = {
  x: {
    charLimit: 280,
    tone: "concise and punchy; a single tight thought",
    hashtagPolicy: "sparing",
    emojiPolicy: "at most one, only if it lands",
  },
  instagram: {
    charLimit: 2200,
    tone: "warmer and more expansive; a short caption that breathes",
    hashtagPolicy: "liberal",
    emojiPolicy: "a few are fine if on-brand",
  },
};

const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X (formerly Twitter)",
  instagram: "Instagram",
};

const HASHTAG_RULE: Record<PlatformConfig["hashtagPolicy"] & string, string> = {
  none: "Do not use hashtags.",
  sparing: "Use at most one hashtag, and only if it genuinely adds something.",
  liberal: "A small cluster of relevant hashtags at the end is welcome.",
};

/** Merge a card's per-platform config over the built-in defaults. */
export function resolvePlatformConfig(
  card: CharacterCardData,
  platform: Platform,
): Required<PlatformConfig> {
  const fromCard = card.extensions?.persona_composer?.platforms?.[platform] ?? {};
  return { ...PLATFORM_DEFAULTS[platform], ...fromCard };
}

/** Build the persona-identity section of the system prompt. Prefers the card's
 *  explicit `system_prompt`; otherwise synthesizes one from the card fields. */
function buildPersonaBlock(card: CharacterCardData): string {
  if (card.system_prompt && card.system_prompt.trim()) {
    return card.system_prompt.trim();
  }
  const parts: string[] = [
    `You are ${card.name}, writing social media posts in your own voice.`,
  ];
  if (card.description?.trim()) parts.push(card.description.trim());
  if (card.personality?.trim()) {
    parts.push(`Personality: ${card.personality.trim()}`);
  }
  if (card.scenario?.trim()) parts.push(`Context: ${card.scenario.trim()}`);
  return parts.join("\n\n");
}

function buildPlatformRules(
  platform: Platform,
  cfg: Required<PlatformConfig>,
  styleNotes?: string,
): string {
  const lines = [
    `You are composing for ${PLATFORM_LABEL[platform]}.`,
    `Hard limit: keep the post at or under ${cfg.charLimit} characters. This is a strict ceiling — count and trim if needed.`,
    `Tone: ${cfg.tone}.`,
    HASHTAG_RULE[cfg.hashtagPolicy],
    `Emoji: ${cfg.emojiPolicy}.`,
  ];
  if (styleNotes?.trim()) lines.push(`Style notes: ${styleNotes.trim()}`);
  return lines.join("\n");
}

export interface AssembleParams {
  card: CharacterCardData;
  platform: Platform;
  sourcePost?: string;
  extraInstruction?: string;
}

export interface AssembledPrompt {
  messages: ChatMessage[];
  /** Resolved constraints, useful for the client (e.g. live char counting). */
  meta: {
    platform: Platform;
    charLimit: number;
  };
}

/**
 * Assemble the full chat-completions prompt for a compose request.
 *
 * Layered the way SillyTavern layers a card: persona identity (system_prompt)
 * first, then platform rules, then the task, with the card's
 * `post_history_instructions` placed LAST as the strongest, most recent steer —
 * mirroring ST's "Post-History Instructions" slot. This module is the single
 * source of truth for prompt shape so Phase 2's browser extension can reuse it.
 */
export function assemblePrompt(params: AssembleParams): AssembledPrompt {
  const { card, platform, sourcePost, extraInstruction } = params;
  const cfg = resolvePlatformConfig(card, platform);
  const styleNotes = card.extensions?.persona_composer?.styleNotes;

  const systemBlocks = [
    buildPersonaBlock(card),
    "--- Output rules ---",
    buildPlatformRules(platform, cfg, styleNotes),
    "Output ONLY the post text itself — no preamble, no quotation marks, no commentary, no markdown. Stay fully in character.",
  ];

  const taskLines: string[] = [];
  const src = sourcePost?.trim();
  if (src) {
    taskLines.push(
      "Here is a post you are replying to:",
      "<<<POST",
      src,
      "POST>>>",
      "",
      `Write ${card.name}'s reply to it, in character.`,
    );
  } else {
    taskLines.push(
      `Compose a fresh, standalone ${PLATFORM_LABEL[platform]} post in ${card.name}'s voice. Make it feel native to the platform and worth posting on its own.`,
    );
  }
  if (extraInstruction?.trim()) {
    taskLines.push("", `Additional direction: ${extraInstruction.trim()}`);
  }

  // Post-history instructions: ST's final, highest-priority steer. Append it to
  // the END of the user turn rather than sending it as a trailing `system`
  // message. A system message placed AFTER the user turn is non-standard, and
  // some endpoints' chat templating (notably DeepSeek-V3.2 via Bedrock's
  // OpenAI-compatible endpoint) react by echoing the whole rendered prompt back
  // instead of replying. Keeping a clean system + user pair avoids that.
  const phi = card.post_history_instructions?.trim();
  if (phi) {
    taskLines.push("", `Above all: ${phi}`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemBlocks.join("\n\n") },
    { role: "user", content: taskLines.join("\n") },
  ];

  return { messages, meta: { platform, charLimit: cfg.charLimit } };
}
