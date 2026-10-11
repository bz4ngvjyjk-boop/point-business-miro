// Moteur : création des dossiers et rangement automatique de la zone 1.
// Source de vérité = métadonnées de l'app (clé META) posées sur chaque pastille.
import { PILOTES, ENJEUX, CARSAT, BLEU, OR, GRIS_FOND, G, G2, ZONE1_TITLE, ZONE2_TITLE,
  COLONNES_PRIO, LIBELLE_PRIO, META } from './config.js';

const board = () => miro.board;
const enjeu = (code) => ENJEUX.find((e) => e.code === code) || ENJEUX[4];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Cadre de la zone 1 ──
export async function getZone1() {
  const frames = await board().get({ type: 'frame' });
  return frames.find((f) => (f.title || '').includes('Avancement avant-vente')) || null;
}

export async function initBoard() {
  let f = await getZone1();
  if (f) return f;
  f = await board().createFrame({
    title: ZONE1_TITLE, x: 0, y: 0, width: G.frameW, height: G.frameH,
    style: { fillColor: '#ffffff' },
  });
  for (const p of PILOTES) await createDecor(f, p);
  await layout();
  return f;
}

async function createDecor(frame, p) {
  const bg = await board().createShape({
    shape: 'rectangle', content: '', width: 200, height: 200, x: frame.x, y: frame.y,
    style: { fillColor: GRIS_FOND, borderColor: BLEU, borderWidth: 2, borderOpacity: 1 },
  });
  await bg.setMetadata(META, { role: 'bg', pilote: p.code });
  await addToFrame(frame, bg);
  const hdr = await board().createShape({
    shape: 'rectangle', content: '', width: 200, height: G.hdrH, x: frame.x, y: frame.y,
    style: { fillColor: BLEU, color: '#ffffff', fontSize: 14, fontFamily: 'open_sans',
      textAlign: 'center', textAlignVertical: 'top', borderOpacity: 0 },
  });
  await hdr.setMetadata(META, { role: 'hdr', pilote: p.code });
  await addToFrame(frame, hdr);
}

// ── Pastilles dossier ──
function cardStyle(d) {
  const e = enjeu(d.enjeu);
  return {
    fillColor: e.fill, color: e.text, fontSize: 12, fontFamily: 'open_sans',
    textAlign: 'center', textAlignVertical: 'middle',
    borderColor: d.carsat ? CARSAT : (e.fill === '#ffffff' ? '#1a1a1a' : '#ffffff'),
    borderWidth: d.carsat ? 5 : 2, borderOpacity: 1,
  };
}

export async function saveDossier(d, itemId) {
  const frame = await getZone1();
  if (!frame) throw new Error("Board non initialisé : clique d'abord sur « Préparer le board ».");
  let item;
  if (itemId) {
    item = await board().getById(itemId);
    item.content = `<p><strong>${esc(d.titre)}</strong></p>`;
    item.style = { ...item.style, ...cardStyle(d) };
    await item.sync();
  } else {
    item = await board().createShape({
      shape: 'rectangle', content: `<p><strong>${esc(d.titre)}</strong></p>`,
      width: G.cardW, height: G.cardH, x: frame.x, y: frame.y, style: cardStyle(d),
    });
    await addToFrame(frame, item);
  }
  await item.setMetadata(META, { role: 'dossier', ...d, maj: new Date().toISOString() });
  await layout();
  return item;
}

// Import en masse (fichier local import.json) : création par lots, un seul rangement final.
// Les dossiers déjà présents (même titre + pilote) ne sont pas recréés.
export async function importDossiers(list, onProgress) {
  const frame = await getZone1();
  if (!frame) throw new Error("Board non initialisé : clique d'abord sur « Préparer le board ».");
  // Réparation : pastilles créées sans fiche (écriture refusée par Miro) -> supprimées puis recréées
  const sansFiche = { length: await removeOrphans(frame) };
  const deja = new Set((await zoneItems(frame)).filter((x) => x.meta.role === 'dossier')
    .map((x) => `${x.meta.pilote}|${x.meta.titre}`));
  const todo = list.filter((d) => !deja.has(`${d.pilote}|${d.titre}`));
  const retry = async (fn) => {
    for (let k = 0; ; k++) {
      try { return await fn(); }
      catch (e) { if (k >= 3) throw e; await new Promise((r) => setTimeout(r, 800 * (k + 1))); }
    }
  };
  // point de dépôt libre, bien à l'intérieur du cadre (bande basse, sous les sections)
  const dropX = frame.x - frame.width / 2 + G.margin + G.cardW;
  const dropY = frame.y + frame.height / 2 - G.margin / 2 - 4;
  const LOT = 4;
  let echecs = 0;
  for (let i = 0; i < todo.length; i += LOT) {
    await Promise.all(todo.slice(i, i + LOT).map(async (d, k) => {
      let item;
      try {
        item = await retry(() => board().createShape({
          shape: 'rectangle', content: `<p><strong>${esc(d.titre)}</strong></p>`,
          width: G.cardW, height: G.cardH, x: dropX + k * (G.cardW + G.gapX), y: dropY, style: cardStyle(d),
        }));
        await retry(() => item.setMetadata(META, { role: 'dossier', ...d, maj: new Date().toISOString() }));
        await addToFrame(frame, item);
      } catch (e) {                                  // jamais de pastille sans fiche ni hors cadre
        echecs++;
        console.error(d.titre, e);
        if (item) await board().remove(item).catch(() => {});
      }
    }));
    onProgress?.(Math.min(i + LOT, todo.length), todo.length);
  }
  const r = await layout();
  return { crees: todo.length - echecs, echecs, ignores: list.length - todo.length, repares: sansFiche.length, ...r };
}

export async function deleteDossier(itemId) {
  const item = await board().getById(itemId);
  await board().remove(item);
  await layout();
}

export async function readDossier(item) {
  if (!item || item.type !== 'shape') return null;
  const m = await item.getMetadata(META);
  return m && m.role === 'dossier' ? m : null;
}

// Liste des objets de l'app dans la zone 1, avec leurs métadonnées.
async function zoneItems(frame) {
  const children = await board().get({ type: 'shape' });
  const mine = children.filter((s) => inFrame(frame, s));
  const metas = await Promise.all(mine.map((s) => s.getMetadata(META)));
  return mine.map((s, i) => ({ item: s, meta: metas[i] })).filter((x) => x.meta);
}

// Rattachement au cadre : Miro le refuse parfois sans raison apparente ; on retente après un
// léger déplacement, sinon l'objet reste libre mais posé dans le cadre (l'app le repère par position).
async function addToFrame(frame, item) {
  try { await frame.add(item); return true; } catch (e) { /* nouvelle tentative */ }
  try {
    await new Promise((r) => setTimeout(r, 400));
    item.x += 1; await item.sync();
    await frame.add(item); return true;
  } catch (e) { return false; }
}
const inFrame = (frame, s) => s.parentId === frame.id || (!s.parentId
  && Math.abs(s.x - frame.x) < frame.width / 2 && Math.abs(s.y - frame.y) < frame.height / 2);

// Nettoyage : tout objet du cadre sans fiche de l'app (écriture interrompue) est supprimé.
async function removeOrphans(frame) {
  const shapes = await board().get({ type: 'shape' });
  const L = frame.x - frame.width / 2, R = frame.x + frame.width / 2;
  const T = frame.y - frame.height / 2, B = frame.y + frame.height / 2;
  const cand = shapes.filter((s) => s.parentId === frame.id
    || (!s.parentId && s.x > L && s.x < R && s.y > T && s.y < B));
  const metas = await Promise.all(cand.map((s) => s.getMetadata(META)));
  const orphans = cand.filter((s, i) => !metas[i]);
  for (const s of orphans) await board().remove(s).catch(() => {});
  return orphans.length;
}

// Coordonnées : on raisonne en relatif au coin haut-gauche du cadre.
function place(item, frame, relX, relY) {
  if (item.relativeTo === 'parent_top_left') { item.x = relX; item.y = relY; }
  else { item.x = frame.x - frame.width / 2 + relX; item.y = frame.y - frame.height / 2 + relY; }
}

// ── Rangement : colonnes proportionnelles au nombre de dossiers de chaque pilote ──
export async function layout() {
  const t0 = performance.now();
  const frame = await getZone1();
  if (!frame) return null;
  const nettoyes = await removeOrphans(frame);
  const all = await zoneItems(frame);
  const dossiers = all.filter((x) => x.meta.role === 'dossier');
  const usableH = G.frameH - G.top - G.margin;
  const rows = Math.min(G.maxRows, Math.floor((usableH + G.gapY) / (G.cardH + G.gapY)));
  // hauteur utile = 25 lignes : le cadre est ramené à son contenu (bord haut fixe)
  const secH = G.hdrH + G.barH + 8 + rows * (G.cardH + G.gapY) + G.sectionPad;
  const frameH = G.top - G.hdrH + secH + G.margin;
  const order = (c) => ENJEUX.findIndex((e) => e.code === c);

  // largeur de chaque section
  const secs = PILOTES.map((p) => {
    const list = dossiers.filter((x) => x.meta.pilote === p.code)
      .sort((a, b) => order(a.meta.enjeu) - order(b.meta.enjeu) || a.meta.titre.localeCompare(b.meta.titre, 'fr'));
    const cols = Math.max(1, Math.ceil(list.length / rows));
    const w = cols * (G.cardW + G.gapX) - G.gapX + 2 * G.sectionPad;
    return { p, list, cols, w };
  });
  const totalW = secs.reduce((s, x) => s + x.w, 0) + G.sectionGap * (secs.length - 1) + 2 * G.margin;
  const frameW = Math.max(G.frameW, totalW);
  if (Math.round(frame.width) !== Math.round(frameW) || Math.round(frame.height) !== Math.round(frameH)) {
    const top = frame.y - frame.height / 2;
    frame.width = frameW; frame.height = frameH; frame.y = top + frameH / 2;
    await frame.sync();
  }

  const syncs = [];
  const moveTo = (item, rx, ry, w, h) => {
    const before = [item.x, item.y, item.width, item.height].map(Math.round).join();
    if (w) item.width = w;
    if (h) item.height = h;
    place(item, frame, rx, ry);
    if ([item.x, item.y, item.width, item.height].map(Math.round).join() !== before) syncs.push(item.sync());
  };

  // supprime les anciennes barres de répartition (recréées ci-dessous)
  const bars = all.filter((x) => x.meta.role === 'bar').map((x) => x.item);
  if (bars.length) await Promise.all(bars.map((b) => board().remove(b)));

  let x0 = (frameW - (totalW - 2 * G.margin)) / 2;
  const newBars = [];
  for (const s of secs) {
    const left = x0;
    const bg = all.find((x) => x.meta.role === 'bg' && x.meta.pilote === s.p.code);
    const hdr = all.find((x) => x.meta.role === 'hdr' && x.meta.pilote === s.p.code);
    if (bg) moveTo(bg.item, left + s.w / 2, G.top - G.hdrH + secH / 2, s.w, secH);
    if (hdr) {
      const txt = `<p><strong>${s.p.code} · ${esc(s.p.nom)}</strong></p><p>${s.list.length} dossier${s.list.length > 1 ? 's' : ''}</p>`;
      if (hdr.item.content !== txt) { hdr.item.content = txt; }
      moveTo(hdr.item, left + s.w / 2, G.top - G.hdrH / 2, s.w, G.hdrH);
      syncs.push(hdr.item.sync());
    }
    // barre de répartition par enjeu, sous l'en-tête
    const n = s.list.length;
    if (n) {
      let bx = left + G.sectionPad;
      const bw = s.w - 2 * G.sectionPad;
      for (const e of ENJEUX) {
        const k = s.list.filter((x) => x.meta.enjeu === e.code).length;
        if (!k) continue;
        const w = Math.max(8, (bw * k) / n);   // Miro impose 8 de largeur minimale
        newBars.push({ e, x: bx + w / 2, w });
        bx += w;
      }
    }
    // pastilles, en colonnes de haut en bas
    s.list.forEach((d, i) => {
      const c = Math.floor(i / rows), r = i % rows;
      moveTo(d.item, left + G.sectionPad + G.cardW / 2 + c * (G.cardW + G.gapX),
        G.top + G.barH + 8 + G.cardH / 2 + r * (G.cardH + G.gapY));
    });
    x0 += s.w + G.sectionGap;
  }
  await Promise.all(syncs);
  await layoutZone2(frame, dossiers);

  for (const b of newBars) {
    const shp = await board().createShape({
      shape: 'rectangle', content: '', width: b.w, height: G.barH, x: frame.x, y: frame.y,
      style: { fillColor: b.e.fill, borderColor: '#1a1a1a', borderWidth: 1, borderOpacity: b.e.fill === '#ffffff' ? 1 : 0 },
    });
    await shp.setMetadata(META, { role: 'bar' });
    await addToFrame(frame, shp);
    place(shp, frame, b.x, G.top + G.barH / 2 + 2);
    await shp.sync();
  }
  return { dossiers: dossiers.length, nettoyes, ms: Math.round(performance.now() - t0) };
}

// ── Zone 2 : cartes priorisées, reflets des fiches (une carte par dossier priorisé) ──
const isoJour = (d) => d.toISOString().slice(0, 10);
function alerte(echeance) {
  if (!echeance) return null;
  const j = Math.round((new Date(echeance) - new Date(isoJour(new Date()))) / 86400000);
  if (j < 0) return { value: 'Dépassée', fillColor: '#c8341f', textColor: '#ffffff' };
  if (j <= 15) return { value: `J-${j}`, fillColor: j <= 7 ? '#c8341f' : '#f0a020', textColor: '#ffffff' };
  return null;
}
function cardData(m) {
  const e = enjeu(m.enjeu);
  const fields = [
    ...(m.ressource || []).map((r) => ({ value: r, fillColor: OR, textColor: BLEU })),
    ...(m.livrables || []).map((l) => ({ value: l, fillColor: '#e3f4d6', textColor: '#245c12' })),
  ];
  const a = alerte(m.echeance);
  if (a) fields.push(a);
  if (m.carsat) fields.push({ value: 'CARSAT', fillColor: CARSAT, textColor: '#ffffff' });
  return {
    title: esc(m.titre) + (m.echeance ? ` · éch. ${m.echeance.slice(8, 10)}/${m.echeance.slice(5, 7)}` : ''),
    style: { cardTheme: e.fill === '#ffffff' ? '#9aa0a6' : e.fill },
    fields,
  };
}

async function getZone2(frame1) {
  const frames = await board().get({ type: 'frame' });
  let f = frames.find((x) => (x.title || '').includes('Gestion des priorités'));
  if (f) return f;
  f = await board().createFrame({
    title: ZONE2_TITLE, width: G.frameW, height: G.frameH, style: { fillColor: '#ffffff' },
    x: frame1.x + frame1.width / 2 + 200 + G.frameW / 2, y: frame1.y,
  });
  for (const p of COLONNES_PRIO) {
    for (const role of ['bg2', 'hdr2']) {
      const s = await board().createShape({
        shape: 'rectangle', content: '', width: 200, height: role === 'bg2' ? 200 : G.hdrH, x: f.x, y: f.y,
        style: role === 'bg2' ? { fillColor: GRIS_FOND, borderOpacity: 0 }
          : { fillColor: p === 'Autres' ? '#6b6f76' : BLEU, color: '#ffffff', fontSize: 24, fontFamily: 'open_sans',
            textAlign: 'center', textAlignVertical: 'middle', borderOpacity: 0 },
      });
      await s.setMetadata(META, { role, col: p });
      await addToFrame(f, s);
    }
  }
  return f;
}

async function layoutZone2(frame1, dossiers) {
  const f = await getZone2(frame1);
  const [shapes, cards] = await Promise.all([board().get({ type: 'shape' }), board().get({ type: 'card' })]);
  const decor = shapes.filter((s) => inFrame(f, s));
  const decMeta = await Promise.all(decor.map((s) => s.getMetadata(META)));
  const mine = cards.filter((c) => inFrame(f, c));
  const cMeta = await Promise.all(mine.map((c) => c.getMetadata(META)));
  const byRef = new Map(mine.map((c, i) => [cMeta[i]?.ref, { item: c, meta: cMeta[i] }]));

  const usableW = G.frameW - 2 * G.margin;
  const colW = (usableW - 3 * G2.colGap) / 4;
  const colOf = (relX) => Math.max(0, Math.min(3, Math.floor((relX - G.margin) / (colW + G2.colGap))));
  const relX = (it) => (it.relativeTo === 'parent_top_left' ? it.x : it.x - (f.x - f.width / 2));

  // 1. Glisser-déposer : une carte déplacée dans une autre colonne change la priorité de sa fiche
  for (const d of dossiers) {
    const c = byRef.get(d.item.id);
    if (!c || !c.meta) continue;
    const col = COLONNES_PRIO[colOf(relX(c.item))];
    if (col !== c.meta.col && col !== d.meta.priorite) {
      d.meta = { ...d.meta, priorite: col, maj: new Date().toISOString() };
      await d.item.setMetadata(META, d.meta);
    }
  }
  // 2. Création / mise à jour / suppression des cartes
  const prio = dossiers.filter((d) => COLONNES_PRIO.includes(d.meta.priorite));
  const keep = new Set();
  for (const d of prio) {
    const data = cardData(d.meta);
    let c = byRef.get(d.item.id)?.item;
    if (!c) {
      c = await board().createCard({ ...data, width: G2.cardW, x: f.x, y: f.y });
      await addToFrame(f, c);
      c = await board().getById(c.id);       // relit la carte avec ses coordonnées relatives au cadre
    } else {
      c.title = data.title; c.style = { ...c.style, ...data.style }; c.fields = data.fields;
    }
    await c.setMetadata(META, { role: 'prio', ref: d.item.id, col: d.meta.priorite });
    d.card = c;
    keep.add(c.id);
  }
  const orphans = mine.filter((c) => !keep.has(c.id));
  if (orphans.length) await Promise.all(orphans.map((c) => board().remove(c)));

  // 3. Rangement des colonnes (2 cartes par ligne, tri par enjeu puis échéance)
  const order = (c) => ENJEUX.findIndex((e) => e.code === c);
  const syncs = [];
  COLONNES_PRIO.forEach((p, k) => {
    const left = G.margin + k * (colW + G2.colGap);
    const list = prio.filter((d) => d.meta.priorite === p).sort((a, b) =>
      order(a.meta.enjeu) - order(b.meta.enjeu) || (a.meta.echeance || '9').localeCompare(b.meta.echeance || '9'));
    decor.forEach((s, i) => {
      const m = decMeta[i];
      if (!m || m.col !== p) return;
      if (m.role === 'bg2') { s.width = colW; s.height = G.frameH - G2.top - G.margin + G.hdrH; place(s, f, left + colW / 2, G2.top - G.hdrH + s.height / 2); }
      if (m.role === 'hdr2') { s.width = colW; s.height = G.hdrH; s.content = `<p><strong>${LIBELLE_PRIO[p]} · ${list.length}</strong></p>`; place(s, f, left + colW / 2, G2.top - G.hdrH / 2); }
      syncs.push(s.sync());
    });
    const pad = (colW - 2 * G2.cardW - G2.cardGapX) / 2;
    list.forEach((d, i) => {
      const cx = left + pad + G2.cardW / 2 + (i % 2) * (G2.cardW + G2.cardGapX);
      place(d.card, f, cx, G2.top + 20 + G2.rowStep / 2 + Math.floor(i / 2) * G2.rowStep);
      syncs.push(d.card.sync());
    });
  });
  await Promise.all(syncs);
}

export async function stats() {
  const frame = await getZone1();
  if (!frame) return null;
  const d = (await zoneItems(frame)).filter((x) => x.meta.role === 'dossier');
  return PILOTES.map((p) => ({ code: p.code, n: d.filter((x) => x.meta.pilote === p.code).length }));
}
