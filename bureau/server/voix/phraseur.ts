/** Découpe le texte de Max, qui arrive par petits morceaux, en phrases complètes à dire dès qu'elles sont finies. */
export class Phraseur {
  private tampon = "";

  ajouter(morceau: string): string[] {
    this.tampon += morceau;
    const out: string[] = [];
    for (;;) {
      const m = this.tampon.match(/([.!?…]+["»”)]*)\s+|\n+/);
      if (!m || m.index === undefined) break;
      const fin = m[1] !== undefined ? m.index + m[1].length : m.index;
      const phrase = this.tampon.slice(0, fin).trim();
      this.tampon = this.tampon.slice(m.index + m[0].length);
      if (phrase) out.push(phrase);
    }
    return out;
  }

  /** Ce qui reste à la fin de la réponse. */
  finir(): string[] {
    const reste = this.tampon.trim();
    this.tampon = "";
    return reste ? [reste] : [];
  }
}
