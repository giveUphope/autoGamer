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

  it("a successful result never needs classification", () => {
    expect(classifyActionFailure({ ok: true, code: "OK" })).toBe("task");
  });
});
