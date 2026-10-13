/**
 * `autogamer_diagnose` — environment and device diagnosis (Phase 2).
 *
 * Two sources merge here, and the merge is the point: the provider's
 * `mobile_diagnose` (device_serial only — the old face takes no
 * logcat/screenshot flags, so ours are accepted but not forwarded) plus OUR
 * local preflight. The tool doubles as the manual preflight entry, so unlike
 * its siblings it does NOT throw on a failed environment: it returns the
 * report with the local fixes appended to the recommendations. Only when the
 * provider itself is unreachable AND the environment is broken does it throw —
 * and then the preflight text (the actionable one) wins over the transport
 * error.
 */
import type { ArtemisBackend } from "../artemis/types.js";
import { preflightErrorText, type PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import { rulesFilePath, type RulesInjectionOutcome } from "../prompt/rulesInjector.js";

export interface DiagnoseDeps {
  backend: ArtemisBackend;
  checkEnv: () => Promise<PreflightResult>;
  defaultDeviceSerial: string;
  /** G80: why the provider rules did or did not reach the model, read at call time. */
  rulesStatus: () => RulesInjectionOutcome;
  artemisRepoPath: string;
}

export function defineDiagnose(deps: DiagnoseDeps): ToolDefinitionInput {
  return {
    name: "autogamer_diagnose",
    description:
      "Diagnose the Android device and the ARTEMIS environment (driven by Google ARTEMIS): " +
      "adb connection, Helper install, recent crashes, and actionable fix recommendations. " +
      "Also the manual entry for a fresh environment preflight.",
    parameters: {
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the default device.",
      },
      include_logcat: {
        type: "boolean",
        description: "Accepted; the provider decides what device logs to include.",
      },
      include_screenshot: {
        type: "boolean",
        description: "Accepted; the provider decides whether to attach a screenshot.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          device_serial: { type: "string", required: true },
          adb_connected: { type: "boolean", required: true },
          helper_installed: { type: "boolean", required: true },
          helper_version: { type: "string" },
          recent_crashes: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          logcat_path: { type: "string" },
          screenshot_path: { type: "string" },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const crashes = Array.isArray(record.recent_crashes) ? (record.recent_crashes as unknown[]).length : 0;
        const fixes = Array.isArray(record.recommendations) ? (record.recommendations as unknown[]).length : 0;
        return [
          {
            type: "text",
            text:
              `device_serial=${String(record.device_serial ?? "")}; ` +
              `adb_connected=${String(record.adb_connected ?? false)}; ` +
              `helper_installed=${String(record.helper_installed ?? false)}; ` +
              `recent_crashes=${crashes}; recommendations=${fixes}`,
          },
        ];
      },
    },
    async execute(args, exec) {
      const serial =
        typeof args.device_serial === "string" && args.device_serial.length > 0
          ? args.device_serial
          : deps.defaultDeviceSerial.length > 0
            ? deps.defaultDeviceSerial
            : undefined;
      const env = await deps.checkEnv();
      const localFixes = env.ok
        ? []
        : env.checks.filter((check) => !check.ok && check.fix).map((check) => check.fix as string);
      let diagnosis;
      try {
        diagnosis = await deps.backend.diagnose({ deviceSerial: serial }, exec?.signal);
      } catch (error) {
        if (!env.ok) throw new Error(preflightErrorText(env));
        throw error;
      }
      const recommendations = [...diagnosis.recommendations];
      for (const fix of localFixes) {
        if (!recommendations.includes(fix)) recommendations.push(fix);
      }
      // G80: rules injection failing silently was the whole defect - a missing provider
      // repo looked like a working plugin. `disabled` is the operator's choice, so it stays quiet.
      const rulesStatus = deps.rulesStatus();
      if (rulesStatus !== "injected" && rulesStatus !== "disabled") {
        const warning =
          `rules are NOT in the model's context (reason: ${rulesStatus} from ${rulesFilePath(
            deps.artemisRepoPath,
          )}); ` +
          "the device contract the tools rely on was never injected - set artemisRepoPath to a provider " +
          "checkout that carries mcp_server/rules.md, or turn injectRules off explicitly";
        if (!recommendations.includes(warning)) recommendations.push(warning);
      }
      return {
        device_serial: diagnosis.deviceSerial ?? serial ?? "",
        adb_connected: diagnosis.adbConnected ?? false,
        helper_installed: diagnosis.helperInstalled ?? false,
        ...(diagnosis.helperVersion !== undefined ? { helper_version: diagnosis.helperVersion } : {}),
        recent_crashes: diagnosis.recentCrashes.map((crash) => ({
          ...(crash.package !== undefined ? { package: crash.package } : {}),
          ...(crash.timestamp !== undefined ? { timestamp: crash.timestamp } : {}),
          ...(crash.stackExcerpt !== undefined ? { stack_excerpt: crash.stackExcerpt } : {}),
        })),
        ...(diagnosis.logcatPath !== undefined ? { logcat_path: diagnosis.logcatPath } : {}),
        ...(diagnosis.screenshotPath !== undefined ? { screenshot_path: diagnosis.screenshotPath } : {}),
        recommendations,
      };
    },
  };
}
