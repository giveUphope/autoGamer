/**
 * Element targeting for `run_device_action` (S11 step 1).
 *
 * The action server answers `get_ui_hierarchy` with a JSON list of uiautomator
 * nodes, and its own `index` field is a PER-CONTAINER ordinal (measured on the
 * live device: 21 nodes carried only 5 distinct values), so it cannot address an
 * element. Both the list the model reads and the lookup that resolves it
 * therefore number nodes by position in that same array — one numbering, no
 * ambiguity (G42). An earlier version scanned the payload for `<node>` XML tags,
 * which never matched and made `{index}` fail on every call.
 */

export interface VisibleElement {
  /** Our positional handle, 0-based, in array order. */
  index: number;
  x: number;
  y: number;
  text?: string;
  desc?: string;
  resourceId?: string;
  class?: string;
  package?: string;
  clickable?: boolean;
  center?: { x: number; y: number };
}

interface RawNode {
  text?: unknown;
  "content-desc"?: unknown;
  "resource-id"?: unknown;
  class?: unknown;
  package?: unknown;
  clickable?: unknown;
  parsed_bounds?: unknown;
  bounds?: unknown;
}

/** Parse the action server's hierarchy payload; undefined when it is not JSON. */
export function parseVisibleElements(payload: string): VisibleElement[] | undefined {
  let nodes: unknown;
  try {
    nodes = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!Array.isArray(nodes)) return undefined;
  const out: VisibleElement[] = [];
  for (const node of nodes as RawNode[]) {
    const center = centerOf(node);
    if (!center) continue;
    out.push({
      index: out.length,
      x: center.x,
      y: center.y,
      text: typeof node?.text === "string" && node.text ? node.text : undefined,
      desc: typeof node?.["content-desc"] === "string" && node["content-desc"] ? node["content-desc"] : undefined,
      resourceId: typeof node?.["resource-id"] === "string" && node["resource-id"] ? node["resource-id"] : undefined,
      class: typeof node?.class === "string" ? node.class : undefined,
      package: typeof node?.package === "string" ? node.package : undefined,
      clickable: node?.clickable === true || node?.clickable === "true",
    });
  }
  return out;
}

/**
 * The model-facing rendering of the same list. Kept deliberately compact: the
 * handle comes first, then whatever identifies the node, then whether it is
 * actionable.
 */
export function formatVisibleElements(elements: VisibleElement[]): string {
  if (elements.length === 0) return "[]";
  const lines = elements.map((el) => {
    const label = el.text || el.desc || el.resourceId || el.class || "(unlabeled)";
    const pkg = el.package ? ` pkg=${el.package}` : "";
    return `#${el.index} [${el.x},${el.y}]${el.clickable ? " clickable" : ""}${pkg} ${label}`;
  });
  return lines.join("\n");
}

export function findNodeCenterByIndex(
  payload: string,
  index: number,
): NodeCenter | undefined {
  const elements = parseVisibleElements(payload);
  if (!elements) return undefined;
  const hit = elements.find((el) => el.index === index);
  return hit ? { x: hit.x, y: hit.y } : undefined;
}

export interface NodeCenter {
  x: number;
  y: number;
  text?: string;
}

export function findNodeCenterBySubstring(
  payload: string,
  needle: string,
): NodeCenter | undefined {
  const elements = parseVisibleElements(payload);
  if (!elements) return undefined;
  const lowered = needle.toLowerCase();
  let best: { center: NodeCenter; exact: boolean } | undefined;
  for (const el of elements) {
    const candidates = [el.text, el.desc, el.resourceId].filter(
      (value): value is string => Boolean(value),
    );
    const hit = candidates.find((value) => value.toLowerCase().includes(lowered));
    if (hit === undefined) continue;
    const exact = hit.toLowerCase() === lowered;
    if (!best || (exact && !best.exact)) best = { center: { x: el.x, y: el.y, text: hit }, exact };
    if (best.exact) break;
  }
  return best?.center;
}

function centerOf(node: RawNode): { x: number; y: number } | undefined {
  const bounds = node?.parsed_bounds;
  if (bounds && typeof bounds === "object") {
    const { left, top, right, bottom } = bounds as Record<string, unknown>;
    if (typeof left === "number" && typeof top === "number" && typeof right === "number" && typeof bottom === "number") {
      return midpoint(left, top, right, bottom);
    }
  }
  // Legacy fallback: "bounds" as "[l,t][r,b]" style strings.
  const numbers = typeof node?.bounds === "string" ? node.bounds.match(/-?\d+/g) : undefined;
  if (numbers && numbers.length >= 4) {
    return midpoint(Number(numbers[0]), Number(numbers[1]), Number(numbers[2]), Number(numbers[3]));
  }
  return undefined;
}

function midpoint(left: number, top: number, right: number, bottom: number) {
  if (right <= left || bottom <= top) return undefined;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}
