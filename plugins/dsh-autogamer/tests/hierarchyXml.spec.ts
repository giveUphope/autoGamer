/**
 * The native hierarchy path (T2-b / G83). Two halves:
 *
 *   - the READ: `uiautomator dump` must never be trusted on its exit code or its
 *     message (measured: code 139 on success, and a success line printed for a
 *     path that does not exist), so the only answer is the file read back and
 *     validated;
 *   - the PARSE: against a real dump (tests/fixtures/hierarchy-chrome.xml, taken
 *     from `emulator-5554` on 2026-10-15, left verbatim) - mixed self-closing and
 *     paired tags, 19 attributes, entities, CJK text, and bounds in the rotated
 *     frame space.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isHierarchyXml,
  parseBounds,
  parseHierarchyXml,
  dumpPath,
  readHierarchyXml,
  decodeXmlEntities,
} from "../src/device/hierarchy.js";
import { parseVisibleElements } from "../src/hierarchy.js";
import { adbRuntime } from "./support/fakeAdb.js";

const A = adbRuntime;
const FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/hierarchy-chrome.xml", import.meta.url)),
  "utf8",
);

const dumpArgv = /shell uiautomator dump /;
const catArgv = /exec-out cat \/sdcard\/dsh-autogamer-hierarchy-/;
const rmArgv = /shell rm \/sdcard\/dsh-autogamer-hierarchy-/;

beforeEach(() => {
  A.reset();
});

describe("readHierarchyXml", () => {
  it("reads the dump back instead of believing the exit code", async () => {
    // Measured: `uiautomator dump` answers 139 + "UI hierchary dumped to: …"
    // even when it worked, so the double answers that way and the read must still succeed.
    A.on(dumpArgv, { code: 139, stdout: "UI hierchary dumped to: /sdcard/x.xml\r\n" });
    A.on(catArgv, { code: 0, stdout: FIXTURE });
    A.on(rmArgv, { code: 0, stdout: "" });
    const xml = await readHierarchyXml("emulator-5554");
    expect(xml).toBe(FIXTURE);
    expect(A.calls.some((args) => rmArgv.test(args.join(" ")))).toBe(true);
    expect(A.calls[0]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "uiautomator",
      "dump",
      expect.stringMatching(/^\/sdcard\/dsh-autogamer-hierarchy-\d+\.xml$/),
    ]);
  });

  /** The other half of the same measurement: a *failed* dump also prints the
   * success line, so the answer must be judged on bytes, not on the message. */
  it("answers nothing when the file is not a hierarchy, whatever dump said", async () => {
    A.on(dumpArgv, { code: 139, stdout: "UI hierchary dumped to: /sdcard/x.xml\r\n" });
    A.on(catArgv, { code: 0, stdout: "cat: /sdcard/x.xml: No such file or directory\n" });
    A.on(rmArgv, { code: 0, stdout: "" });
    expect(await readHierarchyXml("emulator-5554")).toBeUndefined();

    A.reset();
    A.on(dumpArgv, { code: 0, stdout: "" });
    A.on(catArgv, { code: 0, stdout: "<?xml version='1.0' ?><hierarchy rotation=\"0\"></hierarchy>" });
    A.on(rmArgv, { code: 0, stdout: "" });
    expect(await readHierarchyXml("emulator-5554")).toBeUndefined();
  });

  it("still cleans the device up when the read fails", async () => {
    A.on(dumpArgv, { code: 0, stdout: "" });
    A.on(catArgv, { code: 1, stderr: "cat: remote doesn't exist" });
    A.on(rmArgv, { code: 0, stdout: "" });
    await readHierarchyXml("emulator-5554");
    expect(A.calls.filter((args) => rmArgv.test(args.join(" ")))).toHaveLength(1);
  });

  it("names the dump after this process, so two instances do not read each other's file", () => {
    expect(dumpPath()).toBe(`/sdcard/dsh-autogamer-hierarchy-${process.pid}.xml`);
  });
});

describe("isHierarchyXml / parseBounds / entities", () => {
  it("recognises a real dump and rejects a truncated one", () => {
    expect(isHierarchyXml(FIXTURE)).toBe(true);
    expect(isHierarchyXml(FIXTURE.slice(0, 200))).toBe(false);
    expect(isHierarchyXml("<hierarchy rotation=\"0\"></hierarchy>")).toBe(false);
  });

  it("reads the only bounds form the device prints", () => {
    expect(parseBounds("[0,0][1600,900]")).toEqual({ left: 0, top: 0, right: 1600, bottom: 900 });
    expect(parseBounds("[0,31][1600,900]")).toEqual({ left: 0, top: 31, right: 1600, bottom: 900 });
    expect(parseBounds("0,0,1600,900")).toBeUndefined();
    expect(parseBounds(undefined)).toBeUndefined();
  });

  it("decodes the entities a text field can carry", () => {
    expect(decodeXmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeXmlEntities("&quot;close&quot; &lt;tab&gt;")).toBe('"close" <tab>');
    expect(decodeXmlEntities("it&apos;s")).toBe("it's");
    expect(decodeXmlEntities("&#65;&#x42;")).toBe("AB");
    expect(decodeXmlEntities("keep &nope; as-is")).toBe("keep &nope; as-is");
  });
});

describe("parseHierarchyXml against the real dump", () => {
  const doc = parseHierarchyXml(FIXTURE);

  it("flattens all 45 nodes in document order and reads the root rotation", () => {
    expect(doc?.nodes).toHaveLength(45);
    expect(doc?.rotation).toBe(1);
  });

  it("tracks depth across both tag forms", () => {
    // Proven on a tree whose shape is known by construction, not on the fixture:
    // one self-closing sibling and one open parent with a child.
    const synthetic = parseHierarchyXml(
      `<?xml version='1.0' ?><hierarchy rotation="0">` +
        `<node index="0" text="a" bounds="[0,0][10,10]" />` +
        `<node index="1" text="b" bounds="[0,10][10,20]">` +
        `<node index="0" text="c" bounds="[0,20][10,30]" />` +
        `</node>` +
        `</hierarchy>`,
    );
    expect(synthetic?.nodes.map((node) => [node.text, node.depth])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
    ]);

    const depths = doc?.nodes.map((node) => node.depth) ?? [];
    expect(depths[0]).toBe(0);
    expect(Math.max(...depths)).toBe(14);
    // A depth can only grow by one between consecutive nodes: that is what a
    // stack gives and what a "count the openers" shortcut gets wrong.
    for (let i = 1; i < depths.length; i += 1) expect(depths[i]! - depths[i - 1]!).toBeLessThanOrEqual(1);
  });

  it("carries the fields the handle rules depend on", () => {
    const withText = doc?.nodes.filter((node) => node.text.length > 0) ?? [];
    expect(withText.map((node) => node.text)).toEqual(["ZONEE你好", "https://example.com"]);
    const chrome = withText.find((node) => node.text === "https://example.com");
    expect(chrome?.package).toBe("com.android.chromium");
    expect(chrome?.bounds).toBeDefined();

    const described = doc?.nodes.find((node) => node.contentDesc.includes("下载内容")) ?? undefined;
    expect(described?.contentDesc).toBe("下载内容, 标签页");
  });

  it("answers undefined for anything that is not a node tree", () => {
    expect(parseHierarchyXml("not xml at all")).toBeUndefined();
    expect(parseHierarchyXml("<hierarchy rotation=\"0\"></hierarchy>")).toBeUndefined();
  });
});

describe("parseVisibleElements: the XML entry", () => {
  const elements = parseVisibleElements(FIXTURE);

  it("numbers every bounded node by position, not by the node's own index field", () => {
    expect(elements).toBeDefined();
    expect(elements?.length).toBeGreaterThan(0);
    expect(elements?.map((el) => el.index)).toEqual(elements?.map((_el, i) => i));
    // The fixture's own `index` attributes repeat per container (measured), which
    // is exactly why the handle cannot be that field (G42).
    const raw = [...FIXTURE.matchAll(/<node index="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(raw).size).toBeLessThan(raw.length);
  });

  it("centers come from the device bounds in frame space", () => {
    const full = elements?.[0];
    expect(full).toMatchObject({ x: 800, y: 450, package: "com.android.chromium" });
  });

  it("gives both entries the same shape: the py JSON list and the device XML", () => {
    // Same node, two wire forms. `parsed_bounds` is what the py server invented;
    // the XML carries the device's own bounds string, and both must land on the
    // identical element record - otherwise every handle lock would need doubling.
    const asJson = JSON.stringify([
      {
        index: "0",
        text: "ZONEE你好",
        "content-desc": "标签页",
        "resource-id": "com.android.chromium:id/url",
        class: "android.widget.EditText",
        package: "com.android.chromium",
        clickable: "true",
        parsed_bounds: { left: 0, top: 31, right: 1600, bottom: 900 },
      },
    ]);
    const asXml =
      `<?xml version='1.0' ?><hierarchy rotation="1">` +
      `<node index="0" text="ZONEE你好" resource-id="com.android.chromium:id/url" ` +
      `class="android.widget.EditText" package="com.android.chromium" content-desc="标签页" ` +
      `checkable="false" checked="false" clickable="true" enabled="true" focusable="false" ` +
      `focused="false" scrollable="false" long-clickable="false" password="false" selected="false" ` +
      `bounds="[0,31][1600,900]" drawing-order="0" hint="" />` +
      `</hierarchy>`;
    expect(parseVisibleElements(asXml)).toEqual(parseVisibleElements(asJson));
    expect(parseVisibleElements(FIXTURE)?.find((el) => el.text === "ZONEE你好")).toBeDefined();
  });

  it("still answers undefined for a payload that is neither", () => {
    expect(parseVisibleElements("null")).toBeUndefined();
    expect(parseVisibleElements("{}")).toBeUndefined();
    expect(parseVisibleElements("<node ")).toBeUndefined();
  });
});
