/**
 * The legacy action server answers in plain strings or MCP content arrays;
 * every consumer needs the same text unwrapping.
 */

export function unwrapText(structured: unknown): string {
  if (typeof structured === "string") return structured;
  const record = (structured ?? {}) as Record<string, unknown>;
  if (typeof record.result === "string") return record.result;
  if (Array.isArray(record.content)) {
    return record.content
      .map((piece) =>
        typeof piece === "object" && piece !== null && "text" in piece
          ? String((piece as { text: unknown }).text)
          : "",
      )
      .join("\n");
  }
  return JSON.stringify(structured ?? {});
}
