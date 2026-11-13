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
  const rows = items as Array<Record<string, unknown>>;
  // Batch two queries for the whole list instead of 2 queries per karya (N+1).
  const ids = rows.map((k) => String(k.id));
  const partsByKarya = karya.partsForMany(ids);
  const likesByKarya = karya.likeCountsForMany(ids);
  return rows.map((k) => {
    const id = String(k.id);
    return {
      ...k,
      parts: latestParts(partsByKarya[id] ?? []),
      like_count: likesByKarya[id] ?? 0,
    };
  });
}