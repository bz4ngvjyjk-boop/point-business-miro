// Moteur de l'app « Point business hebdo ».
// Source de vérité = métadonnées de l'app (clé META) posées sur chaque pastille dossier (zone 1).
// Les zones 2 et 3 sont des reflets recalculés à partir de ces fiches.
//
// Performance : les métadonnées sont lues une seule fois puis gardées en mémoire (cache) tant que
// le panneau est ouvert ; un rangement ne synchronise que les objets réellement modifiés.
import {
  PILOTES, ENJEUX, CARSAT, BLEU, OR, GRIS_FOND, G, G2, G3, ZONE1_TITLE, ZONE2_TITLE, ZONE3_TITLE,
  COLONNES_PRIO, LIBELLE_PRIO, RESSOURCES, HORIZONS, LIVRABLES_PLAN, LIVRABLES_DEVIS, META,
} from './config.js?v=13';

const board = () => miro.board;
const enjeu = (code) => ENJEUX.find((e) => e.code === code) || ENJEUX[4];
const ordreEnjeu = (c) => ENJEUX.findIndex((e) => e.code === c);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (v) => Math.round(v);
const tronque = (t, n) => (t.length > n ? t.slice(0, Math.max(1, n - 1)).trimEnd() + '…' : t);

// ── Tâches avant-vente : [{ ressource, livrable, priorite, echeance }] ──
// Les anciennes fiches (ressource[] + livrables[] + echeance) sont converties à la lecture.
export function tachesDe(m) {
  if (Array.isArray(m.taches)) return m.taches;
  const L = m.livrables || [];
  const liv = L.includes('plan + devis') || (L.includes('plan') && L.includes('devis')) ? 'plan + devis'
    : L.includes('plan') ? 'plan' : L.includes('devis') ? 'devis' : (L[0] || '');
  const res = (m.ressource || []).length ? m.ressource : (liv ? [''] : []);
  return res.map((r) => ({ ressource: r, livrable: liv, priorite: m.priorite && m.priorite !== 'Autres' ? m.priorite : '—', echeance: m.echeance || null }));
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
  const [shapes, cards, frames] = await Promise.all([
    board().get({ type: 'shape' }), board().get({ type: 'card' }), board().get({ type: 'frame' })]);
  const items = [...shapes, ...cards];
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
  const snap = await snapshot();
  const f1 = findFrame(snap.frames, 'Avancement avant-vente');
  if (!f1) return null;

  // Nettoyage : objets du cadre 1 sans fiche (écriture interrompue)
  const orphelins = snap.items.filter((x) => !x.meta && x.item.type === 'shape' && inFrame(f1, x.item));
  for (const o of orphelins) await remove(o.item);
  const vivants = snap.items.filter((x) => x.meta);
  const dossiers = vivants.filter((x) => x.meta.role === 'dossier');
  await restaurerPriorites(dossiers);

  const H = await layoutZone1(f1, vivants, dossiers, pilotes);
  const top1 = f1.y - f1.height / 2;
  const f2 = await layoutZone2(snap, f1, vivants, dossiers, H, top1);
  await layoutZone3(snap, f2, vivants, dossiers, H, top1);
  return { dossiers: dossiers.length, nettoyes: orphelins.length, ms: Math.round(performance.now() - t0) };
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
  if (j < 0) return { value: 'Dépassée', fillColor: '#c8341f', textColor: '#ffffff' };
  if (j <= 15) return { value: `J-${j}`, fillColor: j <= 7 ? '#c8341f' : '#f0a020', textColor: '#ffffff' };
  return null;
}
const theme = (m) => { const e = enjeu(m.enjeu); return e.fill === '#ffffff' ? '#9aa0a6' : e.fill; };
const echTxt = (m) => { const e = echeanceMin(m); return e ? ` · éch. ${e.slice(8, 10)}/${e.slice(5, 7)}` : ''; };
function cardData2(m) {
  const fields = tachesDe(m).filter((t) => t.ressource || t.livrable).map((t) => ({
    value: [t.ressource, t.livrable].filter(Boolean).join(' · '), fillColor: t.ressource ? OR : '#e3f4d6', textColor: BLEU }));
  const a = alerte(echeanceMin(m));
  if (a) fields.push(a);
  if (m.carsat) fields.push({ value: 'CARSAT', fillColor: CARSAT, textColor: '#ffffff' });
  const ech = echTxt(m);
  return { title: esc(tronque(m.titre, G2.titreMax - ech.length)) + ech, style: { cardTheme: theme(m) }, fields };
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

  // 3. décor + rangement (2 cartes par ligne, tri par enjeu puis échéance)
  const syncs = [];
  const push = (p) => { if (p) syncs.push(p); };
  COLONNES_PRIO.forEach((p, k) => {
    const left = G.margin + k * (colW + G2.colGap);
    const list = prio.filter((d) => d.meta.priorite === p).sort((a, b) =>
      ordreEnjeu(a.meta.enjeu) - ordreEnjeu(b.meta.enjeu) || (echeanceMin(a.meta) || '9').localeCompare(echeanceMin(b.meta) || '9'));
    for (const x of dans) {
      if (x.meta.col !== p) continue;
      if (x.meta.role === 'bg2') { const h = H - G2.top - G.margin + G.hdrH; push(update(x.item, f, left + colW / 2, G2.top - G.hdrH + h / 2, { width: colW, height: h })); }
      if (x.meta.role === 'hdr2') push(update(x.item, f, left + colW / 2, G2.top - G.hdrH / 2, { width: colW, height: G.hdrH, content: `<p><strong>${LIBELLE_PRIO[p]} · ${list.length}</strong></p>` }));
    }
    let y = G2.top + 12;                              // empilement selon la hauteur réelle, espace constant
    list.forEach((d) => {
      const it = d.carte2.item;
      const h = it.height || 88;
      const pr = update(it, f, left + G2.cardPad + G2.cardW / 2, y + h / 2);
      y += h + G2.gap;
      if (pr) push(pr); else if (d.carte2.modifie) push(syncSur(it, f));
    });
  });
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
// 0 = cette semaine (échéances dépassées comprises), 1 = S+1, au-delà : hors zone 3
function horizon(t) {
  if (t.echeance) return Math.max(0, semaineISO(new Date(t.echeance)) - semaineISO(new Date()));
  return { P1: 0, P2: 1 }[t.priorite] ?? 9;
}

async function layoutZone3(snap, f2, vivants, dossiers, H, top1) {
  let f = findFrame(snap.frames, 'Charge plans');
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
  const compte = Object.fromEntries(RESSOURCES.map((a) => [a, { plans: 0, devis: 0 }]));
  for (const d of dossiers) {
    for (const t of tachesDe(d.meta)) {
      const av = t.ressource;
      if (!RESSOURCES.includes(av) || !(LIVRABLES_PLAN.includes(t.livrable) || LIVRABLES_DEVIS.includes(t.livrable))) continue;
      const r = horizon(t);
      if (r >= NH) continue;                         // au-delà de S+1 : pas affiché
      cibles.push({ d, t, av, r, livr: [t.livrable], key: `${d.item.id}|${av}|${t.livrable}` });
      if (LIVRABLES_PLAN.includes(t.livrable)) compte[av].plans++;
      if (LIVRABLES_DEVIS.includes(t.livrable)) compte[av].devis++;
    }
  }
  const exist = new Map(dans.filter((x) => x.meta.role === 'av').map((x) => [x.meta.key, x]));
  const garder = new Set();
  for (const c of cibles) {
    const m = c.d.meta;
    const fields = [{ value: m.pilote, fillColor: BLEU, textColor: '#ffffff' },
      ...c.livr.map((l) => ({ value: l, fillColor: '#e3f4d6', textColor: '#245c12' }))];
    if (c.t.priorite && c.t.priorite !== '—') fields.push({ value: c.t.priorite, fillColor: '#6b6f76', textColor: '#ffffff' });
    const a = alerte(c.t.echeance);
    if (a) fields.push(a);
    const ech = c.t.echeance ? ` · éch. ${c.t.echeance.slice(8, 10)}/${c.t.echeance.slice(5, 7)}` : '';
    const data = { title: esc(tronque(m.titre, G3.titreMax - ech.length)) + ech, style: { cardTheme: theme(m) }, fields };
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
        content: `<p><strong>${m.av}</strong> · ${k.plans} plan${k.plans > 1 ? 's' : ''} · ${k.devis} devis</p>` }));
    }
    if (m.role === 'lab3') push(update(x.item, f, G.margin + G3.labelW / 2, rowY(m.r) + rowH / 2, { width: G3.labelW, height: rowH }));
    if (m.role === 'bg3') push(update(x.item, f, colX(RESSOURCES.indexOf(m.av)) + colW / 2, rowY(m.r) + rowH / 2, { width: colW, height: rowH }));
  }
  const ordre = (a, b) => (a.t.echeance || '9').localeCompare(b.t.echeance || '9') || ordreEnjeu(a.d.meta.enjeu) - ordreEnjeu(b.d.meta.enjeu);
  const s2 = [];
  for (const [j, av] of RESSOURCES.entries()) {
    for (let r = 0; r < NH; r++) {
      const list = cibles.filter((c) => c.av === av && c.r === r).sort(ordre);
      const pad = G3.cardPad;
      let y = rowY(r) + 8, visibles = 0;
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
}

export async function stats() {
  const snap = await snapshot();
  const d = snap.items.filter((x) => x.meta?.role === 'dossier');
  return PILOTES.map((p) => ({ code: p.code, n: d.filter((x) => x.meta.pilote === p.code).length }));
}
