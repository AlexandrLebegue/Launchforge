/**
 * Déclinaison des validations par TYPE DE POST (plateforme).
 * Chaque plateforme = un sous-bloc avec sa checklist propre.
 *
 * Les spécificités sont extraites du code :
 *   - src/services/agentService.ts  (PLATFORM_GUIDELINES — codes rédactionnels)
 *   - src/services/composio.ts      (MEDIA_REQUIRED, publication directe/opérateur,
 *                                    canonicalPostUrl, METRICS_HINTS)
 *   - client/.../ContentHubPage.tsx (PLATFORMS, aperçus dédiés, champ subreddit)
 */

// Métadonnées par plateforme (ordre = ordre d'affichage)
const PLATFORMS = [
  {
    code: 'LI', name: 'LinkedIn', icon: '💼',
    guide: '≤ 1300 caractères, accroche en 1re ligne, paragraphes courts, storytelling, call-to-action final',
    media: 'optional',
    preview: 'dédié',
    publish: 'directe (API Composio, déterministe)',
    permalink: 'reconstruit depuis l\'URN (urn:li:share/activity/ugcPost → /feed/update/…)',
    metrics: 'likes = nombre de réactions ; impressions & commentaires d\'un post PERSONNEL = 0 (LINKEDIN_GET_SHARE_STATS en 403 sur un post perso est NORMAL)',
  },
  {
    code: 'TW', name: 'X / Twitter', icon: '🐦',
    guide: 'tweet unique ≤ 280 caractères OU thread de 3-5 tweets numérotés, accroche forte, ≤ 2 hashtags',
    media: 'optional',
    preview: 'dédié',
    publish: 'directe (API Composio)',
    permalink: 'https://x.com/i/web/status/<id> (id = nombre final de l\'URL /status/)',
    metrics: 'public_metrics : vues, likes, réponses, reposts',
  },
  {
    code: 'IG', name: 'Instagram', icon: '📸',
    guide: 'légende engageante avec emojis, 10-15 hashtags en fin, visuel suggéré',
    media: 'image', // OBLIGATOIRE
    preview: 'dédié',
    publish: 'opérateur IA (outil de publication média)',
    permalink: 'aucun permalien public fiable — l\'API ne renvoie qu\'un id non résolvable (externalUrl peut rester vide)',
    metrics: 'difficile : sans permalien public, la synchro auto peut échouer → saisie/relevé manuel souvent nécessaire',
  },
  {
    code: 'FB', name: 'Facebook', icon: '📘',
    guide: 'post adapté au fil Facebook (pas de guideline dédiée — l\'IA adapte aux codes Facebook)',
    media: 'optional',
    preview: 'générique',
    publish: 'opérateur IA',
    permalink: 'selon la réponse de l\'outil (URL si renvoyée, sinon id)',
    metrics: 'via opérateur IA (selon outils Facebook connectés)',
  },
  {
    code: 'TK', name: 'TikTok', icon: '🎵',
    guide: 'légende courte adaptée à une vidéo verticale',
    media: 'media', // vidéo, ou image pour post photo — OBLIGATOIRE
    preview: 'générique',
    publish: 'opérateur IA',
    permalink: 'pas de permalien public fiable (id non résolvable)',
    metrics: 'via opérateur IA',
    ownApp: true, // nécessite une app développeur (OAuth non géré par Composio)
  },
  {
    code: 'YT', name: 'YouTube', icon: '▶️',
    guide: 'titre + description de vidéo',
    media: 'video', // OBLIGATOIRE
    preview: 'dédié',
    publish: 'opérateur IA (upload vidéo)',
    permalink: 'https://youtu.be/<id 11 caractères>',
    metrics: 'via opérateur IA',
  },
  {
    code: 'RD', name: 'Reddit', icon: '🟠',
    guide: 'titre accrocheur + corps authentique, AUCUN ton publicitaire, apporter de la valeur avant de citer le produit, suggérer 2-3 subreddits',
    media: 'optional',
    preview: 'dédié',
    publish: 'opérateur IA — post TEXTE (self post), jamais un post lien',
    permalink: 'depuis /comments/<id> de l\'URL Reddit',
    metrics: 'likes = score (votes nets), commentaires = num_comments ; PAS de vues (impressions=0) ; shares/clics = 0',
    subreddit: true, // OBLIGATOIRE
  },
  {
    code: 'BL', name: 'Blog / SEO', icon: '🧩',
    guide: 'article long format optimisé SEO (structure, titres, mots-clés)',
    media: 'optional',
    preview: 'générique',
    publish: 'manuel (copier-coller — pas de publication via comptes connectés)',
    permalink: 'saisi manuellement (URL de l\'article publié)',
    metrics: 'saisie manuelle',
  },
  {
    code: 'NL', name: 'Newsletter', icon: '✉️',
    guide: 'format email : objet accrocheur, corps structuré, CTA',
    media: 'optional',
    preview: 'générique',
    publish: 'manuel (copier-coller vers l\'outil d\'emailing)',
    permalink: 'saisi manuellement si version web',
    metrics: 'saisie manuelle (ouvertures/clics depuis l\'outil d\'emailing)',
  },
  {
    code: 'PH', name: 'Product Hunt', icon: '🐱',
    guide: 'tagline ≤ 60 caractères, description produit, premier commentaire du maker (authentique, le « pourquoi »)',
    media: 'optional',
    preview: 'générique',
    publish: 'opérateur IA',
    permalink: 'selon la réponse de l\'outil',
    metrics: 'manuelle / via opérateur',
  },
  {
    code: 'HN', name: 'Hacker News', icon: '🟧',
    guide: 'titre « Show HN » sobre et factuel, présentation technique honnête, AUCUN marketing/hype',
    media: 'none',
    preview: 'générique',
    publish: 'opérateur IA',
    permalink: 'selon la réponse de l\'outil (item id HN)',
    metrics: 'manuelle / via opérateur',
  },
  {
    code: 'IH', name: 'Indie Hackers', icon: '🔨',
    guide: 'post de milestone / partage d\'expérience, chiffres concrets, leçons apprises, ton transparent',
    media: 'optional',
    preview: 'générique',
    publish: 'opérateur IA',
    permalink: 'selon la réponse de l\'outil',
    metrics: 'manuelle / via opérateur',
  },
];

// Texte « attendu » du cas Média selon le type
function mediaExpected(p) {
  switch (p.media) {
    case 'image':
      return `IMAGE OBLIGATOIRE. Sans visuel, la publication est BLOQUÉE en amont (message « ECHEC : ${p.name} exige une image ») avant tout appel — aucun texte seul n'est publié. Avec image : elle est jointe à la publication.`;
    case 'video':
      return `VIDÉO OBLIGATOIRE. Sans vidéo, blocage en amont (« ECHEC : ${p.name} exige une vidéo »). La vidéo locale (/uploads) exige APP_URL pour être téléchargeable par la plateforme.`;
    case 'media':
      return `MÉDIA OBLIGATOIRE (vidéo, ou image pour un post photo). Sans média, blocage en amont. Média local (/uploads) → APP_URL requis pour une URL publique.`;
    case 'none':
      return `Format texte : pas de média attendu.`;
    default:
      return `Média FACULTATIF. S'il est présent et hébergé localement (/uploads), APP_URL doit être configuré pour que la plateforme puisse le télécharger (sinon « ECHEC : média local… »).`;
  }
}

function previewExpected(p) {
  return p.preview === 'dédié'
    ? `Aperçu DÉDIÉ ${p.name} fidèle au rendu réel${p.code === 'RD' ? ' (en-tête r/subreddit, titre, corps)' : ''}, mis à jour au fil de la frappe.`
    : `Aperçu générique (pas de gabarit dédié à ${p.name}) — vérifier que le texte et le média s'affichent correctement.`;
}

// Construit la checklist standard d'une plateforme (chaque validation « déclinée »)
function buildCases(p) {
  const cases = [];
  const id = (n) => `${p.code}${n}`;

  cases.push({
    id: id(1),
    t: `Adaptation au format ${p.name}`,
    e: [`Créer un post avec ${p.name} comme plateforme principale`, `Rédiger via l'IA (ou décliner depuis une autre plateforme)`],
    a: `Le contenu respecte les codes ${p.name} : ${p.guide}.`,
    man: true,
  });

  cases.push({
    id: id(2),
    t: `Aperçu en direct (${p.preview})`,
    e: `Sélectionner ${p.name} et observer l'aperçu`,
    a: previewExpected(p),
    man: true,
  });

  cases.push({
    id: id(3),
    t: `Règle de média`,
    e: `Tenter de publier ${p.media === 'none' ? '(texte seul)' : 'avec et sans média'}`,
    a: mediaExpected(p),
  });

  // Cas spécifique subreddit (Reddit)
  if (p.subreddit) {
    cases.push({
      id: id('3b'),
      t: `Subreddit cible OBLIGATOIRE`,
      e: [`Sélectionner Reddit`, `Laisser le champ Subreddit vide puis tenter de publier`, `Renseigner un subreddit (préfixe « r/ » nettoyé)`],
      a: `Sans subreddit : BLOCAGE (« ECHEC : indiquez le subreddit cible »). Avec subreddit : post TEXTE (self) dans r/<sub>, titre = champ Titre (ou 1re ligne), jamais un post lien.`,
      man: true,
    });
  }

  // Cas spécifique « app propre » (TikTok)
  if (p.ownApp) {
    cases.push({
      id: id('3c'),
      t: `Connexion nécessitant une app développeur`,
      e: `Connecter ${p.name} dans Configuration`,
      a: `Réponse 409 NEEDS_OWN_APP avec les champs à fournir ; la connexion n'aboutit qu'après envoi des identifiants de l'app développeur.`,
    });
  }

  cases.push({
    id: id(4),
    t: `Publication — ${p.publish.split('(')[0].trim()}`,
    e: p.publish.startsWith('manuel')
      ? `Constater l'absence de « Publier maintenant » réel pour ${p.name}`
      : [`Marquer publié / « Publier maintenant »`, `Lire le résultat par plateforme`],
    a: p.publish.startsWith('manuel')
      ? `${p.name} n'est pas publié via comptes connectés : le contenu est fourni à copier-coller ; statut passé « publié » manuellement.`
      : `Publication via ${p.publish}. Résultat clair OK (1 phrase + lien/id) ou ECHEC (raison) ; en cas d'échec, publishError stocké et affiché.`,
    man: true,
  });

  cases.push({
    id: id(5),
    t: `Lien / permalien du post publié`,
    e: `Après publication, vérifier le lien « Voir sur ${p.name} »`,
    a: `Permalien : ${p.permalink}.`,
  });

  cases.push({
    id: id(6),
    t: `Synchronisation des métriques`,
    e: p.metrics.startsWith('saisie manuelle') || p.metrics.startsWith('manuelle')
      ? `Saisir manuellement les métriques du post`
      : [`Renseigner l'URL du post publié`, `Cliquer « Synchroniser »`],
    a: `Métriques ${p.name} : ${p.metrics}.`,
    man: true,
  });

  cases.push({
    id: id(7),
    t: `Validation manuelle d'un contenu ${p.name}`,
    e: [`Mode « validation » (manual)`, `Relire le contenu ${p.name} dans Validations`, `Éditer si besoin puis approuver`],
    a: `Avant d'approuver : vérifier que l'adaptation aux codes ${p.name} est respectée${p.subreddit ? ' et qu\'un subreddit est défini' : ''}${p.media === 'image' || p.media === 'video' || p.media === 'media' ? ` et qu'un média est joint (obligatoire)` : ''}. À l'approbation, le contenu (édité) part comme une publication ${p.name}.`,
    man: true,
  });

  cases.push({
    id: id(8),
    t: `Déclinaison (crosspost) vers ${p.name}`,
    e: [`Depuis un post existant, décliner vers ${p.name} (option « adapter »)`],
    a: `Un exemplaire indépendant ${p.name} est créé (groupé par crossPostId), réécrit aux codes ${p.name}${p.media === 'image' || p.media === 'video' || p.media === 'media' ? ` ; rappel : média obligatoire avant publication` : ''}${p.subreddit ? ` ; subreddit à renseigner` : ''}.`,
  });

  return cases;
}

const groups = PLATFORMS.map((p) => ({
  code: p.code,
  name: p.name,
  icon: p.icon,
  summary:
    `Média : ${p.media === 'image' ? 'image OBLIGATOIRE' : p.media === 'video' ? 'vidéo OBLIGATOIRE' : p.media === 'media' ? 'média OBLIGATOIRE' : p.media === 'none' ? 'aucun (texte)' : 'facultatif'}` +
    ` · Publication : ${p.publish.split('(')[0].trim()}` +
    ` · Aperçu : ${p.preview}` +
    (p.subreddit ? ' · Subreddit requis' : '') +
    (p.ownApp ? ' · App dev requise' : ''),
  cases: buildCases(p),
}));

const platformSection = {
  id: 'V',
  title: 'Validation déclinée par type de post (plateforme)',
  intro:
    "Pour CHAQUE plateforme, déclinaison de toutes les validations : adaptation au format, aperçu, " +
    "règle de média, publication, permalien, métriques, validation manuelle et déclinaison. " +
    "Les contraintes spécifiques (média obligatoire, subreddit, app développeur) sont mises en évidence.",
  groups,
};

// Annexe : plateformes gérées uniquement par les agents (Kanban), hors éditeur de post du Hub.
const agentOnly = {
  title: 'Annexe — plateformes « agents » (Kanban, hors éditeur de post)',
  note:
    "Discord, Slack et GitHub ne figurent pas dans l'éditeur de post du Hub : elles sont pilotées par les agents du Kanban " +
    "(assignation d'une carte → rédaction → publication/validation). Mêmes principes de validation (adaptation au format, " +
    "mode auto/manuel), via les outils Composio correspondants.",
  rows: [
    { code: 'DC', name: 'Discord', icon: '💬', fmt: 'message court et conversationnel, adapté à un canal communautaire, pas de spam' },
    { code: 'SL', name: 'Slack', icon: '💛', fmt: 'message concis et utile pour un workspace communautaire' },
    { code: 'GH', name: 'GitHub', icon: '🐙', fmt: 'README/release notes ou issue/discussion, technique et précis' },
  ],
};

// ──────────────────────────────────────────────────────────────────────────
// Section W — Récurrence, programmation & auto-publication (par plateforme)
// ──────────────────────────────────────────────────────────────────────────
const recurrenceSection = {
  id: 'W',
  title: 'Récurrence, programmation & auto-publication (par plateforme)',
  intro:
    "Le worker d'auto-publication (tick 60 s) republie via le même moteur que « Publier maintenant » : " +
    "il HÉRITE donc de toutes les contraintes de chaque plateforme (média obligatoire, subreddit, APP_URL). " +
    "Tester les mécanismes généraux puis la déclinaison des pré-requis d'auto-publication par plateforme.",
  manual: false,
  matrixManual: false,
  cases: [
    { id: 'W1', t: "Worker d'auto-publication (tick 60 s)", e: "Programmer un post (statut « programmé » + publication auto) à échéance proche", a: "À l'échéance, le post est publié automatiquement sans intervention (worker actif si Composio + IA configurés)." },
    { id: 'W2', t: "Re-vérification d'état avant envoi", e: "Supprimer / publier manuellement un post entre sa programmation et l'échéance", a: "Le worker re-lit l'état : si le post n'est plus « programmé », il ne le republie pas (pas d'écrasement / doublon)." },
    { id: 'W3', t: "Création de la prochaine occurrence", e: "Publier (auto ou manuel) un post récurrent", a: "La prochaine occurrence est créée et datée selon la récurrence, héritant de l'auto-publication ; métriques remises à zéro." },
    { id: 'W4', t: "Types de récurrence", e: "Tester aucune / quotidien / hebdo / quinzaine / mensuel", a: "L'écart de date de la prochaine occurrence correspond exactement au type choisi." },
    { id: 'W5', t: "Régénération IA de la série (instruction)", e: "Définir une instruction de série (recurrenceBrief) puis publier", a: "L'occurrence suivante est réécrite par l'IA selon l'instruction (sinon contenu identique).", man: true },
    { id: 'W6', t: "Mémoire de série (actus / connaissances / MAJ KB)", e: "Basculer useNews / useKnowledge / updateKb", a: "Options respectées dans la génération ; updateKb=1 enrichit la base de connaissances après publication." },
    { id: 'W7', t: "Simulation sans enregistrement", e: "Utiliser « Simuler » la prochaine occurrence", a: "Aperçu du titre + contenu proposés, RIEN n'est enregistré (ni post, ni base de connaissances).", man: true },
    { id: 'W8', t: "Échec d'auto-publication = désactivation", e: "Provoquer un échec à l'échéance (média manquant, compte déconnecté…)", a: "L'auto-publication est DÉSACTIVÉE (autoPublish=0) et l'erreur est stockée (publishError) ; à corriger puis réactiver." },
    { id: 'W9', t: "URL + nettoyage vidéo après succès", e: "Auto-publier un post avec vidéo", a: "L'URL publique du post est résolue (externalUrl) et la vidéo locale (/uploads) est nettoyée une fois récupérée par la plateforme." },
    { id: 'W10', t: "Synchro calendrier de l'occurrence", e: "Après création de la prochaine occurrence", a: "La nouvelle occurrence programmée est poussée vers le calendrier personnel (best-effort)." },
  ],
  matrix: {
    head: ['ID', 'Plateforme', "Pré-requis à CHAQUE occurrence auto-publiée", 'Comportement attendu si non rempli'],
    rows: [
      ['W-LI', '💼 LinkedIn', 'Aucun blocage média ; texte ≤ 1300 car.', 'Auto-publie le texte (+ média si présent). OK attendu.'],
      ['W-TW', '🐦 X / Twitter', 'Texte ≤ 280 car. (ou thread)', 'Auto-publie le tweet/thread. OK attendu.'],
      ['W-IG', '📸 Instagram', 'IMAGE obligatoire sur l\'occurrence', 'Sans image : ECHEC en amont → auto-publication désactivée + publishError. Vérifier que la série porte bien un visuel.'],
      ['W-FB', '📘 Facebook', 'Aucun blocage média', 'Auto-publie via opérateur IA. OK attendu.'],
      ['W-TK', '🎵 TikTok', 'MÉDIA obligatoire + app dev connectée', 'Sans média/connexion : ECHEC → désactivation.'],
      ['W-YT', '▶️ YouTube', 'VIDÉO obligatoire ; média local → APP_URL', 'Sans vidéo (ou APP_URL manquant pour /uploads) : ECHEC → désactivation.'],
      ['W-RD', '🟠 Reddit', 'SUBREDDIT renseigné sur l\'occurrence', 'Sans subreddit : ECHEC (« indiquez le subreddit cible ») → désactivation. Post TEXTE.'],
      ['W-PH', '🐱 Product Hunt', 'Faisabilité via opérateur IA', 'Publication possible mais non déterministe : vérifier le résultat OK/ECHEC.'],
      ['W-XX', '🟧 HN · 🔨 Indie Hackers', 'Faisabilité via opérateur IA', 'Idem : résultat à contrôler (ces plateformes restent souvent semi-manuelles).'],
      ['W-BL', '🧩 Blog · ✉️ Newsletter', '— (pas de publication Composio)', 'Auto-publication NON APPLICABLE : contenu à copier-coller, statut « publié » posé manuellement.'],
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Section X — Détection de leads via commentaires/réactions (par plateforme)
// ──────────────────────────────────────────────────────────────────────────
const leadsSection = {
  id: 'X',
  title: 'Détection de leads via commentaires & réactions (par plateforme)  ★ manuel',
  intro:
    "Le scan des réactions d'un post (likes + commentaires) dépend des outils Composio de la plateforme. " +
    "Section à FORT contrôle manuel : relire chaque lead détecté, son score et son attribution. " +
    "Vérifier les mécanismes communs puis ce qui est réellement lisible par plateforme.",
  manual: true,
  matrixManual: true,
  cases: [
    { id: 'X1', t: "Analyser des messages collés (toutes sources)", e: "Coller commentaires/DMs/emails + préciser la source → « Détecter les leads »", a: "L'IA détecte, nomme, score (0-100) et résume les personnes réelles — relire/corriger avant ajout.", man: true },
    { id: 'X2', t: "Scanner la boîte mail", e: "« Analyser ma boîte mail » (Composio Gmail)", a: "Leads détectés depuis les emails reçus.", man: true },
    { id: 'X3', t: "Pondération du scoring", e: "Fournir un mélange : like seul, repartage avec texte, commentaire avec question/besoin", a: "Commentaire avec besoin >> repartage avec texte (50-70) >> like seul (30-45) ; signaux d'une même personne regroupés (score renforcé).", man: true },
    { id: 'X4', t: "Filtrage bots / spam / négatifs", e: "Inclure des bots, spams et commentaires purement négatifs", a: "Ils sont ignorés (non transformés en leads)." },
    { id: 'X5', t: "Garde-fou anti-hallucination", e: "Cas où les outils ne peuvent pas lire les réactions", a: "Si le modèle propose des leads SANS avoir lu de réactions (0 appel outil réussi), le résultat est REJETÉ par sécurité (erreur)." , man: true },
    { id: 'X6', t: "Attribution post → lead", e: "Scanner les réactions d'un post précis", a: "La source du lead mentionne « réactions post [id court] <plateforme> » (traçabilité)." },
    { id: 'X7', t: "Pré-requis du scan de post", e: "Tenter un scan sur un post non publié / sans URL", a: "Refus : le post doit être publié ET avoir son URL renseignée (section métriques)." },
  ],
  matrix: {
    head: ['ID', 'Plateforme', 'Ce qui est lisible (réactions)', 'Pré-requis / limites'],
    rows: [
      ['X-RD', '🟠 Reddit', 'Commentaires + score (votes) du post', 'URL /comments/<id>. Bonne couverture (commentaires détaillés).'],
      ['X-LI', '💼 LinkedIn', 'Réactions (= likes) ; commentaires LIMITÉS sur post personnel', 'URN urn:li:share/activity (extrait de l\'URL). Stats perso souvent restreintes.'],
      ['X-TW', '🐦 X / Twitter', 'Réponses (commentaires) + personnes ayant liké/reposté', 'id du tweet via /status/<id>.'],
      ['X-IG', '📸 Instagram', 'Commentaires si les outils connectés le permettent', 'Pas de permalien public fiable → attribution par URL DIFFICILE (id média / saisie souvent requise).'],
      ['X-FB', '📘 Facebook', 'Selon les outils Facebook connectés', 'Couverture variable ; vérifier au cas par cas.'],
      ['X-YT', '▶️ YouTube', 'Commentaires de la vidéo (si outils dispo)', 'URL youtu.be/<id>.'],
      ['X-NA', '🧩 Blog · ✉️ Newsletter · 🐱 PH · 🟧 HN · 🔨 IH', 'Scan des réactions NON géré (pas d\'outils Composio dédiés)', 'Utiliser « Analyser des messages collés » à la place (copier les commentaires manuellement).'],
    ],
  },
};

module.exports = { platformSection, agentOnly, recurrenceSection, leadsSection };
