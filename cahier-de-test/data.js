/**
 * Cahier de test LaunchForge — données structurées.
 * Chaque section = un module fonctionnel. Chaque cas = une ligne de checklist.
 *
 * Champs d'un cas :
 *   id   : identifiant (ex. E3)
 *   t    : intitulé du cas de test
 *   e    : étapes (string ou tableau de strings)
 *   a    : résultat attendu (string ou tableau de strings)
 *   man  : true => cas à vérification MANUELLE renforcée (mis en évidence)
 *   pre  : prérequis spécifique (optionnel)
 */

const sections = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'A',
    title: 'Authentification & gestion de compte',
    intro:
      "Inscription, connexion (mot de passe + Google OAuth), réinitialisation, " +
      "et droits RGPD (export / suppression). Tester aussi les limites anti-abus.",
    cases: [
      { id: 'A1', t: "Inscription par email", e: ["Aller sur /register", "Saisir email + mot de passe (≥ 6 car.) + nom", "Valider"], a: "Compte créé, connexion automatique, redirection vers le tableau de bord. Le token est stocké (localStorage)." },
      { id: 'A2', t: "Inscription — mot de passe trop court", e: "Saisir un mot de passe < 6 caractères", a: "Refus avec message « Password must be at least 6 characters ». Aucun compte créé." },
      { id: 'A3', t: "Inscription — email déjà existant", e: "Réutiliser un email déjà inscrit", a: "Erreur 409 « A user with this email already exists »." },
      { id: 'A4', t: "Connexion valide", e: ["Aller sur /login", "Saisir identifiants corrects"], a: "Connexion réussie, redirection vers le tableau de bord." },
      { id: 'A5', t: "Connexion — identifiants invalides", e: "Saisir un mauvais mot de passe", a: "Message générique « Invalid email or password » (pas d'indice sur quel champ est faux)." },
      { id: 'A6', t: "Bouton « Continuer avec Google » conditionnel", e: "Charger /login et /register", a: "Le bouton Google n'apparaît QUE si le serveur est configuré (GOOGLE_CLIENT_ID présent). Sinon il est masqué proprement." },
      { id: 'A7', t: "Connexion Google (OAuth)", e: ["Cliquer « Continuer avec Google »", "Choisir un compte Google avec email vérifié", "Autoriser"], a: "Retour sur l'app connecté ; compte créé ou rattaché à l'email existant ; redirection tableau de bord." },
      { id: 'A8', t: "Google — email non vérifié refusé", e: "Tenter avec un compte Google dont l'email n'est pas vérifié", a: "Connexion refusée (erreur email_unverified)." },
      { id: 'A9', t: "Mot de passe oublié", e: ["/forgot-password", "Saisir son email", "Valider"], a: "Message TOUJOURS générique (pas d'énumération d'emails). Si email existant : lien de réinitialisation envoyé (ou journalisé serveur)." },
      { id: 'A10', t: "Réinitialisation du mot de passe", e: ["Ouvrir le lien reçu (/reset-password?token=…)", "Saisir un nouveau mot de passe"], a: "Mot de passe changé, connexion directe. Le lien est à usage unique et expire après 30 min." },
      { id: 'A11', t: "Lien de reset expiré / réutilisé", e: "Ouvrir un lien déjà utilisé ou vieux de > 30 min", a: "Message « Lien invalide ou expiré »." },
      { id: 'A12', t: "Persistance de session", e: ["Se connecter", "Recharger la page (F5)"], a: "Reste connecté (token JWT 7 jours). /me renvoie l'utilisateur." },
      { id: 'A13', t: "Déconnexion", e: "Cliquer « Déconnexion » dans la barre latérale", a: "Token effacé, retour à la landing page. Les routes protégées redirigent." },
      { id: 'A14', t: "Export RGPD des données", e: "Déclencher l'export (GET /api/auth/export)", a: "Téléchargement d'un JSON « launchforge-mes-donnees.json » contenant toutes les données de l'utilisateur.", man: true },
      { id: 'A15', t: "Suppression du compte (RGPD)", e: ["Demander la suppression", "Re-saisir le mot de passe pour confirmer"], a: "Suppression DÉFINITIVE : compte, projets, posts, contacts, connaissances, médias, liaisons Telegram, comptes Composio propres. Mot de passe incorrect => refus.", man: true },
      { id: 'A16', t: "Anti-force brute (rate limiting)", e: "Enchaîner > 10 tentatives de login en 10 min", a: "Les requêtes excédentaires sont bloquées (HTTP 429) ; idem register (20/h), forgot (5/15min), reset (10/15min)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'B',
    title: 'Pages publiques, légales & SEO',
    intro: "Vitrine accessible sans connexion et conformité (mentions, confidentialité, référencement).",
    cases: [
      { id: 'B1', t: "Landing page (non connecté)", e: "Ouvrir / sans être connecté", a: "La page d'accueil marketing s'affiche (et non le tableau de bord)." },
      { id: 'B2', t: "Mentions légales", e: "Ouvrir /legal", a: "Page mentions légales lisible et complète." },
      { id: 'B3', t: "Politique de confidentialité", e: "Ouvrir /privacy", a: "Page de confidentialité lisible et complète." },
      { id: 'B4', t: "robots.txt", e: "Ouvrir /robots.txt", a: "Disallow /api/ et /uploads/, et ligne Sitemap si APP_URL est configurée." },
      { id: 'B5', t: "sitemap.xml", e: "Ouvrir /sitemap.xml", a: "XML valide listant /, /login, /register, /legal, /privacy (si APP_URL configurée ; 404 sinon)." },
      { id: 'B6', t: "Redirection routes inconnues", e: "Ouvrir une URL inexistante (ex. /xyz)", a: "Redirection vers / (pas d'écran blanc)." },
      { id: 'B7', t: "Accès route protégée non connecté", e: "Ouvrir /content sans token", a: "Pas d'accès aux données ; affichage landing / redirection." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'C',
    title: "Onboarding & création de projet (IA)",
    intro:
      "Entretien conversationnel qui interroge l'utilisateur, fait des recherches web, " +
      "puis génère le plan + amorce la base de connaissances et le Hub de contenu. " +
      "Section à FORT contrôle manuel : il faut relire la conversation et le plan produit.",
    manual: true,
    cases: [
      { id: 'C1', t: "Démarrer un nouveau projet", e: ["Cliquer « Nouveau projet » / aller sur /new", "Lire le message d'accueil de l'assistant"], a: "Une session d'onboarding démarre avec le message de bienvenue (FR/EN)." },
      { id: 'C2', t: "Décrire son entreprise (texte)", e: "Répondre en langage naturel (nom, site, ou idée en une phrase)", a: "L'assistant pose des questions de suivi pertinentes et fait des recherches (actions 🔍 visibles)." , man: true },
      { id: 'C3', t: "Joindre un document", e: "Joindre un PDF/texte (pitch, business plan)", a: "Le document est pris en compte dans les réponses de l'IA (jusqu'à 3 pièces)." , man: true },
      { id: 'C4', t: "Streaming de la réponse (SSE)", e: "Envoyer un message", a: "La réponse s'affiche en continu (delta), les recherches web apparaissent comme actions." },
      { id: 'C5', t: "Reprise après rechargement", e: ["Recharger la page en cours d'onboarding"], a: "La session et l'historique des messages sont conservés." },
      { id: 'C6', t: "Échec d'un tour IA", e: "Provoquer/observer une erreur réseau pendant un tour", a: "Le message en échec n'est PAS persisté : on peut renvoyer le même message." },
      { id: 'C7', t: "Finalisation & génération du plan", e: ["Aller jusqu'au bout de l'entretien"], a: "Session « completed », profil validé, plan de lancement créé et devenu le projet actif.", man: true },
      { id: 'C8', t: "Amorçage automatique (knowledge + contenu)", e: "À la fin de la génération, ouvrir Connaissances puis Hub de contenu", a: "La base de connaissances est pré-remplie depuis le profil ; ~6 idées de posts (2 sem. × 3) sont rédigées et datées en brouillon.", man: true },
      { id: 'C9', t: "Cohérence du plan généré", e: "Relire le plan (objectifs, phases, audience, plateformes)", a: "Le plan reflète fidèlement les informations fournies — vérification manuelle du contenu IA.", man: true },
      { id: 'C10', t: "Notification Telegram (si lié)", e: "Compte Telegram lié avant la création", a: "Message Telegram « Ton plan est prêt » avec le nombre de posts amorcés." },
      { id: 'C11', t: "IA non configurée", e: "Sans OPENROUTER_API_KEY", a: "Onboarding renvoie AI_NOT_CONFIGURED (503) proprement." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'D',
    title: "Tableau de bord & Kanban (plan de lancement)",
    intro: "Vue d'ensemble du projet actif : chiffres clés, prochaine publication, phases et tâches Kanban, assignation d'agents.",
    cases: [
      { id: 'D1', t: "Affichage du tableau de bord", e: "Ouvrir / (connecté, projet actif)", a: "Chiffres clés, prochaine publication, objectifs et phases du plan s'affichent." },
      { id: 'D2', t: "Kanban — colonnes & cartes", e: "Visualiser les phases / cartes du plan", a: "Cartes réparties par colonne (à faire / en cours / fait), catégorie et effort visibles." },
      { id: 'D3', t: "Déplacer une carte (drag & drop)", e: "Glisser une carte d'une colonne à l'autre", a: "L'état Kanban est sauvegardé (PATCH /api/plan/:id/kanban) et persiste après rechargement." },
      { id: 'D4', t: "Assigner une carte à une plateforme/agent", e: "Assigner une tâche à une plateforme", a: "Un agent est trouvé/créé silencieusement, un run démarre (status running puis done/awaiting)." },
      { id: 'D5', t: "Badges de run temps réel", e: "Observer la carte après assignation", a: "Le badge de statut du run se met à jour (running → done / awaiting_approval / failed)." },
      { id: 'D6', t: "Lecteur (rôle viewer) en lecture seule", e: "Sur un projet d'équipe, en rôle Lecteur, tenter de modifier le Kanban", a: "Action refusée (403 « Rôle Lecteur »)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'E',
    title: "Hub de contenu — éditeur de post",
    intro: "Cœur de l'app : création/édition de posts. Tester chaque champ de l'éditeur et l'aperçu en direct.",
    manual: true,
    cases: [
      { id: 'E1', t: "Liste des posts du projet", e: "Ouvrir /content", a: "Tous les posts du projet actif s'affichent (statut, plateforme, date)." },
      { id: 'E2', t: "Recherche & filtres", e: "Filtrer par texte, statut, plateforme", a: "La liste se restreint correctement à chaque filtre." },
      { id: 'E3', t: "Créer un post (champs de base)", e: ["Cliquer « Créer un post »", "Choisir plateforme(s), statut, titre, contenu"], a: "La 1re plateforme est « principale » ; le post se crée en brouillon par défaut." },
      { id: 'E4', t: "Champ subreddit (Reddit)", e: "Choisir Reddit comme plateforme", a: "Un champ subreddit apparaît ; le préfixe « r/ » est nettoyé automatiquement." },
      { id: 'E5', t: "Média — upload image", e: "Téléverser une image", a: "L'image est hébergée et attachée (aperçu visible)." , man: true },
      { id: 'E6', t: "Média — coller une URL", e: "Coller une URL d'image/GIF/vidéo", a: "Le média est rattaché au post." },
      { id: 'E7', t: "Média — upload vidéo (gros fichier)", e: "Téléverser une vidéo MP4/WebM/MOV (jusqu'à 3 Go)", a: "Upload streamé sans saturer la mémoire ; URL publique générée (si APP_URL)." , man: true },
      { id: 'E8', t: "Média obligatoire Instagram", e: "Sélectionner Instagram sans média", a: "L'app signale que le média est requis pour Instagram." },
      { id: 'E9', t: "Génération d'image par IA", e: "Décrire un visuel à générer", a: "Une image est générée, hébergée et attachée au post." , man: true },
      { id: 'E10', t: "Rédaction par l'IA (brief)", e: ["Saisir un brief", "Lancer la rédaction IA"], a: "L'IA écrit le post à partir de la base de connaissances, directement dans le champ texte.", man: true },
      { id: 'E11', t: "Option « actus » (useNews)", e: "Activer l'usage des actualités dans la rédaction", a: "Le contenu généré intègre des éléments d'actualité récents." , man: true },
      { id: 'E12', t: "Aperçu en direct par plateforme", e: "Taper du texte et changer de plateforme", a: "L'aperçu reflète le rendu réel de chaque plateforme, au fil de la frappe.", man: true },
      { id: 'E13', t: "Planification (date + récurrence)", e: "Dater le post, choisir une récurrence (aucune/quotidien/hebdo/…)", a: "La date est enregistrée ; statut « programmé » possible." },
      { id: 'E14', t: "Activer la publication automatique", e: "Cocher « publication automatique » sur un post programmé", a: "Le post est marqué autoPublish ; partira seul à l'heure dite (voir scheduler)." },
      { id: 'E15', t: "Enregistrer en brouillon", e: "Enregistrer sans publier", a: "Le post apparaît dans la liste au statut choisi." },
      { id: 'E16', t: "Supprimer un post", e: "Supprimer un post", a: "Le post disparaît de la liste (DELETE)." },
      { id: 'E17', t: "Saisie manuelle des métriques", e: "Sur un post publié, saisir impressions/likes/commentaires/partages/clics", a: "Valeurs enregistrées ; un instantané (snapshot) est créé pour les courbes temporelles.", man: true },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'F',
    title: "Hub de contenu — publication, déclinaisons, récurrence, métriques",
    intro: "Actions avancées sur un post : publier réellement, décliner multi-plateformes, gérer les séries récurrentes, synchroniser les métriques.",
    cases: [
      { id: 'F1', t: "Publication immédiate (réelle)", e: ["Sur un post, cliquer « Publier maintenant »"], a: "Publication via Composio ; retour PAR PLATEFORME (lien publié ou raison d'échec). URL externe renseignée si dispo.", man: true },
      { id: 'F2', t: "Publication de groupe (multi-plateformes)", e: "Publier un post décliné avec l'option groupe", a: "Tous les exemplaires non publiés du même contenu partent ; un résultat par plateforme." },
      { id: 'F3', t: "Marquer publié (sans envoi réel)", e: "Utiliser « Marquer comme publié »", a: "Statut « publié », date renseignée ; si récurrent, la prochaine occurrence est créée." },
      { id: 'F4', t: "Erreur de publication affichée", e: "Provoquer un échec (compte non connecté / contenu refusé)", a: "Le message d'erreur exact est stocké et affiché (publishError)." },
      { id: 'F5', t: "Correction efface l'erreur", e: "Modifier contenu/subreddit/plateforme/média après un échec", a: "L'ancienne erreur de publication est effacée automatiquement." },
      { id: 'F6', t: "Décliner vers d'autres plateformes", e: ["Choisir des plateformes cibles", "Option « adapter » activée"], a: "Un exemplaire indépendant par plateforme, groupés (crossPostId) ; chacun adapté par l'IA aux codes de sa plateforme.", man: true },
      { id: 'F7', t: "Récurrence — instruction de série", e: "Définir une instruction de régénération (recurrenceBrief)", a: "L'instruction est enregistrée (max 600 car.)." },
      { id: 'F8', t: "Récurrence — simuler la prochaine occurrence", e: "Utiliser « Simuler » (preview) avec ses réglages", a: "L'IA produit la prochaine occurrence SANS rien enregistrer ; on voit le titre + contenu proposés.", man: true },
      { id: 'F9', t: "Récurrence — options actus/connaissances/MAJ KB", e: "Basculer useNews / useKnowledge / updateKb", a: "Les réglages influencent la génération ; updateKb=1 enrichit la base de connaissances après publication." },
      { id: 'F10', t: "Synchroniser les métriques d'un post", e: ["Renseigner l'URL du post publié", "Cliquer « Synchroniser »"], a: "Les vraies métriques sont récupérées via Composio ; snapshot enregistré. Sans URL => message d'invite.", man: true },
      { id: 'F11', t: "Aperçu intégré (embed)", e: "Ouvrir un post publié avec URL", a: "Si l'URL est intégrable (iframe), aperçu intégré ; sinon aperçu interne + lien." },
      { id: 'F12', t: "Composio/IA non configuré", e: "Tenter publier/synchroniser sans config", a: "Erreur claire COMPOSIO_NOT_CONFIGURED / AI_NOT_CONFIGURED (503)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'G',
    title: "Analyse de post (post-mortem IA)  ★ vérification manuelle",
    intro:
      "Analyse IA d'un post publié : pourquoi ça a marché (ou non), quoi refaire. " +
      "Les enseignements alimentent la base de connaissances. À RELIRE attentivement.",
    manual: true,
    cases: [
      { id: 'G1', t: "Lancer l'analyse d'un post publié", e: ["Ouvrir un post publié (avec métriques)", "Cliquer « Analyser ce post »"], a: "L'IA produit une analyse narrative cohérente avec les chiffres réels du post.", man: true },
      { id: 'G2', t: "Enseignements ajoutés à la base", e: "Après l'analyse, vérifier la mention d'enseignements", a: "« N enseignement(s) ajouté(s) à la base de connaissances » ; les fiches « Enseignements » apparaissent dans Connaissances.", man: true },
      { id: 'G3', t: "Re-analyser", e: "Relancer l'analyse (« ↺ Re-analyser »)", a: "Une nouvelle analyse est produite, sans casser l'historique." },
      { id: 'G4', t: "Analyse interdite si non publié", e: "Tenter d'analyser un brouillon", a: "Refus « Seuls les posts publiés peuvent être analysés »." },
      { id: 'G5', t: "Pertinence du contenu d'analyse", e: "Relire l'analyse : forces, faiblesses, recommandations", a: "Recommandations actionnables et fidèles au contexte du projet (jugement humain).", man: true },
      { id: 'G6', t: "IA non configurée", e: "Sans IA", a: "Erreur AI_NOT_CONFIGURED (503)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'H',
    title: "Slides / Présentations (decks Marp)",
    intro: "Génération de présentations par l'IA, rendu plein écran, export et conversion en GIF/MP4 attachable à un post.",
    cases: [
      { id: 'H1', t: "Générer un deck", e: ["Onglet Slides", "Saisir un brief + nb de slides", "Générer"], a: "Un deck est créé (titre + markdown) et apparaît dans la liste.", man: true },
      { id: 'H2', t: "Afficher en plein écran", e: "Ouvrir le deck (/:id/html)", a: "Présentation rendue dans un nouvel onglet (auth par ?token=)." },
      { id: 'H3', t: "Exporter le markdown", e: "Télécharger la source (/:id/markdown)", a: "Fichier .md téléchargé, réutilisable dans Marp CLI." },
      { id: 'H4', t: "Rendu GIF", e: "Convertir le deck en GIF", a: "GIF généré, stocké (/uploads), aussi hébergé publiquement pour attache à un post.", man: true },
      { id: 'H5', t: "Rendu MP4", e: "Convertir le deck en MP4", a: "MP4 généré et stocké (/uploads)." , man: true },
      { id: 'H6', t: "Attacher le rendu à un post", e: "Rendre un GIF avec un postId", a: "L'image/GIF public est attaché au post ciblé." },
      { id: 'H7', t: "Thème Marp appliqué", e: "Changer de thème dans Config puis prévisualiser", a: "Le rendu reflète le thème courant (intégré ou personnalisé)." },
      { id: 'H8', t: "Supprimer un deck", e: "Supprimer", a: "Le deck disparaît ; rôle Lecteur => action refusée (403)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'I',
    title: "Calendrier éditorial",
    intro: "Vue mensuelle des publications, création de post pré-daté, synchronisation Google Calendar.",
    cases: [
      { id: 'I1', t: "Vue mensuelle", e: "Ouvrir /calendar", a: "Grille du mois ; pastilles colorées par statut (programmé / brouillon daté / publié)." },
      { id: 'I2', t: "Créer un post depuis un jour vide", e: "Cliquer un jour sans post", a: "Éditeur ouvert avec la date pré-remplie." },
      { id: 'I3', t: "Ouvrir un post depuis une pastille", e: "Cliquer une pastille existante", a: "Le post correspondant s'ouvre." },
      { id: 'I4', t: "Bouton « Nouveau post »", e: "Créer via le bouton du calendrier", a: "Post créé, date ajustable dans l'éditeur." },
      { id: 'I5', t: "Synchroniser vers Google Calendar", e: "Cliquer la synchro (posts programmés)", a: "Les posts programmés non synchronisés sont ajoutés à l'agenda Google (Composio). Sans connexion => message d'erreur explicite.", man: true },
      { id: 'I6', t: "Synchro auto à la programmation", e: "Programmer/dater un post avec date", a: "Le post est poussé en arrière-plan vers le calendrier (best-effort)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'J',
    title: "Assistant IA (pilotage conversationnel)  ★ vérification manuelle",
    intro:
      "Chat qui pilote toute l'app : point projet, rédaction/publication de posts, lecture/envoi d'emails, " +
      "agenda, validations, recherche web. Chaque outil déclenché doit être vérifié.",
    manual: true,
    cases: [
      { id: 'J1', t: "Idées rapides (suggestions)", e: "Cliquer une suggestion (« Où en est-on ? », « Rédiger un post »…)", a: "La demande se lance et l'assistant répond." },
      { id: 'J2', t: "Demande en langage naturel + streaming", e: ["Saisir une demande", "Entrée (Maj+Entrée = saut de ligne)"], a: "Réponse en continu (delta) ; actions d'outils visibles (recherche, agenda…)." },
      { id: 'J3', t: "Pièces jointes", e: "Joindre jusqu'à 4 fichiers à un message", a: "Les pièces sont prises en compte dans la réponse." , man: true },
      { id: 'J4', t: "Rédiger/enregistrer un post via l'assistant", e: "Demander de rédiger un post", a: "Un post est rédigé puis enregistré dans le Hub (vérifier sa présence et son contenu).", man: true },
      { id: 'J5', t: "Lire les emails", e: "Demander « Lis mes mails »", a: "L'assistant lit la boîte (Composio) et résume — vérifier la cohérence avec la vraie boîte.", man: true },
      { id: 'J6', t: "Envoyer un email", e: "Demander d'envoyer un email à un contact", a: "Email envoyé (Composio) ; vérifier la réception réelle.", man: true },
      { id: 'J7', t: "Agenda / validations via l'assistant", e: "Demander l'état des validations / l'agenda", a: "L'assistant rapporte fidèlement l'état réel des données." , man: true },
      { id: 'J8', t: "Interruption d'un tour", e: "Fermer/quitter pendant la génération", a: "L'appel modèle est coupé (économie de tokens) ; pas de faux message d'erreur résiduel." },
      { id: 'J9', t: "Nouvelle conversation (reset)", e: "Cliquer « Nouvelle conversation »", a: "L'historique est réinitialisé." },
      { id: 'J10', t: "IA non configurée", e: "Sans IA", a: "AI_NOT_CONFIGURED (503)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'K',
    title: "Performances — courbes & rapport de campagne IA  ★ vérification manuelle",
    intro:
      "Métriques réelles dans le temps + analyse IA de campagne. À CROISER avec les chiffres bruts des posts.",
    manual: true,
    cases: [
      { id: 'K1', t: "Courbes de performance", e: "Ouvrir /performance", a: "Vues & likes par semaine, progression relative, croissance cumulée s'affichent." },
      { id: 'K2', t: "Exactitude des séries", e: "Comparer les courbes aux métriques saisies/synchronisées", a: "Les agrégats reflètent fidèlement les snapshots des posts.", man: true },
      { id: 'K3', t: "Répartition par plateforme", e: "Observer le diagramme par plateforme", a: "Répartition cohérente avec les posts publiés par plateforme." },
      { id: 'K4', t: "Rapport de campagne IA", e: "Générer le rapport (GET /report)", a: "Le rapport narratif dit ce qui marche/cale et quoi faire cette semaine — relecture critique.", man: true },
      { id: 'K5', t: "Historique des rapports", e: "Consulter les rapports archivés", a: "Les rapports précédents sont listés et consultables." },
      { id: 'K6', t: "Détail par post + analyse", e: ["Ouvrir un post depuis le tableau trié par engagement", "Lancer son analyse"], a: "Le détail s'affiche ; l'analyse post-mortem se lance (cf. section G).", man: true },
      { id: 'K7', t: "Tri par engagement", e: "Trier le tableau des posts", a: "Le classement par taux d'engagement est correct." },
      { id: 'K8', t: "IA non configurée", e: "Sans IA", a: "Le rapport renvoie AI_NOT_CONFIGURED ; les courbes (sans IA) restent visibles." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'L',
    title: "Base de connaissances (fiches + sources + synchro)",
    intro:
      "Carburant de l'IA : fiches par catégorie, et sources auto (GitHub / site web) analysées par l'IA. " +
      "Étape de RELECTURE des propositions avant intégration.",
    manual: true,
    cases: [
      { id: 'L1', t: "Lister les fiches", e: "Ouvrir /knowledge", a: "Fiches rangées par catégorie (Entreprise, Produit, Audience, Ton, Offres, Enseignements, Veille…)." },
      { id: 'L2', t: "Créer une fiche", e: "Nouvelle fiche (titre + contenu + catégorie)", a: "Fiche créée et visible dans sa catégorie." },
      { id: 'L3', t: "Modifier / supprimer une fiche", e: "Éditer puis supprimer une fiche", a: "Modifications enregistrées ; suppression effective." },
      { id: 'L4', t: "Filtrer / rechercher", e: "Filtrer par catégorie / rechercher", a: "La liste se restreint correctement." },
      { id: 'L5', t: "Ajouter une source GitHub", e: "Ajouter github.com/utilisateur/depot", a: "Source enregistrée (URL canonique) ; URL invalide => message clair." },
      { id: 'L6', t: "Ajouter une source site web", e: "Ajouter une URL de site (option crawl)", a: "Source enregistrée." },
      { id: 'L7', t: "Analyser des sources (propositions)", e: "Lancer l'analyse IA des sources", a: "L'IA propose des fiches (suggestions) à partir du contenu récupéré — à RELIRE avant application.", man: true },
      { id: 'L8', t: "Appliquer les propositions retenues", e: "Sélectionner et appliquer les suggestions", a: "Les fiches choisies sont intégrées à la base ; horodatage de synchro mis à jour.", man: true },
      { id: 'L9', t: "Mise à jour « maintenant » (run)", e: "Déclencher la synchro immédiate des sources enregistrées", a: "Analyse + application automatiques ; nombre de fiches appliquées et erreurs éventuelles affichés." },
      { id: 'L10', t: "Source inexistante / réseau KO", e: "Source injoignable", a: "Erreur de récupération explicite, sans bloquer les autres sources." },
      { id: 'L11', t: "Lecteur en lecture seule", e: "Rôle Lecteur : tenter d'ajouter/synchroniser", a: "Écritures refusées (403)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'M',
    title: "Contacts & Leads — commentaires, scan, scoring, emails  ★ vérification manuelle",
    intro:
      "Détection et scoring des prospects depuis vos COMMENTAIRES / DMs / emails. " +
      "Section la plus dépendante du jugement humain : relire chaque lead détecté, son score et les emails générés.",
    manual: true,
    cases: [
      { id: 'M1', t: "Onglet Contacts", e: "Connaissances → onglet Contacts", a: "Liste des contacts avec type (prospect/client/partenaire), score d'intérêt et résumé." },
      { id: 'M2', t: "CRUD contact manuel", e: "Créer / éditer / supprimer un contact (nom, email, société, notes…)", a: "Contact enregistré ; score borné 0–100." },
      { id: 'M3', t: "Analyser des messages collés", e: ["« Analyser des messages »", "Coller des commentaires/DMs/emails", "Préciser la source", "« Détecter les leads »"], a: "L'IA détecte des candidats, les nomme, les score et les résume — RELIRE et corriger avant d'ajouter.", man: true },
      { id: 'M4', t: "Scanner les réactions d'un post (likes + commentaires)", e: ["« Analyser un post »", "Choisir un post publié AVEC URL renseignée", "Lancer le scan"], a: "Lecture des likes & commentaires via Composio ; leads détectés et attribués au post (source « réactions post [id] »).", man: true },
      { id: 'M5', t: "Scan post sans URL", e: "Choisir un post sans URL publiée", a: "Message invitant à renseigner d'abord l'URL du post (section métriques)." },
      { id: 'M6', t: "Scanner la boîte mail", e: "« Analyser ma boîte mail »", a: "Lecture de la boîte via Composio ; leads détectés depuis les emails.", man: true },
      { id: 'M7', t: "Pertinence du scoring", e: "Vérifier 2–3 leads : score vs contenu réel du message", a: "Le score d'intérêt et le résumé correspondent au signal réel (jugement humain).", man: true },
      { id: 'M8', t: "Rédiger un email (brouillon IA)", e: ["Sur un contact, indiquer un objectif", "Générer le brouillon"], a: "Brouillon personnalisé d'après le contact et son historique d'interactions.", man: true },
      { id: 'M9', t: "Envoyer un email", e: "Envoyer (objet + corps) au contact", a: "Envoi réel via Composio ; l'envoi est tracé dans l'historique du contact (lastInteraction).", man: true },
      { id: 'M10', t: "Contact sans email", e: "Tenter d'envoyer à un contact sans adresse", a: "Refus « Ce contact n'a pas d'adresse email »." },
      { id: 'M11', t: "Indicateur « leads chauds »", e: "Avoir des contacts score ≥ 70", a: "Le compteur « N leads chauds » s'affiche." },
      { id: 'M12', t: "Composio/IA non configuré", e: "Sans config", a: "Scan/inbox/envoi renvoient COMPOSIO_NOT_CONFIGURED ; l'analyse de texte renvoie AI_NOT_CONFIGURED." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'N',
    title: "Validations (relecture des contenus IA)  ★ vérification manuelle",
    intro:
      "Pipeline de relecture : les contenus produits par les agents en mode « validation » attendent ici. " +
      "On relit, on édite, puis on approuve ou rejette. Étape de contrôle humain par excellence.",
    manual: true,
    cases: [
      { id: 'N1', t: "Badge de validations en attente", e: "Observer la barre latérale", a: "Le badge sur « Validations » indique le nombre exact d'éléments en attente." },
      { id: 'N2', t: "Liste des contenus à valider", e: "Ouvrir /approvals", a: "Chaque carte montre le contenu rédigé par un agent (en attente d'approbation)." },
      { id: 'N3', t: "Éditer avant d'approuver", e: "Modifier le texte proposé directement dans la carte", a: "L'édition est prise en compte à l'approbation.", man: true },
      { id: 'N4', t: "Valider et publier", e: "« Valider et publier »", a: "Le contenu (édité si besoin) est publié ; le run passe « done » et l'agent redevient actif.", man: true },
      { id: 'N5', t: "Rejeter avec motif", e: "« Rejeter » + saisir un motif", a: "Le run passe « rejected » avec le motif et une copie du contenu proposé." },
      { id: 'N6', t: "Historique des envois", e: "Consulter l'historique", a: "Trace exacte par contenu : lien publié, échec ou rejet (attestation).", man: true },
      { id: 'N7', t: "Garde-fous d'état", e: "Tenter d'approuver un run déjà traité", a: "Refus « not awaiting approval » (400)." },
      { id: 'N8', t: "Mode publication direct vs validation", e: "Basculer le mode dans Config (auto/manual) puis lancer un agent", a: "En « auto » le contenu part directement (n'apparaît pas ici) ; en « manual » il passe par cette page.", man: true },
      { id: 'N9', t: "Lecteur en lecture seule", e: "Rôle Lecteur : tenter d'approuver/rejeter", a: "Action refusée (403)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'O',
    title: "Équipes & collaboration (rôles)",
    intro: "Création d'équipe, invitations par code/lien, gestion des membres et des rôles (owner / editor / viewer), rattachement de projet.",
    cases: [
      { id: 'O1', t: "Créer une équipe", e: "Ouvrir /teams, créer une équipe (nom ≤ 60 car.)", a: "Équipe créée ; le créateur en est propriétaire (owner)." },
      { id: 'O2', t: "Générer un lien d'invitation", e: "Créer une invitation (rôle editor/viewer, durée 1/7/30 j)", a: "Lien généré ; un même rôle réutilise le lien actif existant (anti-accumulation)." },
      { id: 'O3', t: "Aperçu public de l'invitation", e: "Ouvrir /join?code=… (déconnecté)", a: "Nom de l'équipe + validité affichés sans authentification." },
      { id: 'O4', t: "Rejoindre via un code", e: "Saisir/ouvrir un code d'invitation valide", a: "Ajout comme membre avec le rôle prévu ; déjà membre => message « alreadyMember »." },
      { id: 'O5', t: "Invitation expirée / invalide", e: "Utiliser un code expiré ou faux", a: "Erreur 410 (expiré) / 404 (invalide)." },
      { id: 'O6', t: "Changer le rôle d'un membre", e: "Owner : passer un membre editor↔viewer", a: "Rôle mis à jour ; le rôle de l'owner ne peut pas être changé." },
      { id: 'O7', t: "Retirer un membre / quitter", e: "Owner retire un membre ; un membre se retire lui-même", a: "Membre retiré ; l'owner ne peut pas quitter (doit supprimer l'équipe)." },
      { id: 'O8', t: "Rattacher un projet à une équipe", e: "Owner du projet (et membre owner/editor) rattache le projet", a: "Projet partagé à l'équipe ; détachement possible (teamId null)." },
      { id: 'O9', t: "Accès partagé selon le rôle", e: ["Se connecter comme editor puis comme viewer", "Ouvrir un projet d'équipe"], a: "Editor peut modifier ; Viewer voit tout en lecture seule (écritures => 403). Comptes connectés gérés par le propriétaire seulement.", man: true },
      { id: 'O10', t: "Sélecteur de projet (badge équipe)", e: "Ouvrir le sélecteur de projet", a: "Le projet d'équipe affiche le nom de l'équipe et le rôle (lecteur/éditeur)." },
      { id: 'O11', t: "Supprimer une équipe", e: "Owner supprime l'équipe", a: "Équipe supprimée ; projets détachés." },
      { id: 'O12', t: "Renommer une équipe", e: "Owner renomme", a: "Nom mis à jour (refusé si vide / > 60 car.)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'P',
    title: "Configuration (connexions, modes, synchros, thème)",
    intro: "Connexion des comptes réseaux (Composio OAuth), mode de publication, intervalles de synchro, thème des présentations, bot Telegram.",
    cases: [
      { id: 'P1', t: "État des connexions", e: "Ouvrir /config", a: "Liste des toolkits (LinkedIn, X, Instagram, Facebook, Gmail, Google Calendar, Reddit, YouTube, Discord, Slack, GitHub) avec statut connecté/non." },
      { id: 'P2', t: "Connecter un compte (OAuth)", e: "Cliquer « Connecter » sur un toolkit", a: "Lien d'autorisation OAuth ouvert ; après autorisation, le statut passe « connecté » (polling ?fresh=1)." , man: true },
      { id: 'P3', t: "Toolkit nécessitant sa propre app (X/TikTok)", e: "Connecter X/Twitter ou TikTok", a: "Réponse 409 NEEDS_OWN_APP avec les champs à fournir ; l'envoi des identifiants développeur permet la connexion." },
      { id: 'P4', t: "Déconnecter un compte", e: "Déconnecter un toolkit", a: "Comptes retirés chez Composio ; statut repassé non-connecté ; re-autorisation possible." },
      { id: 'P5', t: "Mode de publication des contenus IA", e: "Basculer Validation (manual) ↔ Direct (auto)", a: "Réglage propre au projet actif ; impacte tous ses agents." },
      { id: 'P6', t: "Intervalle de synchro des métriques", e: "Régler l'intervalle (0 = off ; sinon borné 15 min–7 j)", a: "Valeur enregistrée et bornée correctement." },
      { id: 'P7', t: "Intervalle de synchro des connaissances", e: "Régler l'intervalle (0 = off ; sinon borné 1 h–30 j)", a: "Valeur enregistrée et bornée correctement." },
      { id: 'P8', t: "Thème des présentations (Marp)", e: "Choisir un thème intégré", a: "Thème enregistré et reflété dans l'aperçu des decks." },
      { id: 'P9', t: "Thème personnalisé par IA", e: "Décrire un thème ; générer", a: "CSS sur mesure généré, validé et appliqué (thème « custom »)." , man: true },
      { id: 'P10', t: "Comptes en lecture seule (projet d'équipe)", e: "Membre non-propriétaire ouvre Config", a: "Comptes affichés en lecture seule ; connexion/déconnexion réservées au propriétaire (403)." },
      { id: 'P11', t: "Connecter le bot Telegram perso", e: "Saisir un token @BotFather valide", a: "Le serveur démarre un poller dédié ; nom du bot affiché. Token invalide => message de format." },
      { id: 'P12', t: "Retirer le bot Telegram perso", e: "Supprimer le bot", a: "Le poller s'arrête ; retour au bot global éventuel." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'Q',
    title: "Liaison Telegram",
    intro: "Lier son compte LaunchForge à un bot Telegram pour recevoir notifications et piloter via chat.",
    cases: [
      { id: 'Q1', t: "Générer un code de liaison", e: "Demander un code de liaison (valable 10 min)", a: "Code renvoyé ; statut « linked » correct." },
      { id: 'Q2', t: "Lier le compte au bot", e: "Envoyer le code au bot Telegram", a: "Le compte est lié ; les notifications (ex. plan prêt) arrivent." , man: true },
      { id: 'Q3', t: "Telegram non configuré", e: "Aucun bot disponible", a: "Erreur TELEGRAM_NOT_CONFIGURED (503)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'R',
    title: "Administration (réservé fondateur)",
    intro: "Panneau admin visible uniquement pour les emails administrateurs : statistiques, utilisateurs, flux d'activité.",
    cases: [
      { id: 'R1', t: "Accès réservé", e: "Vérifier le lien « Administration » selon l'email", a: "Visible/accessible UNIQUEMENT pour un email admin ; un non-admin reçoit 403 sur /api/admin/*." , man: true },
      { id: 'R2', t: "Statistiques globales", e: "Ouvrir /admin → stats", a: "Compteurs globaux (utilisateurs, projets, posts…) affichés." },
      { id: 'R3', t: "Liste des utilisateurs", e: "Consulter la liste", a: "Tous les utilisateurs listés." },
      { id: 'R4', t: "Activité d'un utilisateur", e: "Ouvrir l'activité d'un utilisateur (limit ≤ 200)", a: "Journal d'événements de l'utilisateur affiché." },
      { id: 'R5', t: "Flux d'activité global", e: "Parcourir le flux paginé (curseur before=ISO)", a: "Événements récents paginés correctement." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'S',
    title: "Multi-projets & navigation",
    intro: "Chaque projet a ses propres posts, connaissances, contacts, validations et réglages. Changement de contexte global.",
    cases: [
      { id: 'S1', t: "Sélecteur de projet", e: "Ouvrir le sélecteur dans la barre latérale", a: "Le projet actif est marqué (point) ; la liste des projets s'affiche." },
      { id: 'S2', t: "Changer de projet", e: "Sélectionner un autre projet", a: "Activation (POST /activate) ; rechargement complet ; toutes les vues reflètent le nouveau projet." , man: true },
      { id: 'S3', t: "Isolation des données par projet", e: "Comparer posts/connaissances/contacts entre 2 projets", a: "Aucune fuite de données d'un projet à l'autre." , man: true },
      { id: 'S4', t: "Créer un nouveau projet depuis le sélecteur", e: "« Nouveau projet »", a: "Redirection vers l'onboarding /new." },
      { id: 'S5', t: "Badge validations partagé", e: "Naviguer entre les vues", a: "Le badge de validations (overview) est rafraîchi (cache 5 s, polling 30 s)." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'T',
    title: "Visite guidée & tutoriels",
    intro: "Parcours d'accueil à la première visite et tutoriels par module accessibles à la demande.",
    cases: [
      { id: 'T1', t: "Tour à la première visite", e: "Première visite (localStorage vierge)", a: "Le tour « Découverte du site » se lance automatiquement et couvre toutes les sections." },
      { id: 'T2', t: "Fermer le tour (mémorisé)", e: "Fermer le tour", a: "launchforge_tour_done=1 ; le tour ne se relance plus automatiquement." },
      { id: 'T3', t: "Menu Tutoriels", e: "Ouvrir « Tutoriels » (bas de barre latérale)", a: "Liste des tutoriels (Hub, Éditeur, Calendrier, Connaissances, Assistant, Validations, Performances, Config)." },
      { id: 'T4', t: "Lancer un tutoriel ciblé", e: "Choisir un tutoriel (ex. « Créer un post : les champs »)", a: "La bonne page s'ouvre, la barre latérale s'ajuste, le parcours pointe les bons éléments (data-tour)." , man: true },
      { id: 'T5', t: "Tutoriel ouvrant un nouveau post", e: "Lancer le tutoriel « post » (/content?tutorial=post)", a: "Un nouveau post est ouvert pour la démonstration ; rien n'est enregistré sans action." },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'U',
    title: "Transverse : responsive, états d'erreur, sécurité, robustesse",
    intro: "Qualité d'ensemble : mobile, dégradations propres, contrôle d'accès et résistance aux saisies invalides.",
    cases: [
      { id: 'U1', t: "Responsive mobile — pas de débordement", e: "Tester chaque vue en largeur smartphone (≤ 400 px)", a: "Pas de débordement horizontal (scrollWidth ≈ innerWidth) ; sidebar en hamburger + overlay.", man: true },
      { id: 'U2', t: "Sidebar mobile", e: "Ouvrir/fermer la sidebar via le hamburger", a: "Overlay sombre, fermeture au clic dehors, navigation referme la sidebar." },
      { id: 'U3', t: "Modales en mobile", e: "Ouvrir les modales (post, contact, email)", a: "Contenu scrollable dans la modale, lisible, pas tronqué." , man: true },
      { id: 'U4', t: "Dégradations « non configuré »", e: "Tester l'app sans IA / sans Composio / sans Telegram", a: "Messages clairs (AI_NOT_CONFIGURED, COMPOSIO_NOT_CONFIGURED, TELEGRAM_NOT_CONFIGURED) ; boutons concernés masqués/désactivés." },
      { id: 'U5', t: "Contrôle d'accès (RBAC)", e: "Tenter d'accéder/éditer une ressource d'un autre utilisateur/projet", a: "404 (ne pas révéler l'existence) ou 403 selon le cas ; rôle Lecteur bloqué en écriture partout (posts, contacts, KB, decks, agents, kanban, config)." , man: true },
      { id: 'U6', t: "Clé API agent jamais exposée", e: "Inspecter la réponse GET /api/agents", a: "Seul un booléen hasApiKey est renvoyé ; la clé ne quitte jamais le serveur (chiffrée au repos)." },
      { id: 'U7', t: "Validation des entrées", e: "Envoyer des charges invalides (champs manquants, types faux, valeurs hors bornes)", a: "Réponses 400 explicites ; bornage (scores 0–100, intervalles, longueurs de texte)." },
      { id: 'U8', t: "Limite de taille des requêtes", e: "Envoyer un JSON > 15 Mo / image > 8 Mo / vidéo > 3 Go", a: "Refus propre (413 / 400) sans crash serveur." },
      { id: 'U9', t: "Santé du service", e: "GET /api/health", a: "{ status: 'ok', timestamp } renvoyé." },
      { id: 'U10', t: "Purge des médias générés", e: "Vérifier la politique de rétention", a: "Les médias /uploads sont purgés à 90 j ; la vidéo publiée est nettoyée une fois récupérée par la plateforme." },
    ],
  },
];

module.exports = { sections };
