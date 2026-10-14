import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
    // The adb double installs globally: the device layer spawns adb for the
    // roster, the state probes and the screen-size probe, and a suite must not
    // depend on a device being plugged into the machine running it.
    setupFiles: ["tests/support/adbMock.ts"],
  },
});
