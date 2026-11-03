// Les petits panneaux de l'écran Jarvis : la météo et l'agenda du jour, rafraîchis toutes les 20 minutes.
import { EventEmitter } from "node:events";
import type { JarvisVue } from "../../shared/protocol.ts";
import type { Mac } from "./mac.ts";

const PERIODE_MS = 20 * 60_000;

/** Événement : `etat` quand les panneaux changent. */
export class InfosJarvis extends EventEmitter {
  private infos: JarvisVue = { meteo: null, agenda: null };
  private timer?: NodeJS.Timeout;

  constructor(private mac: Pick<Mac, "meteo" | "agenda">) {
    super();
  }

  vue(): JarvisVue {
    return { meteo: this.infos.meteo, agenda: this.infos.agenda ? [...this.infos.agenda] : null };
  }

  async rafraichir(): Promise<void> {
    const [m, a] = await Promise.all([this.mac.meteo(), this.mac.agenda("aujourdhui")]);
    this.infos = { meteo: m.ok ? (m.court ?? null) : this.infos.meteo, agenda: a.ok ? a.evenements : this.infos.agenda };
    this.emit("etat");
  }

  demarrer(): void {
    this.arreter();
    void this.rafraichir();
    this.timer = setInterval(() => void this.rafraichir(), PERIODE_MS);
    this.timer.unref();
  }

  arreter(): void {
    clearInterval(this.timer);
  }
}
