/**
 * Browser-half locks (Phase 3). client.js is hand-written plain JS in the
 * deployment's ModuleLoader format (tsc cannot emit it), so it cannot be
 * `import`ed under node. Most of it is still asserted on text - the same way
 * deliveryShape locks the two patch files against each other:
 * - the manifest half (dsh.client + ./client export + files entry);
 * - the proven call shape (ModuleLoader id, require('react'), slots
 *   inject/register, the five wire-tool keys on tool.call.toolview);
 * - NEGATIVE locks: the cut APIs (conversation.card, ctx.rpc, per-plugin
 *   settings slot, binary push, fetch/WebSocket polling) must never reappear.
 *
 * The prop-reading half is NOT a text lock (交付-2). Evaluating the file with a
 * stub `window.__ModuleLoader__`, a fake `require('react')` and a fake slots ctx
 * is enough to build the real components, so they are called with the props the
 * Host actually passes and the rendered tree is asserted. A substring lock here
 * stayed green through a mutation that disabled the read it was supposed to
 * guard (measured, 2026-10-16) - which is exactly why behaviour, not text, is on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FakeElement {
  tag: unknown;
  props: Record<string, unknown> | null;
  kids: unknown[];
}

/** Evaluate client.js against stub globals and return the components it registers, by wire key. */
function loadCards(): Record<string, (props: unknown) => FakeElement> {
  const source = readFileSync(fileURLToPath(new URL("../client.js", import.meta.url)), "utf-8");
  let factory: ((req: unknown) => { inject: string[]; apply: (ctx: unknown) => void }) | undefined;
  const stubWindow = {
    __ModuleLoader__: {
      load: (entry: { id: string; factory: typeof factory }) => {
        factory = entry.factory;
      },
    },
  };
  const fakeReact = {
    createElement: (tag: unknown, props: Record<string, unknown> | null, ...kids: unknown[]): FakeElement => ({
      tag,
      props,
      kids: kids.flat(),
    }),
  };
  // `window` is not a Node global: pass it in so the file's top-level call resolves.
  // The loader hands `require` to both the top level and the factory, so the stub is
  // shared - `factory(require)` calls it itself.
  const requireStub = (name: string) => {
    if (name === "react") return fakeReact;
    throw new Error(`unexpected require: ${name}`);
  };
  new Function("window", "require", source)(stubWindow, requireStub);
  expect(factory, "client.js never reached __ModuleLoader__.load").toBeTypeOf("function");
  const cards: Record<string, (props: unknown) => FakeElement> = {};
  const ctx = {
    slots: {
      inject: (_slot: string, build: () => void) => build(),
      register: (def: { key?: string }, component: (props: unknown) => FakeElement) => {
        if (def.key) cards[def.key] = component;
      },
    },
  };
  // The loader hands the factory its `require` (official decoration template), so
  // the stub must be passed there, not only at the file's top level.
  factory!(requireStub).apply(ctx);
  return cards;
}

/** Flatten the fake tree into the text a user would read, plus the tag names seen. */
function flatten(node: FakeElement): { texts: string[]; tags: string[] } {
  const texts: string[] = [];
  const tags: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string" || typeof n === "number") {
      texts.push(String(n));
      return;
    }
    if (!n || typeof n !== "object") return;
    const el = n as FakeElement;
    if (typeof el.tag === "string") tags.push(el.tag);
    for (const kid of el.kids ?? []) walk(kid);
  };
  walk(node);
  return { texts, tags };
}

/** The registry is keyed by wire tool name; a missing cell is a failure, not undefined. */
function cardOf(
  cards: Record<string, (props: unknown) => FakeElement>,
  key: string,
): (props: unknown) => FakeElement {
  const card = cards[key];
  if (!card) throw new Error(`no card registered for ${key}`);
  return card;
}

/** The exact props shape measured off a live host (2026-10-16, fiber of a mounted card). */
function hostProps(input: {
  toolName: string;
  text: string;
  meta?: Record<string, unknown> | null;
  isError?: boolean;
  phase?: string;
}) {
  return {
    callId: "call-1",
    toolName: input.toolName,
    phase: input.phase ?? "result",
    block: {
      kind: "tool-result",
      seq: 3,
      time: 0,
      callId: "call-1",
      call: { name: input.toolName, argsRaw: "{}" },
      callTime: 0,
      content: [{ type: "text", text: input.text }],
      isError: input.isError ?? false,
      meta: input.meta ?? null,
      subCalls: [],
    },
    openFile: () => {},
    cwd: "D:\\DEV\\autoGamer",
    home: "C:\\Users\\test",
    loadImage: () => {},
  };
}

const CLIENT = readFileSync(fileURLToPath(new URL("../client.js", import.meta.url)), "utf-8");
const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
) as {
  dsh?: { client?: { platform?: string; immediately?: boolean; inject?: string[] } };
  exports?: Record<string, string>;
  files?: string[];
};

describe("browser half: manifest declares the client artifact", () => {
  it("carries a dsh.client section in the proven shape", () => {
    expect(MANIFEST.dsh?.client?.platform).toBe("web");
    expect(MANIFEST.dsh?.client?.immediately).toBe(true);
    expect(MANIFEST.dsh?.client?.inject).toEqual(["slots"]);
  });

  it("exports ./client and ships client.js", () => {
    expect(MANIFEST.exports?.["./client"]).toBe("./client.js");
    expect(MANIFEST.files).toContain("client.js");
  });
});

describe("browser half: client.js keeps the proven ModuleLoader shape", () => {
  it("registers the loader id and takes React from the browser module table", () => {
    expect(CLIENT).toContain("window.__ModuleLoader__.load({");
    expect(CLIENT).toContain("id: 'dsh-autogamer'");
    expect(CLIENT).toContain("require('react')");
  });

  it("injects slots and registers all five task toolviews by wire key", () => {
    expect(CLIENT).toContain("inject: ['slots']");
    expect(CLIENT).toContain("ctx.slots.inject('tool.call.toolview'");
    for (const tool of [
      "autogamer_run_task",
      "autogamer_manage_task",
      "autogamer_inspect_trace",
      "autogamer_diagnose",
      "autogamer_get_device_state",
    ]) {
      expect(CLIENT, `toolview key for ${tool}`).toContain(`'${tool}'`);
    }
  });

  it("imports nothing but react: no second framework, no host client code", () => {
    expect(CLIENT).not.toMatch(/require\(['"`](?!react['"`])/);
    expect(CLIENT).not.toContain("from '@deepseek-ai/");
  });

  it("never references the cut APIs (Phase 0 verdicts)", () => {
    for (const banned of [
      "conversation.card",
      "ctx.rpc",
      "settings.plugin.item",
      "WebSocket",
      "VideoDecoder",
      "multipart/x-mixed-replace",
    ]) {
      expect(CLIENT, `cut API must stay out: ${banned}`).not.toContain(banned);
    }
    expect(CLIENT).not.toMatch(/\bfetch\s*\(/);
  });
});

/**
 * The card must read the props the Host actually passes. Measured live (2026-10-16)
 * by walking the fiber of a mounted card: the slot hands `{callId, toolName, phase,
 * block}` and the answer lives in `block.content` / `block.meta` / `block.isError`.
 * Reading `props.result` instead is what made every card render an empty shell, so
 * these locks call the registered components with that exact shape and look at what
 * comes back. They are behaviour locks on purpose: a substring lock over the same
 * file stayed green after the read it guarded was disabled (measured).
 */
describe("browser half: cards render the measured prop path", () => {
  it("turns the tool's own `k=v` envelope into rows", () => {
    const cards = loadCards();
    const run = flatten(cardOf(cards, "autogamer_run_task")(hostProps({
      toolName: "autogamer_run_task",
      text: "task_id=autogamer-task-1; status=running; profile=flash; device_serial=emulator-5554",
      meta: { taskId: "autogamer-task-1", status: "running" },
    })));
    expect(run.texts).toContain("task_id");
    expect(run.texts).toContain("autogamer-task-1");
    expect(run.texts).toContain("profile");
    expect(run.texts).toContain("flash");
    expect(run.texts).toContain("running");
    // `meta.taskId` is the same fact spelled differently - one row, not two.
    expect(run.texts).not.toContain("taskId");
  });

  it("shows diagnose's facts, including the ones the model must not be told twice", () => {
    const cards = loadCards();
    const out = flatten(cardOf(cards, "autogamer_diagnose")(hostProps({
      toolName: "autogamer_diagnose",
      text: "device_serial=emulator-5554; adb_connected=true; helper_installed=true; recent_crashes=7; recommendations=1; ocr_ready=true; hierarchy=free; host_timeouts=0; provider=not-configured",
    })));
    for (const fact of ["device_serial", "adb_connected", "recent_crashes", "ocr_ready", "hierarchy"]) {
      expect(out.texts, `row for ${fact}`).toContain(fact);
    }
    expect(out.texts).toContain("7");
    expect(out.texts).toContain("free");
  });

  it("labels a failed call failed instead of dressing it up as a state", () => {
    const cards = loadCards();
    const out = flatten(cardOf(cards, "autogamer_run_task")(hostProps({
      toolName: "autogamer_run_task",
      text: 'task: no element matching text "商店" in the current hierarchy',
      isError: true,
    })));
    expect(out.texts).toContain("failed");
    expect(out.texts).toContain("error");
    expect(out.texts.join(" ")).toContain("no element matching text");
  });

  it("reports the phase while the call is still taking shape", () => {
    const cards = loadCards();
    const out = flatten(cardOf(cards, "autogamer_manage_task")(hostProps({
      toolName: "autogamer_manage_task",
      text: "task_id=autogamer-task-1; state=running; steps=0/? (0 recent); last=",
      phase: "args",
    })));
    expect(out.texts).toContain("args");
  });

  it("invents nothing when the Host passes no block", () => {
    const cards = loadCards();
    const out = flatten(cardOf(cards, "autogamer_run_task")({ callId: "x", toolName: "autogamer_run_task" }));
    expect(out.texts).not.toContain("running");
    expect(out.tags).not.toContain("dt");
  });

  it("renders the device-state card from its own envelope (the fifth cell)", () => {
    const cards = loadCards();
    const out = flatten(cardOf(cards, "autogamer_get_device_state")(hostProps({
      toolName: "autogamer_get_device_state",
      // Measured live 2026-10-16: the value itself carries "|" separators.
      text: "device_serial=emulator-5554; connected=true; current_package=com.taptap; " +
        "screen_summary=connected | screen on and unlocked | frame 900x1600 | helper APK installed; " +
        "accessibility_helper_installed=true",
    })));
    expect(out.texts).toContain("connected true");
    for (const key of ["device_serial", "connected", "current_package", "screen_summary", "accessibility_helper_installed"]) {
      expect(out.texts, `row for ${key}`).toContain(key);
    }
    // A "|" inside a value is content, not a separator.
    expect(out.texts).toContain("connected | screen on and unlocked | frame 900x1600 | helper APK installed");
  });

  it("no longer pretends the Host passes result / value / output", () => {
    for (const dead of ["props.result", "props.value", "props.output"]) {
      expect(CLIENT, `the Host never passes ${dead}`).not.toContain(dead);
    }
    // A badge that falls back to "running" is a health statement nobody measured.
    expect(CLIENT).not.toContain("'running'");
  });
});
