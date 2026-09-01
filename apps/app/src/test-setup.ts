import { afterEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/// A passing run has no errors or warnings. This turns React's act(...) complaints into test
/// failures rather than console noise nobody reads.
///
/// Both of React's messages are the same defect wearing different clothes:
///   - "not wrapped in act(...)"            - an update with no scope around it;
///   - "not configured to support act(...)" - a scope running while the act environment is off,
///     which is what awaiting a testing-library query INSIDE an act scope does. Resolve the element
///     first, then act on it.
/// The second is intermittent, so it hides behind the first if only the first is caught.

const ACT_PATTERNS = [/not wrapped in act/i, /not configured to support act/i];

let expected: RegExp[] = [];

/// Declare that a test provokes a console error on purpose. Use this rather than spying on
/// console.error - a spy takes the console away from this guard for the length of the test.
export function expectsConsoleError(pattern: RegExp): void {
  expected.push(pattern);
}

const realError = console.error;

console.error = (...args: unknown[]): void => {
  const message = args
    .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
    .join(" ");

  if (expected.some((pattern) => pattern.test(message))) {
    return;
  }

  if (ACT_PATTERNS.some((pattern) => pattern.test(message))) {
    throw new Error(`React act() contract broken:\n${message}`);
  }

  realError(...args);
  throw new Error(`Unexpected console.error in test:\n${message}`);
};

afterEach(() => {
  cleanup();
  expected = [];
  vi.restoreAllMocks();
});

expect.extend({});
