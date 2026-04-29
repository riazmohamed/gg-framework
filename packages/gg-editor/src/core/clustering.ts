/**
 * Take clustering — finds segments that are likely re-takes of the same line.
 *
 * v0 uses Jaccard similarity over normalized token sets. This is:
 *   - Free (no API call)
 *   - Deterministic
 *   - Fast: O(N * windowSize) where windowSize caps the comparison range
 *
 * Why Jaccard over embeddings? Re-takes typically share most words verbatim
 * (the speaker says the same thing 2-3 times to nail the delivery). Token
 * overlap catches this reliably. Embeddings would catch paraphrased re-takes
 * too, but at the cost of an API call per segment — moved to v1 if needed.
 */

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Cluster {
  id: number;
  /** Indexes into the original segments array (preserves source order). */
  memberIndexes: number[];
  members: Segment[];
}

export interface ClusterOptions {
  /** Jaccard threshold above which two segments are considered the same take. Default 0.6. */
  threshold?: number;
  /** Only compare segments within this many positions of each other. Default 100. */
  window?: number;
  /** Skip segments shorter than this many tokens (too short to be meaningful re-takes). Default 4. */
  minTokens?: number;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your",
  "my",
  "me",
  "um",
  "uh",
  "ah",
  "oh",
  "like",
  "yeah",
  "well",
  "okay",
  "ok",
  "just",
]);

/**
 * Normalize a segment to a token Set:
 *   - Lowercase
 *   - Strip punctuation
 *   - Drop stopwords + filler ("um", "uh", "like", "yeah", ...)
 *   - Drop tokens shorter than 2 chars
 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const t = raw.replace(/[^a-z0-9'-]/g, "");
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Group segments into clusters of likely re-takes.
 *
 * Returns clusters with size >= 2 only by default (singletons are not
 * interesting — they're just "things said once"). Use `includeSingletons`
 * for completeness.
 */
export function clusterSegments(
  segments: Segment[],
  opts: ClusterOptions & { includeSingletons?: boolean } = {},
): Cluster[] {
  const threshold = opts.threshold ?? 0.6;
  const window = opts.window ?? 100;
  const minTokens = opts.minTokens ?? 4;

  const n = segments.length;
  const tokens: Array<Set<string> | null> = segments.map((s) => {
    const tk = tokenize(s.text);
    return tk.size >= minTokens ? tk : null;
  });

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    const ti = tokens[i];
    if (!ti) continue;
    const limit = Math.min(n, i + window + 1);
    for (let j = i + 1; j < limit; j++) {
      const tj = tokens[j];
      if (!tj) continue;
      if (jaccard(ti, tj) >= threshold) union(i, j);
    }
  }

  // Group by root
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!tokens[i] && !opts.includeSingletons) continue;
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(i);
  }

  const result: Cluster[] = [];
  let id = 1;
  for (const indexes of buckets.values()) {
    if (indexes.length < 2 && !opts.includeSingletons) continue;
    result.push({
      id: id++,
      memberIndexes: indexes,
      members: indexes.map((i) => segments[i]),
    });
  }

  // Sort clusters by first occurrence so output is temporal.
  result.sort((a, b) => a.memberIndexes[0] - b.memberIndexes[0]);
  // Reassign IDs after sort.
  result.forEach((c, i) => (c.id = i + 1));
  return result;
}
