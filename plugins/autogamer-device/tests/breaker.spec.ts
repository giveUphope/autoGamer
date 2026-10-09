import { describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";

describe("DeviceBreaker", () => {
  it("opens after allowedFails environment failures and blocks admission", () => {
    const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 60_000 });
    expect(breaker.canAdmit("d")).toBe(true);
    breaker.recordEnvironmentFailure("d");
    expect(breaker.stateOf("d")).toBe("open");
    expect(breaker.canAdmit("d")).toBe(false);
  });

  it("never opens on task-level failures", () => {
    const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 60_000 });
    for (let i = 0; i < 10; i += 1) breaker.recordTaskFailure("d");
    expect(breaker.stateOf("d")).toBe("closed");
    expect(breaker.canAdmit("d")).toBe(true);
  });

  it("moves to half-open after cooldown and admits exactly one probe", () => {
    let clock = 0;
    const breaker = new DeviceBreaker({
      allowedFails: 1,
      cooldownMs: 1_000,
      now: () => clock,
    });
    breaker.recordEnvironmentFailure("d");
    expect(breaker.canAdmit("d")).toBe(false);

    clock += 1_001;
    expect(breaker.stateOf("d")).toBe("half-open");
    expect(breaker.canAdmit("d")).toBe(true);
    expect(breaker.canAdmit("d")).toBe(false); // single probe
  });

  it("a failing probe re-opens with a fresh cooldown; success closes", () => {
    let clock = 0;
    const breaker = new DeviceBreaker({
      allowedFails: 1,
      cooldownMs: 1_000,
      now: () => clock,
    });
    breaker.recordEnvironmentFailure("d");
    clock += 1_001;
    expect(breaker.canAdmit("d")).toBe(true);
    breaker.recordEnvironmentFailure("d");
    clock += 500;
    expect(breaker.stateOf("d")).toBe("open"); // fresh window, not half-open

    clock += 501;
    expect(breaker.canAdmit("d")).toBe(true);
    breaker.recordSuccess("d");
    expect(breaker.stateOf("d")).toBe("closed");
    expect(breaker.canAdmit("d")).toBe(true);
  });

  it("keys are isolated", () => {
    const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 60_000 });
    breaker.recordEnvironmentFailure("phone-a");
    expect(breaker.stateOf("phone-a")).toBe("open");
    expect(breaker.stateOf("phone-b")).toBe("closed");
  });
});
