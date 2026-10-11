// Panneau de saisie : une fiche dossier = listes de choix, aucune saisie libre hors titre.
import { PILOTES, ENJEUX, PRIORITES, RESSOURCES, LIVRABLES } from './config.js?v=19';
import { initBoard, saveDossier, deleteDossier, readDossier, layout, getZone1, importDossiers, tachesDe, tachesAV, enregistrerOrdreAV } from './engine.js?v=19';

const $ = (id) => document.getElementById(id);
let currentId = null;

function seg(id, options) {
  const box = $(id);
  const multi = box.dataset.multi === '1';
  box.innerHTML = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = o.v;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = (o.color ? `<i style="background:${o.color}"></i>` : '') + o.label;
    b.onclick = () => {
      if (!multi) box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', String(!(b.getAttribute('aria-pressed') === 'true') || !multi));
    };
    box.appendChild(b);
  }
}
const getSeg = (id) => [...$(id).querySelectorAll('button[aria-pressed=true]')].map((b) => b.dataset.v);
const setSeg = (id, values) => $(id).querySelectorAll('button').forEach((b) =>
  b.setAttribute('aria-pressed', String([].concat(values || []).includes(b.dataset.v))));

seg('pilote', PILOTES.map((p) => ({ v: p.code, label: p.code })));
seg('enjeu', ENJEUX.map((e) => ({ v: e.code, label: e.court, color: e.fill })));
seg('priorite', PRIORITES.map((p) => ({ v: p, label: p })));
// Section avant-vente : une ligne par tâche (ressource -> livrable -> priorité -> échéance)
const opts = (list, val) => list.map((v) => `<option value="${v}"${v === val ? ' selected' : ''}>${v}</option>`).join('');
function ligneTache(t = {}) {
  const row = document.createElement('div');
  row.className = 'tache';
  row.innerHTML = `<select class="t-res"><option value="">—</option>${opts(RESSOURCES, t.ressource)}</select>
    <select class="t-liv"><option value="">—</option>${opts(LIVRABLES, t.livrable)}</select>
    <select class="t-pri">${opts(['P1', 'P2', 'P3', '—'], t.priorite || '—')}</select>
    <input type="date" class="t-ech" value="${t.echeance || ''}">
    <button type="button" class="del" title="Retirer cette ligne">×</button>`;
  row.querySelector('.del').onclick = () => row.remove();
  $('taches').appendChild(row);
}
$('addTache').onclick = () => ligneTache();
const lireTaches = () => [...document.querySelectorAll('#taches .tache')].map((r) => ({
  ressource: r.querySelector('.t-res').value, livrable: r.querySelector('.t-liv').value,
  priorite: r.querySelector('.t-pri').value, echeance: r.querySelector('.t-ech').value || null,
})).filter((t) => t.ressource || t.livrable);

function status(msg, err = false) {
  $('status').textContent = msg;
  $('status').className = 'status' + (err ? ' err' : '');
}

function fill(d, id) {
  currentId = id || null;
  $('titre').value = d?.titre || '';
  setSeg('pilote', d?.pilote);
  setSeg('enjeu', d?.enjeu || 'Q');
  setSeg('priorite', d?.priorite || '—');
  $('taches').innerHTML = '';
  const ts = d ? tachesDe(d) : [];
  (ts.length ? ts : [{}]).forEach(ligneTache);
  $('carsat').checked = !!d?.carsat;
  $('ttl').textContent = id ? 'Modifier le dossier' : 'Nouveau dossier';
  $('sub').textContent = id ? (d?.maj ? `Dernière mise à jour : ${new Date(d.maj).toLocaleString('fr-FR')}` : '') :
    'Clique une pastille sur le board pour la modifier.';
  $('delRow').hidden = !id;
  $('confirm').classList.remove('on');
}

function collect() {
  const d = {
    titre: $('titre').value.trim(),
    pilote: getSeg('pilote')[0],
    enjeu: getSeg('enjeu')[0] || 'Q',
    priorite: getSeg('priorite')[0] || '—',
    taches: lireTaches(),
    carsat: $('carsat').checked,
  };
  if (!d.titre) throw new Error('Indique le client et le site.');
  if (!d.pilote) throw new Error('Choisis le pilote.');
  return d;
}

async function busy(label, fn) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  status(label);
  try { await fn(); }
  catch (e) { status(e.message || String(e), true); console.error(e); }
  finally { document.querySelectorAll('button').forEach((b) => (b.disabled = false)); }
}

$('save').onclick = () => busy('Enregistrement…', async () => {
  const d = collect();
  const item = await saveDossier(d, currentId);
  fill(await readDossier(await miro.board.getById(item.id)), item.id);
  status(`« ${d.titre} » enregistré et rangé.`);
});
$('reset').onclick = () => fill(null);
$('del').onclick = () => $('confirm').classList.add('on');
$('delNo').onclick = () => $('confirm').classList.remove('on');
$('delYes').onclick = () => busy('Suppression…', async () => {
  const t = $('titre').value;
  await deleteDossier(currentId);
  fill(null);
  status(`« ${t} » supprimé.`);
});
$('init').onclick = () => busy('Préparation du board…', async () => {
  const f = await initBoard();
  await miro.board.viewport.zoomTo(f);
  status('Zone 1 prête.');
});
$('relayout').onclick = () => busy('Rangement…', async () => {
  const r = await layout();
  status(r ? `${r.dossiers} dossiers rangés en ${Math.round(r.ms / 100) / 10} s.` : "Board non initialisé.");
});

$('import').onclick = () => busy('Lecture du fichier d\'import…', async () => {
  const res = await fetch('import.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Fichier import.json introuvable à côté de l\'app.');
  const list = await res.json();
  const t0 = performance.now();
  const r = await importDossiers(list, (n, tot) => status(`Import : ${n} / ${tot} dossiers créés…`));
  status(`${r.crees} dossiers importés (${r.repares} pastilles sans fiche réparées, ${r.echecs} échecs — relancer l'import pour les reprendre), ${r.ignores} déjà présents. Rangement final : ${r.ms} ms. Total : ${Math.round((performance.now() - t0) / 1000)} s.`);
});

// Sélection d'une pastille sur le board -> chargement de sa fiche
// (pastille de la zone 1, ou carte de la zone 2 qui renvoie à sa pastille)
// ── Vue « ordre de traitement » d'un avant-vente (clic sur un en-tête de la zone 3) ──
let ordreAV = null, ordreListe = [];
function afficherVue(ordre) { $('vueOrdre').hidden = !ordre; $('vueDossier').hidden = ordre; }
const LIGNES = ['Cette semaine', 'S+1', 'Plus tard (hors zone 3)'];
function dessinerOrdre(list) {
  list.sort((a, b) => a.r - b.r);                   // regroupé par ligne, ordre conservé dans chaque groupe
  const box = $('ordreListe');
  box.innerHTML = '';
  let groupe = null;
  list.forEach((x, i) => {
    if (x.r !== groupe) { groupe = x.r; box.insertAdjacentHTML('beforeend', `<div class="og">${LIGNES[groupe]}</div>`); }
    const ech = x.echeance ? ` · éch. ${x.echeance.slice(8, 10)}/${x.echeance.slice(5, 7)}` : '';
    const row = document.createElement('div');
    row.className = 'oi';
    const forcee = x.r !== x.rAuto ? ' · <b>ligne choisie</b>' : '';
    row.innerHTML = `<div><div class="t">${i + 1}. ${x.titre}</div><div class="m">${x.pilote} · ${x.livrable}${ech}${forcee}</div>
        <select class="lg">${LIGNES.map((l, k) => `<option value="${k}"${k === x.r ? ' selected' : ''}>${k === 2 ? 'Plus tard' : l}</option>`).join('')}</select></div>
      <button type="button" title="Monter">▲</button><button type="button" title="Descendre">▼</button>`;
    row.querySelector('.lg').onchange = (ev) => { x.r = Number(ev.target.value); dessinerOrdre(list); };
    row.querySelector('.t').title = x.titre;
    const [haut, bas] = row.querySelectorAll('button');
    haut.disabled = i === 0 || list[i - 1].r !== x.r; bas.disabled = i === list.length - 1 || list[i + 1].r !== x.r;
    haut.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; dessinerOrdre(list); };
    bas.onclick = () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; dessinerOrdre(list); };
    box.appendChild(row);
  });
  if (!list.length) box.innerHTML = '<div class="sub">Aucun plan ni devis attendu pour cette ressource.</div>';
  ordreListe = list;
}
async function ouvrirOrdre(av) {
  ordreAV = av;
  afficherVue(true);
  $('ordreTtl').textContent = `Ordre de traitement · ${av}`;
  $('ordreStatus').textContent = 'Chargement…';
  dessinerOrdre(await tachesAV(av));
  $('ordreStatus').textContent = '';
}
$('ordreRetour').onclick = () => afficherVue(false);
$('ordreSave').onclick = async () => {
  $('ordreStatus').textContent = 'Enregistrement…';
  try {
    await enregistrerOrdreAV(ordreAV, ordreListe.map((x) => (x.r !== x.rAuto ? { key: x.key, r: x.r } : x.key)));
    $('ordreStatus').textContent = 'Ordre et lignes enregistrés, zone 3 mise à jour.';
  }
  catch (e) { $('ordreStatus').textContent = e.message; }
};
$('ordreAuto').onclick = async () => {
  $('ordreStatus').textContent = "Retour à l'ordre automatique…";
  try { await enregistrerOrdreAV(ordreAV, []); dessinerOrdre(await tachesAV(ordreAV)); $('ordreStatus').textContent = 'Ordre automatique rétabli.'; }
  catch (e) { $('ordreStatus').textContent = e.message; }
};

async function charger(items) {
  if (!items || items.length !== 1) return;
  let item = items[0];
  if (item.type === 'shape') {
    const m0 = await item.getMetadata('pbh').catch(() => null);
    if (m0?.role === 'hdr3') { await ouvrirOrdre(m0.av); return; }
  }
  if (item.type === 'card') {
    const m = await item.getMetadata('pbh').catch(() => null);
    if (!m || !['prio', 'av'].includes(m.role) || !m.ref) return;
    item = await miro.board.getById(m.ref).catch(() => null);
  }
  const d = await readDossier(item);
  if (d) { afficherVue(false); fill(d, item.id); }
}
miro.board.ui.on('selection:update', ({ items }) => charger(items));

fill(null);
miro.board.getSelection().then(charger);   // élément déjà sélectionné à l'ouverture du panneau
// À l'ouverture du panneau : rangement automatique (compteurs, zones 2 et 3 toujours à jour)
getZone1().then((f) => {
  if (!f) { status('Board vide : clique « Préparer le board » pour créer la zone 1.'); return; }
  busy('Mise à jour du board…', async () => {
    const r = await layout();
    status(r ? `Board à jour : ${r.dossiers} dossiers${r.mobiles ? `, ${r.mobiles} post-it(s) mobile intégré(s)` : ''} (${Math.round(r.ms / 100) / 10} s).` : '');
  });
});
