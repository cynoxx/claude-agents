// Construit l'app en une page HTML autonome (sans serveur), publiable comme artefact claude.ai.
// Usage : npm run build:artifact  →  dist-artifact/finance-agent.html
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build --mode artifact', { stdio: 'inherit' });

const dir = 'dist-artifact';
const assets = join(dir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8'));
const favicon = readFileSync('public/favicon.svg', 'utf8');

// Le contenu `</script` dans le JS fermerait la balise : on l'échappe
const safeJs = js.join('\n').replaceAll('</script', '<\\/script');

const html = `<title>Agent financier</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
<style>${css.join('\n')}
html, body { background: #0a0a0a; color: #f4f4f2; color-scheme: dark; }
#root { padding-left: max(0px, env(safe-area-inset-left, 0px)); padding-right: max(0px, env(safe-area-inset-right, 0px)); }
</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
writeFileSync(join(dir, 'finance-agent.html'), html);
console.log(`dist-artifact/finance-agent.html (${(html.length / 1024).toFixed(0)} Ko)`);
