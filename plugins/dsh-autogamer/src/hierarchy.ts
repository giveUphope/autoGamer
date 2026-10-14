/**
 * Element targeting for `run_device_action` (S11 step 1).
 *
 * The action server answers `get_ui_hierarchy` with a JSON list of uiautomator
 * nodes, and its own `index` field is a PER-CONTAINER ordinal (measured on the
 * live device: 21 nodes carried only 5 distinct values), so it cannot address an
 * element. The list the model reads therefore numbers nodes by position in that
 * array (G42) — but a handle is RESOLVED by following the node's identity into
 * the next hierarchy, never by taking array position N again (G67: the screen
 * changes under a handle, and position resolution then taps whatever happens to
 * sit at N). An earlier version scanned the payload for `<node>` XML tags,
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
 * The label a node is shown to the model by — and therefore the only identity a
 * `#N` handle can carry: `formatVisibleElements` renders this and nothing else.
 */
export function labelOf(
  el: Pick<VisibleElement, "text" | "desc" | "resourceId" | "class">,
): string {
  return el.text || el.desc || el.resourceId || el.class || "";
}

interface NodeIdentity {
  label: string;
  /** How far this kind of label may be followed, in device px (see MAX_HANDLE_SHIFT). */
  bound: number;
  x: number;
  y: number;
}

// Upstream bounds EVERY shift it is willing to call "the same target moved"
// (precondition_xml.py:396-399: `100.0 * scale_factor`, 300 for a resource-id
// match), because "prefer disappeared over shifted" is the conservative
// direction (`:392-395`). scale_factor is 1 here: the plugin never works in
// downscaled screenshot space. An unbounded follow would let a node that
// vanished on this screen be silently answered by a same-labelled element on
// another one.
const MAX_HANDLE_SHIFT = 100;
const MAX_ID_HANDLE_SHIFT = 300;

function identityOf(el: VisibleElement): NodeIdentity {
  // The label is exactly what `formatVisibleElements` showed the model, so the
  // precedence is shared with it (labelOf). Only the REACH depends on which
  // field carried it: upstream gives a resource-id match more room than a text
  // one, and a bare class name is shared by many nodes.
  const label = labelOf(el);
  if (el.text || el.desc) return { label, bound: MAX_HANDLE_SHIFT, x: el.x, y: el.y };
  if (el.resourceId) return { label, bound: MAX_ID_HANDLE_SHIFT, x: el.x, y: el.y };
  if (el.class) return { label, bound: MAX_HANDLE_SHIFT, x: el.x, y: el.y };
  // Nothing identifies it, so the only thing to match on is where it was.
  return { label: `@${el.x},${el.y}`, bound: 0, x: el.x, y: el.y };
}

export type HandleResolution =
  | { status: "unobserved" }
  | { status: "unknown"; elementCount: number }
  | { status: "gone"; label: string }
  | { status: "resolved"; center: NodeCenter };

export type ObservedHandle =
  | { status: "unobserved" }
  | { status: "unknown"; elementCount: number }
  | { status: "ok"; element: VisibleElement };

/**
 * Does this handle belong to the list the model was shown? One definition of
 * "the live list owns this #N", used both to refuse before a fetch and to
 * resolve after one.
 */
export function handleFromObservation(
  observed: VisibleElement[] | undefined,
  index: number,
): ObservedHandle {
  if (!observed) return { status: "unobserved" };
  const element = observed.find((el) => el.index === index);
  if (!element) return { status: "unknown", elementCount: observed.length };
  return { status: "ok", element };
}

/**
 * Where did the node the model was shown as `#index` (in `observed`, the live
 * observation) go in the `fresh` hierarchy? Resolved by identity, never by
 * array position (G67): position re-resolution silently taps "whatever sits at
 * N now", which `inventory/04-agent-stack-config.md:203` lists as a safety
 * defect. Same-label candidates are disambiguated by proximity, and a candidate
 * further than that label can claim is treated as missing rather than moved.
 */
export function resolveHandle(
  observed: VisibleElement[] | undefined,
  fresh: VisibleElement[],
  index: number,
): HandleResolution {
  const handle = handleFromObservation(observed, index);
  if (handle.status !== "ok") return handle;
  const identity = identityOf(handle.element);
  let best: { el: VisibleElement; distance: number } | undefined;
  for (const el of fresh) {
    if (identityOf(el).label !== identity.label) continue;
    const distance = Math.hypot(el.x - identity.x, el.y - identity.y);
    if (!best || distance < best.distance) best = { el, distance };
  }
  // Nearest wins among same-labelled candidates, and a candidate further than
  // this label's reach is NOT the node we meant - upstream would rather report
  // it missing than act on it (`precondition_xml.py:392-395`).
  if (!best || best.distance > identity.bound) {
    return { status: "gone", label: identity.label };
  }
  return { status: "resolved", center: { x: best.el.x, y: best.el.y, text: identity.label } };
}

/**
 * The model-facing rendering of the same list. Kept deliberately compact: the
 * handle comes first, then whatever identifies the node, then whether it is
 * actionable.
 */
export function formatVisibleElements(elements: VisibleElement[]): string {
  if (elements.length === 0) return "[]";
  const lines = elements.map((el) => {
    const label = labelOf(el) || "(unlabeled)";
    const pkg = el.package ? ` pkg=${el.package}` : "";
    return `#${el.index} [${el.x},${el.y}]${el.clickable ? " clickable" : ""}${pkg} ${label}`;
  });
  return lines.join("\n");
}

export interface NodeCenter {
  x: number;
  y: number;
  text?: string;
}

export function findNodeCenterBySubstring(
  elements: VisibleElement[],
  needle: string,
): NodeCenter | undefined {
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
