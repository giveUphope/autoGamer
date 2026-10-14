/**
 * Hierarchy payloads in the device's own wire form (T2-b). The ladder,
 * observation and dedup specs used to hand the router a JSON list, because that
 * is what the py action server invented; the router now reads the device's XML,
 * so the same node sets are built here. `bounds` is the only form the device
 * prints: `[l,t][r,b]`.
 */
export interface XmlNodeSpec {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function xmlNode(
  text: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): XmlNodeSpec {
  return { text, left, top, right, bottom };
}

export function hierarchyXml(nodes: readonly XmlNodeSpec[]): string {
  const body = nodes
    .map(
      (node) =>
        `<node index="0" text="${node.text}" resource-id="" class="android.widget.TextView" ` +
        `package="com.android.settings" content-desc="" checkable="false" checked="false" ` +
        `clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" ` +
        `long-clickable="false" password="false" selected="false" ` +
        `bounds="[${node.left},${node.top}][${node.right},${node.bottom}]" drawing-order="0" hint="" />`,
    )
    .join("\n  ");
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<hierarchy rotation="0">\n  ${body}\n</hierarchy>`;
}

/** The two settings rows most tests need an observation of. */
export const TWO_ROWS_XML = hierarchyXml([
  xmlNode("亮度", 40, 400, 200, 460),
  xmlNode("显示", 40, 600, 200, 660),
]);
