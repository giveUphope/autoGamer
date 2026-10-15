/**
 * Build hygiene: tsc appends into outDir and never deletes an emitted file
 * whose source was removed. A plain `tsc` build therefore accumulates stale
 * outputs, and the dist glob in the package's files list ships every one of
 * them in the packed bundle — bundle verification once found the deleted
 * actionClient, mcpText, scrcpy and prompt/rulesInjector modules still inside
 * the tarball. Wipe dist before every build so the emitted tree can only
 * mirror src.
 */
import { rmSync } from "node:fs";

rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
