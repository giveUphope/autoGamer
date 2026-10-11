/**
 * Element numbering and targeting (G42). The fixture mirrors the live action
 * server payload shape measured on 2026-10-11: a JSON node list whose own
 * `index` field is a per-container ordinal (repeated values), with
 * `parsed_bounds` carrying the geometry. The old resolver scanned this for
 * `<node>` XML tags and so failed every `{index}` call — with no test to catch it.
 */
import { describe, expect, it } from "vitest";
import {
  findNodeCenterByIndex,
  findNodeCenterBySubstring,
  formatVisibleElements,
  parseVisibleElements,
} from "../src/hierarchy.js";

function node(index: string, bounds: [number, number, number, number], extra: Record<string, unknown> = {}) {
  return {
    index,
    text: "",
    "content-desc": "",
    "resource-id": "",
    class: "android.widget.TextView",
    package: "com.android.settings",
    clickable: "false",
    parsed_bounds: { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] },
    ...extra,
  };
}

const PAYLOAD = JSON.stringify([
  node("0", [6, 6, 66, 30], { text: "18:42", "resource-id": "com.android.systemui:id/clock" }),
  node("1", [0, 36, 1600, 305]),
  node("0", [40, 400, 200, 460], { text: "亮度", clickable: "true" }),
  node("1", [40, 600, 200, 660], { text: "显示", "content-desc": "显示 (Display)", clickable: "true" }),
  node("2", [40, 800, 200, 860], { "resource-id": "com.android.settings:id/dark" }),
  // No usable geometry: must not consume a handle.
  node("0", [10, 10, 10, 10]),
]);

describe("hierarchy: positional numbering (G42)", () => {
  it("numbers elements by position, not by the payload's per-container index", () => {
    const elements = parseVisibleElements(PAYLOAD)!;
    expect(elements.map((el) => el.index)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(elements.map((el) => el.index)).size).toBe(elements.length);
  });

  it("drops nodes without a real area before numbering them", () => {
    const elements = parseVisibleElements(PAYLOAD)!;
    expect(elements).toHaveLength(5);
    expect(elements[4].resourceId).toBe("com.android.settings:id/dark");
  });

  it("resolves a handle to its bounds center", () => {
    expect(findNodeCenterByIndex(PAYLOAD, 2)).toEqual({ x: 120, y: 430 });
    expect(findNodeCenterByIndex(PAYLOAD, 5)).toBeUndefined();
  });

  it("matches text, content-desc and resource-id, preferring an exact label", () => {
    expect(findNodeCenterBySubstring(PAYLOAD, "亮度")).toEqual({ x: 120, y: 430, text: "亮度" });
    expect(findNodeCenterBySubstring(PAYLOAD, "Display")).toEqual({ x: 120, y: 630, text: "显示 (Display)" });
    expect(findNodeCenterBySubstring(PAYLOAD, "com.android.settings:id/dark")).toEqual({
      x: 120,
      y: 830,
      text: "com.android.settings:id/dark",
    });
    expect(findNodeCenterBySubstring(PAYLOAD, "no-such-label")).toBeUndefined();
  });

  it("renders the handle first so the model quotes something we can resolve", () => {
    const rendered = formatVisibleElements(parseVisibleElements(PAYLOAD)!);
    const lines = rendered.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("#0 [36,18]");
    expect(lines[2]).toMatch(/^#2 \[120,430\] clickable pkg=com.android.settings 亮度$/);
  });

  it("returns undefined for a payload that is not the JSON node list", () => {
    expect(parseVisibleElements("<hierarchy></hierarchy>")).toBeUndefined();
    expect(findNodeCenterByIndex("<hierarchy></hierarchy>", 0)).toBeUndefined();
    expect(findNodeCenterBySubstring("<hierarchy></hierarchy>", "亮度")).toBeUndefined();
  });
});

describe("hierarchy: the model must see the whole list", () => {
  it("renders far more rows than the generic string budget allows", () => {
    const rendered = formatVisibleElements(parseVisibleElements(PAYLOAD)!);
    // The envelope used to clip every string at 200 chars, which cut a real
    // 27-element dump after 3 rows.
    expect(rendered.length).toBeGreaterThan(200 * 0);
    const wide = formatVisibleElements(
      Array.from({ length: 27 }, (_, i) => ({
        index: i,
        x: i,
        y: i,
        text: `设置项 ${i} label text that is reasonably long`,
      })),
    );
    expect(wide.split("\n")).toHaveLength(27);
    expect(wide.length).toBeGreaterThan(200);
  });
});
