// `npm run ia-locale` : fait passer Max sur l'IA de ton Mac (Ollama, LM Studio…), après avoir vérifié qu'elle répond.
// `npm run ia-locale -- claude` : revient à Claude. Le choix est écrit dans bureau.config.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, loadConfig } from "./config.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fichier = path.join(racine, CONFIG_FILE);
const lire = () => (fs.existsSync(fichier) ? (JSON.parse(fs.readFileSync(fichier, "utf8")) as Record<string, unknown>) : {});
const ecrire = (cerveau: Record<string, unknown>) => {
  const c = lire();
  c.cerveau = { ...((c.cerveau ?? {}) as object), ...cerveau };
  fs.writeFileSync(fichier, JSON.stringify(c, null, 2) + "\n");
};

/** Le meilleur modèle installé pour Max (bon en français et avec les outils), sinon le premier. */
export function choisirModele(tous: string[]): string | null {
  const modeles = tous.filter((m) => !/embed/i.test(m));
  const ordre = [/qwen2\.5.*(14|7)b/i, /qwen3/i, /qwen/i, /mistral-small|mistral-nemo/i, /llama3\.[123].*8b/i, /mistral/i, /llama/i, /gemma/i];
  for (const r of ordre) {
    const m = modeles.find((x) => r.test(x));
    if (m) return m;
  }
  return modeles[0] ?? null;
}

async function main() {
  if (process.argv[2] === "claude") {
    ecrire({ moteur: "claude" });
    console.log("✅ Max repasse sur Claude. Relance-le : npm run arreter, puis « Dis Siri, Max au rapport ».");
    return;
  }
  const c = loadConfig(racine).cerveau;
  const adresses = [process.argv[2], c.url, "http://localhost:11434/v1", "http://localhost:1234/v1"].filter((x): x is string => !!x);
  for (const url of [...new Set(adresses)]) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/models`, { headers: c.cle ? { authorization: `Bearer ${c.cle}` } : {}, signal: AbortSignal.timeout(3000) });
      if (!r.ok) continue;
      const modeles = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
      const modele = choisirModele(modeles);
      if (!modele) {
        console.log(`⚠️  ${url} répond, mais aucun modèle n'est installé. Avec Ollama : ollama pull qwen2.5:7b`);
        return;
      }
      ecrire({ moteur: "local", url, modele });
      console.log(`✅ Max passe sur ton IA locale : ${modele} (${url}).`);
      console.log(`   Modèles trouvés : ${modeles.join(", ")}`);
      console.log("   Relance-le : npm run arreter, puis « Dis Siri, Max au rapport ». Pour revenir à Claude : npm run ia-locale -- claude");
      return;
    } catch {
      // pas là : l'adresse suivante
    }
  }
  console.log("⚠️  Aucune IA locale ne répond. Installe Ollama (brew install ollama), lance-le (ollama serve), puis : ollama pull qwen2.5:7b");
  console.log("   Avec LM Studio : onglet Developer › Start Server, puis relance npm run ia-locale.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();
