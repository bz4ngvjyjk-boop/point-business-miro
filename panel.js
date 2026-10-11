// Panneau de saisie : une fiche dossier = listes de choix, aucune saisie libre hors titre.
import { PILOTES, ENJEUX, PRIORITES, RESSOURCES, LIVRABLES } from './config.js?v=3';
import { initBoard, saveDossier, deleteDossier, readDossier, layout, getZone1, importDossiers } from './engine.js?v=3';

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
seg('ressource', RESSOURCES.map((r) => ({ v: r, label: r })));
seg('livrables', LIVRABLES.map((l) => ({ v: l, label: l })));

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
  setSeg('ressource', d?.ressource || []);
  setSeg('livrables', d?.livrables || []);
  $('echeance').value = d?.echeance || '';
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
    ressource: getSeg('ressource'),
    livrables: getSeg('livrables'),
    echeance: $('echeance').value || null,
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
  status(r ? `${r.dossiers} dossiers rangés en ${r.ms} ms.` : "Board non initialisé.");
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
async function charger(items) {
  if (!items || items.length !== 1) return;
  let item = items[0];
  if (item.type === 'card') {
    const m = await item.getMetadata('pbh').catch(() => null);
    if (!m || !['prio', 'av'].includes(m.role) || !m.ref) return;
    item = await miro.board.getById(m.ref).catch(() => null);
  }
  const d = await readDossier(item);
  if (d) fill(d, item.id);
}
miro.board.ui.on('selection:update', ({ items }) => charger(items));

fill(null);
miro.board.getSelection().then(charger);   // élément déjà sélectionné à l'ouverture du panneau
getZone1().then((f) => { if (!f) status('Board vide : clique « Préparer le board » pour créer la zone 1.'); });
