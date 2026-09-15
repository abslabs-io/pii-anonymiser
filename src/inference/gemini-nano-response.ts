import { parseEntities } from '../core/anonymise';

export const geminiNanoResponseParserVersion = 'gemini-nano-json-schema-v1';

export function parseGeminiNanoEntities(raw: string) {
  // The Prompt API constrains generation with the same JSON Schema used by
  // WebLLM. Do not strip wrappers, search for braces, or repair partial JSON.
  return parseEntities(raw);
}
