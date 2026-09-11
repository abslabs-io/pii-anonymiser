export const categories = [
  'PERSON',
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'DATE_OF_BIRTH',
  'ID',
  'ACCOUNT',
] as const;

export type Category = (typeof categories)[number];
export type Entity = { text: string; category: Category };
export type Span = Entity & { start: number; end: number; token: string };
export type Anonymised = { original: string; output: string; spans: Span[] };

export class DetectionError extends Error {}

export function parseEntities(raw: string): Entity[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DetectionError(
      'The model returned invalid JSON. No anonymised output was produced. Inspect the model response for details.',
    );
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('entities' in value) ||
    !Array.isArray(value.entities) ||
    value.entities.length > 100
  ) {
    throw new DetectionError(
      'The model returned an invalid entity list. No output was produced.',
    );
  }
  return value.entities.map((entity: unknown) => {
    if (
      !entity ||
      typeof entity !== 'object' ||
      !('text' in entity) ||
      !('category' in entity) ||
      typeof entity.text !== 'string' ||
      !entity.text.trim() ||
      !categories.includes(entity.category as Category)
    ) {
      throw new DetectionError(
        'The model returned an invalid entity. No output was produced.',
      );
    }
    return { text: entity.text, category: entity.category as Category };
  });
}

const word = /[\p{L}\p{N}\p{M}_]/u;

// Work from the original JS string. Never trim, normalise, or regenerate it.
export function anonymise(original: string, entities: Entity[]): Anonymised {
  const candidates: Omit<Span, 'token'>[] = [];
  const labels = new Map<string, Category>();
  for (const entity of entities) {
    if (!entity.text.trim())
      throw new DetectionError('Empty entity text cannot be replaced.');
    const existing = labels.get(entity.text);
    if (existing && existing !== entity.category) {
      throw new DetectionError(
        'The model assigned conflicting categories to the same text. No output was produced.',
      );
    }
    if (existing) continue;
    labels.set(entity.text, entity.category);
    let found = false;
    let from = 0;
    while (from < original.length) {
      const start = original.indexOf(entity.text, from);
      if (start < 0) break;
      const end = start + entity.text.length;
      const before = Array.from(original.slice(0, start)).at(-1) ?? '';
      const after = Array.from(original.slice(end))[0] ?? '';
      const first = Array.from(entity.text)[0];
      const last = Array.from(entity.text).at(-1)!;
      if (
        !(word.test(first) && word.test(before)) &&
        !(word.test(last) && word.test(after))
      ) {
        candidates.push({ ...entity, start, end });
        found = true;
      }
      from = start + 1;
    }
    if (!found)
      throw new DetectionError(
        'A model detection did not match a complete span in the original text. No output was produced.',
      );
  }

  // A containing entity wins (e.g. an email over a name inside it).
  const accepted: Omit<Span, 'token'>[] = [];
  for (const candidate of candidates.sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  )) {
    if (
      accepted.some(
        (span) => span.start <= candidate.start && span.end >= candidate.end,
      )
    )
      continue;
    if (
      accepted.some(
        (span) => span.start < candidate.end && candidate.start < span.end,
      )
    ) {
      throw new DetectionError(
        'The model returned partially overlapping detections. No output was produced.',
      );
    }
    accepted.push(candidate);
  }
  const tokens = new Map<string, string>();
  const counters = new Map<Category, number>();
  const spans = accepted
    .sort((a, b) => a.start - b.start)
    .map((span) => {
      const key = JSON.stringify([span.category, span.text]);
      let token = tokens.get(key);
      if (!token) {
        let count = counters.get(span.category) ?? 0;
        do {
          token = `[${span.category}_${++count}]`;
        } while (original.includes(token));
        counters.set(span.category, count);
        tokens.set(key, token);
      }
      return { ...span, token };
    });
  let cursor = 0;
  let output = '';
  for (const span of spans) {
    output += original.slice(cursor, span.start) + span.token;
    cursor = span.end;
  }
  return { original, output: output + original.slice(cursor), spans };
}
