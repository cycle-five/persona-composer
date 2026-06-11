import fs from "node:fs/promises";
import path from "node:path";
import type {
  CharacterCard,
  CharacterCardData,
  Persona,
  PersonaSummary,
  Platform,
} from "./types";

/** Normalize a V2/V3 card (or a bare `data` object) into CharacterCardData.
 *  Tolerates both `{ spec, data: {...} }` wrappers and flat card objects. */
function normalizeCard(raw: unknown): CharacterCardData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data =
    obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : obj;
  if (typeof data.name !== "string" || data.name.trim() === "") return null;
  return data as unknown as CharacterCardData;
}

/** Derive a stable, url-safe id from a file name (sans extension). */
function idFromFilename(file: string): string {
  return path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Which platforms a persona has explicit config for (falls back to both). */
function platformsFor(card: CharacterCardData): Platform[] {
  const platforms = card.extensions?.persona_composer?.platforms;
  if (platforms) {
    const keys = Object.keys(platforms) as Platform[];
    if (keys.length > 0) return keys;
  }
  return ["x", "instagram"];
}

/** Load every *.json card in `dir` into a map keyed by derived id.
 *  Invalid files are skipped with a warning rather than aborting the load. */
export async function loadPersonas(dir: string): Promise<Map<string, Persona>> {
  const personas = new Map<string, Persona>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.warn(
      `[persona-composer] could not read personas dir ${dir}:`,
      (err as Error).message,
    );
    return personas;
  }

  for (const entry of entries.sort()) {
    if (!entry.toLowerCase().endsWith(".json")) continue;
    const full = path.join(dir, entry);
    try {
      const text = await fs.readFile(full, "utf8");
      const card = normalizeCard(JSON.parse(text) as CharacterCard);
      if (!card) {
        console.warn(`[persona-composer] skipping ${entry}: no valid card data`);
        continue;
      }
      const id = idFromFilename(entry);
      if (personas.has(id)) {
        console.warn(`[persona-composer] duplicate persona id "${id}" (${entry})`);
      }
      personas.set(id, { id, card });
    } catch (err) {
      console.warn(
        `[persona-composer] skipping ${entry}:`,
        (err as Error).message,
      );
    }
  }
  return personas;
}

export function summarize(persona: Persona): PersonaSummary {
  const { id, card } = persona;
  return {
    id,
    name: card.name,
    description: (card.creator_notes || card.description || "").slice(0, 280),
    tags: card.tags ?? [],
    platforms: platformsFor(card),
  };
}
