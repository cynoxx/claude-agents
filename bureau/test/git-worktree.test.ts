import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createWorktree, commitAll, ProjetInvalide } from "../server/git-worktree.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-git-"));
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" }).trim();

function depot(): string {
  const d = tmp();
  git(d, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(d, "a.txt"), "a\n");
  git(d, "add", ".");
  git(d, "commit", "-q", "-m", "init");
  return d;
}

describe("createWorktree", () => {
  it("crée une branche bureau/<slug> dans un dossier séparé", async () => {
    const repo = depot();
    const cible = path.join(tmp(), "code");
    const w = await createWorktree(repo, cible, "ecran-stats");
    expect(w.branch).toBe("bureau/ecran-stats");
    expect(fs.existsSync(path.join(cible, "a.txt"))).toBe(true);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("ajoute -2 si la branche existe déjà", async () => {
    const repo = depot();
    await createWorktree(repo, path.join(tmp(), "c1"), "x");
    const w = await createWorktree(repo, path.join(tmp(), "c2"), "x");
    expect(w.branch).toBe("bureau/x-2");
  });

  it("refuse un dossier qui n'est pas un dépôt Git", async () => {
    await expect(createWorktree(tmp(), path.join(tmp(), "c"), "x")).rejects.toBeInstanceOf(ProjetInvalide);
    await expect(createWorktree("/nexiste/pas", path.join(tmp(), "c"), "x")).rejects.toBeInstanceOf(ProjetInvalide);
  });
});

describe("commitAll", () => {
  it("commite les changements et ne fait rien s'il n'y en a pas", async () => {
    const repo = depot();
    const cible = path.join(tmp(), "code");
    const w = await createWorktree(repo, cible, "y");
    expect(await commitAll(cible, "rien")).toBe(false);
    fs.writeFileSync(path.join(cible, "b.txt"), "b\n");
    expect(await commitAll(cible, "Bureau : ajout de b")).toBe(true);
    expect(git(repo, "log", "-1", "--format=%s", w.branch)).toBe("Bureau : ajout de b");
  });
});
