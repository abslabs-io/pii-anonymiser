import { parseEntities } from '../core/anonymise';

// The pinned WebLLM runtime adds this exact header to outputIds when
// enable_thinking=false. processNextToken decodes it into message.content,
// although it is outside the grammar-constrained JSON generation.
const emptyThinkingPrefix = '<think>\n\n</think>\n\n';
export const responseParserVersion = 'webllm-empty-thinking-v1';

export function parseWebLlmEntities(raw: string) {
  const content = raw.startsWith(emptyThinkingPrefix)
    ? raw.slice(emptyThinkingPrefix.length)
    : raw;
  // Do not extract arbitrary brace-delimited fragments, strip reasoning,
  // accept Markdown fences, or repair incomplete JSON.
  return parseEntities(content);
}
