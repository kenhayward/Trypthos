import type { Epoch, SpineEntry } from "./types";

/// Reserved epoch id, serving /release-notes/current. A real epoch taking it would silently shadow
/// the newest releases, so epochs.test.ts refuses it.
export const OPEN_EPOCH_ID = "current";

/// Named spans, newest first. Closing an epoch is a deliberate, separate PR - never something an
/// ordinary release PR does.
export const EPOCHS: Epoch[] = [];

/// Version and date for EVERY archived release, in the same order as ARCHIVE. Mirrors it exactly;
/// epochs.test.ts asserts that. An epoch stores no count or date span - both are derived from this,
/// because a stored copy would be a second derivation agreeing only by luck.
export const ARCHIVED_SPINE: SpineEntry[] = [];
