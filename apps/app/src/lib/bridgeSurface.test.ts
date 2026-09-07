import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";

/// Every method the renderer calls on the shell must exist on the preload bridge.
///
/// This is a contract whose two sides must change together and which nothing else checks. The
/// renderer's `WorkspaceClient` is a TypeScript interface; the preload is plain JavaScript in
/// another process. TypeScript happily believes the interface, the shell tests happily exercise the
/// handlers, and a method the bridge spells differently - or never got - is a call that returns
/// `undefined is not a function` the first time a user reaches for the feature.
///
/// `outlineIpc.test.js` exists because of the same class of mistake one layer down: a schema added
/// to the domain and never exported from the barrel, which every test passed straight through.

const CLIENT = repoPath("apps", "app", "src", "lib", "workspaceClient.ts");
const PRELOAD = repoPath("apps", "desktop", "src", "preload.js");

/// The member names of the `WorkspaceClient` interface.
///
/// Read from the source rather than listed here, so a method added to the interface is covered
/// without anybody remembering to add it - which is the failure this is guarding against in the
/// first place.
function clientMethods(): string[] {
  const source = readFileSync(CLIENT, "utf8");
  const start = source.indexOf("export interface WorkspaceClient {");
  expect(start).toBeGreaterThan(-1);

  const body = source.slice(start, source.indexOf("\n}", start));
  const names = [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)].map((match) => match[1]!);
  // A regex that matched nothing would make this test pass by finding no work to do, which is the
  // one way a guard like this fails silently.
  expect(names.length).toBeGreaterThan(5);
  return names;
}

describe("the preload bridge", () => {
  it("answers every call the renderer's client makes", () => {
    const preload = readFileSync(PRELOAD, "utf8");
    const missing = clientMethods().filter(
      (method) => !new RegExp(`^ {2}${method}:`, "m").test(preload),
    );

    expect(missing).toEqual([]);
  });
});
