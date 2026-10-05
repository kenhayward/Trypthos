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
