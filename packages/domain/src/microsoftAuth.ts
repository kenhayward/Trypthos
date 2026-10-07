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
/// `z.guid()` rather than `z.string().uuid()`: zod 4's uuid() is RFC-strict and refuses ids that are
/// GUID-shaped but not RFC-versioned.
export const MicrosoftClientConfigSchema = z.object({ clientId: z.guid() }).strict();

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

export type MicrosoftAuthFailure = "not-connected" | "not-configured" | "permission-denied" | "rate-limited" | "offline" | "unknown";

/// What a refusal from the token endpoint or `/me` means to the user.
///
/// A 4xx it does not name is `unknown`, not `offline`: Microsoft answered, so telling the user to
/// check their connection would send them to the wrong place. A 5xx still reads as `offline`.
export function microsoftAuthErrorFor(status: number, body: unknown): MicrosoftAuthFailure {
  const parsed = MicrosoftErrorBodySchema.safeParse(body);
  if (parsed.success) {
    if (parsed.data.error === "invalid_grant" || parsed.data.error === "interaction_required") return "not-connected";
    if (parsed.data.error === "invalid_client" || parsed.data.error === "unauthorized_client") return "not-configured";
  }
  if (status === 401) return "permission-denied";
  if (status === 429) return "rate-limited";
  if (status >= 400 && status < 500) return "unknown";
  return "offline";
}
