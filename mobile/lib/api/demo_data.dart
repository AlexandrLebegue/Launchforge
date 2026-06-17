import 'models.dart';

/// Jeu de données de démonstration — startup fictive « Nimbus ».
/// Permet de visualiser chaque vue entièrement remplie (captures, mode hors-ligne).
class Demo {
 static User user = User(
 id: 'u1',
 email: 'sarah@nimbus.io',
 name: 'Sarah Lambert',
 createdAt: '2026-04-02T09:00:00Z',
 );

 static final _project = ProjectSummary(
 id: 'p1',
 active: 1,
 createdAt: '2026-04-02T09:00:00Z',
 productName: 'Nimbus',
 niche: 'Productivité B2B',
 targetAudience: 'Équipes produit en startup',
 companyName: 'Nimbus SAS',
 );

 static final _project2 = ProjectSummary(
 id: 'p2',
 active: 0,
 createdAt: '2026-05-20T09:00:00Z',
 productName: 'Atlas Analytics',
 niche: 'Data & BI',
 targetAudience: 'Responsables data',
 companyName: 'Nimbus SAS',
 teamId: 't1',
 teamName: 'Studio Nimbus',
 role: 'editor',
 );

 static Overview overview = Overview(
 projects: [_project, _project2],
 project: _project,
 tasksTotal: 24,
 tasksDone: 11,
 tasksInProgress: 5,
 tasksProgress: 46,
 postsScheduled: 7,
 postsPublished: 18,
 postsDrafts: 4,
 nextPost: NextPost(
 id: 'po1',
 title: '3 signes que votre backlog vous ralentit',
 platform: 'linkedin',
 scheduledAt: '2026-06-18T09:00:00Z',
 ),
 approvals: 2,
 );

 static LaunchPlan plan = LaunchPlan(
 id: 'p1',
 input: PlanInput(
 productName: 'Nimbus',
 description:
 'Nimbus est un copilote de gestion de projet pour les équipes produit : il transforme vos notes de réunion en tâches priorisées et synchronise automatiquement votre roadmap avec Linear et Notion.',
 targetAudience: 'Équipes produit en startup',
 niche: 'Productivité B2B',
 pricing: 'À partir de 19 €/mois',
 goals: [
 'Atteindre 500 inscrits en bêta sur 8 semaines',
 'Convertir 12 % des inscrits en comptes payants',
 'Construire une communauté de 1 000 product builders',
 ],
 ),
 launchSequencing: [
 LaunchSequencing(
 phase: 'Pré-lancement',
 timeline: 'Semaines 1-2',
 activities: [
 'Constituer une liste d\'attente avec une landing page dédiée',
 'Publier 3 posts « teaser » sur LinkedIn et X',
 'Contacter 20 communautés product (Slack, Discord)',
 ],
 ),
 LaunchSequencing(
 phase: 'Lancement',
 timeline: 'Semaines 3-5',
 activities: [
 'Lancement Product Hunt avec asset GIF',
 'Série de posts retours d\'expérience bêta-testeurs',
 'Webinaire de démonstration en direct',
 ],
 ),
 LaunchSequencing(
 phase: 'Croissance',
 timeline: 'Semaines 6-8',
 activities: [
 'Programme de parrainage',
 'Études de cas clients chiffrées',
 'Campagne de contenu SEO « productivité produit »',
 ],
 ),
 ],
 );

 static List<Post> posts = [
 Post(
 id: 'po1',
 platform: 'linkedin',
 title: '3 signes que votre backlog vous ralentit',
 content:
 'Votre backlog dépasse 200 tickets? Voici 3 signes que votre équipe produit perd du temps — et comment Nimbus les corrige automatiquement. ',
 status: 'scheduled',
 scheduledAt: '2026-06-18T09:00:00Z',
 recurrence: 'weekly',
 ),
 Post(
 id: 'po2',
 platform: 'twitter',
 title: 'Thread lancement bêta',
 content:
 'On a passé 6 mois à parler à 80 équipes produit. Le constat : 4 h/semaine perdues en triage. Nimbus automatise ça. Bêta ouverte ',
 status: 'scheduled',
 scheduledAt: '2026-06-19T14:00:00Z',
 ),
 Post(
 id: 'po3',
 platform: 'producthunt',
 title: 'Lancement Product Hunt',
 content: 'Nimbus — votre roadmap, pilotée par l\'IA. Lancement officiel aujourd\'hui sur Product Hunt!',
 status: 'scheduled',
 scheduledAt: '2026-06-24T08:01:00Z',
 ),
 Post(
 id: 'po4',
 platform: 'instagram',
 title: 'Reel coulisses',
 content: 'Dans les coulisses de notre sprint de lancement #buildinpublic #startup',
 status: 'draft',
 ),
 Post(
 id: 'po5',
 platform: 'reddit',
 title: 'Retour d\'expérience r/ProductManagement',
 content: 'Comment on a réduit notre temps de triage de 70 % — retour honnête après 3 mois.',
 status: 'draft',
 subreddit: 'ProductManagement',
 ),
 Post(
 id: 'po6',
 platform: 'linkedin',
 title: 'Étude de cas : Equipe Volta',
 content:
 'L\'équipe produit de Volta a divisé par 2 son temps de planification de sprint avec Nimbus. Voici comment. ',
 status: 'published',
 publishedAt: '2026-06-10T09:00:00Z',
 impressions: 14200,
 likes: 312,
 comments: 41,
 shares: 28,
 clicks: 540,
 ),
 Post(
 id: 'po7',
 platform: 'twitter',
 title: 'Astuce raccourci clavier',
 content: 'Petit secret Nimbus : ⌘K transforme n\'importe quelle note en tâche priorisée. Démo ',
 status: 'published',
 publishedAt: '2026-06-06T16:30:00Z',
 impressions: 8900,
 likes: 187,
 comments: 23,
 shares: 54,
 clicks: 210,
 ),
 Post(
 id: 'po8',
 platform: 'youtube',
 title: 'Démo produit 90 s',
 content: 'Découvrez Nimbus en 90 secondes — de la note de réunion à la roadmap synchronisée.',
 status: 'published',
 publishedAt: '2026-06-01T12:00:00Z',
 impressions: 5400,
 likes: 96,
 comments: 12,
 shares: 9,
 clicks: 180,
 ),
 Post(
 id: 'po9',
 platform: 'newsletter',
 title: 'Édition #4 — La roadmap vivante',
 content: 'Cette semaine : pourquoi votre roadmap devrait être un document vivant, pas un PDF figé.',
 status: 'idea',
 ),
 ];

 static List<KnowledgeEntry> knowledge = [
 KnowledgeEntry(
 id: 'k1',
 category: 'company',
 title: 'Mission de l\'entreprise',
 content:
 'Nimbus rend les équipes produit 10× plus rapides en éliminant le travail de coordination manuel. Notre conviction : les meilleures équipes passent leur temps à construire, pas à trier.',
 updatedAt: '2026-06-05T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k2',
 category: 'product',
 title: 'Proposition de valeur',
 content:
 'Transforme les notes de réunion en tâches priorisées et synchronise la roadmap avec Linear, Notion et Jira. Zéro saisie manuelle, contexte préservé.',
 updatedAt: '2026-06-04T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k3',
 category: 'audience',
 title: 'Client idéal (ICP)',
 content:
 'Head of Product ou PM dans une startup de 10 à 80 personnes, équipe produit de 3 à 12 personnes, déjà sur Linear ou Notion, sensible au temps perdu en coordination.',
 updatedAt: '2026-06-03T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k4',
 category: 'tone',
 title: 'Ton de marque',
 content:
 'Direct, concret, sans jargon. On parle comme un pair builder expérimenté. Emojis avec parcimonie. On montre, on ne survend pas.',
 updatedAt: '2026-06-02T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k5',
 category: 'offers',
 title: 'Offres & tarifs',
 content: 'Starter 19 €/mois (3 utilisateurs), Team 49 €/mois (jusqu\'à 12), Scale sur devis. Essai gratuit 14 jours.',
 updatedAt: '2026-06-01T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k6',
 category: 'learnings',
 title: 'Enseignement : les chiffres performent',
 content:
 'Les posts contenant un chiffre précis (« -70 % de triage ») obtiennent 2,3× plus d\'engagement que les posts génériques. À systématiser.',
 updatedAt: '2026-06-11T10:00:00Z',
 ),
 KnowledgeEntry(
 id: 'k7',
 category: 'news',
 title: 'Veille : Linear lève 35 M\$',
 content: 'Linear renforce son écosystème — opportunité de contenu sur l\'intégration Nimbus × Linear.',
 updatedAt: '2026-06-13T10:00:00Z',
 ),
 ];

 static List<Contact> contacts = [
 Contact(
 id: 'c1',
 name: 'Thomas Réau',
 type: 'prospect',
 email: 'thomas@volta.app',
 company: 'Volta',
 source: 'Commentaire LinkedIn',
 interestScore: 92,
 interestSummary: 'A demandé un accès bêta et posé des questions sur l\'intégration Jira.',
 ),
 Contact(
 id: 'c2',
 name: 'Léa Fontaine',
 type: 'client',
 email: 'lea@orbit.io',
 company: 'Orbit',
 source: 'Inscription bêta',
 interestScore: 78,
 interestSummary: 'Cliente active, utilise Nimbus quotidiennement avec son équipe de 6.',
 ),
 Contact(
 id: 'c3',
 name: 'Marc Diallo',
 type: 'prospect',
 email: 'marc.diallo@gmail.com',
 company: null,
 source: 'Email entrant',
 interestScore: 64,
 interestSummary: 'Intéressé mais hésite sur le prix — à recontacter avec l\'offre Starter.',
 ),
 Contact(
 id: 'c4',
 name: 'Studio Hélio',
 type: 'partner',
 email: 'contact@studiohelio.fr',
 company: 'Studio Hélio',
 source: 'Twitter DM',
 interestScore: 55,
 interestSummary: 'Agence proposant un partenariat de revente.',
 ),
 ];

 static List<ApprovalItem> approvals = [
 ApprovalItem(
 id: 'a1',
 agentName: 'Agent LinkedIn',
 agentPlatform: 'linkedin',
 cardTitle: 'Post : retour bêta-testeur Volta',
 status: 'awaiting_approval',
 startedAt: '2026-06-17T08:10:00Z',
 planId: 'p1',
 result:
 'L\'équipe produit de Volta a divisé par 2 son temps de planification de sprint avec Nimbus.\n\nAvant : 2 h de réunion + ressaisie manuelle.\nAprès : les notes deviennent des tâches priorisées en un clic.\n\nLa bêta est ouverte — lien en commentaire. ',
 ),
 ApprovalItem(
 id: 'a2',
 agentName: 'Agent X (Twitter)',
 agentPlatform: 'twitter',
 cardTitle: 'Thread : 4 h/semaine perdues en triage',
 status: 'awaiting_approval',
 startedAt: '2026-06-17T07:45:00Z',
 planId: 'p1',
 result:
 'On a interrogé 80 équipes produit. Résultat : 4 h/semaine perdues à trier des tickets.\n\nCe temps, c\'est 5 semaines de travail par an. Par personne.\n\nNimbus automatise le triage. Bêta ouverte ',
 ),
 ];

 static List<ApprovalItem> approvalHistory = [
 ApprovalItem(
 id: 'h1',
 agentName: 'Agent LinkedIn',
 agentPlatform: 'linkedin',
 cardTitle: 'Étude de cas : Equipe Volta',
 status: 'done',
 startedAt: '2026-06-10T09:00:00Z',
 result: 'Publié avec succès · https://linkedin.com/posts/nimbus-volta',
 ),
 ApprovalItem(
 id: 'h2',
 agentName: 'Agent Reddit',
 agentPlatform: 'reddit',
 cardTitle: 'Retour r/ProductManagement',
 status: 'rejected',
 startedAt: '2026-06-08T11:00:00Z',
 result: 'Rejeté — ton trop promotionnel pour le subreddit.',
 ),
 ];

 static PerformanceSeries performance = PerformanceSeries(
 hasHistory: true,
 weekly: [
 WeeklyPerf(week: 'S-7', posts: 2, impressions: 3200, likes: 64),
 WeeklyPerf(week: 'S-6', posts: 3, impressions: 5100, likes: 98),
 WeeklyPerf(week: 'S-5', posts: 3, impressions: 6800, likes: 142),
 WeeklyPerf(week: 'S-4', posts: 4, impressions: 9400, likes: 201),
 WeeklyPerf(week: 'S-3', posts: 4, impressions: 12600, likes: 268),
 WeeklyPerf(week: 'S-2', posts: 5, impressions: 18900, likes: 372),
 WeeklyPerf(week: 'S-1', posts: 5, impressions: 24100, likes: 489),
 ],
 );

 static String campaignReport =
 'Votre campagne accélère nettement. Les impressions hebdomadaires ont été multipliées par 7,5 en 6 semaines (3 200 24 100), portées surtout par LinkedIn.\n\n'
 'Ce qui marche : les posts avec un chiffre précis (« -70 % de triage », « ×2 plus rapide ») surperforment de 2,3×. L\'étude de cas Volta est votre meilleur contenu (14,2 k vues, 4,9 % d\'engagement).\n\n'
 'Ce qui cale : Instagram reste sous-exploité (1 seul brouillon). YouTube génère peu de clics malgré de bonnes vues — testez un call-to-action plus explicite.\n\n'
 'Cette semaine : capitalisez sur le lancement Product Hunt, déclinez l\'étude de cas Volta en thread X, et activez la série hebdomadaire LinkedIn.';

 static List<ConfigToolkit> toolkits = [
 ConfigToolkit(slug: 'linkedin', name: 'LinkedIn', capability: 'Publication & métriques', connected: true),
 ConfigToolkit(slug: 'twitter', name: 'X (Twitter)', capability: 'Publication & métriques', connected: true),
 ConfigToolkit(slug: 'instagram', name: 'Instagram', capability: 'Publication & métriques', connected: false),
 ConfigToolkit(slug: 'reddit', name: 'Reddit', capability: 'Publication', connected: true),
 ConfigToolkit(slug: 'youtube', name: 'YouTube', capability: 'Publication & métriques', connected: false),
 ConfigToolkit(slug: 'gmail', name: 'Gmail', capability: 'Détection de leads', connected: true),
 ];

 static List<ChatMessage> assistantThread = [
 ChatMessage(role: 'assistant', text: 'Bonjour Sarah Où en est le lancement de Nimbus aujourd\'hui? Je peux faire le point, rédiger un post ou lire vos derniers commentaires.'),
 ChatMessage(role: 'user', text: 'Fais-moi le point sur la semaine.'),
 ChatMessage(
 role: 'assistant',
 text:
 'Voici le point de la semaine pour **Nimbus** :\n\n• 5 posts publiés (+24 % d\'impressions vs S-2)\n• Meilleur contenu : l\'étude de cas Volta (14,2 k vues)\n• 2 contenus attendent votre validation\n• Prochain post programmé : LinkedIn, demain 9 h\n\nLe lancement Product Hunt est dans 7 jours. Voulez-vous que je prépare le thread de lancement?',
 actions: ['Recherche web : tendances Product Hunt', 'Lecture base de connaissances'],
 ),
 ];
}
