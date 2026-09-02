/// Deciding when two endpoint URLs mean the same provider.
///
/// In the domain, and not in either process, because both sides ask the question and they must agree
/// exactly. The shell stores an API key under this form of the endpoint; the renderer uses it to
/// decide whether to show "Key stored" against a profile. Two implementations that differed by a
/// trailing slash would put the badge on the wrong profile - the key would be stored, work fine, and
/// the interface would report it missing.

/// The comparison form of an endpoint URL.
///
/// Case-folded and stripped of trailing slashes, because `https://api.example.com/v1` and
/// `https://API.example.com/v1/` are the same endpoint to every HTTP client. Lower-casing the whole
/// string is deliberately blunt: a path can be case-sensitive in principle, but an OpenAI-compatible
/// base URL that differs only by the case of its path is not a real case, and treating one user's
/// `/V1` as a separate provider from their `/v1` would silently ask them for the key twice.
export function normaliseEndpoint(endpoint: string): string {
  return String(endpoint).trim().toLowerCase().replace(/\/+$/, "");
}
