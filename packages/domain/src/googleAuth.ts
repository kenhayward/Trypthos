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
