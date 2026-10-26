// Twilio, pour que Max t'appelle sur ton téléphone (le réveil) : passer un appel, suivre son état, et déposer le
// message audio du matin (voix de Max + musique) chez Twilio (« Assets » de Twilio Serverless) pour qu'il le joue.
// Le Mac n'a pas besoin d'être joignable depuis internet : tout part de lui.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface IdentifiantsTwilio {
  /** Account SID (AC…). */
  compte: string;
  /** Auth Token, ou le secret d'une clé API si `cle` est donnée. */
  jeton: string;
  /** Une clé API (SK…) à la place de l'Auth Token : révocable sans toucher au compte. */
  cle?: string;
  /** Ton numéro Twilio, celui qui appelle (format +1…, +33…). */
  numero: string;
}

export type Recuperer = (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface EtatAppel {
  /** queued, ringing, in-progress, completed, busy, no-answer, failed, canceled. */
  statut: string;
  /** Secondes de communication. */
  duree: number;
  /** human, machine_start, fax, unknown… (détection du répondeur). */
  reponduPar: string | null;
}

export const STATUTS_FINAUX = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

const API = "https://api.twilio.com/2010-04-01";
const SERVERLESS = "https://serverless.twilio.com/v1";
const UPLOAD = "https://serverless-upload.twilio.com/v1";

export const echapperXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Ce que dit l'appel : le message audio s'il est prêt, puis (ou sinon) le texte lu par une voix Twilio. */
export function twimlReveil(o: { audio: string | null; texte: string; voix: string; relance: string }): string {
  const dire = (t: string) => `<Say language="fr-FR" voice="${echapperXml(o.voix)}">${echapperXml(t)}</Say>`;
  return `<Response>${o.audio ? `<Play>${echapperXml(o.audio)}</Play>` : dire(o.texte)}<Pause length="1"/>${dire(o.relance)}</Response>`;
}

export class Twilio {
  private recuperer: Recuperer;

  constructor(
    private id: IdentifiantsTwilio,
    private o: { dossierDonnees: string; recuperer?: Recuperer; attente?: (ms: number) => Promise<void> } ,
  ) {
    this.recuperer = o.recuperer ?? ((url, init) => fetch(url, init));
  }

  private get entetes(): Record<string, string> {
    return { authorization: `Basic ${Buffer.from(`${this.id.cle || this.id.compte}:${this.id.jeton}`).toString("base64")}` };
  }

  private async requete<T>(methode: "GET" | "POST", url: string, champs?: Record<string, string | string[]> | FormData): Promise<T> {
    let body: string | FormData | undefined;
    const headers = { ...this.entetes };
    if (champs instanceof FormData) body = champs;
    else if (champs) {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(champs)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
      body = p.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const r = await this.recuperer(url, { method: methode, headers, body });
    const j = (await r.json().catch(() => ({}))) as T & { message?: string };
    if (!r.ok) throw new Error(`Twilio (${r.status}) : ${j?.message ?? "erreur"}`);
    return j;
  }

  /**
   * Appelle `vers` et lui fait entendre `twiml`. Le répondeur est détecté (pour ne pas le prendre pour toi) ; un compte
   * d'essai refuse cette option (erreur 400) : on rappelle alors sans, et le Bureau se contente de la durée de l'appel.
   */
  async appeler(vers: string, twiml: string): Promise<string> {
    const url = `${API}/Accounts/${this.id.compte}/Calls.json`;
    const base = { To: vers, From: this.id.numero, Twiml: twiml };
    try {
      return (await this.requete<{ sid: string }>("POST", url, { ...base, MachineDetection: "Enable", Timeout: "40" })).sid;
    } catch (e) {
      if (!/\(400\)/.test((e as Error).message)) throw e;
      return (await this.requete<{ sid: string }>("POST", url, base)).sid;
    }
  }

  async etat(sid: string): Promise<EtatAppel> {
    const r = await this.requete<{ status: string; duration: string | null; answered_by: string | null }>("GET", `${API}/Accounts/${this.id.compte}/Calls/${sid}.json`);
    return { statut: r.status, duree: Number(r.duration ?? 0) || 0, reponduPar: r.answered_by };
  }

  // --- le message audio, déposé chez Twilio ---------------------------------------------------------------

  private fichierCache() {
    return path.join(this.o.dossierDonnees, "twilio.json");
  }

  /** Le service Serverless « max-reveil » et son environnement, créés une fois puis retenus. */
  private async service(): Promise<{ service: string; environnement: string; domaine: string }> {
    try {
      const c = JSON.parse(fs.readFileSync(this.fichierCache(), "utf8"));
      if (c.compte === this.id.compte && c.service && c.environnement && c.domaine) return c;
    } catch {
      // pas encore créé
    }
    const liste = await this.requete<{ services: { sid: string; unique_name: string }[] }>("GET", `${SERVERLESS}/Services?PageSize=50`);
    const service =
      liste.services.find((s) => s.unique_name === "max-reveil")?.sid ??
      (await this.requete<{ sid: string }>("POST", `${SERVERLESS}/Services`, { UniqueName: "max-reveil", FriendlyName: "Max - reveil", IncludeCredentials: "false" })).sid;
    const envs = await this.requete<{ environments: { sid: string; unique_name: string; domain_name: string }[] }>("GET", `${SERVERLESS}/Services/${service}/Environments`);
    const env =
      envs.environments.find((e) => e.unique_name === "reveil") ??
      (await this.requete<{ sid: string; domain_name: string }>("POST", `${SERVERLESS}/Services/${service}/Environments`, { UniqueName: "reveil", DomainSuffix: "reveil" }));
    const c = { compte: this.id.compte, service, environnement: env.sid, domaine: env.domain_name };
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(this.fichierCache(), JSON.stringify(c));
    return c;
  }

  /**
   * Dépose un fichier audio et renvoie son adresse, que Twilio pourra jouer pendant l'appel. L'adresse contient un
   * nom tiré au hasard : personne ne peut la deviner ; chaque dépôt remplace le précédent.
   */
  async deposerAudio(fichier: string): Promise<string> {
    const attendre = this.o.attente ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const s = await this.service();
    const asset = await this.requete<{ sid: string }>("POST", `${SERVERLESS}/Services/${s.service}/Assets`, { FriendlyName: "reveil" });
    const chemin = `/reveil-${crypto.randomBytes(12).toString("hex")}.mp3`;
    const f = new FormData();
    f.append("Path", chemin);
    f.append("Visibility", "public");
    f.append("Content", new Blob([fs.readFileSync(fichier)], { type: "audio/mpeg" }), path.basename(fichier));
    const version = await this.requete<{ sid: string }>("POST", `${UPLOAD}/Services/${s.service}/Assets/${asset.sid}/Versions`, f);
    const build = await this.requete<{ sid: string }>("POST", `${SERVERLESS}/Services/${s.service}/Builds`, { AssetVersions: [version.sid] });
    for (let i = 0; ; i++) {
      const st = await this.requete<{ status: string }>("GET", `${SERVERLESS}/Services/${s.service}/Builds/${build.sid}/Status`);
      if (st.status === "completed") break;
      if (st.status === "failed" || i > 60) throw new Error("Twilio n'a pas pu préparer le message audio.");
      await attendre(2000);
    }
    await this.requete("POST", `${SERVERLESS}/Services/${s.service}/Environments/${s.environnement}/Deployments`, { BuildSid: build.sid });
    return `https://${s.domaine}${chemin}`;
  }
}
