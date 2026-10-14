/**
 * A test-boundary view of the plugin's Config schema.
 *
 * `@deepseek-ai/schemastery` ships no nameable Schema type from this package,
 * so `src/index.ts` declares the export as `object` (the host calls it, but the
 * type does not say so). A Schemastery schema IS a callable normalizer — the
 * loader calls the row's Config with the patch's `config` block and reads the
 * filled-in object back — so specs that need to build a config go through here.
 *
 * This lives in tests on purpose: the production type stays exactly what the
 * host contract justifies, and the narrowing to a callable sits at the one
 * boundary that knows it is a test (R21: a mirror must declare its provenance,
 * and this one is declared rather than smuggled into src).
 */
import { Config } from "../../src/index.js";

export type ConfigCallable = (data?: unknown) => Record<string, unknown>;

export const configOf = Config as unknown as ConfigCallable;