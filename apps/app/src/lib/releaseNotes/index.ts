/// Barrel: types and RECENT only.
///
/// Deliberately does NOT re-export ARCHIVE. Adding it here is the single edit that would undo the
/// bundle boundary, which is why bundleBoundary.test.ts checks this file by name.
export type { Epoch, Release, SpineEntry } from "./types";
export { RECENT } from "./current";
export { ARCHIVED_SPINE, EPOCHS, OPEN_EPOCH_ID } from "./epochs";
