// Moteur de l'app « Point business hebdo ».
// Source de vérité = métadonnées de l'app (clé META) posées sur chaque pastille dossier (zone 1).
// Les zones 2 et 3 sont des reflets recalculés à partir de ces fiches.
//
// Performance : les métadonnées sont lues une seule fois puis gardées en mémoire (cache) tant que
// le panneau est ouvert ; un rangement ne synchronise que les objets réellement modifiés.
import {
  PILOTES, ENJEUX, CARSAT, BLEU, OR, GRIS_FOND, G, G2, G3, ZONE1_TITLE, ZONE2_TITLE, ZONE3_TITLE,
  COLONNES_PRIO, LIBELLE_PRIO, RESSOURCES, HORIZONS, LIVRABLES_PLAN, LIVRABLES_DEVIS, META,
  ZONE4_TITLE, G4, OBJECTIF_TRIM,
} from './config.js?v=49';

const board = () => miro.board;
const enjeu = (code) => ENJEUX.find((e) => e.code === code) || ENJEUX[4];
const ordreEnjeu = (c) => ENJEUX.findIndex((e) => e.code === c);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (v) => Math.round(v);
// Troncature selon la largeur approximative des lettres (majuscules plus larges) : titre sur une ligne
const largeurCar = (c) => (/[A-ZÀ-ÖØ-Þ0-9MW@]/.test(c) ? 1.45 : /[ .,'\-]/.test(c) ? 0.55 : /[ijlrtf]/.test(c) ? 0.65 : 1);
function tronque(t, budget) {
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    w += largeurCar(t[i]);
    if (w > budget) return t.slice(0, Math.max(1, i - 1)).trimEnd() + '…';
  }
  return t;
}

// ── Tâches avant-vente : [{ ressource, livrable, priorite, echeance }] ──
// Les anciennes fiches (ressource[] + livrables[] + echeance) sont converties à la lecture.
// Libellés renommés : les fiches existantes sont lues avec le nouveau nom (réécrit au prochain enregistrement)
// (anciens libellés, et règle « minuscules sauf GC et CDC »)
const SIGLES = ['GC', 'CDC'];
const nomLivrable = (l) => {
  if (!l) return l;
  if (/appel d.offre/i.test(l)) return 'réponse ao';
  return SIGLES.includes(l.toUpperCase()) ? l.toUpperCase() : l.toLowerCase();
};
const renomme = (t) => (t.livrable && nomLivrable(t.livrable) !== t.livrable ? { ...t, livrable: nomLivrable(t.livrable) } : t);
export function tachesDe(m) {
  if (Array.isArray(m.taches)) return m.taches.map(renomme);
  const L = m.livrables || [];
  const liv = L.includes('plan + devis') || (L.includes('plan') && L.includes('devis')) ? 'plan + devis'
    : L.includes('plan') ? 'plan' : L.includes('devis') ? 'devis' : (L[0] || '');
  const res = (m.ressource || []).length ? m.ressource : (liv ? [''] : []);
  return res.map((r) => renomme({ ressource: r, livrable: liv, priorite: m.priorite && m.priorite !== 'Autres' ? m.priorite : '—', echeance: m.echeance || null }));
}
const echeanceMin = (m) => tachesDe(m).map((t) => t.echeance).filter(Boolean).sort()[0] || m.echeance || null;

// ── Cache des métadonnées ──
const cache = new Map();             // id -> meta (ou null si l'objet n'a pas de fiche)
async function setMeta(item, meta) { await item.setMetadata(META, meta); cache.set(item.id, meta); }
async function metaOf(item) {
  if (!cache.has(item.id)) cache.set(item.id, (await item.getMetadata(META).catch(() => null)) || null);
  return cache.get(item.id);
}
async function remove(item) { cache.delete(item.id); await board().remove(item).catch(() => {}); }

// Photo du board : toutes les formes et cartes avec leur fiche (lecture des fiches inconnues seulement)
async function snapshot() {
  const [shapes, cards, frames, texts, images] = await Promise.all([
    board().get({ type: 'shape' }), board().get({ type: 'card' }), board().get({ type: 'frame' }), board().get({ type: 'text' }),
    board().get({ type: 'image' })]);
  const items = [...shapes, ...cards, ...texts, ...images];
  const inconnus = items.filter((i) => !cache.has(i.id));
  for (let k = 0; k < inconnus.length; k += 40) await Promise.all(inconnus.slice(k, k + 40).map(metaOf));
  return { items: items.map((item) => ({ item, meta: cache.get(item.id) })), frames };
}

// ── Cadres ──
const findFrame = (frames, mot) => frames.find((f) => (f.title || '').includes(mot)) || null;
export async function getZone1() { return findFrame(await board().get({ type: 'frame' }), 'Avancement avant-vente'); }

const inFrame = (f, it) => it.parentId === f.id || (!it.parentId
  && Math.abs(it.x - f.x) < f.width / 2 && Math.abs(it.y - f.y) < f.height / 2);

// Rattachement au cadre : Miro le refuse parfois ; on retente, sinon l'objet reste libre mais
// posé dans le cadre (l'app le repère alors par sa position).
async function addToFrame(f, item) {
  try { await f.add(item); return; } catch (e) { /* nouvelle tentative */ }
  try { await new Promise((r) => setTimeout(r, 400)); item.x += 1; await item.sync(); await f.add(item); } catch (e) { /* libre */ }
}
function place(item, f, rx, ry) {
  if (item.relativeTo === 'parent_top_left') { item.x = rx; item.y = ry; }
  else { item.x = f.x - f.width / 2 + rx; item.y = f.y - f.height / 2 + ry; }
}
// Déplace / redimensionne / restyle ; renvoie une promesse de synchro seulement si quelque chose change
// Carte agrandie / rétrécie (redimensionnée à la main ou créée hors gabarit) : remise à la largeur standard
// avant l'empilement, pour que sa hauteur relue soit la bonne.
async function largeurCartes(items, w, f) {
  await Promise.all(items.filter((it) => it.width && Math.abs(it.width - w) > 1).map((it) => {
    it.width = w;
    return syncSur(it, f);
  }));
}
function update(item, f, rx, ry, patch = {}) {
  const avant = JSON.stringify([r1(item.x), r1(item.y), r1(item.width || 0), r1(item.height || 0), item.content, item.title, item.style, item.fields]);
  if (patch.width) item.width = patch.width;
  if (patch.height) item.height = patch.height;
  if (patch.content !== undefined) item.content = patch.content;
  if (patch.title !== undefined) item.title = patch.title;
  if (patch.style) item.style = { ...item.style, ...patch.style };
  if (patch.fields) item.fields = patch.fields;
  if (rx !== null) place(item, f, rx, ry);
  const apres = JSON.stringify([r1(item.x), r1(item.y), r1(item.width || 0), r1(item.height || 0), item.content, item.title, item.style, item.fields]);
  return avant === apres ? null : syncSur(item, f, rx, ry);
}
// Synchro tolérante : si Miro refuse la position, on retente dans l'autre repère (cadre / canevas),
// sinon on l'ignore pour ne pas bloquer tout le rangement.
async function syncSur(item, f, rx, ry) {
  try { return await item.sync(); } catch (e) {
    if (rx === null || rx === undefined) { console.warn('Synchro ignorée', item.id, e.message); return null; }
    try {
      const rel = item.x === rx && item.y === ry;
      if (rel) { item.x = f.x - f.width / 2 + rx; item.y = f.y - f.height / 2 + ry; } else { item.x = rx; item.y = ry; }
      return await item.sync();
    } catch (e2) { console.warn('Déplacement ignoré', item.id, e2.message); return null; }
  }
}
// Crée un objet de décor/reflet dans un cadre, avec sa fiche
async function creer(f, kind, props, meta) {
  const item = kind === 'card'
    ? await board().createCard({ ...props, x: f.x, y: f.y })
    : await board().createShape({ ...props, x: f.x, y: f.y });
  await setMeta(item, meta);
  await addToFrame(f, item);
  const relu = await board().getById(item.id);
  cache.set(relu.id, meta);
  return relu;
}
// Redimensionne un cadre en gardant son coin haut-gauche (taille d'abord, position ensuite)
async function resizeFrame(f, w, h, top, left) {
  const t = top ?? f.y - f.height / 2, l = left ?? f.x - f.width / 2;
  if (r1(f.width) !== r1(w) || r1(f.height) !== r1(h)) { f.width = w; f.height = h; await f.sync(); }
  if (r1(f.x) !== r1(l + w / 2) || r1(f.y) !== r1(t + h / 2)) { f.x = l + w / 2; f.y = t + h / 2; await f.sync(); }
}
async function ensureFrame(frames, mot, title, x, y, w, h) {
  return findFrame(frames, mot) || board().createFrame({ title, x, y, width: w, height: h, style: { fillColor: '#ffffff' } });
}

// ── Pastilles dossier ──
function cardStyle(d) {
  const e = enjeu(d.enjeu);
  return {
    fillColor: e.fill, color: e.text, fontSize: 12, fontFamily: 'open_sans',
    textAlign: 'center', textAlignVertical: 'middle',
    borderColor: e.fill === '#ffffff' ? '#1a1a1a' : '#ffffff', borderWidth: 2, borderOpacity: 1,
  };
}
const contenu = (d) => `<p><strong>${esc(d.titre)}</strong></p>`;

export async function initBoard() {
  let f = await getZone1();
  if (!f) f = await board().createFrame({ title: ZONE1_TITLE, x: 0, y: 0, width: G.frameW, height: G.frameH, style: { fillColor: '#ffffff' } });
  await layout();
  return f;
}

export async function saveDossier(d, itemId) {
  const f = await getZone1();
  if (!f) throw new Error("Board non initialisé : clique d'abord sur « Préparer le board ».");
  let item;
  const meta = { role: 'dossier', ...d, maj: new Date().toISOString() };
  const pilotes = new Set([d.pilote]);
  if (itemId) {
    item = await board().getById(itemId);
    const avant = cache.get(itemId);
    if (avant?.pilote) pilotes.add(avant.pilote);
    item.content = contenu(d);
    item.style = { ...item.style, ...cardStyle(d) };
    await item.sync();
    await setMeta(item, meta);
  } else {
    item = await creer(f, 'shape', { shape: 'rectangle', content: contenu(d), width: G.cardW, height: G.cardH, style: cardStyle(d) }, meta);
  }
  await layout({ pilotes });
  return item;
}

export async function deleteDossier(itemId) {
  const pilote = cache.get(itemId)?.pilote;
  await remove(await board().getById(itemId));
  await layout(pilote ? { pilotes: new Set([pilote]) } : {});
}

export async function readDossier(item) {
  if (!item || item.type !== 'shape') return null;
  const m = await metaOf(item);
  return m && m.role === 'dossier' ? m : null;
}

// Import en masse (import.json local) : création par lots, un seul rangement final.
export async function importDossiers(list, onProgress) {
  const f = await getZone1();
  if (!f) throw new Error("Board non initialisé : clique d'abord sur « Préparer le board ».");
  const snap = await snapshot();
  const deja = new Set(snap.items.filter((x) => x.meta?.role === 'dossier').map((x) => `${x.meta.pilote}|${x.meta.titre}`));
  const todo = list.filter((d) => !deja.has(`${d.pilote}|${d.titre}`));
  let echecs = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (d) => {
      try {
        await creer(f, 'shape', { shape: 'rectangle', content: contenu(d), width: G.cardW, height: G.cardH, style: cardStyle(d) },
          { role: 'dossier', ...d, maj: new Date().toISOString() });
      } catch (e) { echecs++; console.error(d.titre, e); }
    }));
    onProgress?.(Math.min(i + 4, todo.length), todo.length);
  }
  const r = await layout();
  return { crees: todo.length - echecs, echecs, ignores: list.length - todo.length, repares: 0, ...r };
}

// ── Réparation ponctuelle (11/10/2026) : priorités faussées par un changement de grille de la zone 2.
// Restaure les priorités de l'export S40 ; seules des empreintes (FNV-1a de « client|pilote ») sont publiées.
const PRIO_S40 = {"6c2f6440": "P3", "2ecaabd2": "P2", "164d9e91": "P3", "adf714cb": "P2", "14b45408": "P1", "eb177da2": "P1", "1db1f5f1": "Autres", "f2b7af82": "Autres", "a17f3fa1": "Autres", "9fbedd44": "P3", "aea8e6e2": "Autres", "c1a8029f": "P3", "8f017a25": "P1", "7ff47875": "P1", "45f8991d": "P3", "9dec9b3d": "P1", "3eacf1c5": "P2", "ea104ca1": "P2", "aabd8a93": "P1", "b40a5c26": "P2", "2e78b6c6": "P2", "d3f7b3ae": "P2", "18572970": "P1", "39972e6a": "P3", "3f1442cb": "P3", "f8b94894": "P3", "784da198": "P2"};
function fnv1a(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
async function restaurerPriorites(dossiers) {
  const fait = await board().getAppData('prioRestauree1').catch(() => null);
  if (fait) return 0;
  let n = 0;
  for (const d of dossiers) {
    const cible = PRIO_S40[fnv1a(`${d.meta.titre}|${d.meta.pilote}`)] || '—';
    if (d.meta.priorite !== cible) { d.meta = { ...d.meta, priorite: cible }; await setMeta(d.item, d.meta); n++; }
  }
  await board().setAppData('prioRestauree1', true);
  return n;
}


// ══ BOÎTE D'ENTRÉE MOBILE ══
// Sur mobile, l'app ne tourne pas : on pose un post-it dans le cadre « À intégrer (mobile) ».
// À l'ouverture du panneau (ordinateur), chaque post-it est lu, la fiche créée ou mise à jour,
// puis le post-it est retiré. Une info par ligne, ordre libre (client en 1re ligne).
const BOITE_TITRE = 'À intégrer (mobile)';
const AIDE_BOITE = `<p><strong>Saisie depuis le mobile</strong> : poser un post-it dans ce cadre, une info par ligne.</p>
<p>1re ligne : client · site — puis, dans l'ordre que vous voulez :</p>
<p>pilote (AC, JAN, JD, NB, LR, FS, CD) · enjeu (Strat, E1, E2, E3, Q, Closing, Signé) · priorité (P1, P2, P3, Autres) · CARSAT</p>
<p>une ligne par ressource : « PS plan 15/10 », « OP devis », « JAB AO 22/10 P1 »</p>
<p>Le post-it est intégré et retiré à la prochaine ouverture de l'app sur ordinateur.</p>`;
const ENJEU_MOTS = { s: 'S', strat: 'S', strategique: 'S', e1: 'E1', e2: 'E2', e3: 'E3', q: 'Q', qualif: 'Q',
  closing: 'C', c: 'C', signe: 'G', g: 'G' };
const LIV_MOTS = [
  [/plan\s*\+\s*devis/, 'plan + devis'], [/plan\s*action/, 'plan action'], [/\bplan\b/, 'plan'], [/\bdevis\b/, 'devis'],
  [/esquisse/, 'esquisse'], [/\bao\b|appel d.offre/, 'réponse ao'], [/enveloppe/, 'enveloppe'], [/\bcdc\b/, 'CDC'],
  [/\brdv\b/, 'rdv'], [/bercher/, 'bercher'], [/retrofit/, 'retrofit'], [/etude energ/, 'étude énergétique'], [/etude/, 'étude'],
  [/relance/, 'relance'], [/\b3d\b/, '3d'], [/carsat/, 'carsat'], [/\bgc\b/, 'GC'],
];
const sansAccent = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function dateIso(txt) {
  const m = txt.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const now = new Date();
  let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.getFullYear();
  let d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  if (!m[3] && d < new Date(now.getTime() - 60 * 86400000)) d = new Date(Date.UTC(y + 1, Number(m[2]) - 1, Number(m[1])));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
// Lecture d'un post-it -> { titre, pilote?, enjeu?, priorite?, carsat?, taches[] } ou { erreur }
function lirePostit(html) {
  const lignes = html.replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return { erreur: 'post-it vide' };
  if (lignes.some((l) => l.startsWith('⚠'))) return { ignore: true };   // déjà signalé, en attente de correction
  const r = { titre: lignes[0], taches: [] };
  const codesPil = PILOTES.map((p) => p.code);
  for (const brut of lignes.slice(1)) {
    const l = sansAccent(brut), mots = brut.trim().split(/\s+/), premier = mots[0].toUpperCase();
    if (mots.length === 1 && codesPil.includes(premier) && !r.pilote) { r.pilote = premier; continue; }
    if (mots.length === 1 && ENJEU_MOTS[l]) { r.enjeu = ENJEU_MOTS[l]; continue; }
    if (mots.length === 1 && /^(p[123]|autres)$/.test(l)) { r.priorite = l === 'autres' ? 'Autres' : l.toUpperCase(); continue; }
    if (l === 'carsat') { r.carsat = true; continue; }
    if (RESSOURCES.includes(premier) && mots.length > 1) {
      const liv = LIV_MOTS.find(([re]) => re.test(l));
      const pr = l.match(/\bp([123])\b/);
      r.taches.push({ ressource: premier, livrable: liv ? liv[1] : '', priorite: pr ? `P${pr[1]}` : '—', echeance: dateIso(l) });
      continue;
    }
    return { erreur: `ligne non comprise : « ${brut} »` };
  }
  return r;
}

async function boiteMobile(snap, f1) {
  let fb = findFrame(snap.frames, BOITE_TITRE);
  if (!fb) {
    fb = await board().createFrame({ title: BOITE_TITRE, width: 1400, height: 700, style: { fillColor: '#FFF8E1' },
      x: f1.x - f1.width / 2 + 700, y: f1.y + f1.height / 2 + 450 });
    const aide = await board().createText({ content: AIDE_BOITE, x: fb.x, y: fb.y - 250, width: 1300, style: { fontSize: 16, color: '#002060' } });
    await addToFrame(fb, aide);
    return 0;
  }
  const postits = (await board().get({ type: 'sticky_note' })).filter((s) => inFrame(fb, s));
  if (!postits.length) return 0;
  const parTitre = new Map(snap.items.filter((x) => x.meta?.role === 'dossier').map((x) => [sansAccent(x.meta.titre), x]));
  let n = 0;
  for (const p of postits) {
    const l = lirePostit(p.content || '');
    if (l.ignore) continue;
    const exist = l.titre ? parTitre.get(sansAccent(l.titre)) : null;
    if (!l.erreur && !exist && !l.pilote) l.erreur = 'pilote manquant pour un nouveau dossier';
    if (l.erreur) {
      p.content = `${p.content}<p>⚠ ${esc(l.erreur)} — corriger puis supprimer cette ligne</p>`;
      p.style = { ...p.style, fillColor: 'red' };
      await p.sync().catch(() => {});
      continue;
    }
    if (exist) {
      const m = { ...exist.meta };
      if (l.pilote) m.pilote = l.pilote;
      if (l.enjeu) m.enjeu = l.enjeu;
      if (l.priorite) m.priorite = l.priorite;
      if (l.carsat) m.carsat = true;
      const ts = [...tachesDe(m)];
      for (const t of l.taches) {
        const i = ts.findIndex((x) => x.ressource === t.ressource && x.livrable === t.livrable);
        if (i >= 0) ts[i] = { ...ts[i], ...Object.fromEntries(Object.entries(t).filter(([, v]) => v && v !== '—')) };
        else ts.push(t);
      }
      m.taches = ts;
      m.maj = new Date().toISOString();
      exist.item.style = { ...exist.item.style, ...cardStyle(m) };
      await exist.item.sync().catch(() => {});
      await setMeta(exist.item, m);
    } else {
      const d = { titre: l.titre, pilote: l.pilote, enjeu: l.enjeu || 'Q', priorite: l.priorite || '—',
        taches: l.taches, carsat: !!l.carsat };
      await creer(f1, 'shape', { shape: 'rectangle', content: contenu(d), width: G.cardW, height: G.cardH, style: cardStyle(d) },
        { role: 'dossier', ...d, maj: new Date().toISOString() });
    }
    await board().remove(p).catch(() => {});
    n++;
  }
  return n;
}


// ══ REPRISE PONCTUELLE (tableau de chasse) ══
// Un texte « PBH-REPRISE: [...] » déposé sur le board (par script) est appliqué une fois :
// chaque entrée { t: titre exact, j: n° jCRM, q: trimestre visé, s: suivi daté, a: date d'ajout }
// coche « tableau de chasse » sur la fiche correspondante, puis le texte est supprimé.
function decodeHtml(h) { const ta = document.createElement('textarea'); ta.innerHTML = h; return ta.value; }
async function appliquerReprise(snap) {
  const t = snap.items.find((x) => x.item.type === 'text' && (x.item.content || '').includes('PBH-REPRISE'));
  if (!t) return 0;
  let liste;
  try { liste = JSON.parse(decodeHtml(t.item.content.replace(/<[^>]+>/g, '')).split('PBH-REPRISE:')[1].trim()); }
  catch (e) { console.warn('Reprise illisible', e); return 0; }
  const parTitre = new Map(snap.items.filter((x) => x.meta?.role === 'dossier').map((x) => [x.meta.titre, x]));
  let n = 0;
  for (const e of liste) {
    const d = parTitre.get(e.t);
    if (!d) { console.warn('Reprise : dossier introuvable', e.t); continue; }
    const m = { ...d.meta, chasse: true, chasseTrim: e.q, chasseLe: d.meta.chasseLe || e.a, jcrm: e.j,
      suivi: d.meta.suivi || e.s || null, maj: new Date().toISOString() };
    await setMeta(d.item, m);
    n++;
  }
  await board().remove(t.item).catch(() => {});
  return n;
}

// Reprise des n° d'opportunité : texte « PBH-OPP: {"titre": id, ...} » déposé par script.
// Ne complète que les fiches sans n° (jamais d'écrasement), puis le texte est supprimé.
async function appliquerOpp(snap) {
  const t = snap.items.find((x) => x.item.type === 'text' && (x.item.content || '').includes('PBH-OPP'));
  if (!t) return 0;
  let table;
  try { table = JSON.parse(decodeHtml(t.item.content.replace(/<[^>]+>/g, '')).split('PBH-OPP:')[1].trim()); }
  catch (e) { console.warn('PBH-OPP illisible', e); return 0; }
  let n = 0;
  for (const d of snap.items.filter((x) => x.meta?.role === 'dossier')) {
    const id = table[d.meta.titre];
    if (!id || d.meta.jcrm) continue;
    await setMeta(d.item, { ...d.meta, jcrm: id });
    n++;
  }
  await board().remove(t.item).catch(() => {});
  console.log(`PBH-OPP : ${n} n° d'opportunité ajoutés`);
  return n;
}

// ══ RANGEMENT GÉNÉRAL ══
// Un seul rangement à la fois : une demande arrivée pendant un rangement est rejouée juste après.
let enCours = null;
export async function layout(opts = {}) {
  while (enCours) await enCours.catch(() => {});
  enCours = layoutInterne(opts).finally(() => { enCours = null; });
  return enCours;
}
async function layoutInterne({ pilotes = null } = {}) {
  const t0 = performance.now();
  let snap = await snapshot();
  const f1 = findFrame(snap.frames, 'Avancement avant-vente');
  if (!f1) return null;
  // post-its de la boîte mobile : intégrés avant le rangement (rangement complet s'il y en a)
  try { if (await appliquerReprise(snap)) snap = await snapshot(); } catch (e) { console.warn('Reprise', e); }
  try { if (await appliquerOpp(snap)) snap = await snapshot(); } catch (e) { console.warn('PBH-OPP', e); }
  let mobiles = 0;
  const BOITE_MOBILE_ACTIVE = false;   // saisie mobile abandonnée (décision 11/10) : code conservé, désactivé
  if (BOITE_MOBILE_ACTIVE && !pilotes) {
    try { mobiles = await boiteMobile(snap, f1); } catch (e) { console.warn('Boîte mobile', e); }
    if (mobiles) snap = await snapshot();
  }

  // Nettoyage : objets du cadre 1 sans fiche (écriture interrompue)
  const orphelins = snap.items.filter((x) => !x.meta && x.item.type === 'shape' && inFrame(f1, x.item));
  for (const o of orphelins) await remove(o.item);
  const vivants = snap.items.filter((x) => x.meta);
  const dossiers = vivants.filter((x) => x.meta.role === 'dossier');
  await restaurerPriorites(dossiers);

  const H = await layoutZone1(f1, vivants, dossiers, pilotes);
  const top1 = f1.y - f1.height / 2;
  const f2 = await layoutZone2(snap, f1, vivants, dossiers, H, top1);
  const f3 = await layoutZone3(snap, f2, vivants, dossiers, H, top1);
  try { await layoutZone4(snap, f3, vivants, dossiers, H, top1); } catch (e) { console.warn('Zone 4', e); }
  try { await layoutGarde(snap, f1, vivants, top1, H); } catch (e) { console.warn('Page de garde', e); }
  return { dossiers: dossiers.length, nettoyes: orphelins.length, mobiles, ms: Math.round(performance.now() - t0) };
}

// ── Page de garde (export PDF) : charte corporate — fond noir, bande orange à droite, logo blanc ──
// Cotes reprises de la couverture PPTX (wt_objects.cover, diapo 33,87 × 19,05 cm) mises à l'échelle du cadre.
const GARDE = { gap: 200 };   // hauteur = celle des zones, largeur au format 16:9
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateReunion(now = new Date()) {   // lundi de la semaine en cours (le week-end : lundi suivant) + n° de semaine ISO
  const j = (now.getDay() + 6) % 7;                         // 0 = lundi … 6 = dimanche
  const lundi = new Date(now.getFullYear(), now.getMonth(), now.getDate() - j + (j >= 5 ? 7 : 0));
  const t = new Date(Date.UTC(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 3));
  const s1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const sem = 1 + Math.round(((t - s1) / 864e5 - 3 + ((s1.getUTCDay() + 6) % 7)) / 7);
  return `${lundi.getDate()} ${MOIS[lundi.getMonth()]} ${lundi.getFullYear()} · S${sem}`.toUpperCase();
}
async function layoutGarde(snap, f1, vivants, top1, H) {
  const GH = H, GW = Math.round((H * 16) / 9);
  const cm = GW / 33.867, pt = GW / 960;                     // échelle : cm et points de la diapo -> px du cadre
  const left = f1.x - f1.width / 2 - GARDE.gap - GW;
  const ORANGE = '#FDB913';
  let f = findFrame(snap.frames, 'Page de garde');
  if (!f) {
    f = await board().createFrame({ title: '0 · Page de garde', width: GW, height: GH, style: { fillColor: '#000000' },
      x: left + GW / 2, y: top1 + GH / 2 });
  }
  const dans = vivants.filter((x) => inFrame(f, x.item));
  const texte = (size, bold) => ({ fillOpacity: 0, borderOpacity: 0, color: '#ffffff', fontSize: Math.round(size * pt),
    fontFamily: 'open_sans', textAlign: 'left', textAlignVertical: 'top' });
  const el = [
    { k: 'bande', x: GW - 1.4 * cm, y: 0, w: 1.4 * cm, h: GH, style: { fillColor: ORANGE, borderOpacity: 0 } },
    { k: 'date', x: 4.85 * cm, y: 3.3 * cm, w: 22 * cm, h: 1.4 * cm, style: texte(20), content: `<p>${dateReunion()}</p>` },
    { k: 'trait1', x: 4.85 * cm, y: 5.5 * cm, w: 1.85 * cm, h: 2.5 * pt, style: { fillColor: ORANGE, borderOpacity: 0 } },
    { k: 'titre', x: 4.8 * cm, y: 6.3 * cm, w: 26 * cm, h: 2.6 * cm, style: texte(54), content: '<p><strong>RÉUNION COMMERCE</strong></p>' },
    { k: 'trait2', x: 4.85 * cm, y: 9.4 * cm, w: 1.85 * cm, h: 2 * pt, style: { fillColor: ORANGE, borderOpacity: 0 } },
    { k: 'sous', x: 4.85 * cm, y: 9.7 * cm, w: 24 * cm, h: 1.4 * cm, style: texte(18), content: '<p>Point business hebdomadaire</p>' },
  ];
  const syncs = [];
  for (const e of el) {
    let x = dans.find((d) => d.meta.role === 'g0' && d.meta.k === e.k);
    if (!x) {
      const it = await creer(f, 'shape', { shape: 'rectangle', content: e.content || '', width: Math.max(8, e.w), height: Math.max(8, e.h), style: e.style }, { role: 'g0', k: e.k });
      x = { item: it };
    }
    const p = update(x.item, f, e.x + e.w / 2, e.y + e.h / 2, { width: Math.max(8, e.w), height: Math.max(8, e.h), ...(e.content ? { content: e.content } : {}) });
    if (p) syncs.push(p);
  }
  // logo blanc : 1 cm du bas, 3 cm de la droite, 12,7 × 2,8 cm
  const lw = 12.7 * cm, lh = 2.8 * cm, lx = GW - 3 * cm - lw / 2, ly = GH - 1 * cm - lh / 2;
  let logo = dans.find((d) => d.meta.role === 'g0' && d.meta.k === 'logo');
  if (!logo) {
    const it = await board().createImage({ url: new URL('logo_weinmann_blanc.png', location.href).href, x: f.x, y: f.y, width: lw });
    await setMeta(it, { role: 'g0', k: 'logo' });
    await addToFrame(f, it);
    cache.set(it.id, { role: 'g0', k: 'logo' });
    logo = { item: await board().getById(it.id) };
  }
  if (Math.abs((logo.item.width || 0) - lw) > 1) { logo.item.width = lw; await syncSur(logo.item, f); }
  const pl = update(logo.item, f, lx, ly);
  if (pl) syncs.push(pl);
  await Promise.all(syncs);
  // le cadre est réduit APRÈS avoir replacé son contenu (Miro refuse un cadre plus petit que ses enfants)
  try { await resizeFrame(f, GW, GH, f.y - f.height / 2, f.x - f.width / 2); await resizeFrame(f, GW, GH, top1, left); }
  catch (e) { console.warn('Cadre page de garde', e); }
}

// ── Zone 1 : sections par pilote, 25 dossiers max par colonne ──
const largeurs = new Map();          // largeur de chaque section au dernier rangement
async function layoutZone1(f, vivants, dossiers, pilotes) {
  const dans = vivants.filter((x) => inFrame(f, x.item));
  const rows = G.maxRows;
  const secH = G.hdrH + G.barH + 8 + rows * (G.cardH + G.gapY) + G.sectionPad;
  const frameH = G.top - G.hdrH + secH + G.margin;

  // décor manquant (nouveau pilote)
  for (const p of PILOTES) {
    if (!dans.some((x) => x.meta.role === 'bg' && x.meta.pilote === p.code)) {
      const it = await creer(f, 'shape', { shape: 'rectangle', content: '', width: 200, height: 200,
        style: { fillColor: GRIS_FOND, borderColor: BLEU, borderWidth: 2, borderOpacity: 1 } }, { role: 'bg', pilote: p.code });
      await board().sendToBack(it).catch(() => {});
      dans.push({ item: it, meta: cache.get(it.id) });
    }
    if (!dans.some((x) => x.meta.role === 'hdr' && x.meta.pilote === p.code)) {
      const it = await creer(f, 'shape', { shape: 'rectangle', content: '', width: 200, height: G.hdrH,
        style: { fillColor: BLEU, color: '#ffffff', fontSize: 14, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'top', borderOpacity: 0 } },
      { role: 'hdr', pilote: p.code });
      dans.push({ item: it, meta: cache.get(it.id) });
    }
  }

  const secs = PILOTES.map((p) => {
    const list = dossiers.filter((x) => x.meta.pilote === p.code)
      .sort((a, b) => ordreEnjeu(a.meta.enjeu) - ordreEnjeu(b.meta.enjeu) || a.meta.titre.localeCompare(b.meta.titre, 'fr'));
    const cols = Math.max(1, Math.ceil(list.length / rows));
    return { p, list, w: cols * (G.cardW + G.gapX) - G.gapX + 2 * G.sectionPad };
  });
  // Rangement partiel (ajout / modif / suppression) : seulement la section du pilote concerné,
  // sauf si une largeur de section change (nouvelle colonne) -> toute la zone 1.
  const complet = !pilotes || secs.some((x) => largeurs.get(x.p.code) !== x.w);
  const actif = (code) => complet || pilotes.has(code);
  secs.forEach((x) => largeurs.set(x.p.code, x.w));
  const contentW = secs.reduce((s, x) => s + x.w, 0) + G.sectionGap * (secs.length - 1);
  const frameW = Math.max(G.frameW, contentW + 2 * G.margin);
  const top = f.y - f.height / 2, left = f.x - f.width / 2;
  if (complet) { try { await resizeFrame(f, Math.max(f.width, frameW), Math.max(f.height, frameH), top, left); } catch (e) { console.warn(e); } }

  const syncs = [];
  const push = (p) => { if (p) syncs.push(p); };
  const barsExist = new Map(dans.filter((x) => x.meta.role === 'bar').map((x) => [`${x.meta.pilote}|${x.meta.enjeu}`, x.item]));
  const losExist = new Map(dans.filter((x) => x.meta.role === 'carsat').map((x) => [x.meta.ref, x.item]));
  const barsCibles = [], losCibles = [];

  let x0 = (frameW - contentW) / 2;
  for (const s of secs) {
    const left0 = x0;
    if (!actif(s.p.code)) { x0 += s.w + G.sectionGap; continue; }
    const bg = dans.find((x) => x.meta.role === 'bg' && x.meta.pilote === s.p.code);
    const hdr = dans.find((x) => x.meta.role === 'hdr' && x.meta.pilote === s.p.code);
    if (bg) push(update(bg.item, f, left0 + s.w / 2, G.top - G.hdrH + secH / 2, { width: s.w, height: secH }));
    if (hdr) {
      const n = s.list.length;
      push(update(hdr.item, f, left0 + s.w / 2, G.top - G.hdrH / 2, { width: s.w, height: G.hdrH,
        content: `<p><strong>${s.p.code} · ${esc(s.p.nom)}</strong></p><p>${n} dossier${n > 1 ? 's' : ''}</p>` }));
    }
    // barre de répartition par enjeu
    if (s.list.length) {
      let bx = left0 + G.sectionPad;
      const bw = s.w - 2 * G.sectionPad;
      for (const e of ENJEUX) {
        const k = s.list.filter((x) => x.meta.enjeu === e.code).length;
        if (!k) continue;
        const w = Math.max(8, (bw * k) / s.list.length);
        const pct = Math.round((100 * k) / s.list.length);
        barsCibles.push({ key: `${s.p.code}|${e.code}`, pilote: s.p.code, e, x: bx + w / 2, w, pct });
        bx += w;
      }
    }
    // pastilles
    s.list.forEach((d, i) => {
      const c = Math.floor(i / rows), r = i % rows;
      const rx = left0 + G.sectionPad + G.cardW / 2 + c * (G.cardW + G.gapX);
      const ry = G.top + G.barH + 8 + G.cardH / 2 + r * (G.cardH + G.gapY);
      // style réécrit seulement si la couleur a changé (Miro reformate les autres valeurs)
      const st = cardStyle(d.meta), cur = d.item.style || {};
      const restyle = (cur.fillColor || '').toLowerCase() !== st.fillColor || (cur.borderColor || '').toLowerCase() !== st.borderColor;
      push(update(d.item, f, rx, ry, restyle ? { style: st } : {}));
      if (d.meta.carsat) losCibles.push({ ref: d.item.id, x: rx + G.cardW / 2 - 11, y: ry + G.cardH / 2 - 9 });
    });
    x0 += s.w + G.sectionGap;
  }
  await Promise.all(syncs);

  // barres : mise à jour en place, création / suppression du strict nécessaire
  const s2 = [];
  for (const b of barsCibles) {
    let it = barsExist.get(b.key);
    barsExist.delete(b.key);
    const style = { fillColor: b.e.fill, borderColor: '#1a1a1a', borderWidth: 1, borderOpacity: b.e.fill === '#ffffff' ? 1 : 0,
      color: b.e.text, fontSize: 10, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle' };
    const txt = b.w >= 30 ? `<p>${b.pct}%</p>` : '';     // pourcentage affiché si le segment est assez large
    if (!it) it = await creer(f, 'shape', { shape: 'rectangle', content: txt, width: b.w, height: G.barH, style }, { role: 'bar', pilote: b.pilote, enjeu: b.e.code });
    const restyle = it.style?.fontSize !== 10 && Number(it.style?.fontSize) !== 10;
    const p = update(it, f, b.x, G.top + G.barH / 2 + 2, { width: b.w, height: G.barH, content: txt, ...(restyle ? { style } : {}) });
    if (p) s2.push(p);
  }
  // losanges CARSAT
  for (const l of losCibles) {
    let it = losExist.get(l.ref);
    losExist.delete(l.ref);
    if (!it) it = await creer(f, 'shape', { shape: 'rhombus', content: '', width: 14, height: 14,
      style: { fillColor: CARSAT, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 1 } }, { role: 'carsat', ref: l.ref });
    const p = update(it, f, l.x, l.y);
    if (p) s2.push(p);
  }
  // suppression des barres / losanges devenus inutiles, uniquement dans les sections rangées
  const piloteDe = new Map(dossiers.map((d) => [d.item.id, d.meta.pilote]));
  const aSuppr = [
    ...[...barsExist.entries()].filter(([k]) => actif(k.split('|')[0])).map(([, it]) => it),
    ...[...losExist.entries()].filter(([ref]) => !piloteDe.has(ref) || actif(piloteDe.get(ref))).map(([, it]) => it),
  ];
  await Promise.all([...s2, ...aSuppr.map(remove)]);
  if (complet) { try { await resizeFrame(f, frameW, frameH, top, left); } catch (e) { console.warn('Réduction du cadre 1 reportée', e); } }
  return frameH;
}

// ── Zone 2 : cartes priorisées (reflets), glisser-déposer entre colonnes ──
const isoJour = (d) => d.toISOString().slice(0, 10);
function alerte(echeance) {
  if (!echeance) return null;
  const j = Math.round((new Date(echeance) - new Date(isoJour(new Date()))) / 86400000);
  // étiquette = date d'échéance ; couleur selon le temps restant (dépassée ou ≤ 7 j rouge, ≤ 15 j orange, sinon gris)
  const date = `${echeance.slice(8, 10)}/${echeance.slice(5, 7)}`;
  if (j < 0) return { value: `${date} dépassée`, fillColor: '#c8341f', textColor: '#ffffff' };
  if (j <= 15) return { value: date, fillColor: j <= 7 ? '#c8341f' : '#f0a020', textColor: '#ffffff' };
  return { value: date, fillColor: '#e7e7e7', textColor: '#1a1a1a' };
}
const theme = (m) => { const e = enjeu(m.enjeu); return e.fill === '#ffffff' ? '#9aa0a6' : e.fill; };
const echTxt = (m) => { const e = echeanceMin(m); return e ? ` · éch. ${e.slice(8, 10)}/${e.slice(5, 7)}` : ''; };
function cardData2(m) {
  const fields = tachesDe(m).filter((t) => t.ressource || t.livrable).map((t) => ({
    value: [t.ressource, t.livrable].filter(Boolean).join(' · ') + (t.fait ? ' ✓' : ''),
    fillColor: t.fait ? '#1e8e4e' : (t.ressource ? OR : '#e3f4d6'), textColor: t.fait ? '#ffffff' : BLEU }));
  const a = alerte(echeanceMin(m));
  if (a) fields.push(a);
  if (m.carsat) fields.push({ value: 'CARSAT', fillColor: CARSAT, textColor: '#ffffff' });
  return { title: esc(tronque(m.titre, G2.titreMax)), style: { cardTheme: theme(m) }, fields };   // la date est dans l'étiquette
}

// Ordre d'une colonne de priorité : ordre manuel (clic sur l'en-tête) ; les cartes pas encore classées
// (nouvelle carte, carte basculée de la colonne précédente) passent en tête, dans l'ordre automatique.
async function ordreManuel2(col) { return (await board().getAppData(`ordre2_${col}`).catch(() => null)) || []; }
const triAuto2 = (a, b) => ordreEnjeu(a.meta.enjeu) - ordreEnjeu(b.meta.enjeu) || (echeanceMin(a.meta) || '9').localeCompare(echeanceMin(b.meta) || '9');
function triZone2(a, b, manuel) {
  const ia = manuel.indexOf(a.item.id), ib = manuel.indexOf(b.item.id);
  if (ia < 0 && ib < 0) return triAuto2(a, b);
  if (ia < 0) return -1;
  if (ib < 0) return 1;
  return ia - ib;
}
export async function dossiersZone2(col) {
  const snap = await snapshot();
  const manuel = await ordreManuel2(col);
  return snap.items.filter((x) => x.meta?.role === 'dossier' && x.meta.priorite === col).sort((a, b) => triZone2(a, b, manuel))
    .map((x) => ({ id: x.item.id, titre: x.meta.titre, pilote: x.meta.pilote, enjeu: x.meta.enjeu, echeance: echeanceMin(x.meta) }));
}
// Tous les dossiers (recherche pour ajouter un dossier à une colonne de priorité)
export async function tousDossiers() {
  const snap = await snapshot();
  return snap.items.filter((x) => x.meta?.role === 'dossier')
    .map((x) => ({ id: x.item.id, titre: x.meta.titre, pilote: x.meta.pilote, priorite: x.meta.priorite || '—' }));
}
export async function enregistrerOrdre2(col, ids) {
  await board().setAppData(`ordre2_${col}`, ids);
  await layout({ pilotes: new Set() });
}
// Ajout depuis la recherche : le dossier arrive en BAS de la colonne (l'ordre affiché devient l'ordre manuel)
export async function ajouterEnFin(id, col) {
  const actuels = (await dossiersZone2(col)).map((x) => x.id).filter((x) => x !== id);
  await board().setAppData(`ordre2_${col}`, [...actuels, id]);
  const item = await board().getById(id);
  await setMeta(item, { ...(await metaOf(item)), priorite: col, maj: new Date().toISOString() });
  await layout({ pilotes: new Set() });
}
export async function changerPriorite(id, col) {
  const item = await board().getById(id);
  await setMeta(item, { ...(await metaOf(item)), priorite: col, maj: new Date().toISOString() });
  await layout({ pilotes: new Set() });
}
async function layoutZone2(snap, f1, vivants, dossiers, H, top1) {
  let f = findFrame(snap.frames, 'Gestion des priorités');
  if (!f) {
    f = await board().createFrame({ title: ZONE2_TITLE, width: 1600, height: H, style: { fillColor: '#ffffff' },
      x: f1.x + f1.width / 2 + 200 + G.frameW / 2, y: top1 + H / 2 });
  }
  if (H > f.height) { try { await resizeFrame(f, f.width, H, top1); } catch (e) { console.warn(e); } }
  const dans = vivants.filter((x) => inFrame(f, x.item));
  for (const p of COLONNES_PRIO) {
    for (const role of ['bg2', 'hdr2']) {
      if (dans.some((x) => x.meta.role === role && x.meta.col === p)) continue;
      const it = await creer(f, 'shape', { shape: 'rectangle', content: '', width: 200, height: role === 'bg2' ? 200 : G.hdrH,
        style: role === 'bg2' ? { fillColor: GRIS_FOND, borderOpacity: 0 }
          : { fillColor: p === 'Autres' ? '#6b6f76' : BLEU, color: '#ffffff', fontSize: 24, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle', borderOpacity: 0 } },
      { role, col: p });
      if (role === 'bg2') await board().sendToBack(it).catch(() => {});
      dans.push({ item: it, meta: cache.get(it.id) });
    }
  }
  const cartes = dans.filter((x) => x.meta.role === 'prio');
  const parRef = new Map(cartes.map((x) => [x.meta.ref, x]));
  const colW = G2.cardW + 2 * G2.cardPad;
  const W2 = 2 * G.margin + 4 * colW + 3 * G2.colGap;
  const relX = (it) => (it.relativeTo === 'parent_top_left' ? it.x : it.x - (f.x - f.width / 2));
  const GEO2 = `${colW}|${G2.colGap}|${G.margin}`;   // signature de la grille courante
  const colOf = (rx) => COLONNES_PRIO[Math.max(0, Math.min(3, Math.floor((rx - G.margin) / (colW + G2.colGap))))];

  // 1. glisser-déposer : carte déplacée dans une autre colonne -> nouvelle priorité de la fiche
  for (const d of dossiers) {
    const c = parRef.get(d.item.id);
    if (!c || c.meta.geo !== GEO2) continue;          // grille changée : ce n'est pas un glissement
    const col = colOf(relX(c.item));
    if (col !== c.meta.col && col !== d.meta.priorite) {
      d.meta = { ...d.meta, priorite: col, maj: new Date().toISOString() };
      await setMeta(d.item, d.meta);
    }
  }
  // 1 bis. colonne pleine : la dernière carte bascule dans la colonne suivante (P1 → P2 → P3 → Autres) ;
  // la priorité de la fiche est mise à jour. Au-delà de la colonne « Autres » : indicateur « +n ».
  const basZ2 = H - G.margin;
  const hCarte = (d) => parRef.get(d.item.id)?.item.height || 88;
  const man2 = Object.fromEntries(await Promise.all(COLONNES_PRIO.map(async (p) => [p, await ordreManuel2(p)])));
  const tri2 = (a, b) => triZone2(a, b, man2[a.meta.priorite] || []);
  const capacite = (list) => {
    let y = G2.top + 12, n = 0;
    for (const d of list) { const h = hCarte(d); if (y + h > basZ2) break; y += h + G2.gap; n++; }
    return n;
  };
  for (let k = 0; k < COLONNES_PRIO.length - 1; k++) {
    const list = dossiers.filter((d) => d.meta.priorite === COLONNES_PRIO[k]).sort(tri2);
    for (const d of list.slice(capacite(list))) {
      d.meta = { ...d.meta, priorite: COLONNES_PRIO[k + 1], maj: new Date().toISOString() };
      await setMeta(d.item, d.meta);
    }
  }
  // 2. cartes : création / mise à jour si changement / suppression des orphelines
  const prio = dossiers.filter((d) => COLONNES_PRIO.includes(d.meta.priorite));
  const garder = new Set();
  for (const d of prio) {
    const data = cardData2(d.meta);
    const sig = JSON.stringify([data, d.meta.priorite]);
    let c = parRef.get(d.item.id);
    if (!c) {
      const it = await creer(f, 'card', { ...data, width: G2.cardW }, { role: 'prio', ref: d.item.id, col: d.meta.priorite, sig, geo: GEO2 });
      c = { item: it, meta: cache.get(it.id), neuf: true };
    } else if (c.meta.sig !== sig) {
      c.item.title = data.title; c.item.style = { ...c.item.style, ...data.style }; c.item.fields = data.fields;
      await setMeta(c.item, { ...c.meta, col: d.meta.priorite, sig, geo: GEO2 });
      c.modifie = true;
    } else if (c.meta.geo !== GEO2 || c.meta.col !== d.meta.priorite) {
      await setMeta(c.item, { ...c.meta, col: d.meta.priorite, geo: GEO2 });
    }
    d.carte2 = c;
    garder.add(c.item.id);
  }
  await Promise.all(cartes.filter((x) => !garder.has(x.item.id)).map((x) => remove(x.item)));
  // anciennes croix ✕ posées sur les cartes (v32) : supprimées, le retrait se fait depuis le panneau
  await Promise.all(dans.filter((x) => x.meta.role === 'x2').map((x) => remove(x.item)));

  // 3. décor + rangement (2 cartes par ligne, tri par enjeu puis échéance)
  const syncs = [];
  const push = (p) => { if (p) syncs.push(p); };
  for (const [k, p] of COLONNES_PRIO.entries()) {
    const left = G.margin + k * (colW + G2.colGap);
    const list = prio.filter((d) => d.meta.priorite === p).sort(tri2);
    for (const x of dans) {
      if (x.meta.col !== p) continue;
      if (x.meta.role === 'bg2') { const h = H - G2.top - G.margin + G.hdrH; push(update(x.item, f, left + colW / 2, G2.top - G.hdrH + h / 2, { width: colW, height: h })); }
      if (x.meta.role === 'hdr2') push(update(x.item, f, left + colW / 2, G2.top - G.hdrH / 2, { width: colW, height: G.hdrH, content: `<p><strong>${LIBELLE_PRIO[p]} · ${list.length}</strong></p>` }));
    }
    let y = G2.top + 12, visibles = 0;                // empilement selon la hauteur réelle, espace constant
    await largeurCartes(list.map((d) => d.carte2.item), G2.cardW, f);
    for (const d of list) {
      const it = d.carte2.item;
      const h = it.height || 88;
      const tient = y + h <= basZ2;
      const pr = update(it, f, left + G2.cardPad + G2.cardW / 2, tient ? y + h / 2 : basZ2 - h / 2);   // au-delà : empilées en bas
      if (tient) { y += h + G2.gap; visibles++; }
      if (pr) push(pr); else if (d.carte2.modifie) push(syncSur(it, f));
    }
    // indicateur « +n » (en pratique, seule la colonne « Autres » peut encore déborder)
    let ovf = dans.find((x) => x.meta.role === 'ovf2' && x.meta.col === p)?.item;
    const n = list.length - visibles;
    if (n > 0) {
      if (!ovf) ovf = await creer(f, 'shape', { shape: 'round_rectangle', content: '', width: 70, height: 30,
        style: { fillColor: '#c8341f', color: '#ffffff', fontSize: 14, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle', borderOpacity: 0 } }, { role: 'ovf2', col: p });
      push(update(ovf, f, left + colW - 45, basZ2 - 18, { content: `<p><strong>+${n}</strong></p>` }));
      await board().bringToFront(ovf).catch(() => {});
    } else if (ovf) push(remove(ovf));
  }
  await Promise.all(syncs);
  try { await resizeFrame(f, W2, H, top1, f1.x + f1.width / 2 + 200); } catch (e) { console.warn('Réduction du cadre 2 reportée', e); }
  return f;
}

// ── Zone 3 : charge plans + devis par avant-vente × horizon d'échéance (généré, non éditable) ──
function semaineISO(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const debut = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() * 53 + Math.ceil(((t - debut) / 86400000 + 1) / 7);
}
// 0 = cette semaine (échéances dépassées comprises), 1 = plus tard ; sans échéance : P1 -> cette semaine
function horizon(t) {
  if (t.echeance) return semaineISO(new Date(t.echeance)) - semaineISO(new Date()) <= 0 ? 0 : 1;
  return t.priorite === 'P1' ? 0 : 1;
}

// Ordre manuel par avant-vente (enregistré sur le board) : liste de clés de tâches
const cleTache = (dossierId, av, livrable) => `${dossierId}|${av}|${livrable}`;
const cleRenommee = (k) => { const i = k.lastIndexOf('|'); return i < 0 ? k : k.slice(0, i + 1) + nomLivrable(k.slice(i + 1)); };
const renommeCle = (c) => (typeof c === 'string' ? cleRenommee(c) : c && c.key ? { ...c, key: cleRenommee(c.key) } : c);
async function ordreBrut(av) { return ((await board().getAppData(`ordre_${av}`).catch(() => null)) || []).map(renommeCle); }
// clés dans l'ordre manuel (les entrées peuvent être des chaînes ou des objets { key, r })
async function ordreManuel(av) { return (await ordreBrut(av)).map((e) => (typeof e === 'string' ? e : e.key)); }
// lignes forcées à la main : clé -> 0 / 1 / 2
async function lignesForcees(av) {
  const m = new Map();
  for (const e of await ordreBrut(av)) if (e && typeof e === 'object' && Number.isInteger(e.r)) m.set(e.key, Math.min(e.r, HORIZONS.length - 1));
  return m;
}
const rangPrio = (p) => ({ P1: 0, P2: 1, P3: 2 }[p] ?? 3);
const ordreAuto = (a, b) => (a.t.echeance || '9').localeCompare(b.t.echeance || '9')
  || rangPrio(a.t.priorite) - rangPrio(b.t.priorite) || ordreEnjeu(a.d.meta.enjeu) - ordreEnjeu(b.d.meta.enjeu);
function trier(list, manuel) {
  const idx = (c) => { const i = manuel.indexOf(c.key); return i < 0 ? Infinity : i; };
  return list.sort((a, b) => {
    if (!!a.t.fait !== !!b.t.fait) return a.t.fait ? 1 : -1;      // ce qui est fait descend en bas
    const ia = idx(a), ib = idx(b);
    if (ia !== ib) return ia === Infinity ? 1 : ib === Infinity ? -1 : ia - ib;
    return ordreAuto(a, b);
  });
}

// Liste des tâches d'un avant-vente (panneau « ordre de traitement »)
export async function tachesAV(av) {
  const snap = await snapshot();
  const manuel = await ordreManuel(av);
  const forcees = await lignesForcees(av);
  const list = [];
  for (const d of snap.items.filter((x) => x.meta?.role === 'dossier')) {
    for (const t of tachesDe(d.meta)) {
      if (t.ressource !== av) continue;
      const key = cleTache(d.item.id, av, t.livrable);
      const rAuto = horizon(t);
      list.push({ d, t, key, rAuto, r: forcees.has(key) ? forcees.get(key) : rAuto });
    }
  }
  trier(list, manuel);
  list.sort((a, b) => a.r - b.r);   // regroupé par horizon (tri stable : l'ordre est conservé dans chaque groupe)
  return list.map((c) => ({ key: c.key, titre: c.d.meta.titre, pilote: c.d.meta.pilote, livrable: c.t.livrable,
    echeance: c.t.echeance, r: c.r, rAuto: c.rAuto, fait: !!c.t.fait, dossierId: c.d.item.id }));
}
// Pointage par l'avant-vente : tâche faite / à faire
export async function marquerFait(dossierId, av, livrable, fait) {
  const item = await board().getById(dossierId);
  const m = { ...(await metaOf(item)) };
  m.taches = tachesDe(m).map((t) => (t.ressource === av && t.livrable === livrable
    ? { ...t, fait, faitLe: fait ? new Date().toISOString().slice(0, 10) : null } : t));
  m.maj = new Date().toISOString();
  await setMeta(item, m);
  await layout({ pilotes: new Set() });
}
// Croix de la zone 2 : retire le dossier des priorités (priorité « — ») et supprime ses actions avant-vente
export async function retirerZone2(dossierId) {
  const item = await board().getById(dossierId);
  const m = { ...(await metaOf(item)), priorite: '—', taches: [], maj: new Date().toISOString() };
  delete m.ressource; delete m.livrables; delete m.echeance;          // anciens champs (avant les tâches)
  await setMeta(item, m);
  await layout({ pilotes: new Set([m.pilote]) });
}
export async function enregistrerOrdreAV(av, cles) {
  await board().setAppData(`ordre_${av}`, cles);
  await layout({ pilotes: new Set() });
}

async function layoutZone3(snap, f2, vivants, dossiers, H, top1) {
  let f = findFrame(snap.frames, 'Charge');
  if (f && f.title !== ZONE3_TITLE) { f.title = ZONE3_TITLE; await f.sync().catch(() => {}); }
  if (!f) {
    f = await board().createFrame({ title: ZONE3_TITLE, width: G.frameW, height: H, style: { fillColor: '#ffffff' },
      x: f2.x + f2.width / 2 + 200 + G.frameW / 2, y: top1 + H / 2 });
  }
  if (H > f.height) { try { await resizeFrame(f, f.width, H, top1); } catch (e) { console.warn(e); } }
  const NH = HORIZONS.length;
  // une seule colonne de cartes par avant-vente : largeur du cadre ajustée au contenu
  const colW = G3.cardW + 2 * G3.cardPad;
  const W = 2 * G.margin + G3.labelW + RESSOURCES.length * (colW + G3.colGap);
  const colX = (j) => G.margin + G3.labelW + G3.colGap + j * (colW + G3.colGap);
  const rowH = (H - G3.top - G.margin - (NH - 1) * G3.rowGap) / NH;
  const rowY = (r) => G3.top + r * (rowH + G3.rowGap);
  const capacite = Math.max(1, Math.floor((rowH - 16) / G3.rowStep));
  // décor d'horizons supprimés (ancienne grille à 4 lignes)
  const perimes = vivants.filter((x) => inFrame(f, x.item) && ['lab3', 'bg3', 'ovf3'].includes(x.meta.role) && x.meta.r >= NH);
  await Promise.all(perimes.map((x) => remove(x.item)));
  const dans = vivants.filter((x) => inFrame(f, x.item) && !perimes.includes(x));

  // décor manquant
  const decor = [];
  RESSOURCES.forEach((av) => decor.push({ role: 'hdr3', av }));
  HORIZONS.forEach((h, r) => decor.push({ role: 'lab3', r }));
  RESSOURCES.forEach((av) => HORIZONS.forEach((h, r) => decor.push({ role: 'bg3', av, r })));
  for (const d of decor) {
    if (dans.some((x) => x.meta.role === d.role && x.meta.av === d.av && x.meta.r === d.r)) continue;
    const style = d.role === 'hdr3' ? { fillColor: BLEU, color: '#ffffff', fontSize: 20, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle', borderOpacity: 0 }
      : d.role === 'lab3' ? { fillColor: '#ffffff', color: BLEU, fontSize: 18, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle', borderColor: BLEU, borderWidth: 2, borderOpacity: 1 }
        : { fillColor: GRIS_FOND, borderOpacity: 0 };
    const it = await creer(f, 'shape', { shape: 'rectangle', content: d.role === 'lab3' ? `<p><strong>${HORIZONS[d.r]}</strong></p>` : '', width: 100, height: 60, style }, d);
    if (d.role === 'bg3') await board().sendToBack(it).catch(() => {});
    dans.push({ item: it, meta: cache.get(it.id) });
  }

  // cartes cibles : un reflet par (dossier, avant-vente) qui attend un plan et/ou un devis
  const cibles = [];
  const forceesParAV = Object.fromEntries(await Promise.all(RESSOURCES.map(async (a) => [a, await lignesForcees(a)])));
  const compte = Object.fromEntries(RESSOURCES.map((a) => [a, { plans: 0, devis: 0, actions: 0 }]));
  for (const d of dossiers) {
    for (const t of tachesDe(d.meta)) {
      const av = t.ressource;
      if (!RESSOURCES.includes(av)) continue;                // toute action d'une ressource avant-vente
      const k0 = cleTache(d.item.id, av, t.livrable);
      const r = forceesParAV[av].has(k0) ? forceesParAV[av].get(k0) : horizon(t);   // ligne forcée à la main
      if (r >= NH) continue;                         // au-delà de S+1 : pas affiché
      cibles.push({ d, t, av, r, livr: [t.livrable], key: cleTache(d.item.id, av, t.livrable) });
      compte[av].actions++;
      if (LIVRABLES_PLAN.includes(t.livrable)) compte[av].plans++;
      if (LIVRABLES_DEVIS.includes(t.livrable)) compte[av].devis++;
    }
  }
  const exist = new Map(dans.filter((x) => x.meta.role === 'av').map((x) => [x.meta.key, x]));
  const garder = new Set();
  for (const c of cibles) {
    const m = c.d.meta;
    const fields = [...(c.t.fait ? [{ value: '✓ Fait', fillColor: '#1e8e4e', textColor: '#ffffff' }] : []),
      { value: m.pilote, fillColor: BLEU, textColor: '#ffffff' },
      ...c.livr.filter(Boolean).map((l) => ({ value: l, fillColor: '#e3f4d6', textColor: '#245c12' }))];
    const a = alerte(c.t.echeance);
    if (a) fields.push(a);
    const coche = c.t.fait ? '✓ ' : '';
    const data = { title: coche + esc(tronque(m.titre, G3.titreMax - coche.length)),
      style: { cardTheme: c.t.fait ? '#1e8e4e' : theme(m) }, fields };
    const sig = JSON.stringify(data);
    let x = exist.get(c.key);
    if (!x) {
      const it = await creer(f, 'card', { ...data, width: G3.cardW }, { role: 'av', key: c.key, ref: c.d.item.id, sig });
      x = { item: it, meta: cache.get(it.id) };
    } else if (x.meta.sig !== sig) {
      x.item.title = data.title; x.item.style = { ...x.item.style, ...data.style }; x.item.fields = data.fields;
      await setMeta(x.item, { ...x.meta, sig });
      x.modifie = true;
    }
    c.x = x;
    garder.add(x.item.id);
  }
  await Promise.all(dans.filter((x) => x.meta.role === 'av' && !garder.has(x.item.id)).map((x) => remove(x.item)));

  // rangement
  const syncs = [];
  const push = (p) => { if (p) syncs.push(p); };
  const debordements = new Map(dans.filter((x) => x.meta.role === 'ovf3').map((x) => [`${x.meta.av}|${x.meta.r}`, x.item]));
  for (const x of dans) {
    const m = x.meta;
    if (m.role === 'hdr3') {
      const j = RESSOURCES.indexOf(m.av), k = compte[m.av];
      push(update(x.item, f, colX(j) + colW / 2, G3.top - G.hdrH / 2 - 8, { width: colW, height: G.hdrH,
        content: `<p><strong>${m.av}</strong> · ${k.actions} action${k.actions > 1 ? 's' : ''} (${k.plans} plan${k.plans > 1 ? 's' : ''} · ${k.devis} devis)</p>` }));
    }
    if (m.role === 'lab3') push(update(x.item, f, G.margin + G3.labelW / 2, rowY(m.r) + rowH / 2, { width: G3.labelW, height: rowH,
      content: `<p><strong>${HORIZONS[m.r]}</strong></p>` }));
    if (m.role === 'bg3') push(update(x.item, f, colX(RESSOURCES.indexOf(m.av)) + colW / 2, rowY(m.r) + rowH / 2, { width: colW, height: rowH }));
  }
  // ordre de traitement : ordre manuel s'il existe, sinon échéance, priorité de la ligne, enjeu
  const manuels = Object.fromEntries(await Promise.all(RESSOURCES.map(async (a) => [a, await ordreManuel(a)])));
  const s2 = [];
  for (const [j, av] of RESSOURCES.entries()) {
    for (let r = 0; r < NH; r++) {
      const list = trier(cibles.filter((c) => c.av === av && c.r === r), manuels[av]);
      const pad = G3.cardPad;
      let y = rowY(r) + 8, visibles = 0;
      await largeurCartes(list.map((c) => c.x.item), G3.cardW, f);
      list.forEach((c) => {
        const h = c.x.item.height || 88;
        const tient = y + h <= rowY(r) + rowH - 8;
        if (tient) visibles++;
        const rx = colX(j) + pad + G3.cardW / 2;
        const ry = tient ? y + h / 2 : rowY(r) + rowH - 8 - h / 2;   // au-delà : empilées en bas de case
        if (tient) y += h + G3.gap;
        const p = update(c.x.item, f, rx, ry);
        if (p) push(p); else if (c.x.modifie) push(syncSur(c.x.item, f));
      });
      // indicateur « +n » si la case déborde
      const cle = `${av}|${r}`;
      let ovf = debordements.get(cle);
      debordements.delete(cle);
      const n = list.length - visibles;
      if (n > 0) {
        if (!ovf) ovf = await creer(f, 'shape', { shape: 'round_rectangle', content: '', width: 70, height: 30,
          style: { fillColor: '#c8341f', color: '#ffffff', fontSize: 14, fontFamily: 'open_sans', textAlign: 'center', textAlignVertical: 'middle', borderOpacity: 0 } }, { role: 'ovf3', av, r });
        const p = update(ovf, f, colX(j) + colW - 45, rowY(r) + rowH - 22, { content: `<p><strong>+${n}</strong></p>` });
        if (p) s2.push(p);
      } else if (ovf) s2.push(remove(ovf));
    }
  }
  await Promise.all([...syncs, ...s2, ...[...debordements.values()].map(remove)]);
  try { await resizeFrame(f, W, H, top1, f2.x + f2.width / 2 + 200); } catch (e) { console.warn('Réduction du cadre 3 reportée', e); }
  return f;
}


// ══ ZONE 4 : TABLEAU DE CHASSE (trimestre en cours + suivant) ══
// Montants et statuts relus dans jCRM par le script local scripts/miro_tableau_chasse_jcrm.py :
// l'app publie la liste des n° jCRM à suivre (texte « PBH-IDS »), le script répond (texte « PBH-JCRM »).
export function trimestreDe(d = new Date()) { return `T${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`; }
export function trimestresAffiches() {
  const d = new Date();
  const t = Math.floor(d.getMonth() / 3);
  return [trimestreDe(d), t === 3 ? `T1 ${d.getFullYear() + 1}` : `T${t + 2} ${d.getFullYear()}`];
}
const rangTrim = (q) => { const m = /T(\d) (\d{4})/.exec(q || ''); return m ? Number(m[2]) * 4 + Number(m[1]) : 0; };
const keur = (v) => `${Math.round(v).toLocaleString('fr-FR')} k€`;
const meur = (v) => `${(v / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M€`;
const jj = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
// Suivi affiché : le commentaire saisi sur la fiche, sauf si jCRM porte une action plus récente
function suiviCourant(manuel, action) {
  if (!action) return manuel || null;
  const [ya, ma, ja] = action.date.split('-').map(Number);
  const da = new Date(ya, ma - 1, ja);
  const md = /\((\d{2})\/(\d{2})\)\s*$/.exec(manuel || '');
  if (md) {
    const now = new Date();
    let dm = new Date(now.getFullYear(), Number(md[2]) - 1, Number(md[1]));
    if (dm > now) dm = new Date(now.getFullYear() - 1, Number(md[2]) - 1, Number(md[1]));
    if (dm >= da) return manuel;
  }
  return `${action.texte} (${String(ja).padStart(2, '0')}/${String(ma).padStart(2, '0')})`;
}
// Données jCRM déposées par le script (texte « PBH-JCRM ») : lues, gardées dans les données de l'app,
// puis le texte est supprimé du board (il ne sert que de boîte aux lettres).
async function lireJcrm(items) {
  const t = items.find((x) => x.item.type === 'text' && (x.item.content || '').includes('PBH-JCRM'));
  let brut;
  if (t) {
    brut = t.item.content.replace(/<[^>]+>/g, ' ');
    try { await board().setAppData('jcrm', brut); await remove(t.item); } catch (e) { console.warn('PBH-JCRM', e); }
  } else brut = await board().getAppData('jcrm').catch(() => null);
  if (!brut) return { data: new Map(), maj: null };
  const maj = (/maj (\d{2}\/\d{2} \d{2}:\d{2})/.exec(brut) || [])[1] || null;
  const data = new Map();
  for (const m of brut.matchAll(/(\d+):([\d.]*):([A-Z?]):(\d{4}-\d{2}-\d{2})?(?::(\d{4}-\d{2})?)?(?::(\d{4}-\d{2}-\d{2})?:([^;\s<]*))?/g)) {
    let texte = null;
    try { texte = m[7] ? decodeURIComponent(m[7]) : null; } catch (e) { /* texte illisible */ }
    data.set(m[1], { montant: m[2] === '' ? null : Number(m[2]), statut: m[3], signeLe: m[4] || null, chantier: m[5] || null,
      action: m[6] && texte ? { date: m[6], texte } : null });
  }
  return { data, maj };
}

async function layoutZone4(snap, f3, vivants, dossiers, H, top1) {
  const quarts = trimestresAffiches();
  const TW = G4.cols.reduce((a, b) => a + b, 0);
  const W = 2 * G.margin + TW;
  let f = findFrame(snap.frames, 'Tableau de chasse');
  if (!f) {
    f = await board().createFrame({ title: ZONE4_TITLE, width: W, height: H, style: { fillColor: '#ffffff' },
      x: f3.x + f3.width / 2 + 200 + W / 2, y: top1 + H / 2 });
  }
  const dans = vivants.filter((x) => inFrame(f, x.item));
  const { data: jcrm, maj } = await lireJcrm(snap.items.filter((x) => inFrame(f, x.item)));

  // dossiers du tableau, par trimestre visé (un trimestre passé glisse dans le trimestre en cours)
  const blocs = quarts.map(() => []);
  for (const d of dossiers.filter((x) => x.meta.chasse)) {
    let k = quarts.indexOf(d.meta.chasseTrim || quarts[0]);
    let glisse = null;
    const j0 = d.meta.jcrm ? jcrm.get(String(d.meta.jcrm)) : null;
    if (j0?.statut === 'G' && j0.signeLe) {                 // signée : rangée dans le trimestre de signature
      k = quarts.indexOf(trimestreDe(new Date(j0.signeLe)));
      if (k < 0) continue;                                   // signée sur un trimestre passé : hors tableau
    } else if (k < 0 && rangTrim(d.meta.chasseTrim) < rangTrim(quarts[0])) { k = 0; glisse = d.meta.chasseTrim; }
    if (k < 0) continue;
    blocs[k].push({ d, glisse, j: d.meta.jcrm ? jcrm.get(String(d.meta.jcrm)) : null });
  }
  blocs.forEach((b) => b.sort((a, c) => (c.j?.montant || 0) - (a.j?.montant || 0)));

  // hauteur du cadre : 2 tableaux empilés (bords hauts alignés sur les autres zones)
  const hBloc = (n) => G4.bandeauH + G4.enteteH + Math.max(1, n) * G4.ligneH;
  const Hz = Math.max(H, G4.top + hBloc(blocs[0].length) + G4.blocGap + hBloc(blocs[1].length) + 60);
  // élargir / agrandir AVANT de placer les cellules (Miro refuse un objet hors de son cadre)
  if (Hz > f.height || W > f.width) { try { await resizeFrame(f, Math.max(f.width, W), Math.max(f.height, Hz), top1); } catch (e) { console.warn(e); } }

  // index des objets existants (clé logique -> objet)
  const exist = new Map(dans.filter((x) => x.meta.k4).map((x) => [x.meta.k4, x.item]));
  const garder = new Set();
  const syncs = [];
  const push = (p) => { if (p) syncs.push(p); };
  async function cellule(cle, meta, rx, ry, w, h, contenu, style) {
    let it = exist.get(cle);
    if (!it) {
      it = await creer(f, 'shape', { shape: 'rectangle', content: contenu, width: w, height: h, style }, { ...meta, k4: cle });
    }
    garder.add(it.id);
    const cur = it.style || {};
    const restyle = (cur.fillColor || '').toLowerCase() !== (style.fillColor || '').toLowerCase()
      || (cur.color || '').toLowerCase() !== (style.color || '').toLowerCase();
    push(update(it, f, rx, ry, { width: w, height: h, content: contenu, ...(restyle ? { style } : {}) }));
  }
  const base = { fontFamily: 'open_sans', textAlignVertical: 'middle', borderOpacity: 0 };
  const xCol = (i) => G.margin + G4.cols.slice(0, i).reduce((a, b) => a + b, 0);

  let y = G4.top;
  for (let k = 0; k < 2; k++) {
    const q = quarts[k], list = blocs[k];
    const actifs = list.filter((c) => c.j?.statut !== 'P');
    const total = actifs.reduce((s, c) => s + (c.j?.montant || 0), 0);
    const signe = actifs.filter((c) => c.j?.statut === 'G').reduce((s, c) => s + (c.j?.montant || 0), 0);
    const obj = OBJECTIF_TRIM[q.slice(-4)] || 2750;
    const nbS = actifs.filter((c) => c.j?.statut === 'G').length;
    const bandeau = `<p><strong>${q} · ${meur(total)} ciblés / objectif ${meur(obj)} (${Math.round((100 * total) / obj)} %) · ${actifs.length} affaire${actifs.length > 1 ? 's' : ''}</strong></p>`
      + `<p>déjà signé ${keur(signe)} (${nbS})${maj ? ` · montants jCRM du ${maj}` : ''}</p>`;
    await cellule(`b${k}`, { role: 'ch4' }, W / 2, y + G4.bandeauH / 2 - 6, TW, G4.bandeauH - 12, bandeau,
      { ...base, fillColor: BLEU, color: '#ffffff', fontSize: 18, textAlign: 'center' });
    y += G4.bandeauH;
    const titres = ['Affaire', 'Pilote', 'Suivi / échéance annoncée', 'Montant (k€)'];
    for (let i = 0; i < 4; i++) {
      await cellule(`e${k}${i}`, { role: 'ch4' }, xCol(i) + G4.cols[i] / 2, y + G4.enteteH / 2, G4.cols[i], G4.enteteH,
        `<p><strong>${titres[i]}</strong></p>`, { ...base, fillColor: '#dfe5f0', color: BLEU, fontSize: 12, textAlign: i === 3 ? 'right' : i === 1 ? 'center' : 'left' });
    }
    y += G4.enteteH;
    if (!list.length) {
      await cellule(`v${k}`, { role: 'ch4' }, W / 2, y + G4.ligneH / 2, TW, G4.ligneH,
        '<p><em>Aucune affaire : cocher « Dans le tableau de chasse » sur une fiche.</em></p>', { ...base, fillColor: '#ffffff', color: '#9aa0a6', fontSize: 14, textAlign: 'center' });
      y += G4.ligneH;
    }
    const rowP = [];
    list.forEach((c, n) => {
      const m = c.d.meta, sg = c.j?.statut === 'G', perdu = c.j?.statut === 'P';
      const fond = n % 2 ? '#f6f8fb' : '#ffffff';
      const coul = sg ? '#1e8e4e' : perdu ? '#c8341f' : '#1a1a1a';
      let suivi;
      if (sg) suivi = `Signé le ${jourLong(c.j.signeLe)}`;
      else if (perdu) suivi = 'Perdu';
      else {
        const morceaux = [suiviCourant(m.suivi, c.j?.action), c.j?.chantier ? `chantier ${moisLong(c.j.chantier)}` : null,
          c.glisse ? `visé ${c.glisse}` : null, !m.jcrm ? 'n° jCRM à renseigner' : null].filter(Boolean);
        suivi = morceaux.join(' · ');
      }
      const montant = c.j?.montant != null ? Math.round(c.j.montant).toLocaleString('fr-FR') : '—';
      const cells = [`<p><strong>${esc(m.titre)}</strong></p>`, `<p>${m.pilote}</p>`,
        sg || perdu ? `<p>${suivi}</p>` : `<p><em>${esc(suivi)}</em></p>`, `<p>${montant}</p>`];
      const ry = y + n * G4.ligneH + G4.ligneH / 2;
      // (les cellules ouvrent la fiche du dossier au clic : métadonnée « ref »)
      cells.forEach((html, i) => rowP.push(cellule(`r${c.d.item.id}_${i}`, { role: 'ch4', ref: c.d.item.id },
        xCol(i) + G4.cols[i] / 2, ry, G4.cols[i], G4.ligneH, html,
        { ...base, fillColor: fond, color: i === 2 && !sg && !perdu ? '#6b6f76' : coul, fontSize: 11,
          textAlign: i === 3 ? 'right' : i === 1 ? 'center' : 'left' })));
    });
    await Promise.all(rowP);
    y += list.length * G4.ligneH + G4.blocGap;
  }
  await Promise.all(syncs);
  // registre des n° jCRM à relire (pour le script)
  const ids = [...new Set(dossiers.filter((x) => x.meta.chasse && x.meta.jcrm).map((x) => String(x.meta.jcrm)))].sort();
  const registre = `<p>PBH-IDS (n° jCRM du tableau de chasse, lu par le script — ne pas modifier) : ${ids.join(',')}</p>`;
  let reg = dans.find((x) => x.meta.role === 'ids4');
  if (!reg) {
    const it = await board().createText({ content: registre, x: f.x, y: f.y, width: TW, style: { fontSize: 10, color: '#9aa0a6' } });
    await setMeta(it, { role: 'ids4' });
    await addToFrame(f, it);
    reg = { item: await board().getById(it.id) };
  }
  const hFinal = Math.max(H, y + 40);
  const fin = [update(reg.item, f, W / 2, 40, { content: registre })];   // en haut du cadre, toujours dedans
  // anciens objets (cartes de la v22, lignes d'affaires sorties du tableau)
  const perimes = dans.filter((x) => (x.meta.role === 'chasse' || x.meta.role === 'bg4' || x.meta.role === 'hdr4'
    || (x.meta.k4 && !garder.has(x.item.id))));
  await Promise.all([...fin, ...perimes.map((x) => remove(x.item))]);
  try { await resizeFrame(f, W, hFinal, top1, f3.x + f3.width / 2 + 200); } catch (e) { console.warn('Cadre 4', e); }
}
const MOIS_LONG = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jourLong = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MOIS_LONG[Number(iso.slice(5, 7)) - 1]}` : '');
const moisLong = (ym) => `${MOIS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export async function stats() {
  const snap = await snapshot();
  const d = snap.items.filter((x) => x.meta?.role === 'dossier');
  return PILOTES.map((p) => ({ code: p.code, n: d.filter((x) => x.meta.pilote === p.code).length }));
}
