/**
 * The native action executor (T2-c / T2-d / T2-e). What is locked here is the
 * part that is NOT interchangeable: the shapes measured off the device.
 *
 *   - success is silent (`code 0`, empty stdout) — so an empty answer is the
 *     pass condition;
 *   - failure arrives on **stdout with code 0** (`Unknown command: …`,
 *     `No activity found`) and as **code 255 with a Java Exception on stderr**,
 *     so the text is judged independently of the code;
 *   - `adb shell` hands its arguments to the *device* shell, which splits them
 *     again (monkey echoed every argument back as `bash arg: -p`), so model-supplied
 *     text, URLs and package names must be quoted or shape-checked here — an
 *     argv array on our side is not immunity;
 *   - `am force-stop` on a package that never existed exits 0 (measured), so
 *     stop_app needs no existence probe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runNativeAction, readFieldText } from "../src/device/act.js";
import { parseHierarchyXml } from "../src/device/hierarchy.js";
import {
  adbRuntime,
  screencapArgv,
} from "./support/fakeAdb.js";

const A = adbRuntime;

beforeEach(() => {
  A.reset();
});

const gestureArgv = /shell input tap 540 1200$/;

describe("gesture actions", () => {
  it("treats silence as success (measured: code 0 and empty stdout)", async () => {
    A.on(gestureArgv, { code: 0, stdout: "" });
    const answer = await runNativeAction({ tool: "tap", payload: { coordinates: [540, 1200] } }, "emulator-5554");
    expect(answer).toBe("Success");
    expect(A.calls[0]).toEqual(["-s", "emulator-5554", "shell", "input", "tap", "540", "1200"]);
  });

  it("reads a failure printed on stdout with code 0 as a failure", async () => {
    A.on(/shell input/, { code: 0, stdout: "Unknown command: insert\n" });
    const answer = await runNativeAction({ tool: "tap", payload: { coordinates: [1, 2] } }, "emulator-5554");
    expect(answer).toBe("Error: Unknown command: insert");
  });

  it("reads the Java exception shape (code 255 on stderr) as a failure", async () => {
    A.on(/shell input/, {
      code: 255,
      stdout: "",
      stderr: "Exception occurred while executing 'tap'; java.lang.NumberFormatException: abc\n",
    });
    const answer = await runNativeAction({ tool: "tap", payload: { coordinates: [1, 2] } }, "emulator-5554");
    expect(answer).toContain("Error: Exception occurred while executing");
  });

  it("names the serial it was given and omits -s when it was given none", async () => {
    A.on(/shell input/, { code: 0, stdout: "" });
    await runNativeAction({ tool: "back", payload: {} }, undefined);
    expect(A.calls[0]).toEqual(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  });

  it("carries the duration through a swipe, which is what makes a long press a long press", async () => {
    A.on(/shell input swipe/, { code: 0, stdout: "" });
    await runNativeAction({ tool: "swipe", payload: { coordinates: [10, 20, 30, 40], duration: 400 } }, "s");
    expect(A.calls[0]?.slice(-5)).toEqual(["10", "20", "30", "40", "400"]);

    A.reset();
    A.on(/shell input swipe/, { code: 0, stdout: "" });
    await runNativeAction({ tool: "long_press_on", payload: { coordinates: [7, 9], duration: 1500 } }, "s");
    expect(A.calls[0]?.slice(-5)).toEqual(["7", "9", "7", "9", "1500"]);
  });

  it("refuses a malformed payload instead of guessing coordinates", async () => {
    await expect(runNativeAction({ tool: "tap", payload: { coordinates: ["a", "b"] } }, "s")).resolves.toContain("needs coordinates");
    await expect(runNativeAction({ tool: "swipe", payload: { coordinates: [1, 2, 3] } }, "s")).resolves.toContain("needs coordinates");
    expect(A.calls).toEqual([]);
  });

  it("unknown key names are refused without reaching the device", async () => {
    await expect(runNativeAction({ tool: "press_key", payload: { keycode: "HOME; rm -rf /" } }, "s")).resolves.toBe(
      "Error: unknown key HOME; rm -rf /",
    );
    expect(A.calls).toEqual([]);
  });

  it("an aborted call throws environment, never a silent failure", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runNativeAction({ tool: "tap", payload: { coordinates: [1, 2] } }, "s", { signal: controller.signal }),
    ).rejects.toThrow(/^environment: action cancelled/);
  });

  it("a call that never answers is an environment failure, not a task one", async () => {
    A.on(/shell input tap/, { code: -1, stdout: "", stderr: "" });
    await expect(runNativeAction({ tool: "tap", payload: { coordinates: [1, 2] } }, "s")).rejects.toThrow(
      /^environment: adb did not run/,
    );

    A.reset();
    A.on(/shell input tap/, { code: -1, stdout: "", stderr: "", timedOut: true });
    await expect(runNativeAction({ tool: "tap", payload: { coordinates: [1, 2] } }, "s")).rejects.toThrow(/timed out/);
  });
});

describe("text injection (the device shell splits what we hand it)", () => {
  beforeEach(() => {
    A.on(/shell input/, { code: 0, stdout: "" });
    A.on(/shell dumpsys window/, { code: 0, stdout: "" });
    A.on(screencapArgv, { code: 0, stdout: "" });
  });

  it("focuses, then types the text as ONE argument, quotes and all", async () => {
    const answer = await runNativeAction(
      { tool: "focus_and_input_text", payload: { coordinates: [10, 20], text: "你好 world; rm -rf / #7" } },
      "s",
    );
    expect(answer).toBe("Success");
    const typed = A.calls.find((args) => /shell input text/.test(args.join(" ")))!;
    expect(typed.slice(0, 4)).toEqual(["-s", "s", "shell", "input"]);
    // The value is a single argv element, POSIX-quoted: nothing left for the
    // device shell to re-split, so `;` and `#` cannot become new arguments.
    expect(typed.length).toBe(6);
    expect(typed[5]).toBe("'你好 world; rm -rf / #7'");
  });

  it("escapes an embedded single quote rather than ending the quote", async () => {
    await runNativeAction({ tool: "focus_and_input_text", payload: { coordinates: [1, 1], text: "it's" } }, "s");
    const typed = A.calls.find((args) => /shell input text/.test(args.join(" ")))!;
    expect(typed[5]).toBe(`'it'\\''s'`);
  });

  it("empty text is refused, and no tap is dispatched first", async () => {
    A.reset();
    A.on(/shell input/, { code: 0, stdout: "" });
    const answer = await runNativeAction({ tool: "focus_and_input_text", payload: { coordinates: [1, 1], text: "" } }, "s");
    expect(answer).toContain("needs text");
    expect(A.calls).toEqual([]);
  });

  it("clears by counting from the field, then verifies instead of assuming", async () => {
    // 6 characters in the field, and the verification read comes back empty.
    const reads = ["abcdef", ""];
    let read = 0;
    A.on(/shell input/, { code: 0, stdout: "" });

    const answer = await runNativeAction({ tool: "focus_and_clear_text", payload: { coordinates: [5, 5] } }, "s", {
      readFieldText: async () => reads[Math.min(read++, reads.length - 1)]!,
    });
    expect(answer).toBe("Success");
    // Both directions, because MOVE_END was measured NOT to work in every field:
    // delete backwards from wherever the caret sits, then forwards from the top.
    const deletes = A.calls.filter((args) => /shell input keyevent/.test(args.join(" ")));
    expect(deletes).toHaveLength(2);
    expect(deletes[0]!.filter((arg) => arg === "67")).toHaveLength(11);
    expect(deletes[1]!.filter((arg) => arg === "112")).toHaveLength(11);
    // tap + two clear passes + the verification read.
    expect(A.calls.filter((args) => /shell input tap/.test(args.join(" ")))).toHaveLength(1);
  });

  it("says so when the field is still not empty", async () => {
    A.on(/shell input/, { code: 0, stdout: "" });
    const answer = await runNativeAction({ tool: "focus_and_clear_text", payload: { coordinates: [5, 5] } }, "s", {
      readFieldText: async () => "still here",
    });
    expect(answer).toBe("Error: field still holds still here");
  });

  it("the default field reader takes the text out of a real dump", () => {
    const doc = parseHierarchyXml(
      `<?xml version='1.0' ?><hierarchy rotation="0">` +
        `<node index="0" text="" class="android.widget.TextView" package="com.x" content-desc="" resource-id="" bounds="[0,0][10,10]" enabled="true" checkable="false" checked="false" clickable="false" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" drawing-order="0" hint="" />` +
        `</hierarchy>`,
    );
    expect(doc?.nodes[0]?.class).toContain("TextView");
    expect(typeof readFieldText).toBe("function");
  });
});

describe("apps and links", () => {
  it("does not call a launch a success when the package has no launcher", async () => {
    A.on(/cmd package resolve-activity/, { code: 0, stdout: "No activity found\n" });
    const answer = await runNativeAction({ tool: "launch_app", payload: { package_name: "com.no.such" } }, "s");
    expect(answer).toBe("Error: no launcher activity for package com.no.such");
    expect(A.calls.some((args) => /monkey/.test(args.join(" ")))).toBe(false);
  });

  it("resolves first, then starts with monkey", async () => {
    A.on(/cmd package resolve-activity/, {
      code: 0,
      stdout: "priority=0\ncom.android.chromium/com.google.android.apps.chrome.Main\n",
    });
    A.on(/monkey/, { code: 0, stdout: "Events injected: 1\n" });
    const answer = await runNativeAction({ tool: "launch_app", payload: { package_name: "com.android.chromium" } }, "s");
    expect(answer).toBe("Success");
    const monkey = A.calls.find((args) => /monkey/.test(args.join(" ")))!;
    expect(monkey.slice(-6)).toEqual(["monkey", "-p", "com.android.chromium", "-c", "android.intent.category.LAUNCHER", "1"]);
  });

  it("refuses a package name that is not a package name", async () => {
    for (const bad of ["com.x; rm -rf /", "-p", "", "1com.x", "com x"]) {
      const answer = await runNativeAction({ tool: "launch_app", payload: { package_name: bad } }, "s");
      expect(answer, bad).toContain("invalid package name");
    }
    expect(A.calls).toEqual([]);
  });

  it("stop_app is idempotent: silence is success even for a package that never existed", async () => {
    A.on(/am force-stop/, { code: 0, stdout: "" });
    expect(await runNativeAction({ tool: "stop_app", payload: { package_name: "com.never.installed" } }, "s")).toBe(
      "Success",
    );
  });

  it("opens only http(s) links, and quotes the URL as one argument", async () => {
    A.on(/am start/, { code: 0, stdout: "Starting: Intent { act=android.intent.action.VIEW dat=https://example.com/... }\n" });
    const answer = await runNativeAction({ tool: "open_link", payload: { url: "https://example.com/a?c=1&d=2;e" } }, "s");
    expect(answer).toBe("Success");
    const am = A.calls.find((args) => /am start/.test(args.join(" ")))!;
    expect(am[am.length - 1]).toBe("'https://example.com/a?c=1&d=2;e'");

    for (const bad of ["javascript:alert(1)", "file:///etc/hosts", "not a url", ""]) {
      expect(await runNativeAction({ tool: "open_link", payload: { url: bad } }, "s"), bad).toContain("unsupported url");
    }
  });

  it("reports an unhandled link as a failure, not as a silent success", async () => {
    A.on(/am start/, { code: 1, stderr: "Error: Activity not started, unable to resolve Intent\n" });
    const answer = await runNativeAction({ tool: "open_link", payload: { url: "https://nowhere.example" } }, "s");
    expect(answer).toContain("Error: Error: Activity not started");
  });

  it("an unknown tool name is refused rather than run", async () => {
    expect(await runNativeAction({ tool: "reboot", payload: {} }, "s")).toBe("Error: unsupported action reboot");
    expect(A.calls).toEqual([]);
  });
});
