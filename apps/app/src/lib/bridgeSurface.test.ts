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

/// The interfaces whose members must each be a method on the bridge.
///
/// One entry per group of calls the renderer makes on the shell. A new provider adds a group here
/// rather than a second copy of this test - which is the point: the guard has to grow with the
/// surface, or it goes on checking only the half of it that was written first.
const SURFACES = ["WorkspaceClient", "GitHubBridge"];

/// The member names of one interface in the client's source.
///
/// Read from the source rather than listed here, so a method added to the interface is covered
/// without anybody remembering to add it - which is the failure this is guarding against in the
/// first place.
function interfaceMethods(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, `${name} should exist in the client`).toBeGreaterThan(-1);

  const body = source.slice(start, source.indexOf("\n}", start));
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)].map((match) => match[1]!);
}

describe("the preload bridge", () => {
  it("answers every call the renderer's client makes", () => {
    const source = readFileSync(CLIENT, "utf8");
    const preload = readFileSync(PRELOAD, "utf8");

    const methods = SURFACES.flatMap((name) => interfaceMethods(source, name));
    // A regex that matched nothing would make this test pass by finding no work to do, which is the
    // one way a guard like this fails silently.
    expect(methods.length).toBeGreaterThan(5);

    const missing = methods.filter((method) => !new RegExp(`^ {2}${method}:`, "m").test(preload));
    expect(missing).toEqual([]);
  });

  /// Proof the scan reaches the newer surface as well as the original one.
  ///
  /// Without it, a typo in an interface name above would leave that group silently unchecked while
  /// this suite still passed on the other.
  it("covers the GitHub calls as well as the workspace ones", () => {
    const source = readFileSync(CLIENT, "utf8");
    expect(interfaceMethods(source, "GitHubBridge")).toContain("connectGitHub");
    expect(interfaceMethods(source, "WorkspaceClient")).toContain("openWorkspaceRef");
  });
});
