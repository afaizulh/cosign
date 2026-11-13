import { KaryaModel, type KaryaPart } from "./models/karya.model";

/** Latest part per category for one karya (media paths). */
export function latestParts(parts: KaryaPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (!map[p.kategori]) map[p.kategori] = p.media_path;
  }
  return map;
}

/** Group parts by category (for the customizer / manage pages). */
export function partsByCategory(parts: KaryaPart[]): Record<string, KaryaPart[]> {
  const map: Record<string, KaryaPart[]> = {};
  for (const p of parts) {
    (map[p.kategori] ??= []).push(p);
  }
  return map;
}

/** Attach composition (latest parts + like count) to a list of karya rows. */
export function withComposition(items: unknown[], karya: KaryaModel) {
  return items.map((row) => {
    const k = row as Record<string, unknown>;
    return {
      ...k,
      parts: latestParts(karya.parts(String(k.id))),
      like_count: karya.likeCount(String(k.id)),
    };
  });
}