# Google Drive - PR 1: Connect a Google account - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can connect and disconnect a Google account from Settings -> Accounts, through Google's sign-in page in their browser, with the refresh token encrypted in the main process and never visible to the renderer.

**Architecture:** Pure OAuth pieces (URLs, request bodies, redirect parsing, response schemas, error mapping) live in `packages/domain/src/googleAuth.ts`. The shell gains `googleClient.js` (finds the OAuth client config: a file shipped in the installer, or a dev env var) and `googleAuth.js` (loopback listener + PKCE + token lifecycle), wired into four `google:*` IPC channels. The renderer gets a `GoogleBridge`, a `useGoogle` hook and a `GoogleAccountSection` in Settings -> Accounts. No workspace kind, no settings version change - those are PR 2.

**Tech Stack:** TypeScript + zod (domain), Electron CommonJS + `node:http`/`node:crypto` + `net.fetch` (shell), React 19 + react-i18next + Tailwind v4 (renderer), vitest (domain, renderer), `node --test` (shell).

**Spec:** `docs/specs/google-drive-workspace.md` - read "What the spike established", "Decisions taken", and the PR 1 parts of "Architecture" before starting.

**Delivery:** ONE PR from branch `claude/google-drive-workspace-7a679d` (already holds the spec and this plan). Commit after every task; push and open the PR in the last task only.

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine: no warnings, no `console.error` (the jsdom setup fails a test on one; in shell tests inject a `logger` that collects instead of using `console`).
- Commands run from the repo root. `npm ci`, never `npm install`. **No new dependencies** in this PR.
- Domain package: no React, Electron, `fs` or `node:*` imports. Tests sit beside modules with `import { describe, expect, it } from "vitest";`.
- Shell: CommonJS. Tests in `apps/desktop/test/*.test.js` with `node:test` + `node:assert/strict`. Every name destructured from `@trypthos/domain` must be exported from `packages/domain/src/index.ts` (`domainExports.test.js` enforces it). The desktop `pretest` builds the domain first.
- Failures cross IPC as results `{ ok: false, reason }`, never throws.
- **Tokens:** the refresh token is stored with `accounts.setToken("google-drive", ...)` and only after sign-in fully succeeded. The access token lives only in `googleAuth.js` memory. No IPC answer, log line or error message may contain either token, the auth code, the PKCE verifier or the `state`.
- Provider kind string for the account store: `"google-drive"` (matches `provider.ts`'s literal and the PR 2 ref kind).
- New failure reasons: `scope-denied`, `timed-out`, `not-configured` (plus the existing `cancelled`, `offline`, `not-connected`, `permission-denied`, `rate-limited`, `encryption-unavailable`, `bad-request`, `unknown`).
- Every user-facing string in `apps/app/src/locales/en.json`, read with literal `t("...")` keys. Plain hyphen `-` only, never em/en dashes, in strings, release notes, README and features.md. The one exception is the shell's loopback "you can close this tab" page, which follows the precedent of hard-coded English in `menus.js`.
- Files containing regex escapes or Windows paths are written with the editor tools, never a shell heredoc.
- Before staging any change to an existing file, run the line-ending repair against `main` described in `AGENTS.md` (Task 7 does this once for the whole PR; do it per commit if your editor rewrote endings).
- Version: `0.95.4` -> `0.96.0` (functional enhancement). `SETTINGS_VERSION` is **unchanged** (22).

## File Map

**Domain (`packages/domain/src`)**
| File | Responsibility |
|---|---|
| `googleAuth.ts` (+`googleAuth.test.ts`) | Endpoints, scopes, client-config schema, auth URL, request bodies, redirect parsing, token/userinfo schemas, error mapping |
| `ipc.ts`, `ipc.test.ts` | Four `google:*` channels in `IPC_CHANNELS` |
| `index.ts` | Barrel exports |

**Shell (`apps/desktop`)**
| File | Responsibility |
|---|---|
| `src/googleClient.js`, `test/googleClient.test.js` | Locate and parse the OAuth client config, or null |
| `src/googleAuth.js`, `test/googleAuth.test.js` | Loopback sign-in, token exchange, refresh, status, disconnect |
| `src/ipcHandlers.js`, `test/googleIpc.test.js` | `google:status/connect/cancelConnect/disconnect`; leak guard |
| `src/preload.js`, `test/preloadBridge.test.js` | Four bridge methods |
| `src/main.js` | Builds `googleAuth` and passes it in |
| `electron-builder.config.cjs`, `test/packaging.test.js` | Ship `build/google-oauth-client.json` when present |
| `.github/workflows/desktop-release.yml` | Write the client file from a secret before packaging |

**Renderer (`apps/app/src`)**
| File | Responsibility |
|---|---|
| `lib/workspaceClient.ts` | `GoogleBridge`, `googleBridge()` |
| `lib/bridgeSurface.test.ts` | `"GoogleBridge"` in `SURFACES` |
| `hooks/useGitHub.ts` | export `attempt` |
| `hooks/useWorkspace.ts` (+test) | `failureKey` cases |
| `hooks/useGoogle.ts` (+test) | Account state machine |
| `components/GoogleAccountSection.tsx` (+test) | Status, Connect/Cancel/Disconnect |
| `components/SettingsAccounts.tsx`, `SettingsDialog.tsx`, `App.tsx` | Plumb the bridge, render the section |
| `locales/en.json` | `google.*`, `settings.accounts.googleDrive`, three `errors.*` |

**Docs / release:** `version.json` + mirrors, `apps/app/src/lib/releaseNotes/current.ts`, `apps/app/src/lib/appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`.

---

### Task 1: Domain - `googleAuth.ts` and the IPC channels

**Files:**
- Create: `packages/domain/src/googleAuth.ts`, `packages/domain/src/googleAuth.test.ts`
- Modify: `packages/domain/src/ipc.ts` (`IPC_CHANNELS`), `packages/domain/src/ipc.test.ts` (closed-list assertion), `packages/domain/src/index.ts`

**Interfaces:**
- Produces (exported from `@trypthos/domain`):
  - `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_REVOKE_URL`, `GOOGLE_USERINFO_URL`, `DRIVE_SCOPE`, `GOOGLE_SCOPES`
  - `grantsDrive(scope: string): boolean`
  - `GoogleClientConfigSchema` (input: Google's downloaded JSON; output `GoogleClientConfig = { clientId: string; clientSecret: string }`)
  - `authorizationUrl(args: { clientId; redirectUri; state; codeChallenge }): string`
  - `tokenRequestBody(args: { clientId; clientSecret; code; codeVerifier; redirectUri }): string`
  - `refreshRequestBody(args: { clientId; clientSecret; refreshToken }): string`
  - `revokeRequestBody(token: string): string`
  - `readRedirect(url: string, expectedState: string): { ok: true; code: string } | { ok: false; reason: "cancelled" | "bad-request" }`
  - `GoogleTokenSchema`, `GoogleUserInfoSchema`, types `GoogleToken`, `GoogleUserInfo`
  - `googleAuthErrorFor(status: number, body: unknown): GoogleAuthFailure` where `GoogleAuthFailure = "not-connected" | "not-configured" | "permission-denied" | "rate-limited" | "offline"`
  - `IPC_CHANNELS` gains `"google:status"`, `"google:connect"`, `"google:cancelConnect"`, `"google:disconnect"` (appended after `"icons:map"`, in that order)

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/googleAuth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DRIVE_SCOPE,
  GOOGLE_AUTH_URL,
  GoogleClientConfigSchema,
  GoogleTokenSchema,
  GoogleUserInfoSchema,
  authorizationUrl,
  googleAuthErrorFor,
  grantsDrive,
  readRedirect,
  refreshRequestBody,
  revokeRequestBody,
  tokenRequestBody,
} from "./googleAuth";

/// The pure half of signing in to Google. Everything here is a string in and a string or a result
/// out, so the shell's tests can concentrate on ordering and the network.

describe("GoogleClientConfigSchema", () => {
  it("reads the Desktop app client Google's console downloads", () => {
    const parsed = GoogleClientConfigSchema.parse({
      installed: {
        client_id: "123-abc.apps.googleusercontent.com",
        client_secret: "invented-secret",
        project_id: "trypthos-dev",
        redirect_uris: ["http://localhost"],
      },
    });
    expect(parsed).toEqual({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "invented-secret" });
  });

  // A Web client cannot use a loopback redirect on an arbitrary port, so accepting one would build an
  // app whose every sign-in fails at Google with a message about redirect URIs.
  it("refuses a Web application client", () => {
    expect(
      GoogleClientConfigSchema.safeParse({ web: { client_id: "x", client_secret: "y" } }).success,
    ).toBe(false);
  });

  it("refuses a file with no client id", () => {
    expect(GoogleClientConfigSchema.safeParse({ installed: { client_secret: "y" } }).success).toBe(false);
  });
});

describe("authorizationUrl", () => {
  const url = new URL(
    authorizationUrl({
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:50507",
      state: "state-1",
      codeChallenge: "challenge-1",
    }),
  );

  it("points at Google's consent page", () => {
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL);
  });

  it("asks for Drive, the user's email, and a refresh token every time", () => {
    expect(url.searchParams.get("scope")).toBe(`${DRIVE_SCOPE} openid email`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Without prompt=consent Google omits the refresh token on a second sign-in, and a reconnect
    // after a disconnect would store nothing.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("carries the PKCE challenge, the state and the loopback redirect", () => {
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:50507");
    expect(url.searchParams.get("client_id")).toBe("client-1");
  });
});

describe("request bodies", () => {
  it("exchanges a code with its verifier", () => {
    const body = new URLSearchParams(
      tokenRequestBody({
        clientId: "c",
        clientSecret: "s",
        code: "code-1",
        codeVerifier: "verifier-1",
        redirectUri: "http://127.0.0.1:1",
      }),
    );
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      client_id: "c",
      client_secret: "s",
      code: "code-1",
      code_verifier: "verifier-1",
      redirect_uri: "http://127.0.0.1:1",
    });
  });

  it("refreshes with the stored refresh token", () => {
    const body = new URLSearchParams(refreshRequestBody({ clientId: "c", clientSecret: "s", refreshToken: "r" }));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      client_id: "c",
      client_secret: "s",
      refresh_token: "r",
    });
  });

  it("revokes a token", () => {
    expect(Object.fromEntries(new URLSearchParams(revokeRequestBody("r")))).toEqual({ token: "r" });
  });
});

describe("readRedirect", () => {
  const at = (query: string) => `http://127.0.0.1:50507/?${query}`;

  it("answers the code when the state matches", () => {
    expect(readRedirect(at("state=s1&code=c1&scope=x"), "s1")).toEqual({ ok: true, code: "c1" });
  });

  // Checked before anything else: a request that did not come from our own consent page is not
  // Google's answer, whatever it says - including an error.
  it("refuses a redirect whose state is not ours", () => {
    expect(readRedirect(at("state=other&code=c1"), "s1")).toEqual({ ok: false, reason: "bad-request" });
    expect(readRedirect(at("state=other&error=access_denied"), "s1")).toEqual({ ok: false, reason: "bad-request" });
    expect(readRedirect(at("code=c1"), "s1")).toEqual({ ok: false, reason: "bad-request" });
  });

  it("reads a declined consent as cancelled, not as a failure", () => {
    expect(readRedirect(at("state=s1&error=access_denied"), "s1")).toEqual({ ok: false, reason: "cancelled" });
  });

  it("reads any other error, or no code, as a bad request", () => {
    expect(readRedirect(at("state=s1&error=invalid_request"), "s1")).toEqual({ ok: false, reason: "bad-request" });
    expect(readRedirect(at("state=s1"), "s1")).toEqual({ ok: false, reason: "bad-request" });
  });

  it("refuses something that is not a URL", () => {
    expect(readRedirect("not a url", "s1")).toEqual({ ok: false, reason: "bad-request" });
  });
});

describe("grantsDrive", () => {
  // Google's consent screen lets the user untick individual scopes. A grant without Drive signs the
  // user in and opens nothing, so it must not read as connected.
  it("is true only when the full Drive scope was granted", () => {
    expect(grantsDrive(`openid ${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`)).toBe(true);
    expect(grantsDrive("openid https://www.googleapis.com/auth/userinfo.email")).toBe(false);
    expect(grantsDrive("https://www.googleapis.com/auth/drive.file")).toBe(false);
    expect(grantsDrive("")).toBe(false);
  });
});

describe("response schemas", () => {
  it("reads a token answer with and without a refresh token", () => {
    const first = GoogleTokenSchema.parse({
      access_token: "a",
      expires_in: 3599,
      scope: DRIVE_SCOPE,
      token_type: "Bearer",
      refresh_token: "r",
      id_token: "i",
    });
    expect(first.refresh_token).toBe("r");

    const refreshed = GoogleTokenSchema.parse({ access_token: "a", expires_in: 3599, scope: DRIVE_SCOPE, token_type: "Bearer" });
    expect(refreshed.refresh_token).toBeUndefined();
  });

  it("refuses a token answer with no access token", () => {
    expect(GoogleTokenSchema.safeParse({ expires_in: 1, scope: "", token_type: "Bearer" }).success).toBe(false);
  });

  it("reads the user's email", () => {
    expect(GoogleUserInfoSchema.parse({ sub: "1", email: "ada@example.com", email_verified: true }).email).toBe(
      "ada@example.com",
    );
  });
});

describe("googleAuthErrorFor", () => {
  // invalid_grant is a refresh token Google no longer honours: revoked in the account, or expired.
  // The user's next step is to connect again, which is what "not connected" asks for.
  it("reads a revoked grant as not connected", () => {
    expect(googleAuthErrorFor(400, { error: "invalid_grant" })).toBe("not-connected");
  });

  // A client Google does not recognise is a broken build, not something the user did.
  it("reads an unknown client as not configured", () => {
    expect(googleAuthErrorFor(401, { error: "invalid_client" })).toBe("not-configured");
  });

  it("maps the remaining statuses", () => {
    expect(googleAuthErrorFor(401, null)).toBe("permission-denied");
    expect(googleAuthErrorFor(429, null)).toBe("rate-limited");
    expect(googleAuthErrorFor(500, { error: "server_error" })).toBe("offline");
  });
});
```

In `packages/domain/src/ipc.test.ts`, inside the `"is a closed list, so the preload bridge stays enumerable"` expectation, append these four entries after `"icons:map",`:

```ts
      "google:status",
      "google:connect",
      "google:cancelConnect",
      "google:disconnect",
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/domain googleAuth ipc`
Expected: FAIL - `googleAuth.test.ts` cannot resolve `./googleAuth`; `ipc.test.ts` closed-list assertion fails (missing `google:*`).

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/googleAuth.ts`:

```ts
import { z } from "zod";

/// Signing in to Google, the pure half.
///
/// The shell owns the sockets, the browser and the token store; this owns every string that goes to
/// Google and every shape that comes back, so both are tested without a network. See
/// `docs/specs/google-drive-workspace.md` for why the flow is a loopback redirect with PKCE and why
/// the scope is the full `drive` scope.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/// The full Drive scope. `drive.file` cannot list a folder the app did not create - the spike showed
/// a picked folder listing as empty - so a workspace needs this one.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/// `openid email` is how the shell learns which account is connected, without a second API.
export const GOOGLE_SCOPES = [DRIVE_SCOPE, "openid", "email"] as const;

/// Whether a granted scope string includes Drive. Google's consent screen lets a user untick it.
export function grantsDrive(scope: string): boolean {
  return scope.split(/\s+/).includes(DRIVE_SCOPE);
}

/// The client file Google's console downloads for a **Desktop app** client.
///
/// A Web client is refused: it cannot redirect to a loopback port it did not register, so a build
/// carrying one would fail at Google on every sign-in. Google treats a Desktop client's secret as not
/// confidential - it is shipped in the installer - but it is still kept out of the repository.
export const GoogleClientConfigSchema = z
  .object({
    installed: z.object({
      client_id: z.string().min(1),
      client_secret: z.string().min(1),
    }),
  })
  .transform((file) => ({
    clientId: file.installed.client_id,
    clientSecret: file.installed.client_secret,
  }));

export type GoogleClientConfig = z.output<typeof GoogleClientConfigSchema>;

export function authorizationUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    // Without it, Google leaves out the refresh token when the user has consented before - so a
    // reconnect after a disconnect would have nothing to store.
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function tokenRequestBody({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  }).toString();
}

export function refreshRequestBody({
  clientId,
  clientSecret,
  refreshToken,
}: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): string {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }).toString();
}

export function revokeRequestBody(token: string): string {
  return new URLSearchParams({ token }).toString();
}

export type RedirectResult = { ok: true; code: string } | { ok: false; reason: "cancelled" | "bad-request" };

/// Google's answer, as it arrives on the loopback port.
///
/// **The state is checked first.** Anything on that port that does not carry our state did not come
/// from the consent page we opened, and nothing it says - an error included - is Google's answer.
export function readRedirect(url: string, expectedState: string): RedirectResult {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return { ok: false, reason: "bad-request" };
  }

  if (params.get("state") !== expectedState) return { ok: false, reason: "bad-request" };

  const error = params.get("error");
  if (error === "access_denied") return { ok: false, reason: "cancelled" };
  if (error !== null) return { ok: false, reason: "bad-request" };

  const code = params.get("code");
  return code === null || code === "" ? { ok: false, reason: "bad-request" } : { ok: true, code };
}

export const GoogleTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  token_type: z.string(),
  /// Present on the first exchange (with prompt=consent), absent on a refresh.
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().optional(),
});

export type GoogleToken = z.infer<typeof GoogleTokenSchema>;

export const GoogleUserInfoSchema = z.object({ email: z.string().min(1) });

export type GoogleUserInfo = z.infer<typeof GoogleUserInfoSchema>;

const GoogleErrorBodySchema = z.object({ error: z.string() });

export type GoogleAuthFailure = "not-connected" | "not-configured" | "permission-denied" | "rate-limited" | "offline";

/// What a refusal from Google's token or userinfo endpoint means to the user.
export function googleAuthErrorFor(status: number, body: unknown): GoogleAuthFailure {
  const parsed = GoogleErrorBodySchema.safeParse(body);
  if (parsed.success && parsed.data.error === "invalid_grant") return "not-connected";
  if (parsed.success && parsed.data.error === "invalid_client") return "not-configured";
  if (status === 401) return "permission-denied";
  if (status === 429) return "rate-limited";
  return "offline";
}
```

In `packages/domain/src/ipc.ts`, append to `IPC_CHANNELS` after `"icons:map",`:

```ts
  "google:status",
  "google:connect",
  "google:cancelConnect",
  "google:disconnect",
```

In `packages/domain/src/index.ts`, add at the end:

```ts
export {
  DRIVE_SCOPE,
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GoogleClientConfigSchema,
  GoogleTokenSchema,
  GoogleUserInfoSchema,
  authorizationUrl,
  googleAuthErrorFor,
  grantsDrive,
  readRedirect,
  refreshRequestBody,
  revokeRequestBody,
  tokenRequestBody,
} from "./googleAuth";
export type { GoogleAuthFailure, GoogleClientConfig, GoogleToken, GoogleUserInfo, RedirectResult } from "./googleAuth";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root packages/domain` then `npm run typecheck`
Expected: all domain tests PASS; typecheck clean. (Shell tests that enumerate channels, e.g. any that compare preload methods to `IPC_CHANNELS`, may now fail until Task 4 - check with `npm test --workspace trypthos-desktop` and note which; they are fixed in Task 4, not here. If one fails here, list it in the commit message.)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/googleAuth.ts packages/domain/src/googleAuth.test.ts packages/domain/src/ipc.ts packages/domain/src/ipc.test.ts packages/domain/src/index.ts
git commit -m "domain: Google sign-in URLs, schemas and the google:* channels"
```

---

### Task 2: Shell - find the OAuth client, and ship it in the installer

**Files:**
- Create: `apps/desktop/src/googleClient.js`, `apps/desktop/test/googleClient.test.js`
- Modify: `apps/desktop/electron-builder.config.cjs` (`extraResources` build filter), `apps/desktop/test/packaging.test.js`, `.github/workflows/desktop-release.yml`

**Interfaces:**
- Consumes: `GoogleClientConfigSchema` (Task 1)
- Produces: `loadGoogleClient({ packaged, resourcesPath, env, readFile, logger }): GoogleClientConfig | null`, `CLIENT_FILE = "google-oauth-client.json"`, `DEV_CLIENT_ENV = "TRYPTHOS_GOOGLE_CLIENT"`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/googleClient.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadGoogleClient, CLIENT_FILE, DEV_CLIENT_ENV } = require("../src/googleClient");

/// Where the Google OAuth client comes from: a file shipped beside the app when packaged, a file the
/// developer names in development, and nothing at all otherwise - which is a build without Google
/// Drive, not a crash.

const DESKTOP_CLIENT = JSON.stringify({
  installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "invented-secret" },
});

function collectingLogger() {
  const lines = [];
  return { lines, error: (line) => lines.push(line) };
}

test("a packaged build reads the client from its resources", () => {
  const read = [];
  const client = loadGoogleClient({
    packaged: true,
    resourcesPath: path.join("R", "resources"),
    env: {},
    readFile: (file) => {
      read.push(file);
      return DESKTOP_CLIENT;
    },
  });

  assert.deepEqual(read, [path.join("R", "resources", "build", CLIENT_FILE)]);
  assert.deepEqual(client, { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "invented-secret" });
});

test("development reads the file the environment names", () => {
  const read = [];
  const client = loadGoogleClient({
    packaged: false,
    resourcesPath: "ignored",
    env: { [DEV_CLIENT_ENV]: path.join("D", "secrets", "client.json") },
    readFile: (file) => {
      read.push(file);
      return DESKTOP_CLIENT;
    },
  });

  assert.deepEqual(read, [path.join("D", "secrets", "client.json")]);
  assert.equal(client.clientId, "123-abc.apps.googleusercontent.com");
});

// A fork, or a developer who never set one up, builds an app that says Google Drive is not
// available. Nothing is logged: it is a normal state, not a fault.
test("no environment variable in development is no client, quietly", () => {
  const logger = collectingLogger();
  assert.equal(loadGoogleClient({ packaged: false, resourcesPath: "x", env: {}, readFile: () => DESKTOP_CLIENT, logger }), null);
  assert.deepEqual(logger.lines, []);
});

test("a missing file is no client, quietly", () => {
  const logger = collectingLogger();
  const client = loadGoogleClient({
    packaged: true,
    resourcesPath: "R",
    env: {},
    readFile: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    logger,
  });
  assert.equal(client, null);
  assert.deepEqual(logger.lines, []);
});

// A file that is there and wrong is a broken build, and someone needs to be told - without the
// file's contents, which hold the client secret.
test("a malformed file is no client, logged without its contents", () => {
  for (const contents of ["not json", JSON.stringify({ web: { client_id: "x", client_secret: "invented-secret" } })]) {
    const logger = collectingLogger();
    const client = loadGoogleClient({ packaged: true, resourcesPath: "R", env: {}, readFile: () => contents, logger });

    assert.equal(client, null);
    assert.equal(logger.lines.length, 1);
    assert.ok(!logger.lines[0].includes("invented-secret"));
  }
});
```

In `apps/desktop/test/packaging.test.js`, append:

```js
// The Google OAuth client is written into build/ by the release workflow and has to reach the
// installed app, where googleClient.js looks for it. Listed by name in the filter rather than by a
// wildcard, so the app icon sources beside it stay out of every install.
test("the Google OAuth client file is shipped when the build has one", () => {
  const build = (config.extraResources ?? []).find((entry) => entry.from === "build");
  assert.ok(build, "build/ must be copied into resources");
  assert.equal(build.to, "build");
  assert.ok(build.filter.includes("google-oauth-client.json"));
  assert.ok(build.filter.includes("tray*"), "the tray icons must still ship");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL - `Cannot find module '../src/googleClient'`; packaging test fails on the filter.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/googleClient.js`:

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GoogleClientConfigSchema } = require("@trypthos/domain");

/// The Google OAuth client this build signs in with, or null for a build without one.
///
/// **Packaged:** `resources/build/google-oauth-client.json`, written by the release workflow from the
/// `GOOGLE_OAUTH_CLIENT_JSON` repository secret before packaging. Google treats a Desktop client's
/// secret as not confidential - it ships in every installer - but it does not belong in a public
/// repository, which is why it is injected rather than committed.
///
/// **Development:** the file named by `TRYPTHOS_GOOGLE_CLIENT`, which is the JSON Google's console
/// downloads, kept outside the repository.
///
/// Null is a normal answer, not a fault: a fork, or a developer who has not set one up, gets an app
/// that says Google Drive is not available in this build.

const CLIENT_FILE = "google-oauth-client.json";
const DEV_CLIENT_ENV = "TRYPTHOS_GOOGLE_CLIENT";

function clientFileFor({ packaged, resourcesPath, env }) {
  if (packaged) return path.join(resourcesPath, "build", CLIENT_FILE);
  const named = env[DEV_CLIENT_ENV];
  return typeof named === "string" && named !== "" ? named : null;
}

function loadGoogleClient({
  packaged,
  resourcesPath,
  env = process.env,
  readFile = (file) => fs.readFileSync(file, "utf8"),
  logger = console,
}) {
  const file = clientFileFor({ packaged, resourcesPath, env });
  if (file === null) return null;

  let text;
  try {
    text = readFile(file);
  } catch {
    // Absent is the build without Google. Nothing to report.
    return null;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Never the contents: they hold the client secret.
    logger.error?.("The Google OAuth client file is not JSON, so Google Drive is unavailable.");
    return null;
  }

  const parsed = GoogleClientConfigSchema.safeParse(json);
  if (!parsed.success) {
    logger.error?.("The Google OAuth client file is not a Desktop app client, so Google Drive is unavailable.");
    return null;
  }
  return parsed.data;
}

module.exports = { loadGoogleClient, CLIENT_FILE, DEV_CLIENT_ENV };
```

In `apps/desktop/electron-builder.config.cjs`, replace the `build` entry of `extraResources`:

```js
    // Outside the asar: Electron's Tray reads its icon from disk and cannot open an archive.
    // By name, not "*.png": the app icon files sit in the same directory and are consumed at build
    // time - shipping them too is dead weight in every install.
    //
    // google-oauth-client.json is written here by the release workflow (see googleClient.js). A
    // filter that names a file which is not there copies nothing, so a build without the secret
    // still packages.
    { from: "build", to: "build", filter: ["tray*", "google-oauth-client.json"] },
```

In `.github/workflows/desktop-release.yml`, insert this step between `Build` and `Package`:

```yaml
      # The Google OAuth client for Drive sign-in, from a repository secret holding the JSON Google's
      # console downloads for the Desktop app client. A Desktop client's secret is not confidential by
      # Google's own definition, but it does not belong in a public repository either. Without the
      # secret the app still builds, and says Google Drive is not available.
      - name: Write the Google OAuth client
        shell: bash
        env:
          GOOGLE_OAUTH_CLIENT_JSON: ${{ secrets.GOOGLE_OAUTH_CLIENT_JSON }}
        run: |
          if [ -n "$GOOGLE_OAUTH_CLIENT_JSON" ]; then
            mkdir -p apps/desktop/build
            printf '%s' "$GOOGLE_OAUTH_CLIENT_JSON" > apps/desktop/build/google-oauth-client.json
            echo "ok: Google OAuth client written"
          else
            echo "::warning::GOOGLE_OAUTH_CLIENT_JSON is not set, so this build has no Google Drive sign-in."
          fi
```

(`apps/desktop/build/` is already git-ignored, so the file can never be committed by accident.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace trypthos-desktop`
Expected: `googleClient.test.js` and `packaging.test.js` PASS (`dependencies.test.js` still passes: only `node:*` and `@trypthos/domain` are required).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/googleClient.js apps/desktop/test/googleClient.test.js apps/desktop/electron-builder.config.cjs apps/desktop/test/packaging.test.js .github/workflows/desktop-release.yml
git commit -m "desktop: locate the Google OAuth client, and ship it from a release secret"
```

---

### Task 3: Shell - `googleAuth.js`, the sign-in and token lifecycle

**Files:**
- Create: `apps/desktop/src/googleAuth.js`, `apps/desktop/test/googleAuth.test.js`

**Interfaces:**
- Consumes: Task 1 exports; an account store with `setToken/getToken/hasToken/deleteToken` (see `accountStore.js`).
- Produces: `createGoogleAuth({ client, accounts, fetch, openExternal, listen, randomBytes, now, logger, timeoutMs, consentTimeoutMs })` returning:
  - `connect(): Promise<{ ok: true; email: string } | { ok: false; reason: string }>`
  - `cancelConnect(): void`
  - `accessToken({ force?: boolean }?): Promise<{ ok: true; token: string } | { ok: false; reason: string }>` (PR 2's Drive client uses this)
  - `status(): Promise<{ ok: true; configured: boolean; connected: boolean; email: string | null; reason: string | null }>`
  - `disconnect(): Promise<{ ok: true }>`
  - also exported: `listenOnce()`, `GOOGLE_PROVIDER = "google-drive"`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/googleAuth.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleAuth, GOOGLE_PROVIDER } = require("../src/googleAuth");

/// Signing in to Google, through a real loopback listener and a fake Google.
///
/// The browser is played by `openExternal`: it reads the consent URL the shell built and makes the
/// request Google would redirect it to - a real HTTP request to the real listener. Google's token and
/// userinfo endpoints are a fake fetch. So what is under test is the order of things and what is
/// stored when, which is where a sign-in goes wrong.

const DRIVE = "https://www.googleapis.com/auth/drive";
const CLIENT = { clientId: "client-1", clientSecret: "invented-secret" };
const REFRESH = "refresh-invented-1";
const ACCESS = "access-invented-1";

function fakeAccounts() {
  const tokens = new Map();
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
  };
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/// Google's endpoints. Each can be overridden per test; every call is recorded.
function fakeGoogle(overrides = {}) {
  const calls = [];
  const routes = {
    token: (body) =>
      body.get("grant_type") === "authorization_code"
        ? json(200, { access_token: ACCESS, expires_in: 3600, scope: `openid ${DRIVE}`, token_type: "Bearer", refresh_token: REFRESH })
        : json(200, { access_token: "access-refreshed", expires_in: 3600, scope: DRIVE, token_type: "Bearer" }),
    userinfo: () => json(200, { email: "ada@example.com" }),
    revoke: () => json(200, {}),
    ...overrides,
  };
  const fetch = async (url, init = {}) => {
    const body = new URLSearchParams(init.body ?? "");
    calls.push({ url, body, authorization: init.headers?.Authorization ?? null });
    if (url === "https://oauth2.googleapis.com/token") return routes.token(body);
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return routes.userinfo();
    if (url === "https://oauth2.googleapis.com/revoke") return routes.revoke(body);
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

/// The browser: follows the consent URL to the redirect Google would make.
function browserThat(answer = (params) => `state=${params.get("state")}&code=code-1&scope=${encodeURIComponent(DRIVE)}`) {
  const opened = [];
  const openExternal = async (url) => {
    opened.push(url);
    const params = new URL(url).searchParams;
    const redirect = `${params.get("redirect_uri")}/?${answer(params)}`;
    // Not awaited by the shell: a browser answers in its own time.
    setImmediate(() => void globalThis.fetch(redirect).then((r) => r.text()));
  };
  return { openExternal, opened };
}

function collectingLogger() {
  const lines = [];
  return { lines, error: (line) => lines.push(String(line)) };
}

function auth(options = {}) {
  const accounts = options.accounts ?? fakeAccounts();
  const google = options.google ?? fakeGoogle();
  const browser = options.browser ?? browserThat();
  const logger = collectingLogger();
  let clock = 1_000_000;
  const instance = createGoogleAuth({
    client: options.client === undefined ? CLIENT : options.client,
    accounts,
    fetch: google.fetch,
    openExternal: browser.openExternal,
    now: () => clock,
    logger,
    consentTimeoutMs: options.consentTimeoutMs ?? 5_000,
  });
  return { auth: instance, accounts, google, browser, logger, advance: (ms) => (clock += ms) };
}

test("signs in, stores the refresh token, and reports the email", async () => {
  const { auth: google, accounts, browser } = auth();

  assert.deepEqual(await google.connect(), { ok: true, email: "ada@example.com" });
  assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), REFRESH);
  assert.equal(browser.opened.length, 1);

  const consent = new URL(browser.opened[0]).searchParams;
  assert.match(consent.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(consent.get("code_challenge_method"), "S256");
});

test("the code is exchanged with the verifier whose challenge was sent", async () => {
  const crypto = require("node:crypto");
  const { auth: google, google: fake, browser } = auth();
  await google.connect();

  const challenge = new URL(browser.opened[0]).searchParams.get("code_challenge");
  const exchange = fake.calls.find((call) => call.body.get("grant_type") === "authorization_code");
  const verifier = exchange.body.get("code_verifier");
  assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), challenge);
  assert.equal(exchange.body.get("code"), "code-1");
});

// The GitHub rule: a credential reaches disk only after it has been shown to work.
test("nothing is stored when the Drive scope was unticked", async () => {
  const google = fakeGoogle({
    token: () => json(200, { access_token: ACCESS, expires_in: 3600, scope: "openid email", token_type: "Bearer", refresh_token: REFRESH }),
  });
  const { auth: signIn, accounts } = auth({ google });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "scope-denied" });
  assert.equal(accounts.tokens.size, 0);
});

test("nothing is stored when Google will not say who the account is", async () => {
  const google = fakeGoogle({ userinfo: () => json(401, { error: "invalid_token" }) });
  const { auth: signIn, accounts } = auth({ google });

  assert.equal((await signIn.connect()).ok, false);
  assert.equal(accounts.tokens.size, 0);
});

test("a declined consent is cancelled and stores nothing", async () => {
  const browser = browserThat((params) => `state=${params.get("state")}&error=access_denied`);
  const { auth: signIn, accounts } = auth({ browser });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "cancelled" });
  assert.equal(accounts.tokens.size, 0);
});

test("a redirect with somebody else's state is refused and the code never exchanged", async () => {
  const browser = browserThat(() => "state=forged&code=code-1");
  const { auth: signIn, google } = auth({ browser });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "bad-request" });
  assert.equal(google.calls.length, 0);
});

test("a consent nobody answers times out", async () => {
  const browser = { opened: [], openExternal: async () => {} };
  const { auth: signIn } = auth({ browser, consentTimeoutMs: 20 });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "timed-out" });
});

/// A browser that opens the consent page and never answers - the user has wandered off.
function silentBrowser() {
  const browser = { opened: [], openExternal: async (url) => void browser.opened.push(url) };
  return browser;
}

/// Waits until a condition holds. The listener starts asynchronously, so "connect has reached the
/// browser" is something to wait for, not something one tick guarantees.
async function until(condition) {
  for (let tries = 0; tries < 200 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition never held");
}

test("cancel stops a sign-in that is waiting on the browser", async () => {
  const browser = silentBrowser();
  const { auth: signIn, accounts } = auth({ browser });
  const waiting = signIn.connect();
  await until(() => browser.opened.length === 1);

  signIn.cancelConnect();
  assert.deepEqual(await waiting, { ok: false, reason: "cancelled" });
  assert.equal(accounts.tokens.size, 0);
});

// A user who closed the browser tab and clicks Connect again must not be left with two listeners.
test("a second connect cancels the first", async () => {
  const browser = silentBrowser();
  const { auth: signIn } = auth({ browser });
  const first = signIn.connect();
  await until(() => browser.opened.length === 1);

  const second = signIn.connect();
  assert.deepEqual(await first, { ok: false, reason: "cancelled" });

  await until(() => browser.opened.length === 2);
  signIn.cancelConnect();
  assert.deepEqual(await second, { ok: false, reason: "cancelled" });
});

test("connect before a client exists answers not configured", async () => {
  const { auth: signIn, browser } = auth({ client: null });
  assert.deepEqual(await signIn.connect(), { ok: false, reason: "not-configured" });
  assert.equal(browser.opened.length, 0);
});

test("the access token from sign-in is reused until it nears expiry, then refreshed once", async () => {
  const { auth: signIn, google, advance } = auth();
  await signIn.connect();

  assert.deepEqual(await signIn.accessToken(), { ok: true, token: ACCESS });
  advance(3_600_000 - 30_000); // inside the last minute

  const [one, two] = await Promise.all([signIn.accessToken(), signIn.accessToken()]);
  assert.deepEqual(one, { ok: true, token: "access-refreshed" });
  assert.deepEqual(two, one);
  const refreshes = google.calls.filter((call) => call.body.get("grant_type") === "refresh_token");
  assert.equal(refreshes.length, 1, "concurrent callers share one refresh");
  assert.equal(refreshes[0].body.get("refresh_token"), REFRESH);
});

// A grant revoked in the Google account reads as not connected with the reason, and the stored
// token stays - the same as a revoked GitHub token, so the user sees why rather than a blank slate.
test("a revoked grant reads as not connected and leaves the stored token", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken(GOOGLE_PROVIDER, "refresh-stale");
  const google = fakeGoogle({ token: () => json(400, { error: "invalid_grant" }) });
  const { auth: signIn } = auth({ accounts, google });

  assert.deepEqual(await signIn.status(), {
    ok: true,
    configured: true,
    connected: false,
    email: null,
    reason: "not-connected",
  });
  assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), "refresh-stale");
});

test("status with a stored token asks Google who it is", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken(GOOGLE_PROVIDER, REFRESH);
  const { auth: signIn, google } = auth({ accounts });

  assert.deepEqual(await signIn.status(), { ok: true, configured: true, connected: true, email: "ada@example.com", reason: null });
  assert.equal(google.calls.at(-1).authorization, "Bearer access-refreshed");
});

test("status before any sign-in, and in a build without a client", async () => {
  assert.deepEqual(await auth().auth.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
  assert.deepEqual(await auth({ client: null }).auth.status(), {
    ok: true,
    configured: false,
    connected: false,
    email: null,
    reason: null,
  });
});

test("disconnect revokes at Google, then forgets both tokens", async () => {
  const { auth: signIn, accounts, google } = auth();
  await signIn.connect();

  assert.deepEqual(await signIn.disconnect(), { ok: true });
  const revoke = google.calls.find((call) => call.url === "https://oauth2.googleapis.com/revoke");
  assert.equal(revoke.body.get("token"), REFRESH);
  assert.equal(accounts.tokens.size, 0);
  assert.deepEqual(await signIn.accessToken(), { ok: false, reason: "not-connected" });
});

// Signing out is what the user asked for, and it happens here whether or not Google answers.
test("disconnect still forgets the token when Google's revoke fails", async () => {
  const google = fakeGoogle({ revoke: () => json(503, {}) });
  const { auth: signIn, accounts, logger } = auth({ google });
  await signIn.connect();

  assert.deepEqual(await signIn.disconnect(), { ok: true });
  assert.equal(accounts.tokens.size, 0);
  assert.equal(logger.lines.length, 1);
});

test("an unreachable Google is offline, and nothing secret is logged", async () => {
  const google = {
    calls: [],
    fetch: async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    },
  };
  const { auth: signIn, logger } = auth({ google });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "offline" });
  for (const line of logger.lines) {
    assert.ok(!/code-1|invented-secret|state=|verifier/.test(line), `logged something secret: ${line}`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL - `Cannot find module '../src/googleAuth'`.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/googleAuth.js`:

```js
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GoogleTokenSchema,
  GoogleUserInfoSchema,
  authorizationUrl,
  googleAuthErrorFor,
  grantsDrive,
  readRedirect,
  refreshRequestBody,
  revokeRequestBody,
  tokenRequestBody,
} = require("@trypthos/domain");

/// A Google account: signing in, staying signed in, and signing out.
///
/// **This lives in the main process and cannot move.** The refresh token is read from the encrypted
/// account store here and never leaves; the access token exists only in this closure. No IPC channel
/// answers with either, and nothing here logs a URL, a body, a code, a state or a verifier - error
/// lines name the step that failed and nothing else.
///
/// Sign-in is Google's flow for desktop apps: the consent page opens in the user's own browser, and
/// Google redirects to a listener on 127.0.0.1 on a port the OS chose, carrying a code that is only
/// worth anything with the PKCE verifier held here. See docs/specs/google-drive-workspace.md.
///
/// **Nothing here throws outward.** Every path answers `{ ok: false, reason }`.

const GOOGLE_PROVIDER = "google-drive";
const DEFAULT_TIMEOUT_MS = 30_000;
/// How long the consent page may stay open before the sign-in is abandoned.
const CONSENT_TIMEOUT_MS = 5 * 60_000;
/// An access token this close to expiry is refreshed rather than used.
const EXPIRY_MARGIN_MS = 60_000;

/// What the browser tab shows after Google redirects back. English, like the shell's menus: this
/// page is drawn before the renderer and its catalogue are involved.
const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Trypthos</title>' +
  '<p style="font-family:system-ui,sans-serif">You can close this tab and return to Trypthos.</p>';

function failure(reason) {
  return { ok: false, reason };
}

/// A listener on a free loopback port that resolves `arrived` with the first request to `/`.
///
/// Only `/` counts: a browser also asks for /favicon.ico, and that must not be taken for Google.
function listenOnce() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const origin = `http://127.0.0.1:${port}`;
      let settle;
      const arrived = new Promise((done) => (settle = done));
      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", origin);
        if (url.pathname !== "/") {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(DONE_PAGE);
        settle(url.toString());
      });
      resolve({
        redirectUri: origin,
        arrived,
        close: () => {
          server.closeAllConnections?.();
          server.close();
        },
      });
    });
  });
}

function createGoogleAuth({
  client,
  accounts,
  fetch = globalThis.fetch,
  openExternal,
  listen = listenOnce,
  randomBytes = crypto.randomBytes,
  now = Date.now,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  consentTimeoutMs = CONSENT_TIMEOUT_MS,
}) {
  /// `{ token, expiresAt }` while signed in, null otherwise. Memory only.
  let access = null;
  /// The refresh in flight, shared by every caller that arrives while it runs.
  let refreshing = null;
  /// The sign-in waiting on the browser, so a second Connect or a Cancel can stop it.
  let pending = null;

  /// One request to Google, with a timeout. Answers `{ status, ok, body }` or null when it never
  /// arrived. `step` is the only thing a log line says about it.
  async function call(url, { method = "GET", body = null, bearer = null }, step) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(body === null ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
          ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        ...(body === null ? {} : { body }),
      });
      const parsed = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      logger.error?.(`Google ${step} did not complete: ${error.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokenCall(body, step) {
    const answer = await call(GOOGLE_TOKEN_URL, { method: "POST", body }, step);
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(googleAuthErrorFor(answer.status, answer.body));
    const parsed = GoogleTokenSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.(`Google answered the ${step} in a shape this build does not recognise.`);
      return failure("offline");
    }
    return { ok: true, token: parsed.data };
  }

  async function whoami(accessToken) {
    const answer = await call(GOOGLE_USERINFO_URL, { bearer: accessToken }, "account lookup");
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(googleAuthErrorFor(answer.status, answer.body));
    const parsed = GoogleUserInfoSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.("Google answered the account lookup in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, email: parsed.data.email };
  }

  function remember(token) {
    access = { token: token.access_token, expiresAt: now() + token.expires_in * 1000 };
  }

  async function connect() {
    if (client === null) return failure("not-configured");
    pending?.cancel("cancelled");

    let listener;
    try {
      listener = await listen();
    } catch (error) {
      logger.error?.(`Could not listen for Google's answer: ${error.message}`);
      return failure("offline");
    }

    const verifier = randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("base64url");

    let stop;
    const stopped = new Promise((resolve) => (stop = (reason) => resolve({ stopped: reason })));
    const timer = setTimeout(() => stop("timed-out"), consentTimeoutMs);
    const mine = { cancel: stop };
    pending = mine;

    try {
      try {
        await openExternal(
          authorizationUrl({ clientId: client.clientId, redirectUri: listener.redirectUri, state, codeChallenge: challenge }),
        );
      } catch (error) {
        logger.error?.(`Could not open the browser for Google sign-in: ${error.message}`);
        return failure("unknown");
      }

      const outcome = await Promise.race([listener.arrived.then((url) => ({ url })), stopped]);
      if (outcome.stopped !== undefined) return failure(outcome.stopped);

      const redirect = readRedirect(outcome.url, state);
      if (!redirect.ok) return redirect;

      const exchanged = await tokenCall(
        tokenRequestBody({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          code: redirect.code,
          codeVerifier: verifier,
          redirectUri: listener.redirectUri,
        }),
        "sign-in",
      );
      if (!exchanged.ok) return exchanged;

      const token = exchanged.token;
      if (!grantsDrive(token.scope)) return failure("scope-denied");
      if (token.refresh_token === undefined) {
        logger.error?.("Google granted access without a refresh token.");
        return failure("offline");
      }

      const who = await whoami(token.access_token);
      if (!who.ok) return who;

      // Stored last: a credential reaches disk only once it has been shown to work.
      const stored = await accounts.setToken(GOOGLE_PROVIDER, token.refresh_token);
      if (!stored.ok) return stored;

      remember(token);
      return { ok: true, email: who.email };
    } finally {
      clearTimeout(timer);
      listener.close();
      if (pending === mine) pending = null;
    }
  }

  function cancelConnect() {
    pending?.cancel("cancelled");
  }

  async function refresh() {
    const refreshToken = await accounts.getToken(GOOGLE_PROVIDER);
    if (typeof refreshToken !== "string" || refreshToken === "") return failure("not-connected");

    const refreshed = await tokenCall(
      refreshRequestBody({ clientId: client.clientId, clientSecret: client.clientSecret, refreshToken }),
      "refresh",
    );
    if (!refreshed.ok) return refreshed;
    remember(refreshed.token);
    return { ok: true, token: refreshed.token.access_token };
  }

  async function accessToken({ force = false } = {}) {
    if (client === null) return failure("not-configured");
    if (!force && access !== null && access.expiresAt - now() > EXPIRY_MARGIN_MS) {
      return { ok: true, token: access.token };
    }
    if (refreshing === null) {
      refreshing = refresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function status() {
    const answer = (fields) => ({ ok: true, configured: client !== null, connected: false, email: null, reason: null, ...fields });
    if (client === null || !(await accounts.hasToken(GOOGLE_PROVIDER))) return answer({});

    // Asked of Google rather than answered from a stored name: a grant can be revoked from the
    // Google account, and an indicator naming an account the app cannot reach would be a lie.
    const token = await accessToken();
    if (!token.ok) return answer({ reason: token.reason });
    const who = await whoami(token.token);
    return who.ok ? answer({ connected: true, email: who.email }) : answer({ reason: who.reason });
  }

  async function disconnect() {
    pending?.cancel("cancelled");
    const refreshToken = await accounts.getToken(GOOGLE_PROVIDER);
    if (typeof refreshToken === "string" && refreshToken !== "") {
      const answer = await call(GOOGLE_REVOKE_URL, { method: "POST", body: revokeRequestBody(refreshToken) }, "sign-out");
      // Signing out is what the user asked for, and it happens here regardless. Google forgets the
      // grant on its own side when the token is never used again.
      if (answer !== null && !answer.ok) logger.error?.("Google did not confirm the sign-out. It is forgotten here regardless.");
    }
    await accounts.deleteToken(GOOGLE_PROVIDER);
    access = null;
    return { ok: true };
  }

  return { connect, cancelConnect, accessToken, status, disconnect };
}

module.exports = { createGoogleAuth, listenOnce, GOOGLE_PROVIDER };
```

Note for the "unreachable Google" test: `call` logs once per failed step; the sign-in fails at the exchange, so one line, which contains only the step name and `net::ERR_INTERNET_DISCONNECTED`. In the revoke-fails test the 503 path logs exactly one line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace trypthos-desktop`
Expected: all `googleAuth.test.js` tests PASS, no stray output, the process exits (no listener left open - a hang here means a `close()` path was missed).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/googleAuth.js apps/desktop/test/googleAuth.test.js
git commit -m "desktop: sign in to Google through a loopback redirect with PKCE"
```

---

### Task 4: Shell - the `google:*` channels, preload and main wiring

**Files:**
- Modify: `apps/desktop/src/ipcHandlers.js` (new `google` dependency + four handlers, after the `github:disconnect` handler), `apps/desktop/src/preload.js` (after `disconnectGitHub`), `apps/desktop/src/main.js` (build `google` inside `app.whenReady`, pass to `registerIpcHandlers`)
- Create: `apps/desktop/test/googleIpc.test.js`
- Modify: `apps/desktop/test/preloadBridge.test.js`

**Interfaces:**
- Consumes: `createGoogleAuth`, `GOOGLE_PROVIDER` (Task 3); `loadGoogleClient` (Task 2)
- Produces: `registerIpcHandlers({ ..., google = null })`; bridge methods `googleStatus()`, `connectGoogle()`, `cancelGoogleConnect()`, `disconnectGoogle()`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/googleIpc.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { createGoogleAuth, GOOGLE_PROVIDER } = require("../src/googleAuth");

/// The Google account through the real handlers, with a real `googleAuth` over a fake Google.

const DRIVE = "https://www.googleapis.com/auth/drive";
const REFRESH = "refresh-invented-ipc";
const ACCESS = "access-invented-ipc";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  };
}

function fakeAccounts() {
  const tokens = new Map();
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
    connectedProviders: async () => [...tokens.keys()],
  };
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

function googleOver(accounts) {
  return createGoogleAuth({
    client: { clientId: "client-1", clientSecret: "invented-secret" },
    accounts,
    logger: { error: () => {} },
    fetch: async (url, init = {}) => {
      if (url.endsWith("/token")) {
        return json(200, { access_token: ACCESS, expires_in: 3600, scope: DRIVE, token_type: "Bearer", refresh_token: REFRESH });
      }
      if (url.endsWith("/userinfo")) return json(200, { email: "ada@example.com" });
      if (url.endsWith("/revoke")) return json(200, {});
      throw new Error(`unexpected ${url} ${init.method}`);
    },
    openExternal: async (url) => {
      const params = new URL(url).searchParams;
      setImmediate(() => void globalThis.fetch(`${params.get("redirect_uri")}/?state=${params.get("state")}&code=c1`).then((r) => r.text()));
    },
  });
}

async function withHandlers(body, { google = "real" } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-google-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    const accounts = fakeAccounts();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts,
      google: google === "real" ? googleOver(accounts) : google,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain, accounts });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("a build without a Google client says so, and offers nothing", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("google:status"), { ok: true, configured: false, connected: false, email: null, reason: null });
      assert.deepEqual(await ipcMain.invoke("google:connect"), { ok: false, reason: "not-configured" });
      assert.deepEqual(await ipcMain.invoke("google:cancelConnect"), { ok: true });
      assert.deepEqual(await ipcMain.invoke("google:disconnect"), { ok: true });
    },
    { google: null },
  );
});

test("connect, status and disconnect go through to the account", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    assert.deepEqual(await ipcMain.invoke("google:connect"), { ok: true, email: "ada@example.com" });
    assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), REFRESH);

    const status = await ipcMain.invoke("google:status");
    assert.equal(status.connected, true);
    assert.equal(status.email, "ada@example.com");

    assert.deepEqual(await ipcMain.invoke("google:disconnect"), { ok: true });
    assert.equal(accounts.tokens.size, 0);
  });
});

/// The security property, asserted rather than assumed: after signing in, no channel the shell
/// registered answers with the refresh token or the access token.
test("no channel answers with a Google token", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("google:connect");

    for (const [channel, handler] of ipcMain.handlers) {
      if (channel === "google:disconnect") continue; // walked last, below, so the others see a signed-in account
      let answer;
      try {
        answer = await handler(null, {});
      } catch {
        continue;
      }
      const text = JSON.stringify(answer ?? null);
      assert.ok(!text.includes(REFRESH), `${channel} answered with the refresh token`);
      assert.ok(!text.includes(ACCESS), `${channel} answered with the access token`);
    }
    const last = JSON.stringify(await ipcMain.invoke("google:disconnect"));
    assert.ok(!last.includes(REFRESH) && !last.includes(ACCESS));
  });
});
```

In `apps/desktop/test/preloadBridge.test.js`, append:

```js
test("the Google account calls reach their handlers, carrying nothing from the renderer", async () => {
  const { bridge, ipcMain } = loadBridge();
  const received = [];
  for (const channel of ["google:status", "google:connect", "google:cancelConnect", "google:disconnect"]) {
    ipcMain.handle(channel, async (_event, payload) => {
      received.push([channel, payload]);
      return { ok: true };
    });
  }

  await bridge.googleStatus();
  await bridge.connectGoogle();
  await bridge.cancelGoogleConnect();
  await bridge.disconnectGoogle();

  assert.deepEqual(received, [
    ["google:status", undefined],
    ["google:connect", undefined],
    ["google:cancelConnect", undefined],
    ["google:disconnect", undefined],
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL - `handlers.get(...) is not a function` for `google:status`; preload test fails on `bridge.googleStatus is not a function`.

- [ ] **Step 3: Write the implementation**

In `apps/desktop/src/ipcHandlers.js`, add a parameter to `registerIpcHandlers`'s destructured options, directly after `createGitHub = null,`:

```js
  /// The Google account - `googleAuth.js` - or null in a build without a Google OAuth client.
  ///
  /// An instance rather than a factory, unlike GitHub: there is no token to verify before storing,
  /// because the sign-in itself is the verification and happens entirely in the main process.
  google = null,
```

Then add, directly after the `ipcMain.handle("github:disconnect", ...)` handler:

```js
  /// Google, as an account. Same rule as GitHub: answers carry an email, never a token, and there is
  /// no channel that returns one. None of these takes a payload - the renderer cannot name a client,
  /// a scope or a redirect, so there is nothing of its to validate.
  ipcMain.handle("google:status", async () =>
    google === null
      ? { ok: true, configured: false, connected: false, email: null, reason: null }
      : google.status(),
  );

  ipcMain.handle("google:connect", async () =>
    google === null ? { ok: false, reason: "not-configured" } : google.connect(),
  );

  ipcMain.handle("google:cancelConnect", async () => {
    google?.cancelConnect();
    return { ok: true };
  });

  ipcMain.handle("google:disconnect", async () => (google === null ? { ok: true } : google.disconnect()));
```

In `apps/desktop/src/preload.js`, directly after the `disconnectGitHub` line:

```js
  /// Google, as an account. Write-only like GitHub: `status` answers with an EMAIL and never a
  /// token. Connecting takes no argument - the sign-in happens in the user's browser and the main
  /// process, and nothing from this side is part of it.
  googleStatus: () => ipcRenderer.invoke("google:status"),
  connectGoogle: () => ipcRenderer.invoke("google:connect"),
  cancelGoogleConnect: () => ipcRenderer.invoke("google:cancelConnect"),
  disconnectGoogle: () => ipcRenderer.invoke("google:disconnect"),
```

In `apps/desktop/src/main.js`:
1. Add requires beside the other `./` requires at the top: `const { loadGoogleClient } = require("./googleClient");` and `const { createGoogleAuth } = require("./googleAuth");`
2. Directly after `const accounts = createAccountStore({...});` inside `app.whenReady().then(...)`:

```js
    // The Google account. Null in a build without an OAuth client - a fork, or a developer who has
    // not set TRYPTHOS_GOOGLE_CLIENT - which the interface reports as Google Drive being unavailable.
    // Every Google call is made here with net.fetch, for the same proxy and certificate reasons as
    // GitHub, and the consent page opens in the user's own browser: Google refuses sign-in inside an
    // embedded window.
    const googleClient = loadGoogleClient({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    const google =
      googleClient === null
        ? null
        : createGoogleAuth({
            client: googleClient,
            accounts,
            fetch: (url, options) => net.fetch(url, options),
            openExternal: (url) => shell.openExternal(url),
          });
```

3. In the `registerIpcHandlers({...})` call, directly after `createGitHub: ...,` add `google,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace trypthos-desktop` then `npm run lint`
Expected: all shell tests PASS including the existing `githubIpc.test.js` "no channel answers with the stored token" (the new handlers answer `not-configured` there because `google` is not passed). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/src/main.js apps/desktop/test/googleIpc.test.js apps/desktop/test/preloadBridge.test.js
git commit -m "desktop: google:* channels, with a leak guard over every handler"
```

---

### Task 5: Renderer - bridge, failure keys and the `useGoogle` hook

**Files:**
- Modify: `apps/app/src/lib/workspaceClient.ts` (types + `googleBridge()`, beside `GitHubBridge`/`githubBridge`; `TrypthosBridge` extends `GoogleBridge`), `apps/app/src/lib/bridgeSurface.test.ts`, `apps/app/src/hooks/useGitHub.ts` (export `attempt`), `apps/app/src/hooks/useWorkspace.ts` (`failureKey`), `apps/app/src/hooks/useWorkspace.test.ts`, `apps/app/src/locales/en.json` (`errors.*`)
- Create: `apps/app/src/hooks/useGoogle.ts`, `apps/app/src/hooks/useGoogle.test.ts`

**Interfaces:**
- Consumes: the four bridge methods (Task 4)
- Produces:
  - `GoogleStatus`, `GoogleConnectResult`, `GoogleBridge`, `googleBridge(): GoogleBridge | null`
  - `useGoogle(bridge: GoogleBridge | null): GoogleState & GoogleActions` with `GoogleState = { supported; configured; checking; connected; email: string | null; connecting: boolean; errorKey: string | null }` and `GoogleActions = { connect(): Promise<boolean>; cancel(): Promise<void>; disconnect(): Promise<void>; dismissError(): void }`
  - `failureKey("scope-denied") === "errors.scopeDenied"`, `"timed-out" -> "errors.timedOut"`, `"not-configured" -> "errors.notConfigured"`

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/lib/bridgeSurface.test.ts`, change `const SURFACES = ["WorkspaceClient", "GitHubBridge"];` to:

```ts
const SURFACES = ["WorkspaceClient", "GitHubBridge", "GoogleBridge"];
```

and add to the second test:

```ts
    expect(interfaceMethods(source, "GoogleBridge")).toContain("connectGoogle");
```

In `apps/app/src/hooks/useWorkspace.test.ts`, add (inside the existing `describe` for `failureKey`, or a new `describe("failureKey")` if none exists - search the file for `failureKey(` first):

```ts
  it("names the three Google sign-in refusals", () => {
    expect(failureKey("scope-denied")).toBe("errors.scopeDenied");
    expect(failureKey("timed-out")).toBe("errors.timedOut");
    expect(failureKey("not-configured")).toBe("errors.notConfigured");
  });
```

Create `apps/app/src/hooks/useGoogle.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGoogle } from "./useGoogle";
import type { GoogleBridge, GoogleConnectResult } from "../lib/workspaceClient";

/// The Google account, from the interface's side: which of not configured, checking, connected,
/// waiting for the browser and "that did not work" the section is in.

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: null })),
    connectGoogle: vi.fn(async (): Promise<GoogleConnectResult> => ({ ok: true, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("useGoogle", () => {
  it("asks the shell whether an account is connected", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));

    await waitFor(() => expect(result.current.email).toBe("ada@example.com"));
    expect(result.current.connected).toBe(true);
    expect(result.current.configured).toBe(true);
  });

  it("reports no shell as unsupported", async () => {
    const { result } = renderHook(() => useGoogle(null));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.supported).toBe(false);
  });

  it("reports a build without a Google client as not configured", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: false, connected: false, email: null, reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.configured).toBe(false);
  });

  it("is connecting while the browser is open, then connected", async () => {
    let finish: (value: GoogleConnectResult) => void = () => {};
    const bridge = fakeBridge({ connectGoogle: vi.fn(() => new Promise<GoogleConnectResult>((resolve) => (finish = resolve))) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    let connected: Promise<boolean> = Promise.resolve(false);
    act(() => {
      connected = result.current.connect();
    });
    expect(result.current.connecting).toBe(true);

    await act(async () => {
      finish({ ok: true, email: "ada@example.com" });
      await connected;
    });
    expect(result.current.connecting).toBe(false);
    expect(result.current.connected).toBe(true);
    expect(result.current.email).toBe("ada@example.com");
  });

  // Closing the browser or pressing Cancel is not a failure and must not raise a banner.
  it("returns to idle without an error when the sign-in is cancelled", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "cancelled" })) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.connecting).toBe(false);
    expect(result.current.connected).toBe(false);
    expect(result.current.errorKey).toBeNull();
  });

  it("names a refused sign-in", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "scope-denied" })) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.errorKey).toBe("errors.scopeDenied");
  });

  it("cancel asks the shell to stop waiting", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.cancel();
    });
    expect(bridge.cancelGoogleConnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.email).toBeNull();
  });

  it("shows a stored grant Google refused as disconnected with the reason", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: "not-connected" })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.errorKey).toBe("errors.notConnected");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root apps/app useGoogle bridgeSurface useWorkspace`
Expected: FAIL - `useGoogle` module not found; bridgeSurface "GoogleBridge should exist in the client"; the `failureKey` cases return `errors.unknown`.

- [ ] **Step 3: Write the implementation**

In `apps/app/src/lib/workspaceClient.ts`, directly after the `GitHubBridge` interface:

```ts
/// What the shell says about the Google account. An EMAIL, never a token - see `GitHubBridge`.
///
/// `configured` false is a build without a Google OAuth client, which offers no way to connect.
export interface GoogleStatus {
  ok: true;
  configured: boolean;
  connected: boolean;
  email: string | null;
  reason: string | null;
}

export type GoogleConnectResult = { ok: true; email: string } | { ok: false; reason: string };

/// The Google half of the bridge. Connecting takes no argument: the sign-in happens in the user's
/// browser and the main process, and there is deliberately no `getToken`.
export interface GoogleBridge {
  googleStatus(): Promise<GoogleStatus>;
  connectGoogle(): Promise<GoogleConnectResult>;
  cancelGoogleConnect(): Promise<{ ok: boolean }>;
  disconnectGoogle(): Promise<{ ok: boolean }>;
}
```

Change the `TrypthosBridge` line to extend it:

```ts
interface TrypthosBridge extends WorkspaceClient, KeyBridge, ChatBridge, ChatHistoryBridge, GitHubBridge, GoogleBridge {
```

Directly after `githubBridge()`:

```ts
/// The Google half of the bridge, or null outside the desktop shell - same reasoning as `githubBridge`.
export function googleBridge(): GoogleBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.googleStatus) return null;
  return {
    googleStatus: bridge.googleStatus,
    connectGoogle: bridge.connectGoogle,
    cancelGoogleConnect: bridge.cancelGoogleConnect,
    disconnectGoogle: bridge.disconnectGoogle,
  };
}
```

In `apps/app/src/hooks/useGitHub.ts`, change `async function attempt<` to `export async function attempt<` (the doc comment above it stays; it is now shared with `useGoogle`).

In `apps/app/src/hooks/useWorkspace.ts` `failureKey`, add before `default:`:

```ts
    // Google sign-in's own refusals. Each sends the user somewhere different: tick the Drive box,
    // try again, or use a build that has Google Drive at all.
    case "scope-denied":
      return "errors.scopeDenied";
    case "timed-out":
      return "errors.timedOut";
    case "not-configured":
      return "errors.notConfigured";
```

In `apps/app/src/locales/en.json`, inside `"errors"`, after `"encryptionUnavailable"`:

```json
    "scopeDenied": "Google Drive access was not allowed, so Trypthos cannot open your folders. Connect again and leave the Google Drive box ticked.",
    "timedOut": "Google's sign-in page did not answer in time. Connect again to try once more.",
    "notConfigured": "This build of Trypthos was made without Google Drive support.",
```

Create `apps/app/src/hooks/useGoogle.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { GoogleBridge } from "../lib/workspaceClient";
import { attempt } from "./useGitHub";
import { failureKey } from "./useWorkspace";

/// The Google account, as the interface sees it.
///
/// The shape of `useGitHub`, with one state GitHub does not have: `connecting`, while the consent
/// page is open in the user's browser. Nothing here ever holds a credential - the sign-in happens
/// entirely between the browser and the main process, and what comes back is an email.

export interface GoogleState {
  /// False outside the desktop shell.
  supported: boolean;
  /// False in a build without a Google OAuth client. Known only after the first status answer.
  configured: boolean;
  checking: boolean;
  connected: boolean;
  email: string | null;
  /// True while Google's consent page is open in the browser.
  connecting: boolean;
  errorKey: string | null;
}

export interface GoogleActions {
  /// Opens Google's consent page and waits for the answer. True when an account was connected.
  connect(): Promise<boolean>;
  /// Stops waiting for the browser. The pending `connect` then answers cancelled.
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
  dismissError(): void;
}

export function useGoogle(bridge: GoogleBridge | null): GoogleState & GoogleActions {
  const [state, setState] = useState<GoogleState>({
    supported: bridge !== null,
    configured: false,
    checking: bridge !== null,
    connected: false,
    email: null,
    connecting: false,
    errorKey: null,
  });

  useEffect(() => {
    if (bridge === null) return;

    let live = true;
    void (async () => {
      const status = await attempt(() => bridge.googleStatus());
      if (!live) return;

      if (!status.ok) {
        setState((prev) => ({ ...prev, checking: false, connected: false, email: null, errorKey: failureKey(status.reason) }));
        return;
      }

      setState((prev) => ({
        ...prev,
        checking: false,
        configured: status.configured,
        connected: status.connected,
        email: status.email,
        errorKey: status.reason === null ? null : failureKey(status.reason),
      }));
    })();

    return () => {
      live = false;
    };
  }, [bridge]);

  const connect = useCallback(async () => {
    if (bridge === null) return false;

    setState((prev) => ({ ...prev, connecting: true, errorKey: null }));
    const result = await attempt(() => bridge.connectGoogle());

    if (!result.ok) {
      // `failureKey("cancelled")` is null: closing the browser is not an error.
      setState((prev) => ({ ...prev, connecting: false, errorKey: failureKey(result.reason) }));
      return false;
    }

    setState((prev) => ({ ...prev, connecting: false, connected: true, email: result.email, errorKey: null }));
    return true;
  }, [bridge]);

  const cancel = useCallback(async () => {
    if (bridge === null) return;
    await attempt(() => bridge.cancelGoogleConnect());
  }, [bridge]);

  const disconnect = useCallback(async () => {
    if (bridge === null) return;

    const result = await attempt(() => bridge.disconnectGoogle().then((answer) => ({ ...answer })));
    if (!result.ok) {
      setState((prev) => ({ ...prev, errorKey: failureKey("unknown") }));
      return;
    }
    setState((prev) => ({ ...prev, connected: false, email: null, errorKey: null }));
  }, [bridge]);

  return {
    ...state,
    connect,
    cancel,
    disconnect,
    dismissError: () => setState((prev) => ({ ...prev, errorKey: null })),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root apps/app useGoogle bridgeSurface useWorkspace i18nKeys` then `npm run typecheck`
Expected: PASS. `i18nKeys.test.ts` may flag the three new `errors.*` keys as orphaned only if nothing references them - they are referenced through `failureKey`'s literal strings, which the guard reads. If it does flag them, check how the guard treats `failureKey` (it already covers `errors.encryptionUnavailable` the same way) before changing anything.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/workspaceClient.ts apps/app/src/lib/bridgeSurface.test.ts apps/app/src/hooks/useGitHub.ts apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/hooks/useGoogle.ts apps/app/src/hooks/useGoogle.test.ts apps/app/src/locales/en.json
git commit -m "app: the Google account bridge and its state"
```

---

### Task 6: Renderer - the Google Drive section in Settings -> Accounts

**Files:**
- Create: `apps/app/src/components/GoogleAccountSection.tsx`, `apps/app/src/components/GoogleAccountSection.test.tsx`
- Modify: `apps/app/src/components/SettingsAccounts.tsx` (new `google` prop, render the section after the GitHub `<section>`), `apps/app/src/components/SettingsDialog.tsx` (prop `google: GoogleBridge | null` beside `github`, passed to `SettingsAccounts`), `apps/app/src/App.tsx` (`const google = useMemo(() => googleBridge(), []);` beside `github` at line ~177, and `google={google}` beside `github={github}` on `SettingsDialog` at line ~1099), `apps/app/src/locales/en.json` (`google.*`, `settings.accounts.googleDrive`)
- Modify any existing test that renders `SettingsDialog` or `SettingsAccounts` and fails typecheck for the new required prop: pass `google={null}` (find them with `npx vitest run --root apps/app Settings` after Step 3 and `npm run typecheck`).

**Interfaces:**
- Consumes: `useGoogle`, `GoogleBridge` (Task 5)
- Produces: `<GoogleAccountSection bridge={GoogleBridge | null} />` (PR 2's open-folder dialog reuses it for its not-connected state)

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/GoogleAccountSection.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GoogleAccountSection from "./GoogleAccountSection";
import type { GoogleBridge, GoogleConnectResult } from "../lib/workspaceClient";

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: null })),
    connectGoogle: vi.fn(async (): Promise<GoogleConnectResult> => ({ ok: true, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("GoogleAccountSection", () => {
  it("connects through the browser and shows who is connected", async () => {
    const bridge = fakeBridge();
    render(<GoogleAccountSection bridge={bridge} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));

    expect(await screen.findByText("Connected as ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("offers Cancel while waiting for the browser", async () => {
    let finish: (value: GoogleConnectResult) => void = () => {};
    const bridge = fakeBridge({
      connectGoogle: vi.fn(() => new Promise<GoogleConnectResult>((resolve) => (finish = resolve))),
      cancelGoogleConnect: vi.fn(async () => {
        finish({ ok: false, reason: "cancelled" });
        return { ok: true };
      }),
    });
    render(<GoogleAccountSection bridge={bridge} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(screen.getByText("Waiting for your browser...")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Google Drive" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so, with no button, in a build without Google Drive", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: false, connected: false, email: null, reason: null })),
    });
    render(<GoogleAccountSection bridge={bridge} />);

    expect(await screen.findByText("This build of Trypthos was made without Google Drive support.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Drive" })).toBeNull();
  });

  it("shows a refused sign-in as an alert", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "scope-denied" })) });
    render(<GoogleAccountSection bridge={bridge} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google Drive access was not allowed");
  });

  it("explains the browser preview cannot connect", async () => {
    render(<GoogleAccountSection bridge={null} />);
    expect(await screen.findByText("Connecting to Google Drive needs the desktop app. This is the browser preview.")).toBeInTheDocument();
  });
});
```

(Check `apps/app/src/components/*.test.tsx` for whether this suite imports `userEvent` from `@testing-library/user-event` in jsdom tests - it should; the `vitest/browser` rule applies to the browser suite only. Match whatever the neighbouring Settings tests do.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root apps/app GoogleAccountSection`
Expected: FAIL - cannot resolve `./GoogleAccountSection`.

- [ ] **Step 3: Write the implementation**

In `apps/app/src/locales/en.json`:
- inside `settings.accounts`, after `"github": "GitHub"` add `,"googleDrive": "Google Drive"`
- after the top-level `"github": { ... }` block, add:

```json
  "google": {
    "checking": "Checking your Google account...",
    "connect": "Connect Google Drive",
    "connecting": "Waiting for your browser...",
    "cancel": "Cancel",
    "disconnect": "Disconnect",
    "connectedAs": "Connected as {{email}}",
    "notConnected": "Not connected",
    "connectBlurb": "Trypthos opens Google's sign-in page in your browser. Allow access to Google Drive there, then come back here. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and talks to Google directly from this machine.",
    "notConfigured": "This build of Trypthos was made without Google Drive support.",
    "browserOnly": "Connecting to Google Drive needs the desktop app. This is the browser preview.",
    "nextRelease": "Opening Drive folders as workspaces arrives in the next release."
  },
```

Create `apps/app/src/components/GoogleAccountSection.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useGoogle } from "../hooks/useGoogle";
import type { GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
}

/// Connecting a Google account: status, Connect (and Cancel while the browser is open), Disconnect.
///
/// A component of its own rather than inline in Settings, because the Drive open-folder dialog shows
/// the same control when no account is connected yet. Nothing here displays a credential: the
/// connected account is named by the email the shell got from Google.
export default function GoogleAccountSection({ bridge }: Props) {
  const { t } = useTranslation();
  const google = useGoogle(bridge);

  const statusLine = google.checking
    ? t("google.checking")
    : google.connected && google.email !== null
      ? t("google.connectedAs", { email: google.email })
      : t("google.notConnected");

  return (
    <section className="mt-4 max-w-lg rounded-lg border border-rule p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-ui font-medium text-ink">{t("settings.accounts.googleDrive")}</h4>
        <span className="ml-auto text-xs text-ink-4">{statusLine}</span>
      </div>

      {google.errorKey !== null && (
        <p role="alert" className="mt-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
          {t(google.errorKey)}
        </p>
      )}

      {!google.supported ? (
        <p className="mt-3 text-xs text-ink-3">{t("google.browserOnly")}</p>
      ) : google.checking ? null : !google.configured ? (
        <p className="mt-3 text-xs text-ink-3">{t("google.notConfigured")}</p>
      ) : google.connected ? (
        <button
          type="button"
          onClick={() => void google.disconnect()}
          className="mt-3 rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
        >
          {t("google.disconnect")}
        </button>
      ) : google.connecting ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-ink-3">{t("google.connecting")}</span>
          <button
            type="button"
            onClick={() => void google.cancel()}
            className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("google.cancel")}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-3">{t("google.connectBlurb")}</p>
          <button
            type="button"
            onClick={() => void google.connect()}
            className="mt-3 rounded bg-accent px-3 py-1 text-ui text-on-accent"
          >
            {t("google.connect")}
          </button>
        </>
      )}

      {google.supported && google.configured && <p className="mt-3 text-xs text-ink-4">{t("google.nextRelease")}</p>}
    </section>
  );
}
```

In `apps/app/src/components/SettingsAccounts.tsx`:
- add imports `import GoogleAccountSection from "./GoogleAccountSection";` and `import type { GitHubBridge, GoogleBridge } from "../lib/workspaceClient";` (replacing the existing `GitHubBridge`-only import)
- add to `Props`:
  ```ts
    /// The Google half of the shell, or null in the browser preview.
    google: GoogleBridge | null;
  ```
- change the signature to `export default function SettingsAccounts({ bridge, google }: Props)`
- after the closing `</section>` of the GitHub section, add `<GoogleAccountSection bridge={google} />`

In `apps/app/src/components/SettingsDialog.tsx`: import `GoogleBridge` beside `GitHubBridge`; add a `google: GoogleBridge | null;` prop directly under `github` (with the same style of doc comment); destructure `google` beside `github`; render `<SettingsAccounts bridge={github} google={google} />`.

In `apps/app/src/App.tsx`: import `googleBridge` beside `githubBridge`; add `const google = useMemo(() => googleBridge(), []);` directly under the `github` memo; pass `google={google}` directly under `github={github}` on `SettingsDialog`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck`, fix any test that renders `SettingsDialog`/`SettingsAccounts` by passing `google={null}`, then `npm test` and `npm run lint`
Expected: everything PASS, including `i18nKeys` (every new key referenced, none orphaned) and the no-dash guard.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/GoogleAccountSection.tsx apps/app/src/components/GoogleAccountSection.test.tsx apps/app/src/components/SettingsAccounts.tsx apps/app/src/components/SettingsDialog.tsx apps/app/src/App.tsx apps/app/src/locales/en.json
git add -u apps/app/src   # any existing Settings tests that gained google={null}
git commit -m "app: connect a Google account from Settings > Accounts"
```

---

### Task 7: Manual check, release, docs, PR

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json` (exactly five entries), `apps/app/src/lib/releaseNotes/current.ts`, `apps/app/src/lib/appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Manual check against the Internal test project**

Requires the Desktop client JSON at `D:\Repositories\Trypthos\.secrets\gdrive-client.json` (outside the repo, never committed).

```bash
npm run build --workspace @trypthos/domain
```

Start the renderer dev server and Electron with the client set (PowerShell: `$env:TRYPTHOS_GOOGLE_CLIENT = "D:\Repositories\Trypthos\.secrets\gdrive-client.json"` before `npm run dev --workspace trypthos-desktop`). Then, in Settings -> Accounts -> Google Drive:
1. Connect -> browser opens Google consent -> approve -> the tab says to return -> Settings shows "Connected as <your account>".
2. Restart the app -> still connected (refresh token survived; status re-asked Google).
3. Connect again after Disconnect, this time **untick the Google Drive box** on the consent screen -> the scope-denied alert appears and the status stays "Not connected".
4. Connect, then close the browser tab without answering, then press Cancel -> back to the Connect button, no alert.
5. Disconnect -> "Not connected"; in the Google account's third-party access page, Trypthos's access is gone.
6. Without `TRYPTHOS_GOOGLE_CLIENT` set -> the section says this build has no Google Drive support.

Record the outcome of each in the PR body ("Manual check" section) as pass/fail only - no account names.

- [ ] **Step 2: Version 0.95.4 -> 0.96.0**

Edit `version.json` and the four `package.json` files. In `package-lock.json` change exactly five `"version": "0.95.4"` entries: the top-level one, and those under `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]` - match each by the workspace `name` above it, never by find-and-replace across the file. Then:

Run: `npx vitest run --root apps/app versionMirrors`
Expected: PASS after Step 3 (it also checks `RECENT[0]`).

- [ ] **Step 3: Release notes entry**

Find the next PR number: `gh pr list --state all --limit 1 --json number` and `gh issue list --state all --limit 1 --json number`; the PR will be the larger of the two plus one (confirm after `gh pr create` and correct if different). Add at the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`:

```ts
  {
    version: "0.96.0",
    date: "<today, YYYY-MM-DD>",
    pr: <number>,
    headline: "Connect a Google account, ready for Google Drive folders",
    summary:
      "The first step towards opening Google Drive folders as workspaces: Settings > Accounts now has a Google Drive section. Connect opens Google's own sign-in page in your browser, where you allow Trypthos to use Google Drive, and the section then shows which account is connected. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and every request goes from this machine straight to Google. If you untick Google Drive on Google's page, Trypthos says so rather than pretending to be connected. Disconnect signs out and asks Google to forget the permission. Opening Drive folders in the folder browser arrives in the next release.",
    added: [
      "Settings > Accounts > Google Drive: connect through Google's sign-in page in your browser, see which account is connected, cancel a sign-in you did not finish, and disconnect.",
    ],
  },
```

- [ ] **Step 4: About box, README, features, Architecture, CLAUDE.md**

`apps/app/src/lib/appInfo.ts`:
- In the "Workspace browser" row replace `OneDrive, Google Drive and Dropbox follow in a later release.` with `Google Drive folders follow in the next release, OneDrive and Dropbox later.`
- Add a row directly after "GitHub repositories": `| Google Drive | Connect your Google account from Settings > Accounts, through Google's sign-in page in your browser. Opening Drive folders as workspaces follows in the next release. |`
- In `DISCLAIMERS`, after the GitHub line, add: `"Google requests go directly from this app to Google's sign-in and Drive services, using the permission you grant on Google's own page. What keeps you signed in is encrypted by your operating system and never leaves this machine.",`

`README.md` Features table: add a `Google Drive` row matching the About row's meaning, linking to `docs/features.md` the way the GitHub row does; update any line that says Google Drive is planned/not written (search `Google Drive`) so it says sign-in is built and folders follow.

`docs/features.md`: add a Google Drive bullet beside the GitHub one with the same content as the release summary's first three sentences.

`docs/Architecture.md`: add a "Google Drive (sign-in)" section after the GitHub section covering - in prose, with the reasons from the spec - the loopback + PKCE flow and why (Google blocks embedded sign-in), the `drive` scope and why (`drive.file` lists nothing - spike), refresh token in `providerAccounts.json` under `google-drive` and the access token in memory only, the four `google:*` channels and their answers (email, never a token), the OAuth client's origin (`resources/build/google-oauth-client.json` from the `GOOGLE_OAUTH_CLIENT_JSON` secret; `TRYPTHOS_GOOGLE_CLIENT` in development; null = not configured), and that publishing beyond the Workspace organisation needs Google verification of a restricted scope. Update the built-status line near `:607` so it no longer lists Google Drive as unwritten.

`CLAUDE.md`, "Cloud providers" section: change `Then, in order: **OneDrive, Google Drive, Dropbox, GitHub.**` to `Then, in order: **Google Drive, OneDrive, Dropbox** (GitHub shipped first, out of the original order).` and in the "Status" note at the top replace `the cloud backends are not written` with `Google Drive sign-in is built and its folders are in progress; the other cloud backends are not written`.

- [ ] **Step 5: Full verification**

Run, each must be clean: `npm ci` (only if node_modules is stale), `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser`
Expected: all PASS, no warnings in the output.

- [ ] **Step 6: Line endings, commit, push, PR**

Run the line-ending repair against `main` from `AGENTS.md` (the "ready-to-run repair script"), then confirm `git diff main --stat` shows only intended lines.

```bash
git add version.json package.json apps/app/package.json apps/desktop/package.json packages/domain/package.json package-lock.json apps/app/src/lib/releaseNotes/current.ts apps/app/src/lib/appInfo.ts README.md docs/features.md docs/Architecture.md CLAUDE.md
git commit -m "release: 0.96.0 - connect a Google account"
git push -u origin claude/google-drive-workspace-7a679d
gh pr create --title "Connect a Google account (Google Drive, part 1)" --body-file <body>
```

PR body must include: summary; "Spec: docs/specs/google-drive-workspace.md"; the manual-check results from Step 1; **Deployment surface: needs a release (new installer). The release workflow needs the `GOOGLE_OAUTH_CLIENT_JSON` repository secret set to the Desktop client JSON before tagging, or the installer ships without Google Drive sign-in.**; and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer. No issue is needed (feature, not a fix). If `gh pr create` reports a different number than Step 3 assumed, fix `pr:` in `current.ts`, commit and push.
