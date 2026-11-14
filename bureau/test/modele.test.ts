import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { telechargerModele, URL_MODELE } from "../server/modele.ts";

const contenu = Buffer.alloc(300_000, 7);
let coupe = false;
const serveur = http.createServer((req, res) => {
  if (req.url === "/absent") {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-length": String(contenu.length) });
  if (coupe) {
    res.write(contenu.subarray(0, 1000));
    return res.destroy();
  }
  res.end(contenu);
});
const base = new Promise<string>((r) => serveur.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`)));
afterAll(() => new Promise((r) => serveur.close(r)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-modele-"));

describe("telechargerModele", () => {
  it("vise le modèle large-v3-turbo de whisper.cpp", () => {
    expect(URL_MODELE).toBe("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin");
  });

  it("télécharge le modèle en suivant la progression", async () => {
    const dest = path.join(tmp(), "modeles", "m.bin");
    const progres: number[] = [];
    expect(await telechargerModele(`${await base}/m.bin`, dest, (p) => progres.push(p))).toBe("telecharge");
    expect(fs.readFileSync(dest).equals(contenu)).toBe(true);
    expect(progres.at(-1)).toBe(1);
    expect(fs.existsSync(dest + ".partiel")).toBe(false);
  });

  it("ne retélécharge pas un modèle déjà là", async () => {
    const dest = path.join(tmp(), "m.bin");
    fs.writeFileSync(dest, "déjà là");
    expect(await telechargerModele(`${await base}/m.bin`, dest)).toBe("deja-la");
    expect(fs.readFileSync(dest, "utf8")).toBe("déjà là");
  });

  it("ne laisse pas un modèle à moitié téléchargé passer pour complet", async () => {
    const dest = path.join(tmp(), "m.bin");
    coupe = true;
    try {
      await expect(telechargerModele(`${await base}/m.bin`, dest)).rejects.toThrow();
    } finally {
      coupe = false;
    }
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("explique une adresse introuvable", async () => {
    await expect(telechargerModele(`${await base}/absent`, path.join(tmp(), "m.bin"))).rejects.toThrow(/404/);
  });
});
