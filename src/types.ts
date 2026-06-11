// Shared types for persona-composer.

export type Platform = "x" | "instagram";

/** Hashtag policy hint passed into prompt assembly. */
export type HashtagPolicy = "none" | "sparing" | "liberal";

/** Per-platform style/constraint config, stored in a card's
 *  `extensions.persona_composer.platforms[platform]`. All fields optional;
 *  the loader fills in defaults. */
export interface PlatformConfig {
  /** Hard character budget for the composed post. */
  charLimit?: number;
  /** Free-text tone hint, e.g. "punchy, lowercase, terminally online". */
  tone?: string;
  hashtagPolicy?: HashtagPolicy;
  /** Free-text emoji guidance, e.g. "none" or "one trailing emoji max". */
  emojiPolicy?: string;
}

/** The persona-composer extension block embedded in a character card. */
export interface PersonaComposerExtension {
  platforms?: Partial<Record<Platform, PlatformConfig>>;
  /** Extra cross-platform style notes folded into the system prompt. */
  styleNotes?: string;
}

/** Minimal view of a SillyTavern V2/V3 character card's `data` object,
 *  limited to the fields this tool reads. */
export interface CharacterCardData {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  tags?: string[];
  extensions?: {
    persona_composer?: PersonaComposerExtension;
    [key: string]: unknown;
  };
}

/** A V2 (`chara_card_v2`) or V3 (`chara_card_v3`) character card. */
export interface CharacterCard {
  spec?: string;
  spec_version?: string;
  data: CharacterCardData;
}

/** A loaded persona: the card plus its derived id. */
export interface Persona {
  id: string;
  card: CharacterCardData;
}

/** Summary returned by GET /personas. */
export interface PersonaSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  platforms: Platform[];
}

/** Body of POST /compose. */
export interface ComposeRequest {
  personaId: string;
  platform: Platform;
  sourcePost?: string;
  extraInstruction?: string;
}

/** One message in an OpenAI-compatible chat-completions request. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
