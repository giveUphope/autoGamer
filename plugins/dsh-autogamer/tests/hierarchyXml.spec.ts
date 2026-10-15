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
  parseOccupants,
  readUiAutomationOccupants,
} from "../src/device/hierarchy.js";
import { parseVisibleElements } from "../src/hierarchy.js";
import { adbRuntime } from "./support/fakeAdb.js";

const A = adbRuntime;
const FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/hierarchy-chrome.xml", import.meta.url)),
  "utf8",
);
/** 真机原样摘录（2026-10-16，MuMu `emulator-5554`，`adb shell ps -A -o PID,ARGS`）；未加注释行。 */
const PS_FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/ps-PID-ARGS.txt", import.meta.url)),
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

describe("readUiAutomationOccupants (能力重审-2)", () => {
  const psArgv = /shell ps -A -o PID,ARGS/;

  /** A process table in the shape toybox prints: a header, then `pid args` rows. */
  function table(...rows: string[]): string {
    return [" PID   ARGS", ...rows].join("\n") + "\n";
  }

  it("names the holder when a uia2 server is in the table", async () => {
    A.on(psArgv, {
      code: 0,
      stdout: table(
        " 1 init [smu] ",
        " 1234 uiautomator",
        " 2201 app_process /system/bin com.wetest.uia2.Main -p 9008",
      ),
    });
    expect(await readUiAutomationOccupants("emulator-5554")).toEqual({
      state: "occupied",
      names: ["uiautomator2 server"],
    });
  });

  it("lists every holder it recognises, not just the first", async () => {
    A.on(psArgv, {
      code: 0,
      stdout: table(
        " 300 app_process /system/bin io.appium.uiautomator2.server.Instrumentation",
        " 400 app_process /system/bin com.github.uiautomator",
      ),
    });
    const readout = await readUiAutomationOccupants(undefined);
    expect(readout.state).toBe("occupied");
    expect(readout.names).toEqual(["openatx uiautomator app", "Appium uiautomator2 server"]);
  });

  it("asks through the one adb seam with the serial it was given", async () => {
    A.on(psArgv, { code: 0, stdout: table(" 1 init [smu] ") });
    await readUiAutomationOccupants("emulator-5554");
    expect(A.calls.map((args) => args.join(" "))).toEqual(["-s emulator-5554 shell ps -A -o PID,ARGS"]);
  });

  it("reports free only from a table it could actually read", async () => {
    A.on(psArgv, { code: 0, stdout: table(" 1 init [smu] ", " 700 com.android.systemui") });
    expect(await readUiAutomationOccupants(undefined)).toEqual({ state: "free", names: [] });
  });

  // The column layout of `ps -A -o PID,ARGS` has no measurement in this repo's
  // ledger, so the branch handling "could not read it" is what keeps the whole
  // read honest: a failure must never come back as a clean slot.
  it.each([
    ["a non-zero exit", { code: 1, stderr: "error: device offline" }],
    ["an error printed with code 0", { code: 0, stdout: "ps: unknown argument for -o\nUnknown command: -o" }],
    ["a header and no rows", { code: 0, stdout: " PID   ARGS\n" }],
    ["nothing at all", { code: 0, stdout: "" }],
    ["a timeout", { code: -1, timedOut: true }],
  ])("answers unknown, never free, for %s", async (_label, reply) => {
    A.on(psArgv, reply);
    expect(await readUiAutomationOccupants(undefined)).toEqual({ state: "unknown", names: [] });
  });

  it("parses a table without adb, for the shapes a device really prints", () => {
    expect(parseOccupants("")).toEqual({ state: "unknown", names: [] });
    expect(parseOccupants("error: device 'x' not found")).toEqual({ state: "unknown", names: [] });
    expect(parseOccupants(" PID   ARGS\n 1 init [smu] \n")).toEqual({ state: "free", names: [] });
    expect(parseOccupants(" PID   ARGS\n 9 androidx.test.runner.MonitoringInstrumentation\n").state).toBe("occupied");
  });

  /**
   * 真机复验（能力重审-2 留的那条 🔶）：`ps -A -o PID,ARGS` 的列布局本仓从没量过，
   * 「按整行匹配 marker」当初是**因为没量过**才这么写的。现在量了（夹具是设备原样摘录），
   * 这条锁把三件事钉住：表头确实被行规则排除（不是靠跳首行）、除表头外每一行都成了行、
   * 读出 `free` 是有证据的正读数。`unknown` 那态**没有**被这次测量收窄——收窄它等于
   * 对着「一行都没读出来」的表签发健康证明。
   */
  it("locks the measured device table shape, not a hand-written one", () => {
    const lines = PS_FIXTURE.replace(/\r/g, "").split("\n");
    expect(lines[0]).toMatch(/^\s*PID\s+ARGS\s*$/);
    const rows = lines.filter((l) => /^\s*\d+\s+\S/.test(l));
    const dataLines = lines.filter((l) => l.trim().length > 0 && !/^\s*PID\s+ARGS\s*$/.test(l));
    expect(rows).toEqual(dataLines);
    expect(rows.length).toBeGreaterThan(1);
    expect(parseOccupants(PS_FIXTURE)).toEqual({ state: "free", names: [] });
    // marker 落在 ARGS 的任意位置都算，因为它本来就是自由文本的余下部分
    const injected = [...lines.slice(0, 5), "  9999 com.wetest.uia2.Main -p 6746", ...lines.slice(5)].join("\n");
    expect(parseOccupants(injected)).toEqual({ state: "occupied", names: ["uiautomator2 server"] });
    // 只剩表头 = 读不出任何行，仍不许答「没人占」
    expect(parseOccupants(lines[0] ?? "")).toEqual({ state: "unknown", names: [] });
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
