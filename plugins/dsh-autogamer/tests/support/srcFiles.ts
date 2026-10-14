import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Every TypeScript file under `dir`, so a source-level contract check cannot
 *  quietly stop covering a file that was added or renamed. */
export function* typescriptFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* typescriptFiles(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}
