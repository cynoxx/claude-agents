import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class ProjetInvalide extends Error {}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

async function brancheExiste(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/** Crée un worktree sur une nouvelle branche `bureau/<slug>` (suffixe -2, -3… si elle existe). */
export async function createWorktree(projectPath: string, targetDir: string, slug: string): Promise<{ path: string; branch: string }> {
  if (!fs.existsSync(projectPath)) throw new ProjetInvalide(`Le projet ${projectPath} est introuvable`);
  let repo: string;
  try {
    repo = await git(projectPath, "rev-parse", "--show-toplevel");
  } catch {
    throw new ProjetInvalide(`${projectPath} n'est pas un dépôt Git`);
  }
  let branch = `bureau/${slug}`;
  for (let i = 2; await brancheExiste(repo, branch); i++) branch = `bureau/${slug}-${i}`;
  await git(repo, "worktree", "add", "-q", "-b", branch, targetDir, "HEAD");
  return { path: targetDir, branch };
}

/** Commite tout ce qui a changé dans le worktree. Renvoie false s'il n'y avait rien à commiter. */
export async function commitAll(worktree: string, message: string): Promise<boolean> {
  if (!(await git(worktree, "status", "--porcelain"))) return false;
  await git(worktree, "add", "-A");
  let identite: string[] = [];
  try {
    await git(worktree, "config", "user.email");
  } catch {
    identite = ["-c", "user.name=Bureau", "-c", "user.email=bureau@localhost"];
  }
  await git(worktree, ...identite, "commit", "-q", "-m", message);
  return true;
}
