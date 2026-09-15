import { parseEntities } from '../core/anonymise';

export const transformersJsResponseParserVersion =
  'transformersjs-json-fence-v2';

export function parseTransformersJsEntities(raw: string) {
  // Transformers.js has no built-in JSON-schema-constrained generation.
  // Qwen3 consistently wrapped JSON in this exact Markdown form during the
  // first hardware run. Normalize only that outer transport wrapper; do not
  // search for braces, strip reasoning/commentary, or repair partial output.
  const fenced = raw.match(/^```json\r?\n([\s\S]*)\r?\n```$/);
  return parseEntities(fenced?.[1] ?? raw);
}
