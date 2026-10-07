# OneDrive PR 1: Connect a Microsoft account - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can connect a personal Microsoft account from Settings > Accounts (sign-in in their browser), see "Connected as <email>", and disconnect - with no token ever crossing IPC or reaching a log. Version 0.102.0.

**Architecture:** Mirrors Google's account plumbing. The loopback listener and PKCE move out of `googleAuth.js` into a shared `loopbackOAuth.js`; a new `microsoftAuth.js` uses it against Microsoft's `consumers` authority, storing only the (rotating) refresh token in `accountStore` under `"onedrive"`. Four `onedrive:*` channels answer status/connect/cancel/disconnect. In the renderer, `GoogleAccountSection` + `useGoogle` become a provider-neutral `CloudAccountSection` + `useCloudAccount`, used for both Google and OneDrive.

**Tech Stack:** Electron main (CommonJS, `net.fetch`), zod domain package (TypeScript, built to CommonJS), React 19 renderer, vitest (jsdom), `node --test` for the shell.

**Spec:** `docs/specs/onedrive-workspace.md` (read it first - its spike table and decisions table are binding).

## Global Constraints

- TDD: every behaviour change starts with a failing test, watched failing, then the minimal code.
- A passing test run prints nothing to stderr. Shell modules take an injected `logger` and tests pass a collecting one.
- **Tokens never cross IPC, never reach a log, never appear in an error message.** Log lines carry a step name plus `error?.code ?? error?.name` only - never a URL, body, code, state, verifier, token, email or path.
- Leak-guard tests assert the **exact** token strings are absent (never a host-name substring - CodeQL flags that).
- Every user-facing string goes through `apps/app/src/locales/en.json`. **No em or en dashes** in user-facing text; use `-`.
- Scopes, exactly: `Files.ReadWrite.All offline_access User.Read`. Authority: `https://login.microsoftonline.com/consumers/oauth2/v2.0`.
- Redirect URI: `http://localhost:<port>` (the app registration lists `http://localhost`; Microsoft accepts any port for it). The listener binds `127.0.0.1`.
- Client ID is **not committed**. Packaged: `resources/build/onedrive-client.json` written by the release workflow from the `ONEDRIVE_CLIENT_ID` secret. Development: the file named by `TRYPTHOS_ONEDRIVE_CLIENT`. Shape `{ "clientId": "<uuid>" }`. No file means OneDrive is `not-configured`.
- Account store key: `"onedrive"`. The refresh token **rotates on every refresh**: store the new one before the refresh resolves; refreshes are single-flight.
- Personal accounts only. No client secret anywhere.
- Never put real user data in fixtures: use `ada@example.com`, invented tokens like `refresh-invented-1`.
- Version: **0.102.0** (functional enhancement: Minor +1, Build 0). `version.json` + root/app/desktop/domain `package.json` + exactly five `package-lock.json` entries (top-level `version`, `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]`) - match on the workspace name, never find-and-replace.
- Line endings: committed files mix CRLF and LF and the editor tools rewrite to LF. Commit, then run the repair script against `origin/main` and re-stage with `git restore --staged --source=origin/main -- F && git add F` per file (see AGENTS.md). `package-lock.json` is LF-pinned by `.gitattributes`.
- Writing files through a shell heredoc or Python string mangles backslashes (`\n`, `\b`): use the editor tools for any file containing regex escapes.
- Commands (from the repo root): `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser`. One renderer file: `npx vitest run --root apps/app <name>`. One domain file: `npx vitest run --root packages/domain <name>`. One shell file: `node --test apps/desktop/test/<file>.test.js`.
- The shell requires `@trypthos/domain` from `packages/domain/dist`: run `npm run build --workspace @trypthos/domain` after changing the domain and before running shell tests.

## Rulings recorded while planning

- **`/me` lives in `microsoftAuth.js`, not `oneDriveApi.js`.** The spec's PR 1 line mentions `oneDriveApi.me/drive`; Google's account lookup lives in `googleAuth.js`, and `/me/drive` is only needed once workspaces open. `oneDriveApi.js` is created in PR 2. Cost if wrong: one function moves in PR 2.
- **No revoke on disconnect.** Microsoft's v2 endpoint has no token revocation for personal accounts. Disconnect forgets the local token; the Settings text tells the user where to remove the app's access (`https://account.live.com/consent/Manage`).
- **Renderer failure keys for OneDrive** come from a small `oneDriveFailureKey(reason)` in PR 1, because `ProviderKind` gains `"onedrive"` only when the workspace kind arrives in PR 2. PR 2 folds it into `providerFailureKey`.
- **Shared strings move to `cloud.*`** (connecting, cancel, disconnect, connectedAs, notConnected, browserOnly); provider-specific ones stay under `google.*` and new `onedrive.*`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/microsoftAuth.ts` (new) | Microsoft URLs, scopes, client-file schema, authorize/token/refresh bodies, token and `/me` schemas, scope check, failure mapping. Pure. |
| `packages/domain/src/microsoftAuth.test.ts` (new) | Its tests. |
| `packages/domain/src/index.ts` | Re-exports. |
| `packages/domain/src/ipc.ts` | Four new channels in `IPC_CHANNELS`. |
| `apps/desktop/src/loopbackOAuth.js` (new) | `listenOnce({ redirectHost })`, `pkcePair(randomBytes)`. Moved out of `googleAuth.js`. |
| `apps/desktop/test/loopbackOAuth.test.js` (new) | The listener test moved from `googleAuth.test.js`, plus `redirectHost` and `pkcePair`. |
| `apps/desktop/src/googleAuth.js` | Imports from `loopbackOAuth.js`; re-exports `listenOnce` for compatibility of nothing - see Task 2. |
| `apps/desktop/src/microsoftClient.js` (new) | Finds and validates the client file. |
| `apps/desktop/test/microsoftClient.test.js` (new) | Its tests. |
| `apps/desktop/src/microsoftAuth.js` (new) | Sign-in, rotating refresh, status, disconnect. |
| `apps/desktop/test/microsoftAuth.test.js` (new) | Its tests. |
| `apps/desktop/src/ipcHandlers.js` | `microsoft` dependency and the four `onedrive:*` handlers. |
| `apps/desktop/test/oneDriveIpc.test.js` (new) | Handlers through a real `microsoftAuth` over a fake Microsoft; the token leak walk. |
| `apps/desktop/src/preload.js` | `oneDriveStatus`, `connectOneDrive`, `cancelOneDriveConnect`, `disconnectOneDrive`. |
| `apps/desktop/src/main.js` | Builds `microsoft` and passes it to the handlers. |
| `apps/desktop/electron-builder.config.cjs` | Ships `build/onedrive-client.json`. |
| `.github/workflows/desktop-release.yml` | Writes it from `ONEDRIVE_CLIENT_ID`. |
| `apps/app/src/lib/workspaceClient.ts` | `CloudAccountBridge`, `OneDriveBridge`, `oneDriveBridge()`, `googleAccountBridge()`. |
| `apps/app/src/hooks/useCloudAccount.ts` (new, replaces `useGoogle.ts`) | Provider-neutral account state and actions. |
| `apps/app/src/components/CloudAccountSection.tsx` (new, replaces `GoogleAccountSection.tsx`) | Provider-neutral account UI. |
| `apps/app/src/lib/cloudAccounts.ts` (new) | `GOOGLE_ACCOUNT` and `ONEDRIVE_ACCOUNT` descriptors (keys, failure mapping). |
| `apps/app/src/components/SettingsAccounts.tsx`, `OpenDriveDialog.tsx`, `App.tsx` | Use the shared section; Settings shows OneDrive. |
| `apps/app/src/locales/en.json` | `cloud.*`, `onedrive.*`, `settings.accounts.oneDrive`, `errors.oneDrive*`. |
| Docs | `version.json` + mirrors, `releaseNotes/current.ts`, `appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`, the spec's status line. |

---

### Task 1: Domain - Microsoft sign-in model

**Files:**
- Create: `packages/domain/src/microsoftAuth.ts`
- Create: `packages/domain/src/microsoftAuth.test.ts`
- Modify: `packages/domain/src/index.ts` (add the exports next to the `googleAuth` block)

**Interfaces:**
- Produces (all exported from `@trypthos/domain`):
  - `MICROSOFT_AUTHORITY`, `MICROSOFT_AUTHORIZE_URL`, `MICROSOFT_TOKEN_URL`, `GRAPH_ME_URL`, `ONEDRIVE_SCOPES` (readonly tuple), `ONEDRIVE_PROVIDER = "onedrive"`
  - `MicrosoftClientConfigSchema` -> `{ clientId: string }`
  - `microsoftAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }): string`
  - `microsoftTokenRequestBody({ clientId, code, codeVerifier, redirectUri }): string`
  - `microsoftRefreshRequestBody({ clientId, refreshToken }): string`
  - `MicrosoftTokenSchema` (requires `refresh_token`)
  - `GraphMeSchema`, `accountEmail(me): string`
  - `grantsOneDrive(scope: string): boolean`
  - `microsoftAuthErrorFor(status: number, body: unknown): "not-connected" | "not-configured" | "permission-denied" | "rate-limited" | "offline"`
  - `readRedirect` is reused from `googleAuth.ts` unchanged (it is provider-neutral).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/microsoftAuth.test.ts
import { describe, expect, it } from "vitest";
import {
  GRAPH_ME_URL,
  GraphMeSchema,
  MICROSOFT_AUTHORIZE_URL,
  MICROSOFT_TOKEN_URL,
  MicrosoftClientConfigSchema,
  MicrosoftTokenSchema,
  ONEDRIVE_SCOPES,
  accountEmail,
  grantsOneDrive,
  microsoftAuthErrorFor,
  microsoftAuthorizationUrl,
  microsoftRefreshRequestBody,
  microsoftTokenRequestBody,
} from "./microsoftAuth";

const CLIENT = "00000000-1111-2222-3333-444444444444";

describe("Microsoft sign-in addresses", () => {
  it("signs in personal accounts only, through the consumers authority", () => {
    expect(MICROSOFT_AUTHORIZE_URL).toBe("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
    expect(MICROSOFT_TOKEN_URL).toBe("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
    expect(GRAPH_ME_URL).toBe("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName");
  });

  it("asks for exactly the three scopes the app registration grants", () => {
    expect([...ONEDRIVE_SCOPES]).toEqual(["Files.ReadWrite.All", "offline_access", "User.Read"]);
  });

  it("builds the authorize URL with PKCE, state, and an account chooser", () => {
    const url = new URL(
      microsoftAuthorizationUrl({ clientId: CLIENT, redirectUri: "http://localhost:5050", state: "s1", codeChallenge: "c1" }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(MICROSOFT_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: "http://localhost:5050",
      response_type: "code",
      response_mode: "query",
      scope: "Files.ReadWrite.All offline_access User.Read",
      state: "s1",
      code_challenge: "c1",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("exchanges a code without any client secret", () => {
    const body = new URLSearchParams(
      microsoftTokenRequestBody({ clientId: CLIENT, code: "k", codeVerifier: "v", redirectUri: "http://localhost:5050" }),
    );
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      client_id: CLIENT,
      code: "k",
      code_verifier: "v",
      redirect_uri: "http://localhost:5050",
      scope: "Files.ReadWrite.All offline_access User.Read",
    });
    expect(body.has("client_secret")).toBe(false);
  });

  // Microsoft requires the scope on a refresh too, and answers with a NEW refresh token.
  it("refreshes with the scope and without a secret", () => {
    const body = new URLSearchParams(microsoftRefreshRequestBody({ clientId: CLIENT, refreshToken: "r" }));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      client_id: CLIENT,
      refresh_token: "r",
      scope: "Files.ReadWrite.All offline_access User.Read",
    });
  });
});

describe("the client file", () => {
  it("accepts a client id", () => {
    expect(MicrosoftClientConfigSchema.parse({ clientId: CLIENT })).toEqual({ clientId: CLIENT });
  });

  it("refuses anything that is not a GUID, and any extra field", () => {
    expect(MicrosoftClientConfigSchema.safeParse({ clientId: "not-a-guid" }).success).toBe(false);
    expect(MicrosoftClientConfigSchema.safeParse({ clientId: CLIENT, clientSecret: "x" }).success).toBe(false);
  });
});

describe("what Microsoft answers", () => {
  const token = { access_token: "a", expires_in: 3599, scope: "Files.ReadWrite.All User.Read", token_type: "Bearer", refresh_token: "r" };

  it("needs a refresh token on every answer, because it rotates", () => {
    expect(MicrosoftTokenSchema.safeParse(token).success).toBe(true);
    const { refresh_token: _dropped, ...without } = token;
    expect(MicrosoftTokenSchema.safeParse(without).success).toBe(false);
  });

  it("names the account by mail, or by its principal name when there is no mail", () => {
    expect(accountEmail(GraphMeSchema.parse({ mail: "ada@example.com", userPrincipalName: "ada@outlook.com" }))).toBe(
      "ada@example.com",
    );
    expect(accountEmail(GraphMeSchema.parse({ mail: null, userPrincipalName: "ada@outlook.com" }))).toBe("ada@outlook.com");
    expect(GraphMeSchema.safeParse({ mail: null }).success).toBe(false);
  });
});

describe("grantsOneDrive", () => {
  // The spike's answer: offline_access is not echoed, the other two are.
  it("accepts the granted pair, short or fully qualified, in any case", () => {
    expect(grantsOneDrive("Files.ReadWrite.All User.Read")).toBe(true);
    expect(grantsOneDrive("https://graph.microsoft.com/Files.ReadWrite.All https://graph.microsoft.com/User.Read")).toBe(true);
    expect(grantsOneDrive("files.readwrite.all user.read")).toBe(true);
  });

  it("refuses a grant missing either one, or a narrower files scope", () => {
    expect(grantsOneDrive("User.Read")).toBe(false);
    expect(grantsOneDrive("Files.ReadWrite.All")).toBe(false);
    expect(grantsOneDrive("Files.ReadWrite User.Read")).toBe(false);
    expect(grantsOneDrive("Files.ReadWrite.AllX User.Read")).toBe(false);
  });
});

describe("microsoftAuthErrorFor", () => {
  it.each([
    [400, { error: "invalid_grant" }, "not-connected"],
    [400, { error: "interaction_required" }, "not-connected"],
    [400, { error: "invalid_client" }, "not-configured"],
    [400, { error: "unauthorized_client" }, "not-configured"],
    [401, {}, "permission-denied"],
    [429, {}, "rate-limited"],
    [500, {}, "offline"],
    [400, "not json", "offline"],
  ])("%i %j is %s", (status, body, reason) => {
    expect(microsoftAuthErrorFor(status, body)).toBe(reason);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --root packages/domain microsoftAuth`
Expected: FAIL - cannot resolve `./microsoftAuth`.

- [ ] **Step 3: Write the module**

```ts
// packages/domain/src/microsoftAuth.ts
import { z } from "zod";

/// Signing in to a personal Microsoft account, for OneDrive. Pure: addresses, request bodies, and
/// the shapes Microsoft's answers are checked against. The fetch lives in the shell's
/// `microsoftAuth.js`. See docs/specs/onedrive-workspace.md.
///
/// **Personal accounts only**: the `consumers` authority. The app registration is set the same way,
/// and nothing here is tested against a work or school tenant.

export const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
export const MICROSOFT_AUTHORIZE_URL = `${MICROSOFT_AUTHORITY}/authorize`;
export const MICROSOFT_TOKEN_URL = `${MICROSOFT_AUTHORITY}/token`;
export const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";

/// Where the refresh token is kept in the account store.
export const ONEDRIVE_PROVIDER = "onedrive";

/// `Files.ReadWrite.All` rather than `Files.ReadWrite`: only the former reaches folders other people
/// shared with the user. `offline_access` is what earns a refresh token.
export const ONEDRIVE_SCOPES = ["Files.ReadWrite.All", "offline_access", "User.Read"] as const;
const SCOPE = ONEDRIVE_SCOPES.join(" ");

/// What the build carries: the app registration's client id. Not a secret - a public client has
/// none - but injected at build time so a fork does not sign in as this registration.
export const MicrosoftClientConfigSchema = z.object({ clientId: z.string().uuid() }).strict();

export type MicrosoftClientConfig = z.infer<typeof MicrosoftClientConfigSchema>;

export function microsoftAuthorizationUrl({
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
    response_mode: "query",
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Lets someone signed in to the browser with one Microsoft account connect a different one.
    prompt: "select_account",
  });
  return `${MICROSOFT_AUTHORIZE_URL}?${params.toString()}`;
}

export function microsoftTokenRequestBody({
  clientId,
  code,
  codeVerifier,
  redirectUri,
}: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    scope: SCOPE,
  }).toString();
}

export function microsoftRefreshRequestBody({ clientId, refreshToken }: { clientId: string; refreshToken: string }): string {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE,
  }).toString();
}

/// Microsoft returns a refresh token on EVERY answer, the first exchange and each refresh alike, and
/// the old one may stop working once a new one is issued - so its absence is a fault, not a detail.
export const MicrosoftTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  token_type: z.string(),
  refresh_token: z.string().min(1),
});

export type MicrosoftToken = z.infer<typeof MicrosoftTokenSchema>;

/// `/me`, narrowed to what names the account. `mail` can be null on a personal account; the
/// principal name is then the sign-in address.
export const GraphMeSchema = z
  .object({ mail: z.string().min(1).nullish(), userPrincipalName: z.string().min(1).optional() })
  .refine((me) => typeof me.mail === "string" || typeof me.userPrincipalName === "string");

export type GraphMe = z.infer<typeof GraphMeSchema>;

export function accountEmail(me: GraphMe): string {
  return me.mail ?? me.userPrincipalName ?? "";
}

const GRAPH_PREFIX = "https://graph.microsoft.com/";

/// Whether the granted scopes include both that OneDrive needs. Token by token, case-insensitively,
/// with or without Graph's resource prefix - never as a substring, so `Files.ReadWrite` does not pass
/// for `Files.ReadWrite.All`.
export function grantsOneDrive(scope: string): boolean {
  const granted = new Set(
    scope
      .split(/\s+/)
      .filter((token) => token !== "")
      .map((token) => (token.toLowerCase().startsWith(GRAPH_PREFIX) ? token.slice(GRAPH_PREFIX.length) : token).toLowerCase()),
  );
  return granted.has("files.readwrite.all") && granted.has("user.read");
}

const MicrosoftErrorBodySchema = z.object({ error: z.string() });

export type MicrosoftAuthFailure = "not-connected" | "not-configured" | "permission-denied" | "rate-limited" | "offline";

/// What a refusal from the token endpoint or `/me` means to the user.
export function microsoftAuthErrorFor(status: number, body: unknown): MicrosoftAuthFailure {
  const parsed = MicrosoftErrorBodySchema.safeParse(body);
  if (parsed.success) {
    if (parsed.data.error === "invalid_grant" || parsed.data.error === "interaction_required") return "not-connected";
    if (parsed.data.error === "invalid_client" || parsed.data.error === "unauthorized_client") return "not-configured";
  }
  if (status === 401) return "permission-denied";
  if (status === 429) return "rate-limited";
  return "offline";
}
```

Add to `packages/domain/src/index.ts`, beside the existing `googleAuth` exports (follow that block's style - values and `type` exports listed explicitly):

```ts
export {
  GRAPH_ME_URL,
  GraphMeSchema,
  MICROSOFT_AUTHORITY,
  MICROSOFT_AUTHORIZE_URL,
  MICROSOFT_TOKEN_URL,
  MicrosoftClientConfigSchema,
  MicrosoftTokenSchema,
  ONEDRIVE_PROVIDER,
  ONEDRIVE_SCOPES,
  accountEmail,
  grantsOneDrive,
  microsoftAuthErrorFor,
  microsoftAuthorizationUrl,
  microsoftRefreshRequestBody,
  microsoftTokenRequestBody,
  type GraphMe,
  type MicrosoftAuthFailure,
  type MicrosoftClientConfig,
  type MicrosoftToken,
} from "./microsoftAuth";
```

- [ ] **Step 4: Run them to verify they pass, then the whole domain suite**

Run: `npx vitest run --root packages/domain microsoftAuth` then `npm test --workspace @trypthos/domain`
Expected: PASS. If the domain has a module-graph test listing every source file, add `microsoftAuth.ts` to it as that test asks.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/microsoftAuth.ts packages/domain/src/microsoftAuth.test.ts packages/domain/src/index.ts
git commit -m "Domain: Microsoft sign-in addresses, schemas and scope check"
```

---

### Task 2: Shell - extract the loopback listener and PKCE

**Files:**
- Create: `apps/desktop/src/loopbackOAuth.js`
- Create: `apps/desktop/test/loopbackOAuth.test.js`
- Modify: `apps/desktop/src/googleAuth.js` (remove `listenOnce`, `DONE_PAGE`; import from `loopbackOAuth.js`; compute PKCE with `pkcePair`)
- Modify: `apps/desktop/test/googleAuth.test.js` (the `listenOnce` test near line 299 moves to the new file)

**Interfaces:**
- Produces: `listenOnce({ redirectHost = "127.0.0.1" } = {}) -> Promise<{ redirectUri: string, arrived: Promise<string>, close(): void }>` - binds `127.0.0.1` always; `redirectUri` is `http://<redirectHost>:<port>`. `pkcePair(randomBytes) -> { verifier, challenge, state }`.
- Consumes: nothing new.
- `googleAuth.js` keeps exporting `{ createGoogleAuth, GOOGLE_PROVIDER }` and **stops** exporting `listenOnce`; grep for other importers first (`grep -rn "listenOnce" apps/desktop`) and update them.

- [ ] **Step 1: Move the existing listener test and add the new cases**

Open `apps/desktop/test/googleAuth.test.js`, find the test(s) starting at the `const { listenOnce } = require("../src/googleAuth");` line (around line 299), cut them, and paste into the new file below with the require changed. Then add:

```js
// apps/desktop/test/loopbackOAuth.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { listenOnce, pkcePair } = require("../src/loopbackOAuth");

// ...the moved listenOnce test(s) from googleAuth.test.js go here, unchanged except the require...

// Microsoft's registration names http://localhost, Google's flow uses 127.0.0.1. The socket is
// 127.0.0.1 either way - only the address the provider is told changes.
test("names the redirect by the host asked for, while listening on 127.0.0.1", async () => {
  const listener = await listenOnce({ redirectHost: "localhost" });
  try {
    const port = new URL(listener.redirectUri).port;
    assert.match(listener.redirectUri, /^http:\/\/localhost:\d+$/);
    const response = await fetch(`http://127.0.0.1:${port}/?code=c&state=s`);
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(new URL(await listener.arrived).searchParams.get("code"), "c");
  } finally {
    listener.close();
  }
});

test("defaults the redirect host to 127.0.0.1", async () => {
  const listener = await listenOnce();
  try {
    assert.match(listener.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    listener.close();
  }
});

test("makes a verifier, its S256 challenge, and a state", () => {
  const bytes = (n) => Buffer.alloc(n, 7);
  const { verifier, challenge, state } = pkcePair(bytes);
  assert.equal(verifier, bytes(32).toString("base64url"));
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(state, bytes(16).toString("base64url"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/desktop/test/loopbackOAuth.test.js`
Expected: FAIL - `Cannot find module '../src/loopbackOAuth'`.

- [ ] **Step 3: Create the module by moving code**

```js
// apps/desktop/src/loopbackOAuth.js
"use strict";

const http = require("node:http");
const nodeCrypto = require("node:crypto");

/// The part of a desktop OAuth sign-in that is the same for every provider: a listener on a free
/// loopback port, and the PKCE verifier, challenge and state. Moved out of googleAuth.js so Google
/// and Microsoft share one implementation of the part that is easy to get subtly wrong.

/// What the browser tab shows after the provider redirects back. English, like the shell's menus:
/// this page is drawn before the renderer and its catalogue are involved.
const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Trypthos</title>' +
  '<p style="font-family:system-ui,sans-serif">You can close this tab and return to Trypthos.</p>';

/// A listener on a free port of 127.0.0.1 that resolves `arrived` with the first request to `/`.
///
/// Only `/` counts: a browser also asks for /favicon.ico, and that must not be taken for the answer.
/// `redirectHost` is only what the provider is TOLD: Microsoft's registration names `localhost`,
/// Google's flow uses `127.0.0.1`. The socket is 127.0.0.1 either way, never every interface.
function listenOnce({ redirectHost = "127.0.0.1" } = {}) {
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
        redirectUri: `http://${redirectHost}:${port}`,
        arrived,
        close: () => {
          server.closeAllConnections?.();
          server.close();
        },
      });
    });
  });
}

/// The PKCE pair and the state, from the injected random source so a test can fix them.
function pkcePair(randomBytes = nodeCrypto.randomBytes) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = nodeCrypto.createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

module.exports = { listenOnce, pkcePair };
```

In `apps/desktop/src/googleAuth.js`:
- delete `const http = require("node:http");`, the `DONE_PAGE` constant and the whole `listenOnce` function;
- add `const { listenOnce, pkcePair } = require("./loopbackOAuth");`;
- replace the three lines computing `verifier`, `challenge`, `state` (around line 201) with `const { verifier, challenge, state } = pkcePair(randomBytes);`;
- keep `const nodeCrypto = require("node:crypto");` only if still used (it is the default for `randomBytes`);
- change the export to `module.exports = { createGoogleAuth, GOOGLE_PROVIDER };`.

- [ ] **Step 4: Run both files**

Run: `node --test apps/desktop/test/loopbackOAuth.test.js apps/desktop/test/googleAuth.test.js apps/desktop/test/googleIpc.test.js`
Expected: PASS, with no stderr output. Google's tests pass unchanged apart from the moved block.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/loopbackOAuth.js apps/desktop/test/loopbackOAuth.test.js apps/desktop/src/googleAuth.js apps/desktop/test/googleAuth.test.js
git commit -m "Shell: share the loopback listener and PKCE between providers"
```

---

### Task 3: Shell - find the Microsoft client

**Files:**
- Create: `apps/desktop/src/microsoftClient.js`
- Create: `apps/desktop/test/microsoftClient.test.js`

**Interfaces:**
- Consumes: `MicrosoftClientConfigSchema` (Task 1).
- Produces: `loadMicrosoftClient({ packaged, resourcesPath, env = process.env, readFile, logger = console }) -> { clientId } | null`; constants `CLIENT_FILE = "onedrive-client.json"`, `DEV_CLIENT_ENV = "TRYPTHOS_ONEDRIVE_CLIENT"`.

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/test/microsoftClient.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadMicrosoftClient, CLIENT_FILE, DEV_CLIENT_ENV } = require("../src/microsoftClient");

const ID = "00000000-1111-2222-3333-444444444444";
const quiet = () => {
  const logged = [];
  return { logged, logger: { error: (line) => logged.push(line) } };
};

test("a packaged build reads resources/build/onedrive-client.json", () => {
  const read = [];
  const client = loadMicrosoftClient({
    packaged: true,
    resourcesPath: "/app/resources",
    env: {},
    readFile: (file) => (read.push(file), JSON.stringify({ clientId: ID })),
  });
  assert.deepEqual(client, { clientId: ID });
  assert.deepEqual(read, [path.join("/app/resources", "build", CLIENT_FILE)]);
});

test("development reads the file the environment names", () => {
  const client = loadMicrosoftClient({
    packaged: false,
    resourcesPath: "/unused",
    env: { [DEV_CLIENT_ENV]: "/secrets/onedrive-client.json" },
    readFile: (file) => (assert.equal(file, "/secrets/onedrive-client.json"), JSON.stringify({ clientId: ID })),
  });
  assert.deepEqual(client, { clientId: ID });
});

test("no file, or no variable, is a build without OneDrive - and says nothing", () => {
  const { logged, logger } = quiet();
  assert.equal(loadMicrosoftClient({ packaged: false, resourcesPath: "/r", env: {}, logger }), null);
  assert.equal(
    loadMicrosoftClient({
      packaged: true,
      resourcesPath: "/r",
      env: {},
      logger,
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    null,
  );
  assert.deepEqual(logged, []);
});

test("a file that is not JSON, or not a client id, is refused with one line naming neither its contents", () => {
  const { logged, logger } = quiet();
  assert.equal(loadMicrosoftClient({ packaged: true, resourcesPath: "/r", env: {}, logger, readFile: () => "{nope" }), null);
  assert.equal(
    loadMicrosoftClient({ packaged: true, resourcesPath: "/r", env: {}, logger, readFile: () => JSON.stringify({ clientId: "abc" }) }),
    null,
  );
  assert.equal(logged.length, 2);
  assert.equal(logged.some((line) => line.includes("abc") || line.includes("nope")), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/microsoftClient.test.js`
Expected: FAIL - `Cannot find module '../src/microsoftClient'`.

- [ ] **Step 3: Write the module**

```js
// apps/desktop/src/microsoftClient.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MicrosoftClientConfigSchema } = require("@trypthos/domain");

/// The Microsoft app registration this build signs in with, or null for a build without one.
///
/// **Packaged:** `resources/build/onedrive-client.json`, written by the release workflow from the
/// `ONEDRIVE_CLIENT_ID` repository secret. A public client has no secret, but the id is still
/// injected rather than committed, so a fork does not sign its users in as this registration.
///
/// **Development:** the file named by `TRYPTHOS_ONEDRIVE_CLIENT`, `{ "clientId": "<guid>" }`.
///
/// Null is a normal answer: the interface then says OneDrive is not available in this build.

const CLIENT_FILE = "onedrive-client.json";
const DEV_CLIENT_ENV = "TRYPTHOS_ONEDRIVE_CLIENT";

function clientFileFor({ packaged, resourcesPath, env }) {
  if (packaged) return path.join(resourcesPath, "build", CLIENT_FILE);
  const named = env[DEV_CLIENT_ENV];
  return typeof named === "string" && named !== "" ? named : null;
}

function loadMicrosoftClient({
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
    // Absent is the build without OneDrive. Nothing to report.
    return null;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error?.("The OneDrive client file is not JSON, so OneDrive is unavailable.");
    return null;
  }

  const parsed = MicrosoftClientConfigSchema.safeParse(json);
  if (!parsed.success) {
    logger.error?.("The OneDrive client file does not hold a client id, so OneDrive is unavailable.");
    return null;
  }
  return parsed.data;
}

module.exports = { loadMicrosoftClient, CLIENT_FILE, DEV_CLIENT_ENV };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test apps/desktop/test/microsoftClient.test.js`
Expected: PASS, no stderr.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/microsoftClient.js apps/desktop/test/microsoftClient.test.js
git commit -m "Shell: find the OneDrive client id, injected or named in development"
```

---

### Task 4: Shell - the Microsoft account (`microsoftAuth.js`)

**Files:**
- Create: `apps/desktop/src/microsoftAuth.js`
- Create: `apps/desktop/test/microsoftAuth.test.js`

**Interfaces:**
- Consumes: Task 1 domain exports, `readRedirect` (existing domain export), `listenOnce`/`pkcePair` (Task 2), an `accounts` store with `setToken/getToken/hasToken/deleteToken`.
- Produces: `createMicrosoftAuth({ client, accounts, fetch, openExternal, listen, randomBytes, now, logger, timeoutMs, consentTimeoutMs })` returning `{ connect, cancelConnect, accessToken, status, disconnect }`:
  - `connect() -> { ok: true, email } | { ok: false, reason }` (reasons: `not-configured`, `cancelled`, `timed-out`, `bad-request`, `scope-denied`, `not-connected`, `permission-denied`, `rate-limited`, `offline`, `unknown`)
  - `accessToken({ force } = {}) -> { ok: true, token } | { ok: false, reason }`
  - `status() -> { ok: true, configured, connected, email, reason }`
  - `disconnect() -> { ok: true } | { ok: false, reason }`
  - `cancelConnect() -> void`
  - Also export `MICROSOFT_PROVIDER` (= `ONEDRIVE_PROVIDER`, `"onedrive"`).

The structure is `googleAuth.js` with four differences: no client secret; `listen` is called with `{ redirectHost: "localhost" }`; **every successful refresh stores the new refresh token before resolving** (and a store failure fails the refresh); **`invalid_grant` on refresh deletes the stored token**; no revoke on disconnect.

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/test/microsoftAuth.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMicrosoftAuth, MICROSOFT_PROVIDER } = require("../src/microsoftAuth");

const CLIENT = { clientId: "00000000-1111-2222-3333-444444444444" };
const GRANTED = "Files.ReadWrite.All User.Read";

function fakeAccounts(initial = null) {
  const tokens = new Map(initial === null ? [] : [[MICROSOFT_PROVIDER, initial]]);
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
  };
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

/// A fake Microsoft. `token` answers the token endpoint; each refresh hands out a NEW refresh token,
/// as the spike showed Microsoft does.
function fakeMicrosoft({ scope = GRANTED, me = { mail: "ada@example.com" }, refreshAnswer = null } = {}) {
  const calls = [];
  let issued = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/token")) {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "refresh_token" && refreshAnswer !== null) return refreshAnswer(body);
      issued += 1;
      return json(200, {
        access_token: `access-invented-${issued}`,
        expires_in: 3599,
        scope,
        token_type: "Bearer",
        refresh_token: `refresh-invented-${issued}`,
      });
    }
    if (url.includes("graph.microsoft.com/v1.0/me")) return json(200, me);
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

function harness({ accounts = fakeAccounts(), microsoft = fakeMicrosoft(), answer = (state) => `code=c1&state=${state}`, now = () => 0 } = {}) {
  const logged = [];
  let settle = null;
  let listenOptions = null;
  let opened = null;
  const instance = createMicrosoftAuth({
    client: CLIENT,
    accounts,
    fetch: microsoft.fetch,
    now,
    logger: { error: (line) => logged.push(line) },
    listen: async (options) => {
      listenOptions = options;
      const arrived = new Promise((done) => (settle = done));
      return { redirectUri: "http://localhost:5050", arrived, close: () => {} };
    },
    openExternal: async (url) => {
      opened = new URL(url);
      const query = answer(opened.searchParams.get("state"));
      if (query !== null) setImmediate(() => settle(`http://localhost:5050/?${query}`));
    },
  });
  return { instance, accounts, microsoft, logged, listenOptions: () => listenOptions, opened: () => opened };
}

test("connects: opens Microsoft's page, exchanges the code, stores the refresh token, names the account", async () => {
  const h = harness();
  const result = await h.instance.connect();

  assert.deepEqual(result, { ok: true, email: "ada@example.com" });
  assert.deepEqual(h.listenOptions(), { redirectHost: "localhost" });
  assert.equal(h.opened().origin + h.opened().pathname, "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
  const exchange = new URLSearchParams(h.microsoft.calls[0].init.body);
  assert.equal(exchange.get("code"), "c1");
  assert.equal(exchange.has("client_secret"), false);
});

test("a redirect without our state is not Microsoft's answer, and nothing is stored", async () => {
  const h = harness({ answer: () => "code=c1&state=forged" });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "bad-request" });
  assert.equal(h.accounts.tokens.size, 0);
  assert.equal(h.microsoft.calls.length, 0);
});

test("closing the consent page with access_denied is cancelled", async () => {
  const h = harness({ answer: (state) => `error=access_denied&state=${state}` });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "cancelled" });
});

test("Cancel while the browser is open answers cancelled", async () => {
  const h = harness({ answer: () => null });
  const pending = h.instance.connect();
  await new Promise((resolve) => setImmediate(resolve));
  h.instance.cancelConnect();
  assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
});

test("a grant without Files.ReadWrite.All is refused and not stored", async () => {
  const h = harness({ microsoft: fakeMicrosoft({ scope: "User.Read" }) });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "scope-denied" });
  assert.equal(h.accounts.tokens.size, 0);
});

// The spike: every refresh hands back a new refresh token. Keeping the old one would leave the app
// holding a token Microsoft may already have retired.
test("stores the rotated refresh token on every refresh", async () => {
  let clock = 0;
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), now: () => clock });
  const first = await h.instance.accessToken();
  assert.deepEqual(first, { ok: true, token: "access-invented-1" });
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
  assert.equal(new URLSearchParams(h.microsoft.calls[0].init.body).get("refresh_token"), "refresh-invented-0");

  clock += 3_600_000;
  const second = await h.instance.accessToken();
  assert.deepEqual(second, { ok: true, token: "access-invented-2" });
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-2");
  assert.equal(new URLSearchParams(h.microsoft.calls[1].init.body).get("refresh_token"), "refresh-invented-1");
});

test("two callers at once share one refresh", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0") });
  const [one, two] = await Promise.all([h.instance.accessToken(), h.instance.accessToken()]);
  assert.deepEqual(one, two);
  assert.equal(h.microsoft.calls.filter((call) => call.url.endsWith("/token")).length, 1);
});

test("an access token is reused until a minute before it expires", async () => {
  let clock = 0;
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), now: () => clock });
  await h.instance.accessToken();
  clock = (3599 - 61) * 1000;
  await h.instance.accessToken();
  assert.equal(h.microsoft.calls.length, 1);
  clock = (3599 - 59) * 1000;
  await h.instance.accessToken();
  assert.equal(h.microsoft.calls.length, 2);
});

test("a refresh Microsoft refuses as invalid_grant forgets the stored token", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(400, { error: "invalid_grant" }) }),
  });
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "not-connected" });
  assert.equal(h.accounts.tokens.has("onedrive"), false);
});

test("a refresh whose new token cannot be stored fails rather than carrying on with the old one", async () => {
  const accounts = fakeAccounts("refresh-invented-0");
  accounts.setToken = async () => {
    throw Object.assign(new Error("disk"), { code: "EACCES" });
  };
  const h = harness({ accounts });
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "unknown" });
  assert.deepEqual(h.logged, ["Account store save failed: EACCES"]);
});

test("status asks Microsoft who the account is", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), microsoft: fakeMicrosoft({ me: { mail: null, userPrincipalName: "ada@outlook.com" } }) });
  assert.deepEqual(await h.instance.status(), {
    ok: true,
    configured: true,
    connected: true,
    email: "ada@outlook.com",
    reason: null,
  });
});

test("status with nothing stored is not connected, and asks nobody", async () => {
  const h = harness();
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
  assert.equal(h.microsoft.calls.length, 0);
});

test("a build without a client is not configured", async () => {
  const instance = createMicrosoftAuth({ client: null, accounts: fakeAccounts(), openExternal: async () => {} });
  assert.deepEqual(await instance.connect(), { ok: false, reason: "not-configured" });
  assert.deepEqual(await instance.status(), { ok: true, configured: false, connected: false, email: null, reason: null });
});

// Microsoft has no revoke endpoint for a personal account's token. Disconnect forgets it here.
test("disconnect forgets the token locally, without calling Microsoft", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0") });
  await h.instance.accessToken();
  const before = h.microsoft.calls.length;
  assert.deepEqual(await h.instance.disconnect(), { ok: true });
  assert.equal(h.accounts.tokens.has("onedrive"), false);
  assert.equal(h.microsoft.calls.length, before);
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
});

test("no log line carries a token, a code or the state", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(500, { error: "server_error" }) }),
  });
  await h.instance.accessToken();
  await h.instance.disconnect();
  const text = h.logged.join("\n");
  for (const secret of ["refresh-invented-0", "access-invented", "c1"]) assert.equal(text.includes(secret), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/desktop/test/microsoftAuth.test.js`
Expected: FAIL - `Cannot find module '../src/microsoftAuth'`.

- [ ] **Step 3: Write the module**

```js
// apps/desktop/src/microsoftAuth.js
"use strict";

const nodeCrypto = require("node:crypto");
const {
  GRAPH_ME_URL,
  GraphMeSchema,
  MICROSOFT_TOKEN_URL,
  MicrosoftTokenSchema,
  ONEDRIVE_PROVIDER,
  accountEmail,
  grantsOneDrive,
  microsoftAuthErrorFor,
  microsoftAuthorizationUrl,
  microsoftRefreshRequestBody,
  microsoftTokenRequestBody,
  readRedirect,
} = require("@trypthos/domain");
const { listenOnce, pkcePair } = require("./loopbackOAuth");

/// A personal Microsoft account, for OneDrive: signing in, staying signed in, and signing out.
///
/// **This lives in the main process and cannot move.** The refresh token is read from the encrypted
/// account store here and never leaves; the access token exists only in this closure. No IPC channel
/// answers with either, and no log line carries a URL, a body, a code, the state or the verifier.
///
/// Google's flow (googleAuth.js) with Microsoft's differences, from the spike in
/// docs/specs/onedrive-workspace.md:
/// - a public client: no secret anywhere;
/// - the redirect is `http://localhost:<port>`, because that is what the registration lists;
/// - **the refresh token rotates on every refresh**, so each refresh stores the new one before it
///   answers, and only one refresh runs at a time - two would race to store, and the loser's token
///   could be the one kept;
/// - there is no revoke endpoint for a personal account's token, so disconnect forgets it here.
///
/// **Nothing here throws outward.** Every path answers `{ ok: false, reason }`.

const MICROSOFT_PROVIDER = ONEDRIVE_PROVIDER;
const DEFAULT_TIMEOUT_MS = 30_000;
const CONSENT_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
}

function createMicrosoftAuth({
  client,
  accounts,
  fetch = globalThis.fetch,
  openExternal,
  listen = listenOnce,
  randomBytes = nodeCrypto.randomBytes,
  now = Date.now,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  consentTimeoutMs = CONSENT_TIMEOUT_MS,
}) {
  let access = null;
  let refreshing = null;
  let pending = null;
  /// Bumped by every sign-out, so work begun before one cannot bring a token back after it.
  let generation = 0;

  async function safely(step, operation) {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      logger.error?.(`Account store ${step} failed: ${error?.code ?? error?.name}`);
      return failure("unknown");
    }
  }

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
      logger.error?.(`Microsoft ${step} did not complete: ${error?.code ?? error?.name}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokenCall(body, step) {
    const answer = await call(MICROSOFT_TOKEN_URL, { method: "POST", body }, step);
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(microsoftAuthErrorFor(answer.status, answer.body));
    const parsed = MicrosoftTokenSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.(`Microsoft answered the ${step} in a shape this build does not recognise.`);
      return failure("offline");
    }
    return { ok: true, token: parsed.data };
  }

  async function whoami(accessToken) {
    const answer = await call(GRAPH_ME_URL, { bearer: accessToken }, "account lookup");
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(microsoftAuthErrorFor(answer.status, answer.body));
    const parsed = GraphMeSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.("Microsoft answered the account lookup in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, email: accountEmail(parsed.data) };
  }

  function remember(token) {
    access = { token: token.access_token, expiresAt: now() + token.expires_in * 1000 };
  }

  async function connect() {
    if (client === null) return failure("not-configured");
    pending?.cancel("cancelled");

    let resolveStopped;
    const stopped = new Promise((resolve) => (resolveStopped = resolve));
    const mine = {
      reason: undefined,
      cancel: (reason) => {
        if (mine.reason !== undefined) return;
        mine.reason = reason;
        resolveStopped({ stopped: reason });
      },
    };
    pending = mine;

    let listener;
    try {
      listener = await listen({ redirectHost: "localhost" });
    } catch (error) {
      logger.error?.(`Could not listen for Microsoft's answer: ${error?.code ?? error?.name}`);
      if (pending === mine) pending = null;
      return failure(mine.reason ?? "offline");
    }
    if (mine.reason !== undefined) {
      listener.close();
      if (pending === mine) pending = null;
      return failure(mine.reason);
    }

    const { verifier, challenge, state } = pkcePair(randomBytes);
    const timer = setTimeout(() => mine.cancel("timed-out"), consentTimeoutMs);

    try {
      try {
        await openExternal(
          microsoftAuthorizationUrl({ clientId: client.clientId, redirectUri: listener.redirectUri, state, codeChallenge: challenge }),
        );
      } catch (error) {
        logger.error?.(`Could not open the browser for Microsoft sign-in: ${error?.code ?? error?.name}`);
        return failure("unknown");
      }

      const outcome = await Promise.race([listener.arrived.then((url) => ({ url })), stopped]);
      if (outcome.stopped !== undefined) return failure(outcome.stopped);
      clearTimeout(timer);

      const redirect = readRedirect(outcome.url, state);
      if (!redirect.ok) return redirect;

      const exchanged = await tokenCall(
        microsoftTokenRequestBody({
          clientId: client.clientId,
          code: redirect.code,
          codeVerifier: verifier,
          redirectUri: listener.redirectUri,
        }),
        "sign-in",
      );
      if (!exchanged.ok) return exchanged;

      const token = exchanged.token;
      if (!grantsOneDrive(token.scope)) return failure("scope-denied");

      const who = await whoami(token.access_token);
      if (!who.ok) return who;
      if (mine.reason !== undefined) return failure(mine.reason);

      // Stored last: a credential reaches disk only once it has been shown to work.
      const saved = await safely("save", () => accounts.setToken(MICROSOFT_PROVIDER, token.refresh_token));
      if (!saved.ok) return saved;
      if (saved.value && saved.value.ok === false) return saved.value;

      if (mine.reason !== undefined) {
        await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
        return failure(mine.reason);
      }
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
    const began = generation;
    const read = await safely("read", () => accounts.getToken(MICROSOFT_PROVIDER));
    if (!read.ok) return read;
    const refreshToken = read.value;
    if (typeof refreshToken !== "string" || refreshToken === "") return failure("not-connected");

    const refreshed = await tokenCall(microsoftRefreshRequestBody({ clientId: client.clientId, refreshToken }), "refresh");
    if (!refreshed.ok) {
      // Microsoft will not take this token again: keeping it would make every launch ask and fail.
      if (refreshed.reason === "not-connected" && generation === began) {
        await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
      }
      return refreshed;
    }
    if (generation !== began) return failure("not-connected");

    // The new refresh token is stored BEFORE the access token is handed out. If it cannot be, the
    // refresh fails: carrying on would leave the store holding a token Microsoft may have retired.
    const saved = await safely("save", () => accounts.setToken(MICROSOFT_PROVIDER, refreshed.token.refresh_token));
    if (!saved.ok) return saved;
    if (saved.value && saved.value.ok === false) return saved.value;
    if (generation !== began) return failure("not-connected");

    remember(refreshed.token);
    return { ok: true, token: refreshed.token.access_token };
  }

  async function accessToken({ force = false } = {}) {
    if (client === null) return failure("not-configured");
    if (!force && access !== null && access.expiresAt - now() > EXPIRY_MARGIN_MS) {
      return { ok: true, token: access.token };
    }
    if (refreshing === null) {
      const mineRefresh = refresh().finally(() => {
        if (refreshing === mineRefresh) refreshing = null;
      });
      refreshing = mineRefresh;
    }
    return refreshing;
  }

  async function status() {
    const answer = (fields) => ({ ok: true, configured: client !== null, connected: false, email: null, reason: null, ...fields });
    if (client === null) return answer({});
    const has = await safely("check", () => accounts.hasToken(MICROSOFT_PROVIDER));
    if (!has.ok) return answer({ reason: has.reason });
    if (!has.value) return answer({});

    const token = await accessToken();
    if (!token.ok) return answer({ reason: token.reason === "not-connected" ? null : token.reason });
    const who = await whoami(token.token);
    return who.ok ? answer({ connected: true, email: who.email }) : answer({ reason: who.reason });
  }

  async function disconnect() {
    pending?.cancel("cancelled");
    generation += 1;
    access = null;
    refreshing = null;
    const deleted = await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
    if (!deleted.ok) return deleted;
    return { ok: true };
  }

  return { connect, cancelConnect, accessToken, status, disconnect };
}

module.exports = { createMicrosoftAuth, MICROSOFT_PROVIDER };
```

Note on `status`: a refresh refused as `invalid_grant` has already deleted the token, so status reports a plain "not connected" (reason null) rather than an error banner - the user simply connects again. Add this test to Step 1's file and watch it pass with the rest:

```js
test("status after Microsoft refused the stored token is simply not connected", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(400, { error: "invalid_grant" }) }),
  });
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/microsoftAuth.test.js`
Expected: PASS, no stderr (every test passes a collecting logger).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/microsoftAuth.js apps/desktop/test/microsoftAuth.test.js
git commit -m "Shell: Microsoft sign-in with a rotating, single-flight refresh"
```

---

### Task 5: Shell - channels, preload, main wiring, packaging, leak guard

**Files:**
- Modify: `packages/domain/src/ipc.ts` (append to `IPC_CHANNELS` after `"google:folders"`)
- Modify: `apps/desktop/src/ipcHandlers.js` (new `microsoft = null` dependency; four handlers next to Google's)
- Modify: `apps/desktop/src/preload.js` (four functions after Google's)
- Modify: `apps/desktop/src/main.js` (build `microsoft`, pass it)
- Modify: `apps/desktop/electron-builder.config.cjs` (filter gains `"onedrive-client.json"`)
- Modify: `.github/workflows/desktop-release.yml` (write the file from the secret)
- Create: `apps/desktop/test/oneDriveIpc.test.js`
- Modify: any test asserting the exact channel list or the preload surface (`grep -rn "google:cancelConnect" apps packages --include=*.test.*`) - add the four new channels there.

**Interfaces:**
- Consumes: `createMicrosoftAuth` (Task 4), `loadMicrosoftClient` (Task 3).
- Produces: channels `onedrive:status`, `onedrive:connect`, `onedrive:cancelConnect`, `onedrive:disconnect`; preload `oneDriveStatus()`, `connectOneDrive()`, `cancelOneDriveConnect()`, `disconnectOneDrive()` with the same answer shapes as Google's.

- [ ] **Step 1: Write the failing IPC test**

```js
// apps/desktop/test/oneDriveIpc.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { createMicrosoftAuth } = require("../src/microsoftAuth");

/// The OneDrive account through the real handlers, with a real `microsoftAuth` over a fake Microsoft.

const REFRESH = "refresh-invented-onedrive-ipc";
const ROTATED = "refresh-rotated-onedrive-ipc";
const ACCESS = "access-invented-onedrive-ipc";

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

function microsoftOver(accounts) {
  return createMicrosoftAuth({
    client: { clientId: "00000000-1111-2222-3333-444444444444" },
    accounts,
    logger: { error: () => {} },
    fetch: async (url, init = {}) => {
      if (url.endsWith("/token")) {
        const grant = new URLSearchParams(init.body).get("grant_type");
        return json(200, {
          access_token: ACCESS,
          expires_in: 3599,
          scope: "Files.ReadWrite.All User.Read",
          token_type: "Bearer",
          refresh_token: grant === "refresh_token" ? ROTATED : REFRESH,
        });
      }
      if (url.includes("/v1.0/me")) return json(200, { mail: "ada@example.com" });
      throw new Error(`unexpected ${url}`);
    },
    openExternal: async (url) => {
      const params = new URL(url).searchParams;
      const port = new URL(params.get("redirect_uri")).port;
      setImmediate(() => void globalThis.fetch(`http://127.0.0.1:${port}/?state=${params.get("state")}&code=c1`).then((r) => r.text()));
    },
  });
}
```

Then copy `withHandlers` from `apps/desktop/test/googleIpc.test.js` (it builds a temp `userDataDir`, calls `registerIpcHandlers` with fakes, and cleans up). Replace its `google` option with `microsoft`, so it passes `microsoft: options.microsoft === "none" ? null : microsoftOver(accounts)` into `registerIpcHandlers`. Then the tests:

```js
test("connects, reports the account by email, and disconnects", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    assert.deepEqual(await ipcMain.invoke("onedrive:status"), { ok: true, configured: true, connected: false, email: null, reason: null });
    assert.deepEqual(await ipcMain.invoke("onedrive:connect"), { ok: true, email: "ada@example.com" });
    assert.equal(accounts.tokens.get("onedrive"), REFRESH);
    assert.deepEqual(await ipcMain.invoke("onedrive:disconnect"), { ok: true });
    assert.equal(accounts.tokens.has("onedrive"), false);
  });
});

test("a build without a client says so on every channel", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:status"), { ok: true, configured: false, connected: false, email: null, reason: null });
      assert.deepEqual(await ipcMain.invoke("onedrive:connect"), { ok: false, reason: "not-configured" });
      assert.deepEqual(await ipcMain.invoke("onedrive:cancelConnect"), { ok: true });
      assert.deepEqual(await ipcMain.invoke("onedrive:disconnect"), { ok: true });
    },
    { microsoft: "none" },
  );
});

// The leak guard. Every channel, with an empty payload, after a connect and a refresh - so both the
// first refresh token and the rotated one have existed - must answer without any token in it, in its
// answer, in a thrown error, or in a log line.
test("no channel answers with a Microsoft token", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("onedrive:connect");
    const logged = [];
    const realConsoleError = console.error;
    console.error = (...args) => void logged.push(args.map(String).join(" "));
    try {
      for (const [channel, handler] of ipcMain.handlers) {
        if (channel === "onedrive:disconnect") continue; // walked last, so the others see a connected account
        let text;
        try {
          text = JSON.stringify((await handler(null, {})) ?? null);
        } catch (error) {
          text = `${String(error)} ${error?.stack ?? ""}`;
        }
        for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!text.includes(token), `${channel} answered with a Microsoft token`);
      }
    } finally {
      console.error = realConsoleError;
    }
    const leaked = logged.join(" ");
    for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!leaked.includes(token), "a log line carried a Microsoft token");
    const last = JSON.stringify(await ipcMain.invoke("onedrive:disconnect"));
    for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!last.includes(token));
  });
});
```

Add `"onedrive:status", "onedrive:connect", "onedrive:cancelConnect", "onedrive:disconnect"` wherever a test lists the expected channels (the secretsIpc "every channel in the contract has a handler" test reads `IPC_CHANNELS`, so it will fail until the handlers exist - that failure is expected in Step 2).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/desktop/test/oneDriveIpc.test.js`
Expected: FAIL - `handlers.get(...)` is not a function for `onedrive:status`.

- [ ] **Step 3: Implement**

`packages/domain/src/ipc.ts`, after `"google:folders",`:

```ts
  "onedrive:status",
  "onedrive:connect",
  "onedrive:cancelConnect",
  "onedrive:disconnect",
```

`apps/desktop/src/ipcHandlers.js`: in the destructured options of `registerIpcHandlers`, after `createGoogleDrive = null,`:

```js
  /// The Microsoft account - `microsoftAuth.js` - or null in a build without a OneDrive client id.
  microsoft = null,
```

and after the `google:disconnect` handler:

```js
  /// OneDrive, as an account. The same rules as Google: answers carry an email, never a token, and
  /// none of these takes a payload - there is nothing of the renderer's to validate.
  ipcMain.handle("onedrive:status", async () =>
    microsoft === null
      ? { ok: true, configured: false, connected: false, email: null, reason: null }
      : microsoft.status(),
  );

  ipcMain.handle("onedrive:connect", async () =>
    microsoft === null ? { ok: false, reason: "not-configured" } : microsoft.connect(),
  );

  ipcMain.handle("onedrive:cancelConnect", async () => {
    microsoft?.cancelConnect();
    return { ok: true };
  });

  ipcMain.handle("onedrive:disconnect", async () => (microsoft === null ? { ok: true } : microsoft.disconnect()));
```

`apps/desktop/src/preload.js`, after `disconnectGoogle`:

```js
  /// OneDrive, as an account. Write-only like Google: `status` answers with an EMAIL and never a
  /// token, and connecting takes no argument.
  oneDriveStatus: () => ipcRenderer.invoke("onedrive:status"),
  connectOneDrive: () => ipcRenderer.invoke("onedrive:connect"),
  cancelOneDriveConnect: () => ipcRenderer.invoke("onedrive:cancelConnect"),
  disconnectOneDrive: () => ipcRenderer.invoke("onedrive:disconnect"),
```

`apps/desktop/src/main.js`: add requires next to the Google ones:

```js
const { loadMicrosoftClient } = require("./microsoftClient");
const { createMicrosoftAuth } = require("./microsoftAuth");
```

after the `google` construction:

```js
    // The Microsoft account, for OneDrive. Null in a build without a client id - a fork, or a
    // developer who has not set TRYPTHOS_ONEDRIVE_CLIENT. Same net.fetch and browser rules as Google.
    const microsoftClient = loadMicrosoftClient({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    const microsoft =
      microsoftClient === null
        ? null
        : createMicrosoftAuth({
            client: microsoftClient,
            accounts,
            fetch: (url, options) => net.fetch(url, options),
            openExternal: (url) => shell.openExternal(url),
          });
```

and pass `microsoft,` to `registerIpcHandlers` next to `google,`.

`apps/desktop/electron-builder.config.cjs`: change the filter to
`filter: ["tray*", "google-oauth-client.json", "onedrive-client.json"]` and extend the comment above it to name both files.

`.github/workflows/desktop-release.yml`: in the same step that writes the Google client (add the env var beside `GOOGLE_OAUTH_CLIENT_JSON`):

```yaml
          ONEDRIVE_CLIENT_ID: ${{ secrets.ONEDRIVE_CLIENT_ID }}
```

and after the Google `if ... fi` block:

```bash
          if [ -n "$ONEDRIVE_CLIENT_ID" ]; then
            mkdir -p apps/desktop/build
            printf '{ "clientId": "%s" }' "$ONEDRIVE_CLIENT_ID" > apps/desktop/build/onedrive-client.json
            echo "ok: OneDrive client written"
          else
            echo "::warning::ONEDRIVE_CLIENT_ID is not set, so this build has no OneDrive sign-in."
          fi
```

- [ ] **Step 4: Run the shell and domain suites**

Run: `npm run build --workspace @trypthos/domain && npm test --workspace trypthos-desktop && npm test --workspace @trypthos/domain`
Expected: PASS, with no new stderr lines. Check the leak test fails if you temporarily make `onedrive:status` return `{ token: ACCESS }` - then revert.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ipc.ts apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/src/main.js apps/desktop/electron-builder.config.cjs .github/workflows/desktop-release.yml apps/desktop/test/oneDriveIpc.test.js
git commit -m "Shell: onedrive account channels, wiring, packaging and the token leak guard"
```

---

### Task 6: Renderer - one account section for every cloud provider

**Files:**
- Create: `apps/app/src/hooks/useCloudAccount.ts` (from `useGoogle.ts`, which is deleted)
- Create: `apps/app/src/hooks/useCloudAccount.test.ts` (from `useGoogle.test.ts` if it exists; otherwise new)
- Create: `apps/app/src/lib/cloudAccounts.ts`
- Create: `apps/app/src/components/CloudAccountSection.tsx` (from `GoogleAccountSection.tsx`, which is deleted)
- Create: `apps/app/src/components/CloudAccountSection.test.tsx` (from `GoogleAccountSection.test.tsx`, which is deleted, plus OneDrive cases)
- Modify: `apps/app/src/lib/workspaceClient.ts`, `apps/app/src/components/SettingsAccounts.tsx`, `apps/app/src/components/OpenDriveDialog.tsx`, `apps/app/src/App.tsx`, `apps/app/src/locales/en.json`, and any test that renders `SettingsAccounts` or `OpenDriveDialog` (add the `oneDrive` prop / new import).

**Interfaces:**
- Produces:

```ts
// apps/app/src/lib/workspaceClient.ts
export interface CloudAccountStatus { ok: true; configured: boolean; connected: boolean; email: string | null; reason: string | null }
export type CloudConnectResult = { ok: true; email: string } | { ok: false; reason: string };
/// Any provider's account, as the shared section drives it.
export interface CloudAccountBridge {
  status(): Promise<CloudAccountStatus>;
  connect(): Promise<CloudConnectResult>;
  cancelConnect(): Promise<{ ok: boolean }>;
  disconnect(): Promise<{ ok: boolean; reason?: string }>;
}
export interface OneDriveBridge {
  oneDriveStatus(): Promise<CloudAccountStatus>;
  connectOneDrive(): Promise<CloudConnectResult>;
  cancelOneDriveConnect(): Promise<{ ok: boolean }>;
  disconnectOneDrive(): Promise<{ ok: boolean; reason?: string }>;
}
export function oneDriveBridge(): OneDriveBridge | null;
export function googleAccount(bridge: GoogleBridge | null): CloudAccountBridge | null;
export function oneDriveAccount(bridge: OneDriveBridge | null): CloudAccountBridge | null;
```

`GoogleStatus` and `GoogleConnectResult` become aliases of `CloudAccountStatus` / `CloudConnectResult` (keep the names exported so existing imports compile). `TrypthosBridge` also extends `OneDriveBridge`.

```ts
// apps/app/src/lib/cloudAccounts.ts
export interface CloudAccountKind {
  /// Settings heading, e.g. "settings.accounts.googleDrive".
  titleKey: string;
  checkingKey: string;
  connectKey: string;
  connectBlurbKey: string;
  notConfiguredKey: string;
  /// Shown under a connected account, or null. OneDrive's says where to remove the app's access.
  connectedNoteKey: string | null;
  failureKey(reason: string): string | null;
}
export const GOOGLE_ACCOUNT: CloudAccountKind;
export const ONEDRIVE_ACCOUNT: CloudAccountKind;
export function oneDriveFailureKey(reason: string): string | null;
```

```ts
// apps/app/src/hooks/useCloudAccount.ts
export interface CloudAccountState { supported: boolean; configured: boolean; checking: boolean; connected: boolean; email: string | null; connecting: boolean; errorKey: string | null }
export interface CloudAccountActions { connect(): Promise<boolean>; cancel(): Promise<void>; disconnect(): Promise<void>; dismissError(): void }
export function useCloudAccount(bridge: CloudAccountBridge | null, failureKey: (reason: string) => string | null): CloudAccountState & CloudAccountActions;
```

```tsx
// apps/app/src/components/CloudAccountSection.tsx
interface Props { kind: CloudAccountKind; bridge: CloudAccountBridge | null; onConnected?: () => void }
export default function CloudAccountSection(props: Props): JSX.Element;
```

- [ ] **Step 1: Move the Google tests onto the new names (they must still pass after the refactor)**

`git mv apps/app/src/components/GoogleAccountSection.test.tsx apps/app/src/components/CloudAccountSection.test.tsx` (and `useGoogle.test.ts` -> `useCloudAccount.test.ts` if present). In each moved test, render `<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(fakeGoogleBridge)} />` instead of `<GoogleAccountSection bridge={fakeGoogleBridge} />`; keep every assertion's visible text unchanged (the strings do not change - only their keys move).

Add OneDrive cases to `CloudAccountSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import CloudAccountSection from "./CloudAccountSection";
import { ONEDRIVE_ACCOUNT } from "../lib/cloudAccounts";
import { oneDriveAccount, type OneDriveBridge } from "../lib/workspaceClient";

function fakeOneDrive(overrides: Partial<OneDriveBridge> = {}): OneDriveBridge {
  return {
    oneDriveStatus: async () => ({ ok: true, configured: true, connected: false, email: null, reason: null }),
    connectOneDrive: async () => ({ ok: true, email: "ada@example.com" }),
    cancelOneDriveConnect: async () => ({ ok: true }),
    disconnectOneDrive: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("the OneDrive account", () => {
  it("connects and names the account", async () => {
    const user = userEvent.setup();
    render(<CloudAccountSection kind={ONEDRIVE_ACCOUNT} bridge={oneDriveAccount(fakeOneDrive())} />);
    expect(await screen.findByRole("heading", { name: "OneDrive" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect(await screen.findByText("Connected as ada@example.com")).toBeTruthy();
    // Microsoft cannot be asked to forget the grant, so the section says where to.
    expect(screen.getByText(/account\.live\.com/)).toBeTruthy();
  });

  it("says when this build has no OneDrive", async () => {
    render(
      <CloudAccountSection
        kind={ONEDRIVE_ACCOUNT}
        bridge={oneDriveAccount(fakeOneDrive({ oneDriveStatus: async () => ({ ok: true, configured: false, connected: false, email: null, reason: null }) }))}
      />,
    );
    expect(await screen.findByText("This build of Trypthos was made without OneDrive support.")).toBeTruthy();
  });

  it("explains a failed sign-in in OneDrive's words", async () => {
    const user = userEvent.setup();
    render(
      <CloudAccountSection
        kind={ONEDRIVE_ACCOUNT}
        bridge={oneDriveAccount(fakeOneDrive({ connectOneDrive: async () => ({ ok: false, reason: "offline" }) }))}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach Microsoft. Check your connection and try again.");
  });

  it("is a desktop-only control in the browser preview", () => {
    render(<CloudAccountSection kind={ONEDRIVE_ACCOUNT} bridge={null} />);
    expect(screen.getByText("Connecting to OneDrive needs the desktop app. This is the browser preview.")).toBeTruthy();
  });
});
```

Also add to the existing `SettingsAccounts` test (find it with `grep -rln "SettingsAccounts" apps/app/src --include=*.test.tsx`) a case that both "Google Drive" and "OneDrive" headings render when both bridges are given.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --root apps/app CloudAccountSection SettingsAccounts`
Expected: FAIL - cannot resolve `./CloudAccountSection`.

- [ ] **Step 3: Implement**

`apps/app/src/hooks/useCloudAccount.ts` - `useGoogle.ts` with: the bridge typed `CloudAccountBridge`; `bridge.googleStatus()` -> `bridge.status()`, `connectGoogle` -> `connect`, `cancelGoogleConnect` -> `cancelConnect`, `disconnectGoogle` -> `disconnect`; every `providerFailureKey("google-drive", reason)` -> `failureKey(reason)` (the second parameter); keep `attempt` from `./useGitHub`; the effect depends on `[bridge, failureKey]`. Rename `GoogleState`/`GoogleActions` to `CloudAccountState`/`CloudAccountActions`. Delete `useGoogle.ts`.

`apps/app/src/lib/workspaceClient.ts` - add the interfaces above, and:

```ts
/// The OneDrive half of the bridge, or null outside the desktop shell.
export function oneDriveBridge(): OneDriveBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.oneDriveStatus) return null;
  return {
    oneDriveStatus: bridge.oneDriveStatus,
    connectOneDrive: bridge.connectOneDrive,
    cancelOneDriveConnect: bridge.cancelOneDriveConnect,
    disconnectOneDrive: bridge.disconnectOneDrive,
  };
}

/// Google's account calls under the names the shared section uses.
export function googleAccount(bridge: GoogleBridge | null): CloudAccountBridge | null {
  if (bridge === null) return null;
  return {
    status: () => bridge.googleStatus(),
    connect: () => bridge.connectGoogle(),
    cancelConnect: () => bridge.cancelGoogleConnect(),
    disconnect: () => bridge.disconnectGoogle(),
  };
}

export function oneDriveAccount(bridge: OneDriveBridge | null): CloudAccountBridge | null {
  if (bridge === null) return null;
  return {
    status: () => bridge.oneDriveStatus(),
    connect: () => bridge.connectOneDrive(),
    cancelConnect: () => bridge.cancelOneDriveConnect(),
    disconnect: () => bridge.disconnectOneDrive(),
  };
}
```

`apps/app/src/lib/cloudAccounts.ts`:

```ts
import { failureKey, providerFailureKey } from "../hooks/useWorkspace";

/// What tells one cloud account apart in the shared section: its words and how its failures read.
/// Keys, not wording, so this stays pure; the component translates.
export interface CloudAccountKind {
  titleKey: string;
  checkingKey: string;
  connectKey: string;
  connectBlurbKey: string;
  notConfiguredKey: string;
  browserOnlyKey: string;
  connectedNoteKey: string | null;
  failureKey(reason: string): string | null;
}

export const GOOGLE_ACCOUNT: CloudAccountKind = {
  titleKey: "settings.accounts.googleDrive",
  checkingKey: "google.checking",
  connectKey: "google.connect",
  connectBlurbKey: "google.connectBlurb",
  notConfiguredKey: "google.notConfigured",
  browserOnlyKey: "google.browserOnly",
  connectedNoteKey: null,
  failureKey: (reason) => providerFailureKey("google-drive", reason),
};

/// OneDrive's account failures until PR 2 gives `providerFailureKey` a OneDrive kind.
export function oneDriveFailureKey(reason: string): string | null {
  switch (reason) {
    case "offline":
      return "errors.oneDriveOffline";
    case "rate-limited":
      return "errors.oneDriveRateLimited";
    case "not-connected":
      return "errors.oneDriveNotConnected";
    case "scope-denied":
      return "errors.oneDriveScopeDenied";
    default:
      return failureKey(reason);
  }
}

export const ONEDRIVE_ACCOUNT: CloudAccountKind = {
  titleKey: "settings.accounts.oneDrive",
  checkingKey: "onedrive.checking",
  connectKey: "onedrive.connect",
  connectBlurbKey: "onedrive.connectBlurb",
  notConfiguredKey: "onedrive.notConfigured",
  browserOnlyKey: "onedrive.browserOnly",
  connectedNoteKey: "onedrive.removeAccess",
  failureKey: oneDriveFailureKey,
};
```

(Check how Google maps `scope-denied` today - `grep -n "scope-denied\|scopeDenied" apps/app/src` - and give OneDrive the parallel key. If `failureKey` already maps `scope-denied` generically, drop that case.)

`apps/app/src/components/CloudAccountSection.tsx` - `GoogleAccountSection.tsx` with: props `{ kind, bridge, onConnected }`; `const account = useCloudAccount(bridge, kind.failureKey);`; every `t("google.X")` that is provider-specific becomes `t(kind.XKey)` (checking, connect, connectBlurb, notConfigured, browserOnly, the heading `t(kind.titleKey)`); the shared ones become `t("cloud.connecting")`, `t("cloud.cancel")`, `t("cloud.disconnect")`, `t("cloud.connectedAs", { email })`, `t("cloud.notConnected")`; after the Disconnect button, when `kind.connectedNoteKey !== null`, render `<p className="mt-2 text-xs text-ink-4">{t(kind.connectedNoteKey)}</p>`. Delete `GoogleAccountSection.tsx`.

`SettingsAccounts.tsx`: props gain `oneDrive: OneDriveBridge | null`; replace `<GoogleAccountSection bridge={google} />` with

```tsx
      <CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(google)} />
      <CloudAccountSection kind={ONEDRIVE_ACCOUNT} bridge={oneDriveAccount(oneDrive)} />
```

Memoise the adapters so the hook's effect does not re-run each render: `const googleCalls = useMemo(() => googleAccount(google), [google]);` and the same for OneDrive.

`OpenDriveDialog.tsx`: `<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleCalls} onConnected={...} />` with `const googleCalls = useMemo(() => googleAccount(bridge), [bridge]);`.

`App.tsx`: `const oneDrive = useMemo(() => oneDriveBridge(), []);` beside `google`, passed to `SettingsAccounts` wherever `google={google}` is passed (`grep -n "google={google}" apps/app/src`).

`apps/app/src/locales/en.json`:
- add a `"cloud"` block: `"connecting": "Waiting for your browser..."`, `"cancel": "Cancel"`, `"disconnect": "Disconnect"`, `"connectedAs": "Connected as {{email}}"`, `"notConnected": "Not connected"`;
- remove those five keys from `"google"`;
- add an `"onedrive"` block:
  - `"checking": "Checking your Microsoft account..."`
  - `"connect": "Connect OneDrive"`
  - `"connectBlurb": "Trypthos opens Microsoft's sign-in page in your browser. Sign in with your personal Microsoft account and allow access to your files, then come back here. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and talks to Microsoft directly from this machine."`
  - `"notConfigured": "This build of Trypthos was made without OneDrive support."`
  - `"browserOnly": "Connecting to OneDrive needs the desktop app. This is the browser preview."`
  - `"removeAccess": "Disconnecting forgets the sign-in on this computer. To remove Trypthos's access from your Microsoft account too, visit account.live.com/consent/Manage."`
- `settings.accounts.oneDrive`: `"OneDrive"`;
- `errors.oneDriveOffline`: `"Could not reach Microsoft. Check your connection and try again."`, `errors.oneDriveRateLimited`: `"Microsoft is busy. Wait a minute and try again."`, `errors.oneDriveNotConnected`: `"Your Microsoft account is no longer connected. Connect it again in Settings > Accounts."`, `errors.oneDriveScopeDenied`: `"Trypthos needs access to your files to open OneDrive folders. Connect again and allow it."` (match the tone of the existing `errors.google*` entries; no em or en dashes).

- [ ] **Step 4: Run the renderer suite and the i18n guard**

Run: `npx vitest run --root apps/app CloudAccountSection SettingsAccounts OpenDriveDialog i18nKeys useCloudAccount` then `npm test --workspace trypthos-app`
Expected: PASS with no stderr. `i18nKeys.test.ts` proves no orphaned `google.*` key remains and every new key exists.

- [ ] **Step 5: Commit**

```bash
git add -A apps/app/src
git commit -m "Renderer: one account section for Google and OneDrive"
```

---

### Task 7: Docs, version and release notes

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json` (five entries) -> `0.102.0`
- Modify: `apps/app/src/lib/releaseNotes/current.ts` (new `RECENT[0]`)
- Modify: `apps/app/src/lib/appInfo.ts` (a `OneDrive` capability row after `Google Drive`; a disclaimer line for Microsoft after Google's)
- Modify: `README.md` (Features row; a "OneDrive sign-in in your own build" note in the building section)
- Modify: `docs/features.md` (OneDrive bullet beside Google Drive's)
- Modify: `docs/Architecture.md` (a "OneDrive account" subsection beside "Google account")
- Modify: `CLAUDE.md` (the cloud provider order line: Google Drive shipped, then OneDrive (in progress), Dropbox; the status line mentions OneDrive accounts)
- Modify: `docs/specs/onedrive-workspace.md` (status: "PR 1 delivered (0.102.0)")

- [ ] **Step 1: Find the PR number**

Run: `gh pr list --state all --limit 1 --json number -q '.[0].number'` and `gh issue list --state all --limit 1 --json number -q '.[0].number'`; the PR will be the larger of the two plus one. Use it as `pr` below and in the PR title.

- [ ] **Step 2: Bump the version in lockstep**

Edit each file by hand. In `package-lock.json` change only the five entries whose `name` is `trypthos`, `trypthos-app`, `trypthos-desktop`, `@trypthos/domain` (plus the top-level `version`) - count exactly five changes.

- [ ] **Step 3: Write the release entry**

At the top of `RECENT`:

```ts
  {
    version: "0.102.0",
    date: "<today, YYYY-MM-DD>",
    pr: <number from Step 1>,
    headline: "Connect a OneDrive account",
    summary:
      "Settings > Accounts has a OneDrive section. Connect opens Microsoft's sign-in page in your browser: sign in with your personal Microsoft account and allow access to your files, and the section shows the account you connected. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and talks to Microsoft directly from this machine. Disconnect forgets the sign-in on this computer; to remove Trypthos's access from your Microsoft account as well, visit account.live.com/consent/Manage. Opening OneDrive folders follows in the next release. Work and school accounts are not supported.",
    added: [
      "Connect and disconnect a personal Microsoft account for OneDrive in Settings > Accounts.",
    ],
    changed: [
      "The Google Drive and OneDrive account sections in Settings share one design.",
    ],
  },
```

- [ ] **Step 4: Update the inventories in lockstep**

- `appInfo.ts` capability row: `| OneDrive | Connect a personal Microsoft account from Settings > Accounts, through Microsoft's sign-in page in your browser. Opening OneDrive folders follows in the next release. |`
- `appInfo.ts` disclaimers: `"Microsoft requests go directly from this app to Microsoft's sign-in and Microsoft Graph services, using the permission you grant on Microsoft's own page. What keeps you signed in is stored encrypted on this computer and never leaves it."` (mirror the Google line's wording and length).
- `README.md` Features: a `| OneDrive | ... |` row matching the About row, linking to `docs/features.md#onedrive` if the table links anchors the way the Google row does. In the build/development section, a short note: OneDrive needs your own app registration (Microsoft Entra, Personal Microsoft accounts only, redirect `http://localhost` as Mobile and desktop, public client flows on, delegated `Files.ReadWrite.All`, `offline_access`, `User.Read`); set `TRYPTHOS_ONEDRIVE_CLIENT` to a file `{ "clientId": "<id>" }` in development, or the `ONEDRIVE_CLIENT_ID` repository secret for release builds.
- `docs/features.md`: a `## OneDrive` (or the heading style Google Drive uses) with the summary paragraph above.
- `docs/Architecture.md`: a subsection mirroring the Google account one (lines ~883-890): `microsoftAuth.js`, `microsoftClient.js`, `loopbackOAuth.js` shared with Google; the rotating refresh token stored before use and the single-flight refresh; `invalid_grant` forgets the token; no revoke; the four channels and `oneDriveIpc.test.js`; where the client id comes from; the renderer's `CloudAccountSection` / `useCloudAccount` / `cloudAccounts.ts`.
- `CLAUDE.md`: the status line gains "and a OneDrive account can be connected"; the provider order line reads "Then, in order: **Google Drive** (shipped), **OneDrive** (in progress), **Dropbox**".
- The spec's status line.

- [ ] **Step 5: Full verification**

Run, from the repo root: `npm run lint && npm run typecheck && npm run build && npm test && npm run test:browser`
Expected: all pass, and no stderr lines in any suite (search the output for `stderr`, `Error`, `Warning`).

- [ ] **Step 6: Commit, repair line endings, push, open the PR**

```bash
git add -A
git commit -m "Docs and release notes: 0.102.0, OneDrive accounts"
node <scratchpad>/fix-eol.mjs origin/main
for f in $(git diff --name-only origin/main HEAD); do [ "$f" = package-lock.json ] && continue; git restore --staged --source=origin/main -- "$f"; git add "$f"; done
git commit -m "Restore main's line endings on every line this branch did not change"
git diff --stat origin/main HEAD   # only real changes
git checkout -- package-lock.json  # the repair touched the LF-pinned lock in the worktree only
git push -u origin <branch>
gh pr create --base main --title "OneDrive, part 1: connect a Microsoft account" --body-file <body>
```

The PR body states: what was built; the rulings above; that `ONEDRIVE_CLIENT_ID` must be set as a repository secret before a release; the manual check (set `TRYPTHOS_ONEDRIVE_CLIENT` to the `.secrets/onedrive-client.json` path, `npm run app`, Settings > Accounts > Connect OneDrive, sign in, see the email, quit and relaunch - still connected (proves the rotated token was stored), Disconnect, relaunch - not connected; Google's section still connects and disconnects); **Deployment surface: needs a release (new installer)**.

---

## Self-review against the spec

- Spec "Shared sign-in code" -> Task 2. "Client ID injected at build time" -> Tasks 3, 5 (workflow, builder). "Rotating refresh token, single-flight" -> Task 4 tests "stores the rotated refresh token on every refresh", "two callers at once share one refresh", "a refresh whose new token cannot be stored fails". "Who the account is asked of Graph" -> Task 4 `whoami`, status test. "Consent check" -> Task 1 `grantsOneDrive`, Task 4 scope test. "No revoke" -> Task 4 disconnect test, ruling recorded. "Four channels" + leak guard -> Task 5. "CloudAccountSection" -> Task 6. Release workflow + README fork note -> Tasks 5, 7. CLAUDE.md order -> Task 7.
- Deferred to PR 2 by the spec: the ref kind and settings 25, `oneDriveApi.js`, the provider, `onedrive:folders`, the picker, header button, glyph, capabilities. Not in this plan, deliberately.
- Type names used across tasks: `createMicrosoftAuth`, `MICROSOFT_PROVIDER`, `loadMicrosoftClient`, `listenOnce({ redirectHost })`, `pkcePair(randomBytes)`, `CloudAccountBridge`, `CloudAccountKind`, `useCloudAccount(bridge, failureKey)`, `googleAccount`, `oneDriveAccount`, `oneDriveBridge`, `GOOGLE_ACCOUNT`, `ONEDRIVE_ACCOUNT` - consistent throughout.
