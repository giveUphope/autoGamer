/**
 * Minimal uiautomator-dump XML parsing for target resolution (S11 step 1).
 * Only what the router needs: find a node whose text/content-desc/resource-id
 * contains the target text, and read its bounds center. Full index-based
 * targeting (the visible-elements list) lands with hierarchy wiring in P1.
 */

export interface NodeCenter {
  x: number;
  y: number;
  text?: string;
}

export function findNodeCenterBySubstring(
  xml: string,
  needle: string,
): NodeCenter | undefined {
  const lowered = needle.toLowerCase();
  const nodePattern = /<node\b[^>]*>/g;
  let match: RegExpExecArray | null | undefined;
  let best: { center: NodeCenter; exact: boolean } | undefined; // eslint-disable-line
  while ((match = nodePattern.exec(xml)) !== null) {
    const tag = match[0];
    const text = attr(tag, "text");
    const desc = attr(tag, "content-desc");
    const resource = attr(tag, "resource-id");
    const candidates = [text, desc, resource].filter(
      (value): value is string => Boolean(value),
    );
    const hit: string | undefined = candidates.find((value) => value.toLowerCase().includes(lowered));
    if (hit === undefined) continue;
    const center = boundsCenter(tag);
    if (!center) continue;
    const exact = hit.toLowerCase() === lowered;
    if (best === undefined || (exact && !best.exact)) best = { center: { ...center, text: hit }, exact };
    if (best.exact) break;
  }
  return best?.center;
}

export function findNodeCenterByIndex(xml: string, index: number): NodeCenter | undefined {
  const nodePattern = /<node\b[^>]*>/g;
  let match: RegExpExecArray | null | undefined;
  let seen = -1;
  while ((match = nodePattern.exec(xml)) !== null) {
    seen += 1;
    if (seen === index && match) return boundsCenter(match[0]);
  }
  return undefined;
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1];
}

function boundsCenter(tag: string): { x: number; y: number } | undefined {
  const bounds = attr(tag, "bounds");
  if (!bounds) return undefined;
  const numbers = bounds.match(/\d+/g);
  if (!numbers || numbers.length < 4) return undefined;
  const left = Number(numbers[0]);
  const top = Number(numbers[1]);
  const right = Number(numbers[2]);
  const bottom = Number(numbers[3]);
  if (right <= left || bottom <= top) return undefined;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}
