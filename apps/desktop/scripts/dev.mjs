import { spawn } from "node:child_process";
import electron from "electron";

/// Launches the shell in development mode.
///
/// A script rather than an inline environment variable in the npm script, because setting one
/// inline is not portable between cmd and a POSIX shell - and this project is developed on both.
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, TRYPTHOS_DEV: "1" },
});

child.on("exit", (code) => process.exit(code ?? 0));
