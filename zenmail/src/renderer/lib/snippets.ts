/**
 * Pure snippets-data helpers — no React/store imports (mirrors coach.ts/latency.ts, DECISIONS D10 pattern).
 * Consumed by store/mail.ts and exercised directly by snippets.test.ts.
 */
import type { SnippetRecord } from '../../shared/types';

export const SNIPPETS_KEY = 'snippets';

/** True when `v` has the shape of a well-formed SnippetRecord (all fields present, correctly typed). */
function isValidRecord(v: unknown): v is SnippetRecord {
  if (v == null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.body === 'string' &&
    typeof r.createdAt === 'number'
  );
}

/**
 * Parses a persisted snippets JSON string into a SnippetRecord[], never throwing.
 * Malformed JSON, a non-array root, or individually-corrupt items are dropped rather than
 * crashing the caller — a stored setting should never be able to break the app on load.
 */
export function parseSnippets(raw: string | null | undefined): SnippetRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidRecord);
}

/** Case-insensitive substring match over name/body. Blank/whitespace-only query returns the full list. */
export function filterSnippets(list: SnippetRecord[], query: string): SnippetRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (s) => s.name.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
  );
}

/**
 * Converts plain text into a DocumentFragment, one text node per line joined by <br> elements.
 * No HTML-escaping is needed: text assigned via `document.createTextNode` is never parsed as
 * markup (unlike innerHTML) — the browser renders it verbatim, so e.g. "<img src=x>" ends up as
 * literal text, not an element (see DECISIONS D5).
 */
export function textToFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    fragment.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) fragment.appendChild(document.createElement('br'));
  });
  return fragment;
}

/** Builds a fresh SnippetRecord with a random id and the given creation timestamp. */
export function newSnippet(name: string, body: string, now: number): SnippetRecord {
  return { id: crypto.randomUUID(), name, body, createdAt: now };
}
