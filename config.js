// Référentiel du point business hebdo (code validé par Johan, cf. cadrage 11/10/2026).
// Aucune donnée client ici : les dossiers vivent uniquement dans le board Miro.

export const PILOTES = [
  { code: 'AC', nom: 'André C.' },
  { code: 'JAN', nom: 'Johan A.' },
  { code: 'JD', nom: 'Jérôme D.' },
  { code: 'NB', nom: 'Nicolas B.' },
  { code: 'LR', nom: 'Lionel R.' },
  { code: 'FS', nom: 'François S.' },
  { code: 'CD', nom: 'Cédric D.' },
];

// Ordre = ordre de rangement dans une section (haut -> bas).
export const ENJEUX = [
  { code: 'S', label: 'Stratégique', court: 'Strat.', fill: '#7a0d8e', text: '#ffffff' },
  { code: 'E1', label: 'Enjeu 1', court: 'E1', fill: '#f24726', text: '#ffffff' },
  { code: 'E2', label: 'Enjeu 2', court: 'E2', fill: '#ecac06', text: '#ffffff' },
  { code: 'E3', label: 'Enjeu 3', court: 'E3', fill: '#2dc75c', text: '#ffffff' },
  { code: 'Q', label: 'À qualifier', court: 'À qualif.', fill: '#ffffff', text: '#1a1a1a' },
  { code: 'C', label: 'Closing', court: 'Closing', fill: '#1a1a1a', text: '#ffffff' },
  { code: 'G', label: 'Signé · attente ARC', court: 'Signé', fill: '#e7e7e7', text: '#1a1a1a' },
];

export const PRIORITES = ['P1', 'P2', 'P3', 'Autres', '—'];
export const RESSOURCES = ['AG', 'OP', 'PS', 'JAB', 'FS'];
export const LIVRABLES = ['plan', 'devis', 'plan + devis', 'esquisse', "Réponse appel d'offre",
  'enveloppe', 'CDC', 'RDV', 'BERCHER', 'Retrofit', 'Plan action', 'étude', 'relance',
  'manque infos commercial'];

export const CARSAT = '#af7e04';
export const BLEU = '#002060';
export const OR = '#FDB913';
export const GRIS_FOND = '#F1F2F4';

// Géométrie (unités Miro). Cadres au ratio A3 paysage pour l'export PDF natif.
export const G = {
  cardW: 176, cardH: 38, gapX: 10, gapY: 6, maxRows: 25,   // 25 dossiers max par colonne
  frameW: 2970, frameH: 2100, margin: 40, top: 150,   // top = titre + en-têtes de section
  sectionPad: 12, sectionGap: 20, hdrH: 64, barH: 20,
};

export const ZONE1_TITLE = '1 · Avancement avant-vente par pilote';
export const ZONE2_TITLE = '2 · Gestion des priorités';
export const COLONNES_PRIO = ['P1', 'P2', 'P3', 'Autres'];
export const LIBELLE_PRIO = { P1: 'Priorité 1', P2: 'Priorité 2', P3: 'Priorité 3', Autres: 'Autres' };
export const G2 = { colGap: 30, cardW: 320, cardPad: 12, rowStep: 76, gap: 8, top: 150, titreMax: 28 };   // 1 colonne par priorité
export const ZONE3_TITLE = '3 · Charge avant-vente';
export const HORIZONS = ['Cette semaine', 'Plus tard'];   // zone 3 : cette semaine / tout le reste
export const LIVRABLES_PLAN = ['plan', 'plan + devis', 'esquisse'];
export const LIVRABLES_DEVIS = ['devis', 'plan + devis'];
export const G3 = { labelW: 160, colGap: 20, rowGap: 16, cardW: 260, cardPad: 12, rowStep: 76, gap: 8, top: 150, titreMax: 22 };
export const ZONE4_TITLE = '4 · Tableau de chasse';
export const G4 = { cols: [560, 110, 1100, 170], ligneH: 44, enteteH: 40, bandeauH: 84, blocGap: 70, top: 110 };   // tableau façon slide CODIR
// Objectif de signatures par trimestre (k€) : 2026 = 10 M€/an, 2027 = 11 M€/an (COCOM / CODIR)
export const OBJECTIF_TRIM = { 2026: 2500, 2027: 2750, 2028: 2750 };
export const PART_SCENARIOS = [0.6, 0.9];   // scénarios négatif / positif sur le reste à signer
export const META = 'pbh';            // clé de métadonnées de l'app sur chaque objet
