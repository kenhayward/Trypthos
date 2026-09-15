import { z } from "zod";
import { workspaceRefName } from "./workspaceRef";

/// The vaults Obsidian knows about, read from its own settings file.
///
/// Obsidian keeps one file listing every vault it has opened - `obsidian.json` in its app-data
/// folder - as an object keyed by an id it mints, each entry naming a folder. That file is how this
/// app offers a vault without making the user browse for one, and its presence at all is how it
/// knows Obsidian is installed.
///
/// **Another application's file, so untrusted twice over.** It is written by versions of Obsidian
/// this build has never seen, and it names folders on disk. So each entry is parsed on its own and
/// one that does not fit is skipped rather than taking the list with it; and the renderer is only
/// ever handed an id to send back, which the shell resolves against this file again - see
/// `OpenVaultRequest`.

/// What the renderer names a vault by. Obsidian mints sixteen hex characters; anything that could be
/// read as a path is refused, because this arrives from the untrusted side.
export const ObsidianVaultIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const VaultEntrySchema = z.object({ path: z.string().min(1) });

export interface ObsidianVault {
  /// Obsidian's own id for the vault, and the only thing the renderer sends back to open it.
  id: string;
  /// The folder's name, which is what Obsidian's own vault switcher shows.
  name: string;
  /// The absolute folder, shown under the name so two vaults with one name can be told apart.
  path: string;
}

/// Every vault a parsed `obsidian.json` names, by name.
///
/// Total: anything that is not Obsidian's shape answers with no vaults rather than an error, since
/// the only thing a caller could do with an error is show an empty list anyway.
export function obsidianVaultsFrom(raw: unknown): ObsidianVault[] {
  if (typeof raw !== "object" || raw === null) return [];
  const vaults = (raw as { vaults?: unknown }).vaults;
  if (typeof vaults !== "object" || vaults === null || Array.isArray(vaults)) return [];

  const found: ObsidianVault[] = [];
  for (const [id, entry] of Object.entries(vaults)) {
    const parsed = VaultEntrySchema.safeParse(entry);
    if (!parsed.success || !ObsidianVaultIdSchema.safeParse(id).success) continue;

    const { path } = parsed.data;
    found.push({ id, name: workspaceRefName({ kind: "local", root: path }), path });
  }

  return found.sort(
    (one, other) =>
      one.name.localeCompare(other.name, undefined, { sensitivity: "base" }) ||
      one.path.localeCompare(other.path),
  );
}
