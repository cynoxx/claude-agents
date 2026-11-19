// Max, l'esprit de lumière, en 3D (three.js). Une sphère de particules traversée de filaments ; quand il t'écoute ou te
// parle, un visage affleure dans la matière et se tourne vers toi. Tout bouge par ressorts ; la voix pousse la lumière.
// Tout est calculé par la carte graphique (un seul nuage de points, dessiné en une fois) : rien n'est recalculé en
// JavaScript à chaque image, sauf une poignée de nombres.
import * as THREE from "three";
import type { EtatMax } from "../../shared/protocol.ts";
import { REGLAGES, Ressort, YEUX, hasard, humeurDe, nuage, pointVisage, voixSimulee, type Humeur } from "./entite-pur.ts";

const NB_POINTS = 42000;
const NB_FILAMENTS = 46;
const NB_ETINCELLES = 90;

const VERTEX = /* glsl */ `
attribute vec3 aSphere;
attribute vec3 aVisage;
attribute vec3 aNormale;
attribute vec4 aInfo; // hasard, mâchoire, orbite, trait
uniform float uT, uVisage, uVoix, uEnergie, uApp, uPx, uSalut;
uniform float uBandes[8];
uniform vec3 uC1, uC2;
varying vec4 vCouleur;

float lisse(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

void main() {
  float g = aInfo.x;
  // chaque point rejoint le visage à son rythme : la matière se réorganise, elle ne « fond » pas d'un bloc
  // un tiers de la matière ne devient jamais visage : elle reste en sphère autour de lui, comme une aura
  float coque = step(0.68, fract(g * 13.7));
  float k = lisse(0.0, 1.0, uVisage * 1.45 - g * 0.45) * (1.0 - coque);
  vec3 p = mix(aSphere * (1.0 + coque * 0.42 * uVisage), aVisage, k);
  vec3 n = normalize(mix(aSphere, aNormale, k));

  // la matière vit : un courant lent, plus fort quand il réfléchit
  vec3 courant = vec3(sin(p.y * 4.0 + uT * 0.7 + g * 6.283), sin(p.z * 4.0 + uT * 0.6 + g * 4.0), sin(p.x * 4.0 + uT * 0.8 + g * 2.0));
  p += courant * (0.012 + 0.045 * uEnergie) * (1.0 - 0.6 * k);

  // la voix pousse la lumière vers l'extérieur, par bandes de spectre réparties autour de lui
  float tour = (atan(p.y, p.x) / 6.2831853 + 0.5) * 8.0;
  float b0 = uBandes[int(mod(floor(tour), 8.0))];
  float b1 = uBandes[int(mod(floor(tour) + 1.0, 8.0))];
  float bande = mix(b0, b1, lisse(0.0, 1.0, fract(tour)));
  p += n * uVoix * (0.03 + 0.3 * bande) * (1.0 - 0.8 * k) * (0.4 + 0.6 * g);
  // la mâchoire descend quand il parle
  p.y -= aInfo.y * k * uVoix * 0.11;
  // il respire
  p *= 1.0 + 0.014 * sin(uT * 0.9) + 0.06 * uSalut;

  // l'apparition : la matière arrive de loin et se condense
  float a = lisse(0.0, 1.0, uApp * 1.35 - g * 0.35);
  vec3 loin = normalize(aSphere + courant * 0.4) * (2.6 + 5.0 * g);
  loin.y += 1.5 * (g - 0.5);
  p = mix(loin, p, a);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 nv = normalize(normalMatrix * n);
  // le bord s'allume (le relief du visage se lit par ses contours), l'arrière s'efface
  float bord = pow(1.0 - abs(nv.z), 2.4);
  float face = lisse(-0.25, 0.35, nv.z);
  // une lumière venue d'en haut à gauche modèle le visage : le nez, les arcades et les lèvres prennent du relief
  float eclaire = pow(max(dot(nv, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 1.6);
  float lumSphere = 0.16 + 0.84 * bord;
  float trait = aInfo.w * k;
  float lumVisage = 0.035 + 0.7 * eclaire + 0.14 * bord + 0.7 * trait;
  float lum = mix(lumSphere, lumVisage, k) * mix(0.25, 1.0, face);
  lum *= 1.0 - coque * 0.6 * uVisage;
  // les orbites restent sombres : les yeux sont deux foyers de lumière posés dedans
  float oeil = aInfo.z * k;
  lum *= 1.0 - 0.6 * oeil * (1.0 - aInfo.w);
  lum += uVoix * 0.25 * bande;
  float gros = step(0.985, g) * (1.0 - 0.7 * k);
  lum *= 1.0 + gros * 0.9;
  vec3 c = mix(uC1, uC2, clamp(bord * 0.25 * (1.0 - k) + trait * 0.55 + eclaire * 0.25 * k + gros * 0.6, 0.0, 1.0));
  vCouleur = vec4(c, lum * a);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (0.55 + 0.6 * g + gros * 1.1) * (1.0 - 0.5 * trait) / -mv.z;
}`;

const FRAGMENT = /* glsl */ `
uniform float uLum;
varying vec4 vCouleur;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vCouleur.rgb, pow(a, 1.5) * vCouleur.a * uLum * 0.85);
}`;

const VERTEX_FIL = /* glsl */ `
attribute vec2 aFil; // position le long du filament (0 à 1), hasard du filament
uniform float uT, uApp, uVoix;
varying vec2 vFil;
void main() {
  vFil = aFil;
  vec3 p = position * (1.0 + 0.02 * sin(uT * 0.8 + aFil.y * 40.0) + uVoix * 0.05 * aFil.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p * mix(3.5, 1.0, uApp), 1.0);
}`;

const FRAGMENT_FIL = /* glsl */ `
uniform float uT, uLum, uOpacite, uEnergie;
uniform vec3 uC1, uC2;
varying vec2 vFil;
void main() {
  // une impulsion de lumière court le long de chaque filament
  float tete = fract(uT * (0.08 + 0.25 * uEnergie) * (0.5 + vFil.y) + vFil.y * 7.0);
  float d = fract(vFil.x - tete);
  float pulse = pow(1.0 - d, 6.0);
  float bords = sin(vFil.x * 3.14159);
  float a = (0.07 + 0.8 * pulse) * bords * uOpacite * uLum;
  gl_FragColor = vec4(mix(uC1, uC2, pulse), a);
}`;

const lisseJs = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Une tache de lumière douce (le cœur, le halo), dessinée une seule fois. */
function textureHalo(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Entite {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private groupe = new THREE.Group();
  private points: THREE.Points;
  private matPoints: THREE.ShaderMaterial;
  private matFil: THREE.ShaderMaterial;
  private coeur: THREE.Sprite;
  private halo: THREE.Sprite;
  private anneaux: THREE.Line[] = [];
  private yeux: THREE.Sprite[] = [];
  private etincelles: THREE.Points;
  private etincellesBase: Float32Array;

  private etatMax: EtatMax = "veille";
  private alerte = false;
  private fete = 0;
  private forcee: Humeur | null = null;
  private t = 0;
  private dernier = 0;
  private anim = 0;
  private zoom = 1;
  private voixReelle: { niveau: number; bandes: number[]; jusqua: number } | null = null;
  private cameraJusqua = 0;
  private regardCible = { x: 0, y: 0 };
  private clignement = 3;
  private salut = 0;
  private lent = 0;

  // tout ce qui change d'une humeur à l'autre passe par un ressort
  private r = {
    visage: new Ressort(0, 26, 1),
    energie: new Ressort(0.2, 30, 1),
    taille: new Ressort(0.88, 70, 0.55),
    lumiere: new Ressort(0, 30, 1),
    anneau1: new Ressort(0, 50, 0.6),
    anneau2: new Ressort(0, 50, 0.6),
    etincelles: new Ressort(0, 30, 1),
    vitesse: new Ressort(0.06, 20, 1),
    voix: new Ressort(0, 260, 0.9),
    app: new Ressort(0, 5, 1),
    rx: new Ressort(0, 45, 0.75),
    ry: new Ressort(0, 45, 0.75),
    c1: [new Ressort(0.18, 25, 1), new Ressort(0.55, 25, 1), new Ressort(1, 25, 1)],
    c2: [new Ressort(0.43, 25, 1), new Ressort(0.88, 25, 1), new Ressort(1, 25, 1)],
  };
  private tour = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0, 6.2);
    this.scene.add(this.groupe);

    // le nuage : la sphère et le visage dans les mêmes points
    const nu = nuage(NB_POINTS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(nu.sphere, 3));
    geo.setAttribute("aSphere", new THREE.BufferAttribute(nu.sphere, 3));
    geo.setAttribute("aVisage", new THREE.BufferAttribute(nu.visage, 3));
    geo.setAttribute("aNormale", new THREE.BufferAttribute(nu.normale, 3));
    geo.setAttribute("aInfo", new THREE.BufferAttribute(nu.info, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
    // de la lumière ajoutée, sans jamais écrire d'opacité : la toile n'assombrit pas le décor qui est derrière Max
    const commun = {
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    } as const;
    this.matPoints = new THREE.ShaderMaterial({
      ...commun,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uT: { value: 0 }, uVisage: { value: 0 }, uVoix: { value: 0 }, uEnergie: { value: 0.2 }, uApp: { value: 0 }, uPx: { value: 20 },
        uSalut: { value: 0 }, uLum: { value: 1 }, uBandes: { value: new Array(8).fill(0) },
        uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() },
      },
    });
    this.points = new THREE.Points(geo, this.matPoints);
    this.groupe.add(this.points);

    // les filaments : des arcs de grand cercle, tous dans une seule géométrie
    const h = hasard(21);
    const pos: number[] = [];
    const fil: number[] = [];
    const SEG = 56;
    for (let f = 0; f < NB_FILAMENTS; f++) {
      const axe = new THREE.Vector3(h() - 0.5, h() - 0.5, h() - 0.5).normalize();
      const depart = new THREE.Vector3(h() - 0.5, h() - 0.5, h() - 0.5).cross(axe).normalize();
      const rayon = 0.55 + h() * 0.6;
      const longueur = Math.PI * (0.5 + h() * 1.3);
      const g = h();
      let avant: THREE.Vector3 | null = null;
      for (let s = 0; s <= SEG; s++) {
        const q = new THREE.Quaternion().setFromAxisAngle(axe, (s / SEG) * longueur);
        const p = depart.clone().applyQuaternion(q).multiplyScalar(rayon * (1 + 0.12 * Math.sin((s / SEG) * Math.PI)));
        if (avant) {
          pos.push(avant.x, avant.y, avant.z, p.x, p.y, p.z);
          fil.push((s - 1) / SEG, g, s / SEG, g);
        }
        avant = p;
      }
    }
    const geoFil = new THREE.BufferGeometry();
    geoFil.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geoFil.setAttribute("aFil", new THREE.Float32BufferAttribute(fil, 2));
    this.matFil = new THREE.ShaderMaterial({
      ...commun,
      vertexShader: VERTEX_FIL,
      fragmentShader: FRAGMENT_FIL,
      uniforms: { uT: { value: 0 }, uApp: { value: 0 }, uVoix: { value: 0 }, uLum: { value: 1 }, uOpacite: { value: 1 }, uEnergie: { value: 0.2 }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() } },
    });
    this.groupe.add(new THREE.LineSegments(geoFil, this.matFil));

    // le cœur et le halo
    const tex = textureHalo();
    this.coeur = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, ...commun }));
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, ...commun, opacity: 0.35 }));
    this.scene.add(this.halo, this.coeur);

    // les yeux : deux foyers de lumière posés dans les orbites (ils suivent la tête, ils clignent)
    for (const [ex, ey] of YEUX) {
      const d = new THREE.Vector3(ex, ey, Math.sqrt(1 - ex * ex - ey * ey));
      const o = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, ...commun, opacity: 0 }));
      o.position.set(...pointVisage(d.x, d.y, d.z)).multiplyScalar(0.97);
      this.yeux.push(o);
      this.groupe.add(o);
    }

    // les anneaux : l'écoute (un, tourné vers toi), l'alerte (deux)
    for (let i = 0; i < 2; i++) {
      const pts = Array.from({ length: 181 }, (_, k) => new THREE.Vector3(Math.cos((k / 180) * Math.PI * 2), Math.sin((k / 180) * Math.PI * 2), 0));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ ...commun, opacity: 0 }));
      l.rotation.x = Math.PI / 2 - 0.32 - i * 0.2;
      l.rotation.y = i * 0.5;
      this.anneaux.push(l);
      this.scene.add(l);
    }

    // les étincelles : des idées qui passent (réflexion), une gerbe (réussite)
    this.etincellesBase = new Float32Array(NB_ETINCELLES * 4);
    for (let i = 0; i < NB_ETINCELLES; i++) this.etincellesBase.set([h() * Math.PI * 2, Math.acos(2 * h() - 1), 1.25 + h() * 1.1, 0.3 + h()], i * 4);
    const geoE = new THREE.BufferGeometry();
    geoE.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NB_ETINCELLES * 3), 3));
    this.etincelles = new THREE.Points(geoE, new THREE.PointsMaterial({ ...commun, map: tex, size: 0.09, opacity: 0, sizeAttenuation: true }));
    this.etincelles.frustumCulled = false;
    this.scene.add(this.etincelles);

    const redim = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
      this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
      this.camera.updateProjectionMatrix();
      this.matPoints.uniforms.uPx.value = Math.max(1, r.height) * dpr * 0.046;
    };
    new ResizeObserver(redim).observe(canvas);
    redim();

    window.addEventListener("pointermove", (e) => {
      if (performance.now() < this.cameraJusqua) return;
      this.regardCible = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
    });
    window.addEventListener("max-apparait", () => this.apparaitre());
    // ?max=alerte (ou veille, ecoute, reflexion, parole, fete, soir) : forcer une humeur, pour la regarder
    const force = new URLSearchParams(location.search).get("max");
    if (force && force in REGLAGES) this.forcee = force as Humeur;
  }

  // --- ce que le reste de la page lui dit -------------------------------------------------------------------

  etat(e: EtatMax): void {
    this.etatMax = e;
  }

  /** Grossit Max (la plongée vers le bureau) : 1 = normal. */
  agrandir(z: number): void {
    this.zoom = z;
  }

  /** Max Ultime, une sanction, une urgence : il passe à la braise. */
  obscur(actif: boolean): void {
    this.alerte = actif;
  }

  /** Une quête réussie : il passe à l'or pendant quelques secondes. */
  feter(secondes = 4): void {
    this.fete = secondes;
  }

  /** Fixe une humeur (l'atelier, les essais) ; null : il reprend sa vie. */
  forcer(h: Humeur | null): void {
    this.forcee = h;
  }

  /** Regarde vers toi (de -1 à 1), d'après la caméra. */
  regarder(x: number, y: number): void {
    this.cameraJusqua = performance.now() + 1500;
    this.regardCible = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  /** Tu reviens : son cœur s'embrase et il se gonfle un instant. */
  saluer(): void {
    this.salut = 1;
  }

  /** Les anneaux de texte de l'ancien Max : plus rien à afficher autour de lui. */
  donnees(_etiquettes: string[]): void {}

  /** Le vrai son de sa voix (niveau de 0 à 1, 8 bandes de spectre) : il remplace la voix simulée tant qu'il arrive. */
  nourrirVoix(niveau: number, bandes: number[]): void {
    this.voixReelle = { niveau, bandes, jusqua: performance.now() + 250 };
  }

  get niveauVoix(): number {
    return this.r.voix.valeur;
  }

  /** La matière arrive de loin et se condense. */
  apparaitre(): void {
    this.r.app.valeur = 0;
    this.r.app.vitesse = 0;
  }

  demarrer(): void {
    this.apparaitre();
    const boucle = (ms: number) => {
      this.anim = requestAnimationFrame(boucle);
      // pendant l'ouverture, toute la carte graphique est pour elle
      if (document.hidden || document.body.dataset.intro === "oui") {
        this.dernier = 0;
        return;
      }
      const dt = Math.min(0.05, (ms - (this.dernier || ms)) / 1000);
      this.dernier = ms;
      this.image(dt);
    };
    this.anim = requestAnimationFrame(boucle);
  }

  arreter(): void {
    cancelAnimationFrame(this.anim);
  }

  // --- une image ---------------------------------------------------------------------------------------------

  private image(dt: number): void {
    this.t += dt;
    this.fete = Math.max(0, this.fete - dt);
    const humeur = this.forcee ?? humeurDe(this.etatMax, { alerte: this.alerte, fete: this.fete > 0, heure: new Date().getHours() });
    const g = REGLAGES[humeur];
    const r = this.r;

    // la voix : la vraie si elle arrive, sinon une voix simulée quand il parle
    const parle = humeur === "parole" || ((humeur === "alerte" || humeur === "soir") && this.etatMax === "parle");
    let niveau = 0;
    let bandes: number[] = new Array(8).fill(0);
    if (this.voixReelle && performance.now() < this.voixReelle.jusqua) ({ niveau, bandes } = this.voixReelle);
    else if (parle) ({ niveau, bandes } = voixSimulee(this.t));
    const voix = Math.max(0, r.voix.avancer(niveau, dt));

    const visage = r.visage.avancer(g.visage, dt);
    const energie = r.energie.avancer(g.energie, dt);
    const taille = r.taille.avancer(g.taille, dt);
    const lumiere = r.lumiere.avancer(g.lumiere, dt);
    const app = Math.min(1, r.app.avancer(1, dt));
    const c1 = r.c1.map((x, i) => x.avancer(g.c1[i], dt));
    const c2 = r.c2.map((x, i) => x.avancer(g.c2[i], dt));
    this.salut = Math.max(0, this.salut - dt * 1.2);

    // il cligne des yeux de temps en temps
    this.clignement -= dt;
    if (this.clignement < -0.14) this.clignement = 2.5 + Math.random() * 4;
    const clign = this.clignement < 0 ? 0.15 : 1;

    // il tourne lentement sur lui-même au repos ; dès qu'il a un visage, il te fait face et te suit du regard
    this.tour += dt * r.vitesse.avancer(g.vitesse, dt) * (1 - visage);
    if (visage > 0.5) this.tour *= Math.exp(-dt * 3);
    const rx = r.rx.avancer(this.regardCible.x, dt);
    const ry = r.ry.avancer(this.regardCible.y, dt);
    this.groupe.rotation.set(ry * 0.3 * visage + 0.06 * Math.sin(this.t * 0.5), this.tour + rx * 0.5 * visage, 0.03 * Math.sin(this.t * 0.37));
    const s = taille * this.zoom * (1 + 0.02 * voix);
    this.groupe.scale.setScalar(s);
    // la fenêtre : la caméra se décale à l'opposé de ta tête, la scène prend de la profondeur
    this.camera.position.set(-rx * 0.45, ry * 0.3, 6.2);
    this.camera.lookAt(0, 0, 0);

    const u = this.matPoints.uniforms;
    u.uT.value = this.t;
    u.uVisage.value = visage;
    u.uVoix.value = voix;
    u.uEnergie.value = energie;
    u.uApp.value = app;
    u.uSalut.value = this.salut;
    u.uLum.value = lumiere;
    u.uBandes.value = bandes;
    (u.uC1.value as THREE.Color).setRGB(c1[0], c1[1], c1[2]);
    (u.uC2.value as THREE.Color).setRGB(c2[0], c2[1], c2[2]);

    const f = this.matFil.uniforms;
    f.uT.value = this.t;
    f.uApp.value = app;
    f.uVoix.value = voix;
    f.uLum.value = lumiere * app;
    f.uEnergie.value = energie;
    f.uOpacite.value = 1 - 0.78 * visage; // le visage doit se lire : les filaments s'effacent derrière lui
    (f.uC1.value as THREE.Color).setRGB(c1[0], c1[1], c1[2]);
    (f.uC2.value as THREE.Color).setRGB(c2[0], c2[1], c2[2]);

    // le cœur bat avec la voix ; le halo donne la lumière autour
    const coul = new THREE.Color(c1[0], c1[1], c1[2]);
    const clair = new THREE.Color(c2[0], c2[1], c2[2]);
    const batt = 0.9 + 0.1 * Math.sin(this.t * 1.7) + voix * 0.9 + this.salut;
    this.coeur.material.color.copy(clair);
    this.coeur.material.opacity = Math.min(1, (0.75 - 0.45 * visage) * lumiere * app * batt);
    this.coeur.scale.setScalar(s * (1.0 + 0.5 * voix + 0.6 * this.salut));
    this.halo.material.color.copy(coul);
    this.halo.material.opacity = 0.32 * lumiere * app * (1 + 0.5 * voix);
    this.halo.scale.setScalar(s * (5.2 + voix * 1.2 + this.salut * 2));

    // les yeux : ils s'allument avec le visage, se ferment d'un coup et se rouvrent
    for (const o of this.yeux) {
      o.material.color.copy(clair);
      o.material.opacity = Math.min(1, lisseJs(0.45, 0.9, visage) * lumiere * app * 0.95);
      o.scale.set(0.13, 0.13 * clign, 1);
    }

    // les anneaux
    const a1 = r.anneau1.avancer(g.anneaux >= 1 ? 1 : 0, dt);
    const a2 = r.anneau2.avancer(g.anneaux >= 2 ? 1 : 0, dt);
    [a1, a2].forEach((a, i) => {
      const l = this.anneaux[i];
      const m = l.material as THREE.LineBasicMaterial;
      m.color.copy(coul);
      m.opacity = Math.max(0, a) * 0.5 * app;
      l.scale.setScalar(s * (1.2 + 0.25 * Math.max(0, a) + i * 0.14 + 0.03 * Math.sin(this.t * 2 + i)));
      l.rotation.z = this.t * (i ? -0.25 : 0.18);
      l.visible = m.opacity > 0.01;
    });

    // les étincelles
    const e = r.etincelles.avancer(g.etincelles, dt);
    const me = this.etincelles.material as THREE.PointsMaterial;
    me.opacity = Math.max(0, e) * 0.9 * app;
    this.etincelles.visible = me.opacity > 0.01;
    if (this.etincelles.visible) {
      me.color.copy(clair);
      const p = this.etincelles.geometry.getAttribute("position") as THREE.BufferAttribute;
      const b = this.etincellesBase;
      for (let i = 0; i < NB_ETINCELLES; i++) {
        const th = b[i * 4] + this.t * b[i * 4 + 3] * 0.8;
        const ph = b[i * 4 + 1] + Math.sin(this.t * 0.5 + i) * 0.3;
        const ray = s * b[i * 4 + 2] * (0.75 + 0.5 * Math.max(0, e));
        p.setXYZ(i, Math.sin(ph) * Math.cos(th) * ray, Math.cos(ph) * ray, Math.sin(ph) * Math.sin(th) * ray);
      }
      p.needsUpdate = true;
    }

    // si les images ralentissent longtemps, on dessine moins de points (jamais moins du tiers)
    this.lent = dt > 1 / 40 ? this.lent + dt : Math.max(0, this.lent - dt * 0.5);
    if (this.lent > 2.5) {
      const geo = this.points.geometry;
      const n = Math.max(Math.round(NB_POINTS / 3), Math.round((geo.drawRange.count === Infinity ? NB_POINTS : geo.drawRange.count) * 0.7));
      geo.setDrawRange(0, n);
      this.lent = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
