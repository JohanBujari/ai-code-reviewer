/**
 * Robustly extract the JSON payload from a model response that may contain
 * markdown fences, prose preamble, or other surrounding text.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    /* fall through */
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const candidate = fenceMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* fall through */
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* fall through */
    }
  }

  return text;
}
