/**
 * Element numbering and targeting (G42) plus handle resolution by identity
 * (G67) — the handle follows the node it was shown as, never array position N.
 * The fixture mirrors the live action
 * server payload shape measured on 2026-10-11: a JSON node list whose own
 * `index` field is a per-container ordinal (repeated values), with
 * `parsed_bounds` carrying the geometry. The old resolver scanned this for
 * `<node>` XML tags and so failed every `{index}` call — with no test to catch it.
 */
import { describe, expect, it } from "vitest";
import {
  findNodeCenterBySubstring,
  formatVisibleElements,
  parseVisibleElements,
  resolveHandle,
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

  it("resolves a handle against the list the model was shown, not thin air", () => {
    const observed = parseVisibleElements(PAYLOAD)!;
    expect(resolveHandle(observed, observed, 2)).toEqual({
      status: "resolved",
      center: { x: 120, y: 430, text: "亮度" },
    });
    // A handle outside the live observation is a caller bug, not a transient screen.
    expect(resolveHandle(observed, observed, 5)).toEqual({ status: "unknown", elementCount: 5 });
    expect(resolveHandle(undefined, observed, 0)).toEqual({ status: "unobserved" });
  });

  it("follows a handle to where its identity moved, never to whatever sits at N", () => {
    const observed = parseVisibleElements(PAYLOAD)!;
    // Three nodes inserted before 亮度, and it drifted 5px on its own.
    const shifted = parseVisibleElements(
      JSON.stringify([
        node("0", [0, 0, 40, 40], { text: "新" }),
        node("1", [0, 40, 40, 80], { text: "更" }),
        node("2", [0, 80, 40, 120], { text: "新" }),
        node("0", [45, 405, 205, 465], { text: "亮度", clickable: "true" }),
        node("1", [40, 900, 200, 960], { text: "显示", "content-desc": "显示 (Display)" }),
      ]),
    )!;
    // Positional resolution would return this tree's #2 ("新" at (20,100)).
    expect(resolveHandle(observed, shifted, 2)).toEqual({
      status: "resolved",
      center: { x: 125, y: 435, text: "亮度" },
    });
    expect(resolveHandle(observed, shifted, 4)).toEqual({
      status: "gone",
      label: "com.android.settings:id/dark",
    });
  });

  it("only follows a bare class name a short way (content identifies, class does not)", () => {
    const observed = parseVisibleElements(PAYLOAD)!;
    // #1 was a class-labeled TextView container centered at (800,170).
    const far = parseVisibleElements(JSON.stringify([node("0", [1200, 1400, 1360, 1460])]))!;
    expect(resolveHandle(observed, far, 1)).toEqual({
      status: "gone",
      label: "android.widget.TextView",
    });
    const near = parseVisibleElements(JSON.stringify([node("0", [0, 120, 1600, 380])]))!;
    expect(resolveHandle(observed, near, 1)).toMatchObject({ status: "resolved" });
  });

  it("matches text, content-desc and resource-id, preferring an exact label", () => {
    const elements = parseVisibleElements(PAYLOAD)!;
    expect(findNodeCenterBySubstring(elements, "亮度")).toEqual({ x: 120, y: 430, text: "亮度" });
    expect(findNodeCenterBySubstring(elements, "Display")).toEqual({ x: 120, y: 630, text: "显示 (Display)" });
    expect(findNodeCenterBySubstring(elements, "com.android.settings:id/dark")).toEqual({
      x: 120,
      y: 830,
      text: "com.android.settings:id/dark",
    });
    expect(findNodeCenterBySubstring(elements, "no-such-label")).toBeUndefined();
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
    expect(resolveHandle(parseVisibleElements("[]"), parseVisibleElements(PAYLOAD)!, 0)).toEqual({
      status: "unknown",
      elementCount: 0,
    });
  });
});

describe("hierarchy: the model must see the whole list", () => {
  it("renders far more rows than the generic string budget allows", () => {
    const rendered = formatVisibleElements(parseVisibleElements(PAYLOAD)!);
    // The envelope used to clip every string at 200 chars, which cut a real
    // 27-element dump after 3 rows.
    expect(rendered.length).toBeGreaterThan(200);
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
