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
