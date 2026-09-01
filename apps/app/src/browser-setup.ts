import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "./index.css";

/// Setup for the real-browser suite.
///
/// Deliberately smaller than the jsdom one. There are no geometry polyfills here because there is
/// real geometry - that is the entire reason this suite exists.
///
/// The stylesheet is imported because these tests assert on rendered appearance, and appearance in
/// this app comes from Tailwind and from CodeMirror's own themes. Without it the assertions would be
/// measuring an unstyled page and quietly passing or failing for the wrong reason.

afterEach(() => {
  cleanup();
});
