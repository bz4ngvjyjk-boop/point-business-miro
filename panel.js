// Panneau de saisie : une fiche dossier = listes de choix, aucune saisie libre hors titre.
import { PILOTES, ENJEUX, PRIORITES, RESSOURCES, LIVRABLES } from './config.js?v=60';
import { initBoard, saveDossier, deleteDossier, readDossier, layout, getZone1, importDossiers, tachesDe, tachesAV, enregistrerOrdreAV, marquerFait, retirerZone2, trimestresAffiches, dossiersZone2, enregistrerOrdre2, changerPriorite, tousDossiers, ajouterEnFin, dossiersParking, mettreEnParking } from './engine.js?v=60';

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

seg('pilote', [...PILOTES.map((p) => ({ v: p.code, label: p.code })), { v: '', label: 'À attribuer' }]);   // sans pilote : parking au-dessus de la zone 1
seg('enjeu', ENJEUX.map((e) => ({ v: e.code, label: e.court, color: e.fill })));
seg('priorite', PRIORITES.map((p) => ({ v: p, label: p })));
// Section avant-vente : une ligne par tâche (ressource -> livrable -> priorité -> échéance)
const opts = (list, val) => list.map((v) => `<option value="${v}"${v === val ? ' selected' : ''}>${v}</option>`).join('');
function ligneTache(t = {}) {
  const row = document.createElement('div');
  row.className = 'tache';
  row.innerHTML = `<select class="t-res"><option value="">—</option>${opts(RESSOURCES, t.ressource)}</select>
    <select class="t-liv"><option value="">—</option>${opts(LIVRABLES, t.livrable)}</select>
    <input type="date" class="t-ech" value="${t.echeance || ''}">
    <button type="button" class="del" title="Retirer cette ligne">×</button>
    <label class="t-fait" title="Cocher quand le livrable est traité"><input type="checkbox" class="t-ok"${t.fait ? ' checked' : ''}><span class="etat ${t.fait ? 'ok' : 'ko'}">${t.fait ? 'fait' : 'à faire'}</span></label>`;
  const ck = row.querySelector('.t-ok'), et = row.querySelector('.etat');
  ck.addEventListener('change', () => { et.textContent = ck.checked ? 'fait' : 'à faire'; et.className = `etat ${ck.checked ? 'ok' : 'ko'}`; });
  row.dataset.faitLe = t.faitLe || '';
  row.querySelector('.del').onclick = () => row.remove();
  $('taches').appendChild(row);
}
$('addTache').onclick = () => ligneTache();
const lireTaches = () => [...document.querySelectorAll('#taches .tache')].map((r) => ({
  ressource: r.querySelector('.t-res').value, livrable: r.querySelector('.t-liv').value,
  echeance: r.querySelector('.t-ech').value || null,          // priorité : celle du dossier (zone 2)
  fait: r.querySelector('.t-ok').checked,
  faitLe: r.querySelector('.t-ok').checked ? (r.dataset.faitLe || new Date().toISOString().slice(0, 10)) : null,
})).filter((t) => t.ressource || t.livrable);

function status(msg, err = false) {
  $('status').textContent = msg;
  $('status').className = 'status' + (err ? ' err' : '');
}

// trimestres proposés : en cours + 3 suivants
(function remplirTrimestres() {
  const [q0] = trimestresAffiches();
  let t = Number(q0[1]), a = Number(q0.slice(-4));
  const opts = [];
  for (let i = 0; i < 4; i++) { opts.push(`T${t} ${a}`); t++; if (t > 4) { t = 1; a++; } }
  $('chasseTrim').innerHTML = opts.map((q) => `<option>${q}</option>`).join('');
})();
let chasseLe = null, suiviInitial = '', oppId = null, parkingLe = null;
// bouton « Parking » (à droite des priorités) : bascule indépendante de la priorité, enregistrée aussitôt
const enParking = () => $('parking').getAttribute('aria-pressed') === 'true';
$('parking').addEventListener('click', () => { $('parking').setAttribute('aria-pressed', String(!enParking())); planifier(0); });
// N° d'opportunité : saisi une fois (champ « Opportunité jCRM »), puis affiché en lien grisé ; « ✎ modifier » pour corriger
function afficherOpp(edition = false) {
  $('oppId').hidden = !oppId;
  if (oppId) { $('oppId').textContent = '#' + oppId; $('oppId').href = JCRM_FICHE + oppId; }
  $('oppSaisie').hidden = !!oppId && !edition;
  $('oppSaisie').value = oppId || '';
  $('oppEdit').hidden = !oppId || edition;
}
$('oppEdit').onclick = () => { afficherOpp(true); $('oppSaisie').focus(); };
$('oppSaisie').addEventListener('input', () => { const n = parseInt($('oppSaisie').value, 10); oppId = n > 0 ? n : null; });
$('oppSaisie').addEventListener('change', () => afficherOpp(false));
const JCRM_FICHE = 'https://crm.weinmann.fr/index.php?page=opportunites-fiche&id=';
// la date de saisie « (jj/mm) » est ajoutée au suivi quand le texte change (règle CRM : une info toujours datée)
function suiviDate() {
  const t = $('suivi').value.trim();
  if (!t) return null;
  if (t === suiviInitial.replace(/\s*\(\d{2}\/\d{2}\)$/, '')) return suiviInitial;
  const d = new Date();
  return `${t} (${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')})`;
}

let generation = 0;
function fill(d, id) {
  generation++;
  currentId = id || null;
  $('chasse').checked = !!d?.chasse;
  // trimestre visé : toujours proposé, même s'il est passé (sinon il serait effacé à l'enregistrement)
  [...$('chasseTrim').querySelectorAll('option.passe')].forEach((o) => o.remove());
  if (d?.chasseTrim && ![...$('chasseTrim').options].some((o) => o.value === d.chasseTrim)) {
    $('chasseTrim').insertAdjacentHTML('afterbegin', `<option class="passe" value="${d.chasseTrim}">${d.chasseTrim} (passé)</option>`);
  }
  if (d?.chasseTrim) $('chasseTrim').value = d.chasseTrim; else $('chasseTrim').selectedIndex = 0;
  oppId = d?.jcrm || null;                      // n° d'opportunité jCRM : lien grisé à côté du nom
  afficherOpp();
  suiviInitial = d?.suivi || '';
  $('suivi').value = suiviInitial.replace(/\s*\(\d{2}\/\d{2}\)$/, '');
  chasseLe = d?.chasseLe || null;
  $('chasseInfo').textContent = d?.chasse && chasseLe ? `Ajouté au tableau de chasse le ${chasseLe.slice(8, 10)}/${chasseLe.slice(5, 7)}/${chasseLe.slice(0, 4)}` : '';
  $('titre').value = d?.titre || '';
  setSeg('pilote', d?.pilote);
  setSeg('enjeu', d?.enjeu || 'Q');
  setSeg('priorite', d?.priorite || '—');
  $('taches').innerHTML = '';
  const ts = d ? tachesDe(d) : [];
  (ts.length ? ts : [{}]).forEach(ligneTache);
  $('carsat').checked = !!d?.carsat;
  $('parking').setAttribute('aria-pressed', String(!!d?.parking));
  parkingLe = d?.parkingLe || null;
  $('ttl').textContent = id ? 'Modifier le dossier' : 'Nouveau dossier';
  $('sub').textContent = id ? (d?.maj ? `Dernière mise à jour : ${new Date(d.maj).toLocaleString('fr-FR')}` : '') :
    'Clique une pastille sur le board pour la modifier.';
  $('delRow').hidden = !id;
  $('confirm').classList.remove('on');
  $('confirmZ2').classList.remove('on');
  majBoutonZ2();
  clearTimeout(minuterie); minuterie = null;
}
// bouton ✕ « retirer de la zone 2 » : visible sur un dossier en priorité ou avec des actions avant-vente
function majBoutonZ2() {
  $('z2Btn').hidden = !currentId || ((getSeg('priorite')[0] || '—') === '—' && !lireTaches().length);
}

function collect() {
  const d = {
    titre: $('titre').value.trim(),
    pilote: getSeg('pilote')[0] || '',
    enjeu: getSeg('enjeu')[0] || 'Q',
    priorite: getSeg('priorite')[0] || '—',
    taches: lireTaches(),
    chasse: $('chasse').checked,
    chasseTrim: $('chasse').checked ? $('chasseTrim').value : null,
    chasseLe: $('chasse').checked ? (chasseLe || new Date().toISOString().slice(0, 10)) : null,
    jcrm: oppId,
    suivi: suiviDate(),
    carsat: $('carsat').checked,
    parking: enParking(),
    parkingLe: enParking() ? (parkingLe || new Date().toISOString().slice(0, 10)) : null,
  };
  if (!d.titre) throw new Error('Indique le client et le site.');
  if (!currentId && !getSeg('pilote').length) throw new Error('Choisis le pilote (ou « À attribuer ») pour créer le dossier.');
  return d;
}

async function busy(label, fn) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  status(label);
  try { await fn(); }
  catch (e) { status(e.message || String(e), true); console.error(e); }
  finally { document.querySelectorAll('button').forEach((b) => (b.disabled = false)); }
}

$('reset').onclick = async () => { await flush(); fill(null); };

// ══ Enregistrement automatique ══
// Toute modification est enregistrée seule : cases et listes tout de suite, texte après une courte pause.
// Un nouveau dossier est créé dès que le client et le pilote sont renseignés.
let minuterie = null, enCoursSave = false, aRefaire = false, saveEnCours = null;
const nomNormal = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function planifier(delai = 0) {
  majBoutonZ2();
  clearTimeout(minuterie);
  minuterie = setTimeout(autoSave, delai);
}
// modification en attente : enregistrée avant de changer de fiche
async function flush() {
  if (minuterie) { clearTimeout(minuterie); await autoSave(); }
  while (saveEnCours) await saveEnCours.catch(() => {});
}
async function autoSave() {
  minuterie = null;
  if (enCoursSave) { aRefaire = true; return; }
  let d;
  try { d = collect(); }
  catch (e) { if (currentId) status(e.message, true); else status(`${e.message} Le dossier sera créé automatiquement.`); return; }
  enCoursSave = true;
  const nouveau = !currentId, gen = generation;
  let fini;
  saveEnCours = new Promise((r) => { fini = r; });
  status(nouveau ? 'Création du dossier…' : 'Enregistrement…');
  try {
    if (nouveau) {                                // garde-fou : un dossier du même nom existe déjà -> on l'ouvre, pas de doublon
      const deja = (await tousDossiers()).find((x) => nomNormal(x.titre) === nomNormal(d.titre));
      if (deja) {
        const it = await miro.board.getById(deja.id);
        fill(await readDossier(it), deja.id);
        status(`« ${deja.titre} » existe déjà (${deja.pilote || 'à attribuer'}) : fiche existante ouverte, aucun doublon créé.`, true);
        return;
      }
    }
    const item = await saveDossier(d, currentId);
    if (gen !== generation) return;               // une autre fiche a été ouverte entre-temps : ne pas la détourner
    currentId = item.id;
    suiviInitial = d.suivi || '';                 // la date du suivi n'est ajoutée qu'une fois
    chasseLe = d.chasseLe;
    parkingLe = d.parkingLe;
    $('ttl').textContent = 'Modifier le dossier';
    $('sub').textContent = `Enregistré automatiquement à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    $('delRow').hidden = false;
    majBoutonZ2();
    status(nouveau ? `« ${d.titre} » créé et rangé.` : `« ${d.titre} » enregistré.`);
  } catch (e) { status(e.message || String(e), true); console.error(e); }
  finally {
    enCoursSave = false;
    saveEnCours = null; fini();
    if (aRefaire) { aRefaire = false; if (gen === generation) planifier(0); }
  }
}
const vue = $('vueDossier');
vue.addEventListener('change', (ev) => { if (!ev.target.closest('#confirm, #confirmZ2')) planifier(0); });   // listes, cases, dates
vue.addEventListener('input', (ev) => { if (ev.target.matches('#titre, #suivi')) planifier(1500); });     // texte : après une pause
['pilote', 'enjeu', 'priorite'].forEach((id) => $(id).addEventListener('click', (ev) => { if (ev.target.closest('button')) planifier(0); }));
$('taches').addEventListener('click', (ev) => { if (ev.target.classList.contains('del')) planifier(0); });
$('z2Btn').onclick = () => { $('z2t').textContent = $('titre').value; $('confirmZ2').classList.add('on'); };
$('del').onclick = () => $('confirm').classList.add('on');
$('z2No').onclick = () => $('confirmZ2').classList.remove('on');
$('z2Yes').onclick = () => {
  clearTimeout(minuterie);
  const id = currentId;
  if (!id) return;
  $('confirmZ2').classList.remove('on');
  busy('Retrait de la zone 2…', async () => {
    await retirerZone2(id);
    const it = await miro.board.getById(id).catch(() => null);
    const d = it && await readDossier(it);
    if (d) fill(d, id);
    status('Retiré de la zone 2 : priorité « — », actions avant-vente supprimées.');
  });
};
$('delNo').onclick = () => $('confirm').classList.remove('on');
$('delYes').onclick = () => busy('Suppression…', async () => {
  clearTimeout(minuterie);
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
let ordreAV = null, ordreListe = [], ordreZ2 = null, vuePk = false;   // vuePk : liste du parking   // ordreZ2 : colonne de priorité affichée (zone 2), sinon zone 3
function afficherVue(ordre) { $('vueOrdre').hidden = !ordre; $('vueDossier').hidden = ordre; }
const LIGNES = ['Cette semaine', 'Plus tard'];
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
    row.innerHTML = `<div><div class="t">${x.fait ? '✓ ' : ''}${i + 1}. ${x.titre}</div><div class="m">${x.pilote} · ${x.livrable}${ech}${forcee}</div>
        <label class="okf"><input type="checkbox" class="ok"${x.fait ? ' checked' : ''}><span class="etat ${x.fait ? 'ok' : 'ko'}">${x.fait ? 'fait' : 'à faire'}</span></label>
        <select class="lg">${LIGNES.map((l, k) => `<option value="${k}"${k === x.r ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <button type="button" title="Monter">▲</button><button type="button" title="Descendre">▼</button>`;
    row.querySelector('.lg').onchange = (ev) => { x.r = Number(ev.target.value); dessinerOrdre(list); ordreModifie(); };
    row.querySelector('.ok').onchange = async (ev) => {
      x.fait = ev.target.checked;
      $('ordreStatus').textContent = x.fait ? 'Pointé comme fait…' : 'Remis à faire…';
      try { await marquerFait(x.dossierId, ordreAV, x.livrable, x.fait); dessinerOrdre(list); $('ordreStatus').textContent = x.fait ? '✓ Pointé comme fait.' : 'Remis à faire.'; }
      catch (e) { $('ordreStatus').textContent = e.message; }
    };
    if (x.fait) row.classList.add('fait');
    row.querySelector('.t').title = `${x.titre} — cliquer pour modifier la fiche`;
    row.querySelector('.t').onclick = () => ouvrirFiche(x.dossierId);
    const [haut, bas] = row.querySelectorAll('button');
    haut.disabled = i === 0 || list[i - 1].r !== x.r; bas.disabled = i === list.length - 1 || list[i + 1].r !== x.r;
    haut.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; dessinerOrdre(list); ordreModifie(); };
    bas.onclick = () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; dessinerOrdre(list); ordreModifie(); };
    box.appendChild(row);
  });
  if (!list.length) box.innerHTML = '<div class="sub">Aucun plan ni devis attendu pour cette ressource.</div>';
  ordreListe = list;
}
// ── Vue « ordre » d'une colonne de priorité (clic sur un en-tête de la zone 2) ──
const COLS2 = ['P1', 'P2', 'P3', 'Autres', '—'];
function dessinerOrdre2(list) {
  const box = $('ordreListe');
  box.innerHTML = '';
  list.forEach((x, i) => {
    const ech = x.echeance ? ` · éch. ${x.echeance.slice(8, 10)}/${x.echeance.slice(5, 7)}` : '';
    const row = document.createElement('div');
    row.className = 'oi';
    row.innerHTML = `<div><div class="t">${i + 1}. ${x.titre}</div><div class="m">${x.pilote}${ech}</div>
        <select class="lg" title="Changer de colonne">${COLS2.map((c) => `<option${c === ordreZ2 ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
      <button type="button" title="Monter">▲</button><button type="button" title="Descendre">▼</button>`;
    row.querySelector('.t').title = `${x.titre} — cliquer pour modifier la fiche`;
    row.querySelector('.t').onclick = () => ouvrirFiche(x.id);
    row.querySelector('.lg').onchange = async (ev) => {
      const col = ev.target.value;
      $('ordreStatus').textContent = `Passage en ${col}…`;
      try { await changerPriorite(x.id, col); list.splice(i, 1); dessinerOrdre2(list); $('ordreStatus').textContent = `« ${x.titre} » passé en ${col}.`; }
      catch (e) { $('ordreStatus').textContent = e.message; }
    };
    const [haut, bas] = row.querySelectorAll('button');
    haut.disabled = i === 0; bas.disabled = i === list.length - 1;
    haut.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; dessinerOrdre2(list); ordreModifie(); };
    bas.onclick = () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; dessinerOrdre2(list); ordreModifie(); };
    box.appendChild(row);
  });
  if (!list.length) box.innerHTML = '<div class="sub">Aucun dossier dans cette colonne.</div>';
  ordreListe = list;
}
// Recherche d'un dossier à ajouter à la colonne affichée (zone 2)
let catalogue = [];
const sansAccents = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function chercherZ2() {
  const q = sansAccents($('z2Cherche').value.trim());
  const box = $('z2Res');
  box.innerHTML = '';
  if (q.length < 2) return;
  const res = catalogue.filter((d) => (vuePk ? !d.parking : d.priorite !== ordreZ2) && sansAccents(d.titre).includes(q)).slice(0, 8);
  if (!res.length) { box.innerHTML = '<div class="sub">Aucun dossier trouvé.</div>'; return; }
  for (const d of res) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'z2r';
    b.innerHTML = `<strong>${d.titre}</strong><span>${d.pilote}${d.priorite !== '—' ? ` · actuellement ${d.priorite}` : ''}</span>`;
    if (vuePk) {
      b.onclick = async () => {
        $('ordreStatus').textContent = `Ajout de « ${d.titre} » au parking…`;
        try {
          await mettreEnParking(d.id, true);
          d.parking = true;
          $('z2Cherche').value = ''; box.innerHTML = '';
          dessinerParking(await dossiersParking());
          $('ordreStatus').textContent = `« ${d.titre} » ajouté au parking.`;
        } catch (e) { $('ordreStatus').textContent = e.message; }
      };
      box.appendChild(b);
      continue;
    }
    b.onclick = async () => {
      $('ordreStatus').textContent = `Ajout de « ${d.titre} »…`;
      try {
        await flushOrdre();
        await ajouterEnFin(d.id, ordreZ2);
        d.priorite = ordreZ2;
        $('z2Cherche').value = ''; box.innerHTML = '';
        dessinerOrdre2(await dossiersZone2(ordreZ2));
        $('ordreStatus').textContent = `« ${d.titre} » ajouté en bas de ${ordreZ2}.`;
      } catch (e) { $('ordreStatus').textContent = e.message; }
    };
    box.appendChild(b);
  }
}
$('z2Cherche').addEventListener('input', chercherZ2);
// Ouvre la fiche d'un dossier depuis une vue « ordre » ; « ← Retour à l'ordre » ramène à la liste
let retourOrdre = null;
async function ouvrirFiche(id) {
  await flushOrdre();
  const it = await miro.board.getById(id).catch(() => null);
  const d = it && await readDossier(it);
  if (!d) return;
  retourOrdre = vuePk ? { pk: true } : ordreZ2 ? { z2: ordreZ2 } : { av: ordreAV };
  afficherVue(false);
  fill(d, id);
  $('retourOrdre').hidden = false;
  $('retourOrdre').textContent = vuePk ? '← Retour au parking' : `← Retour à l'ordre ${ordreZ2 || ordreAV}`;
}
$('retourOrdre').onclick = async () => {
  await flush();
  const r = retourOrdre;
  $('retourOrdre').hidden = true;
  if (r?.pk) await ouvrirParking(); else if (r?.z2) await ouvrirOrdre2(r.z2); else if (r?.av) await ouvrirOrdre(r.av);
};
// ── Vue « parking » (clic sur le titre de la zone parking) : recherche pour ajouter, liste -> fiche, ✕ pour retirer ──
function dessinerParking(list) {
  const box = $('ordreListe');
  box.innerHTML = '';
  list.forEach((x) => {
    const le = x.parkingLe ? ` · depuis le ${x.parkingLe.slice(8, 10)}/${x.parkingLe.slice(5, 7)}` : '';
    const row = document.createElement('div');
    row.className = 'oi pk';
    row.innerHTML = `<div><div class="t">${x.titre}</div><div class="m">${x.pilote}${le}</div></div>
      <button type="button" title="Retirer du parking">✕</button>`;
    row.querySelector('.t').title = `${x.titre} — cliquer pour ouvrir la fiche`;
    row.querySelector('.t').onclick = () => ouvrirFiche(x.id);
    row.querySelector('button').onclick = async () => {
      $('ordreStatus').textContent = `Retrait de « ${x.titre} »…`;
      try { await mettreEnParking(x.id, false); const c = catalogue.find((d) => d.id === x.id); if (c) c.parking = false;
        dessinerParking(await dossiersParking()); $('ordreStatus').textContent = `« ${x.titre} » retiré du parking.`; }
      catch (e) { $('ordreStatus').textContent = e.message; }
    };
    box.appendChild(row);
  });
  if (!list.length) box.innerHTML = '<div class="sub">Parking vide : recherche un dossier ci-dessus pour l\'ajouter.</div>';
}
async function ouvrirParking() {
  await flushOrdre();
  vuePk = true; ordreZ2 = null;
  afficherVue(true);
  $('z2Ajout').hidden = false; $('ordreAuto').hidden = true;
  $('z2Cherche').value = ''; $('z2Res').innerHTML = '';
  tousDossiers().then((l) => { catalogue = l; });
  $('ordreTtl').textContent = 'Parking · à évoquer au prochain point';
  $('ordreStatus').textContent = 'Chargement…';
  dessinerParking(await dossiersParking());
  $('ordreStatus').textContent = '';
}
async function ouvrirOrdre2(col) {
  await flushOrdre();
  vuePk = false; $('ordreAuto').hidden = false;
  ordreZ2 = col;
  afficherVue(true);
  $('z2Ajout').hidden = false;
  $('z2Cherche').value = ''; $('z2Res').innerHTML = '';
  tousDossiers().then((l) => { catalogue = l; });
  $('ordreTtl').textContent = `Ordre · ${col === 'Autres' ? 'Autres' : `Priorité ${col.slice(1)}`}`;
  $('ordreStatus').textContent = 'Chargement…';
  dessinerOrdre2(await dossiersZone2(col));
  $('ordreStatus').textContent = '';
}
async function ouvrirOrdre(av) {
  await flushOrdre();
  vuePk = false; $('ordreAuto').hidden = false;
  ordreZ2 = null;
  $('z2Ajout').hidden = true;
  ordreAV = av;
  afficherVue(true);
  $('ordreTtl').textContent = `Ordre de traitement · ${av}`;
  $('ordreStatus').textContent = 'Chargement…';
  dessinerOrdre(await tachesAV(av));
  $('ordreStatus').textContent = '';
}
// Ordre de traitement : enregistré automatiquement peu après le dernier clic (plusieurs flèches d'affilée = 1 enregistrement)
let minuterieOrdre = null, ordreEnCours = false, ordreARefaire = false;
function ordreModifie() {
  $('ordreStatus').textContent = 'Modification…';
  clearTimeout(minuterieOrdre);
  minuterieOrdre = setTimeout(sauverOrdre, 800);
}
async function sauverOrdre() {
  minuterieOrdre = null;
  if (ordreEnCours) { ordreARefaire = true; return; }
  ordreEnCours = true;
  $('ordreStatus').textContent = 'Enregistrement…';
  try {
    if (ordreZ2) {
      await enregistrerOrdre2(ordreZ2, ordreListe.map((x) => x.id));
      $('ordreStatus').textContent = 'Ordre enregistré automatiquement, zone 2 mise à jour.';
    } else {
      await enregistrerOrdreAV(ordreAV, ordreListe.map((x) => (x.r !== x.rAuto ? { key: x.key, r: x.r } : x.key)));
      $('ordreStatus').textContent = 'Ordre enregistré automatiquement, zone 3 mise à jour.';
    }
  }
  catch (e) { $('ordreStatus').textContent = e.message; }
  finally { ordreEnCours = false; if (ordreARefaire) { ordreARefaire = false; sauverOrdre(); } }
}
async function flushOrdre() { if (minuterieOrdre) { clearTimeout(minuterieOrdre); await sauverOrdre(); } }
$('ordreRetour').onclick = async () => { await flushOrdre(); afficherVue(false); };
$('ordreAuto').onclick = async () => {
  $('ordreStatus').textContent = "Retour à l'ordre automatique…";
  try {
    if (ordreZ2) { await enregistrerOrdre2(ordreZ2, []); dessinerOrdre2(await dossiersZone2(ordreZ2)); }
    else { await enregistrerOrdreAV(ordreAV, []); dessinerOrdre(await tachesAV(ordreAV)); }
    $('ordreStatus').textContent = 'Ordre automatique rétabli.';
  }
  catch (e) { $('ordreStatus').textContent = e.message; }
};

async function charger(items) {
  if (!items || items.length !== 1) return;
  $('retourOrdre').hidden = true;
  await flush();
  await flushOrdre();
  let item = items[0];
  if (item.type === 'shape') {
    const m0 = await item.getMetadata('pbh').catch(() => null);
    if (m0?.role === 'hdr3') { await ouvrirOrdre(m0.av); return; }
    if (m0?.role === 'hdr2') { await ouvrirOrdre2(m0.col); return; }
    if (m0?.role === 'pkt') { await ouvrirParking(); return; }
    if (m0?.role === 'ch4' && m0.ref) item = await miro.board.getById(m0.ref).catch(() => null);   // ligne du tableau de chasse
  }
  if (item.type === 'card') {
    const m = await item.getMetadata('pbh').catch(() => null);
    if (!m || !['prio', 'av', 'pk'].includes(m.role) || !m.ref) return;
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
