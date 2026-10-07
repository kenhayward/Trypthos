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
    const without: Partial<typeof token> = { ...token };
    delete without.refresh_token;
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
    [401, { error: "invalid_client" }, "not-configured"],
    [401, {}, "permission-denied"],
    [429, {}, "rate-limited"],
    [500, {}, "offline"],
    [503, "not json", "offline"],
    // Microsoft answered, so the connection is fine: a refusal it did not name is not "offline".
    [403, {}, "unknown"],
    [400, { error: "invalid_request" }, "unknown"],
    [400, "not json", "unknown"],
  ])("%i %j is %s", (status, body, reason) => {
    expect(microsoftAuthErrorFor(status, body)).toBe(reason);
  });
});
