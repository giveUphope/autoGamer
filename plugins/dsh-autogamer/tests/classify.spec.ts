import { describe, expect, it } from "vitest";
import { classifyActionFailure, classifyMessage, classifyTransportError } from "../src/classify.js";

describe("classify", () => {
  it("treats transport errors as environment", () => {
    expect(classifyTransportError(new Error("connection closed"))).toBe("environment");
  });

  it("maps action codes to the right failure class", () => {
    expect(classifyActionFailure({ ok: false, code: "TARGET_NOT_FOUND" })).toBe("task");
    expect(classifyActionFailure({ ok: false, code: "INVALID_ARGS" })).toBe("task");
    expect(classifyActionFailure({ ok: false, code: "PACKAGE_NOT_FOUND" })).toBe("task");
    expect(classifyActionFailure({ ok: false, code: "DEVICE_ERROR", message: "" })).toBe("environment");
    expect(classifyActionFailure({ ok: false, code: "TIMEOUT" })).toBe("environment");
  });

  it("falls back to marker matching for uncoded failures", () => {
    expect(classifyMessage("adb: device offline")).toBe("environment");
    expect(classifyMessage("no element matched 'submit button'")).toBe("task");
    expect(classifyMessage("connection refused by helper")).toBe("environment");
  });

  it("reads a legacy bare Failed as environment (fail-safe, S4)", () => {
    // normalizeOutcome maps the legacy "Failed" string to "device reported
    // failure"; the device marker then classifies environment. An
    // indistinguishable failure counts toward the breaker rather than slipping
    // through — that is the fail-safe side of the asymmetry, pinned here so a
    // future reclassification is deliberate.
    expect(classifyMessage("device reported failure")).toBe("environment");
  });

  it("a successful result never needs classification", () => {
    expect(classifyActionFailure({ ok: true, code: "OK" })).toBe("task");
  });
});
