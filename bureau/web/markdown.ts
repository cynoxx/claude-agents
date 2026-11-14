// Petit rendu Markdown → HTML échappé, suffisant pour RESULTAT.md et les rapports.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LIEN = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

function inlineSansCode(s: string): string {
  return esc(s)
    .replace(LIEN, (_, texte, url) => {
      const sur = /^https?:\/\//.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
      return sur ? `<a href="${url}" target="_blank" rel="noopener">${texte}</a>` : texte;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
}

function inline(s: string): string {
  return s
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? `<code>${esc(part.slice(1, -1))}</code>` : inlineSansCode(part)))
    .join("");
}

const cellules = (ligne: string) =>
  ligne
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => inline(c.trim()));

const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const SEPARATEUR = /^\s*\|?\s*:?-{2,}/;

export function renderMarkdown(md: string): string {
  const lignes = md.replace(/\r\n/g, "\n").split("\n");
  const blocs: string[] = [];
  let i = 0;
  const debutBloc = (l: string) => /^```/.test(l) || /^#{1,4}\s/.test(l) || UL.test(l) || OL.test(l) || /^>/.test(l) || l.trim().startsWith("|");

  while (i < lignes.length) {
    const l = lignes[i];
    if (!l.trim()) {
      i++;
    } else if (/^```/.test(l)) {
      const code: string[] = [];
      for (i++; i < lignes.length && !/^```/.test(lignes[i]); i++) code.push(lignes[i]);
      i++;
      blocs.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,4}\s/.test(l)) {
      const n = l.match(/^#+/)![0].length;
      blocs.push(`<h${n}>${inline(l.slice(n).trim())}</h${n}>`);
      i++;
    } else if (l.trim().startsWith("|") && SEPARATEUR.test(lignes[i + 1] ?? "")) {
      const tete = cellules(l);
      const corps: string[][] = [];
      for (i += 2; i < lignes.length && lignes[i].trim().startsWith("|"); i++) corps.push(cellules(lignes[i]));
      const th = tete.map((c) => `<th>${c}</th>`).join("");
      const tr = corps.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
      blocs.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
    } else if (UL.test(l) || OL.test(l)) {
      const re = UL.test(l) ? UL : OL;
      const items: string[] = [];
      for (; i < lignes.length && re.test(lignes[i]); i++) items.push(`<li>${inline(lignes[i].replace(re, ""))}</li>`);
      const tag = re === UL ? "ul" : "ol";
      blocs.push(`<${tag}>${items.join("")}</${tag}>`);
    } else if (/^>/.test(l)) {
      const q: string[] = [];
      for (; i < lignes.length && /^>/.test(lignes[i]); i++) q.push(lignes[i].replace(/^>\s?/, ""));
      blocs.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
    } else {
      const p: string[] = [];
      for (; i < lignes.length && lignes[i].trim() && (p.length === 0 || !debutBloc(lignes[i])); i++) p.push(lignes[i].trim());
      blocs.push(`<p>${inline(p.join(" "))}</p>`);
    }
  }
  return blocs.join("\n");
}
