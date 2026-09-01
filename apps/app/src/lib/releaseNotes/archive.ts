import type { Release } from "./types";

/// Every release already covered by an epoch. Grows without bound and must NEVER reach the initial
/// bundle: only the epoch drill-down page may import this module, and the barrel must not re-export
/// it. bundleBoundary.test.ts asserts that directly, because nothing else would catch it - an eager
/// `import { ARCHIVE }` type-checks, renders correctly, and passes every other test while putting
/// the whole history on every page load.
export const ARCHIVE: Release[] = [];
