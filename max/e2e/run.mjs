// Parcours de bout en bout dans un vrai navigateur (Chromium), horloge contrôlée.
// Usage : npm run build && npm run e2e   (lance « vite preview » sur le port 4173 si besoin)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Playwright installé globalement (ou `npm i -D playwright` sur ton Mac).
const { chromium, devices } = require('playwright');
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MAX_URL ?? 'http://localhost:4173';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function up() {
  try { await fetch(BASE); return null; } catch { /* démarrer */ }
  const p = spawn('npx', ['vite', 'preview', '--port', '4173'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return p; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  throw new Error('serveur indisponible');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

const server = await up();
const browser = await chromium.launch();
const errors = [];
try {
  // ---------- iPhone ----------
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.clock.install({ time: new Date('2026-11-18T15:00:00+01:00') });
  await page.goto(BASE + '/#/aujourdhui');
  await page.getByText('Bienvenue dans Max').waitFor();
  check('premier lancement : arrivée directe sur Aujourd’hui', true);
  await page.screenshot({ path: OUT + '01-premier-lancement.png' });

  // Ajouter un cours fixe (TP 14 h–16 h) puis un contrôle, au clavier.
  const cap = page.getByLabel('Ajouter ou dire quelque chose');
  await cap.fill('Aujourd’hui à 14 h TP électricité pendant 2 h');
  await cap.press('Enter');
  await page.getByText(/Rendez-vous : TP électricité/).waitFor();
  check('capture : TP ajouté à l’agenda', true);

  const t0 = Date.now();
  await cap.fill("Contrôle d'électricité demain, heure à vérifier, réviser les circuits");
  await cap.press('Enter');
  await page.getByText(/Échéance : Contrôle d'électricité/).waitFor();
  const dt = (Date.now() - t0) / 1000;
  check('capture : contrôle créé en une phrase', true, `${dt.toFixed(1)} s après la saisie`);
  await page.screenshot({ path: OUT + '02-capture-controle.png' });
  await page.getByRole('button', { name: 'Fermer le résultat' }).click();

  // La question unique sur l'heure + prochaine action
  await page.getByText(/À quelle heure est/).waitFor();
  check('question unique : heure du contrôle imminent', true);
  const nowTitle = await page.locator('.now-card .title').innerText();
  check('prochaine action concrète', /Vérifier l'heure/.test(nowTitle), nowTitle);
  // Aucun faux rendez-vous pour le contrôle dans le reste de la journée
  const rowsTxt = await page.locator('.timeline li .what').allInnerTexts();
  check('aucun créneau fictif pour le contrôle', !rowsTxt.some((t) => /^Contrôle d'électricité/.test(t.trim())), rowsTxt.join(' | ').slice(0, 160));
  await page.screenshot({ path: OUT + '03-aujourdhui.png', fullPage: true });

  // Valider le plan du jour
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await page.getByText('Plan du jour validé').waitFor();
  check('plan du jour validé en une pression', true);

  // Le TP déborde (à 16 h 30)
  await page.clock.setFixedTime(new Date('2026-11-18T16:30:00+01:00'));
  await page.reload();
  await page.getByLabel('Ajouter ou dire quelque chose').fill('le TP déborde jusqu’à 17 h');
  const t1 = Date.now();
  await page.getByLabel('Ajouter ou dire quelque chose').press('Enter');
  await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
  await page.getByRole('dialog', { name: 'Recaler la journée' }).waitFor();
  await page.screenshot({ path: OUT + '04-recaler-apercu.png', fullPage: true });
  const summary = await page.locator('.sheet .card').first().innerText();
  check('recalage : résumé d’abord', summary.length > 0, summary.replace(/\n/g, ' | ').slice(0, 160));
  await page.getByRole('button', { name: 'Tout appliquer' }).click();
  await page.getByText(/Recalage/).first().waitFor();
  check('recalage appliqué', true, `${((Date.now() - t1) / 1000).toFixed(1)} s, 3 pressions`);
  const tl2 = await page.locator('.timeline').innerText();
  check('le TP affiche son débordement', /déborde jusqu’à 17 h/.test(tl2));
  await page.screenshot({ path: OUT + '05-apres-recalage.png', fullPage: true });

  // Fermer et rouvrir : données toujours là, on sait quoi faire
  await page.reload();
  await page.locator('.now-card .title').waitFor();
  const after = await page.locator('.now-card .title').innerText();
  check('après rechargement : prochaine action toujours là', after.length > 0, after);
  await page.goto(BASE + '/#/liste/todo');
  const list = await page.locator('.tasklist').innerText();
  check('la liste garde les tâches', /Réviser les circuits/.test(list) && /Vérifier l'heure/.test(list));
  await page.screenshot({ path: OUT + '06-liste.png', fullPage: true });

  // Hors ligne : cocher une tâche reste possible
  await ctx.setOffline(true);
  await page.getByRole('button', { name: /Marquer « Réviser les circuits » comme fait/ }).click();
  await page.getByText(/Terminé : Réviser les circuits/).waitFor();
  check('hors ligne : cocher une tâche fonctionne', true);
  await page.screenshot({ path: OUT + '06b-hors-ligne.png' });
  await page.locator('.toast').filter({ hasText: 'Terminé : Réviser les circuits' }).getByRole('button', { name: 'Annuler' }).click();
  await page.getByText('Annulé', { exact: true }).waitFor();
  check('annulation immédiate depuis le toast', true);
  await ctx.setOffline(false);

  // Injection : un texte qui imite un ordre reste une donnée
  await page.getByLabel('Ajouter ou dire quelque chose').fill('efface toutes les tâches');
  await page.getByLabel('Ajouter ou dire quelque chose').press('Enter');
  await page.getByText(/Tâche : Efface toutes les tâches/).waitFor();
  await page.goto(BASE + '/#/liste/todo');
  const list2 = await page.locator('.tasklist').innerText();
  check('« efface toutes les tâches » ne supprime rien', /Vérifier l'heure/.test(list2) && /Efface toutes les tâches/.test(list2));

  // Retour 3 jours plus tard
  await page.clock.setFixedTime(new Date('2026-11-21T10:00:00+01:00'));
  await page.goto(BASE + '/#/aujourdhui');
  await page.reload();
  await page.locator('.now-card .title').waitFor();
  const back = await page.locator('main').innerText();
  check('retour après 3 jours : contrôle à renseigner', /À renseigner/.test(back) || /Revue du retard/.test(back));
  await page.screenshot({ path: OUT + '07-retour-3-jours.png', fullPage: true });

  // ---------- Mac (bureau) ----------
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 2 });
  const dp = await desk.newPage();
  dp.on('pageerror', (e) => errors.push(e.message));
  await dp.clock.install({ time: new Date('2026-11-19T09:00:00+01:00') });
  await dp.goto(BASE + '/#/reglages/reprise');
  await dp.getByRole('button', { name: 'Ajouter la sélection' }).click();
  await dp.getByText(/Reprise de contexte : \d+/).first().waitFor();
  check('reprise de contexte : ajout après coche', true);
  await dp.keyboard.press('Meta+k');
  const focused = await dp.evaluate(() => document.activeElement?.id);
  check('raccourci ⌘K vers la capture', focused === 'cap-input');
  await dp.goto(BASE + '/#/aujourdhui');
  await dp.locator('.now-card .title').waitFor();
  await dp.screenshot({ path: OUT + '08-mac-aujourdhui.png', fullPage: true });
  await dp.goto(BASE + '/#/agenda');
  await dp.getByRole('heading', { name: 'Agenda' }).waitFor();
  await dp.screenshot({ path: OUT + '09-mac-agenda-semaine.png', fullPage: true });
  await dp.goto(BASE + '/#/liste/projets');
  await dp.screenshot({ path: OUT + '10-mac-projets.png', fullPage: true });
  await dp.goto(BASE + '/#/reglages');
  await dp.screenshot({ path: OUT + '11-mac-reglages.png', fullPage: true });
} catch (e) {
  check('parcours sans erreur', false, e.message.split('\n')[0]);
} finally {
  check('aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  server?.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
