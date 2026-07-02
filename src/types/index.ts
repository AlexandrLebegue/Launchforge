/** Ce que l'utilisateur veut faire avancer en priorité, et où il en est. */
export type PrimaryObjective = 'launch' | 'grow-revenue' | 'both';
/** Stade commercial réel — pilote la pondération du plan (lancement vs vente). */
export type Traction = 'pre-revenue' | 'first-customers' | 'early-revenue' | 'scaling';
/** Manière dont l'entreprise vend : libre-service, vente assistée, ou les deux. */
export type SalesMotion = 'self-serve' | 'sales-led' | 'hybrid';

/**
 * Contexte go-to-market / commercial collecté à l'onboarding. Tous optionnels :
 * une idée pré-lancement n'a ni CA ni cycle de vente. Ce contexte oriente le
 * plan, la base de connaissances et les relances de l'assistant vers la VENTE.
 */
export interface GoToMarket {
  /** Priorité du moment : lancer, vendre plus, ou les deux. */
  primaryObjective?: PrimaryObjective;
  /** Où en est le revenu (pré-revenu → en passage à l'échelle). */
  traction?: Traction;
  /** Mouvement de vente dominant. */
  salesMotion?: SalesMotion;
  /** Qui décide / signe le chèque (l'acheteur), distinct de qui utilise. */
  buyer?: string;
  /** Le frein n°1 à la croissance (pas assez de trafic, le trafic ne convertit pas, leads qui refroidissent, churn…). */
  bottleneck?: string;
  /** Prochain palier de revenu visé (ex. « passer de 2k€ à 10k€ MRR en 3 mois »). */
  revenueGoal?: string;
}

export interface PlanInput extends GoToMarket {
  productName: string;
  description: string;
  targetAudience: string;
  niche: string;
  goals: string[];
  pricing: string;
  company?: CompanyProfile;
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export interface CompanyProfile {
  name: string;
  exists: boolean;
  website?: string;
  description?: string;
  location?: string;
  stage?: string;
  socials?: string[];
  competitors?: string[];
  notes?: string;
}

export interface OnboardingAttachment {
  name: string;
  /** Texte brut, ou base64 pour les PDF */
  content: string;
  type?: 'text' | 'pdf';
}

export interface OnboardingChatMessage {
  role: 'assistant' | 'user';
  text: string;
  /** Tool actions performed during this assistant turn (e.g. web searches) */
  actions?: string[];
}

export interface OnboardingProfile extends GoToMarket {
  company: CompanyProfile;
  productName: string;
  description: string;
  targetAudience: string;
  niche: string;
  goals: string[];
  pricing: string;
}

export interface OnboardingSession {
  id: string;
  userId: string;
  status: 'active' | 'completed';
  messages: OnboardingChatMessage[];
  profile: Partial<OnboardingProfile> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyAction {
  week: number;
  theme: string;
  actions: string[];
  kpis: string[];
}

export interface CommunityTarget {
  platform: string;
  communities: string[];
  approach: string;
  frequency: string;
}

export interface ContentAngle {
  title: string;
  format: string;
  platforms: string[];
  description: string;
}

export interface OutreachStrategy {
  phase: string;
  tactics: string[];
  target: string;
}

export interface LaunchSequencing {
  phase: string;
  timeline: string;
  activities: string[];
}

export interface ValidationChecklist {
  item: string;
  status: 'pending' | 'done';
  details: string;
}

export interface FirstUsersTactic {
  tactic: string;
  effort: 'low' | 'medium' | 'high';
  expectedResult: string;
}

export interface LaunchPlan {
  id: string;
  userId: string;
  /** 1 = projet actif (contexte de travail courant de l'utilisateur) */
  active: number;
  createdAt: string;
  input: PlanInput;
  weekly_plan: WeeklyAction[];
  community_targets: CommunityTarget[];
  content_angles: ContentAngle[];
  outreach_strategy: OutreachStrategy[];
  launch_sequencing: LaunchSequencing[];
  validation_checklist: ValidationChecklist[];
  first_users_tactics: FirstUsersTactic[];
  kanbanState?: KanbanState;
}

// ── Vue d'ensemble (shell de l'app en un seul aller-retour) ──────────────────

/** Projet « léger » pour la sidebar et le tableau de bord (pas de blobs JSON) */
export interface ProjectSummary {
  id: string;
  active: number;
  createdAt: string;
  productName: string;
  niche: string;
  targetAudience: string;
  companyName: string | null;
  /** Projet d'équipe : id + nom de l'équipe (null = projet personnel) */
  teamId?: string | null;
  teamName?: string | null;
  /** Rôle de l'utilisateur courant sur ce projet */
  role?: TeamRole;
}

export interface Overview {
  projects: ProjectSummary[];
  /** Projet actif (ou le plus récent) — null si aucun projet */
  project: ProjectSummary | null;
  tasks: { total: number; done: number; inProgress: number; progress: number };
  posts: {
    scheduled: number;
    published: number;
    drafts: number;
    next: { id: string; title: string; platform: string; scheduledAt: string } | null;
  };
  /** Validations en attente du projet actif */
  approvals: number;
}

// ── Historique des conversations avec l'assistant ─────────────────────────────
// Chaque fil de la vue 💬 Assistant est persisté côté serveur. Les conversations
// inactives depuis plus d'un mois sont purgées automatiquement.

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Outils utilisés pendant ce tour (recherche web, agenda…) — purement décoratif */
  actions?: string[];
}

export interface Conversation {
  id: string;
  userId: string;
  /** Projet actif au moment du dernier message (null = aucun projet) */
  planId: string | null;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Entrée légère de la liste d'historique (sans le corps des messages) */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Début du dernier message, pour l'aperçu dans la liste */
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackInput {
  planId: string;
  rating: number;
  comment?: string;
}

export interface Feedback {
  id: string;
  planId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /** Tutoriel d'accueil en attente (posé à la création du compte, montré après
   *  le 1er projet puis consommé). Absent/false = déjà vu ou compte ancien. */
  tutorialPending?: boolean;
  /** Le compte a un mot de passe local (faux pour un compte créé via Google
   *  seul). Pilote l'UI du profil : changement de mot de passe, et exigence du
   *  mot de passe actuel pour modifier l'email. */
  hasPassword?: boolean;
  /** Fournisseur OAuth rattaché (« google ») ou null pour un compte local. */
  authProvider?: string | null;
}

// ── Abonnement & facturation ──────────────────────────────────────────────────
// Trois offres : « Braise » (gratuite, limitée), « Brasier » (payante, tout
// illimité) et « Brasier PLUS » (payante, IA premium Claude Opus). L'accès payant
// vient soit d'un abonnement Stripe actif, soit de l'essai « reverse trial » de
// 15 jours non expiré (cf. services/entitlements).

export type PlanTier = 'braise' | 'brasier' | 'plus';
/** Offre payante souscrite via Stripe (le tier effectif en découle) */
export type PaidPlan = 'brasier' | 'plus';
export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';

/** État d'abonnement brut, tel que stocké sur l'utilisateur */
export interface SubscriptionRecord {
  status: SubscriptionStatus;
  /** Offre souscrite ('brasier' | 'plus') — null tant qu'aucun abonnement */
  plan: PaidPlan | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  interval: 'month' | 'year' | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  trialEndsAt: string | null;
  firstPaidAt: string | null;
}

/** Compteur d'usage IA mensuel (ressource bornée pour l'offre Braise) */
export type UsageKind = 'ai_generation' | 'ai_image';

export interface AuthRequest {
  email: string;
  password: string;
  name?: string;
}

export interface AuthPayload {
  userId: string;
  email: string;
}

// ── Équipes ────────────────────────────────────────────────────────────────
export type TeamRole = 'owner' | 'editor' | 'viewer';

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

/** Équipe + rôle de l'utilisateur courant + nombre de membres (pour les listes) */
export interface TeamSummary extends Team {
  role: TeamRole;
  memberCount: number;
}

export interface TeamMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  code: string;
  role: TeamRole;
  createdAt: string;
  expiresAt: string | null;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  sections: string[];
}

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  category: string;
  effort: 'low' | 'medium' | 'high';
  column: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  week?: number;
  order: number;
  createdAt: string;
}

export interface KanbanState {
  columns: {
    backlog: KanbanCard[];
    todo: KanbanCard[];
    in_progress: KanbanCard[];
    review: KanbanCard[];
    done: KanbanCard[];
  };
}

// ── Agents ────────────────────────────────────────────────────────────────────

export type AgentPlatform =
  | 'reddit'
  | 'twitter'
  | 'linkedin'
  | 'instagram'
  | 'producthunt'
  | 'hackernews'
  | 'indiehackers'
  | 'discord'
  | 'slack'
  | 'github';

export type AgentStatus = 'active' | 'inactive' | 'error';
export type RunStatus   = 'pending' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'rejected';
/** Pipeline de validation : publication immédiate ou validation par l'utilisateur */
export type ApprovalMode = 'auto' | 'manual';

export interface Agent {
  id: string;
  userId: string;
  /** Projet auquel cet agent (et son mode de validation) appartient */
  planId: string | null;
  name: string;
  platform: AgentPlatform;
  apiKey: string;
  status: AgentStatus;
  approvalMode: ApprovalMode;
  lastRunAt: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  planId: string;
  cardId: string;
  cardTitle: string;
  status: RunStatus;
  result: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** Run en attente de validation, enrichi des infos de l'agent (page Validations) */
export interface ApprovalItem extends AgentRun {
  agentName: string;
  agentPlatform: AgentPlatform;
}

export interface AgentTemplate {
  platform: AgentPlatform;
  name: string;
  icon: string;
  description: string;
  composioApp: string;
}

// ── Content Hub ───────────────────────────────────────────────────────────────

export type PostStatus = 'idea' | 'draft' | 'scheduled' | 'published';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface Post {
  id: string;
  userId: string;
  /** Projet (plan) auquel ce post appartient — null pour les anciens posts */
  planId: string | null;
  platform: string;
  title: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  /** URL du post une fois publié sur la plateforme (sert à la synchro des métriques) */
  externalUrl: string | null;
  /** Identifiant natif du post chez la plateforme (id vidéo, id média, fullname
   *  Reddit, id tweet…) — renseigné par l'import d'historique pour dédupliquer */
  externalId: string | null;
  /** URL du visuel à joindre au post (image hébergée) */
  imageUrl: string | null;
  /** Reddit : subreddit cible (sans le préfixe « r/ ») — null pour les autres plateformes */
  subreddit: string | null;
  recurrence: Recurrence;
  /** Si renseignée : chaque nouvelle occurrence est RÉGÉNÉRÉE par l'IA à
   *  partir de cette instruction (sinon le même contenu est repris) */
  recurrenceBrief: string | null;
  /** Id du post d'origine de la série récurrente (null = tête de série ou non récurrent) */
  seriesId: string | null;
  /** La régénération IA s'appuie sur une recherche d'actualités web */
  recurrenceUseNews: number;
  /** La régénération IA s'appuie sur la base de connaissances (défaut : oui) */
  recurrenceUseKnowledge: number;
  /** L'IA archive les actus utilisées dans la fiche 📰 Veille de la base de connaissances */
  recurrenceUpdateKb: number;
  /** Groupe multi-plateformes : même contenu décliné sur plusieurs plateformes */
  crossPostId: string | null;
  /** Publication automatique à l'heure programmée par le worker (via Composio) */
  autoPublish: number;
  /** Dernière erreur de publication automatique (null si OK) */
  publishError: string | null;
  /** 1 si un événement a été créé dans le calendrier personnel de l'utilisateur */
  calendarSynced: number;
  /** Métriques saisies par l'utilisateur après publication */
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

/** Un commentaire léger récupéré chez la plateforme (avant stockage) */
export interface CommentItem {
  /** Id du commentaire chez la plateforme — sert à dédupliquer entre synchros */
  externalId?: string | null;
  author?: string | null;
  text: string;
  likeCount?: number;
  /** Date du commentaire (ISO) si la plateforme la fournit */
  commentedAt?: string | null;
}

/** Commentaire d'un post publié, persisté (table post_comments) */
export interface PostComment {
  id: string;
  postId: string;
  userId: string;
  planId: string | null;
  platform: string;
  externalId: string | null;
  author: string | null;
  text: string;
  likeCount: number;
  commentedAt: string | null;
  /** Date de récupération (ISO) */
  fetchedAt: string;
}

export type KnowledgeCategory = 'company' | 'product' | 'audience' | 'tone' | 'offers' | 'learnings' | 'news' | 'other';

export interface KnowledgeEntry {
  id: string;
  userId: string;
  /** Projet auquel cette fiche appartient — chaque projet a sa propre base */
  planId: string | null;
  category: KnowledgeCategory;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Mise à jour automatique de la base de connaissances ───────────────────────
// L'utilisateur déclare des SOURCES (dépôt GitHub, site/page web) ; l'IA les
// analyse et propose des fiches à créer/mettre à jour (validées par l'utilisateur).

export type KnowledgeSourceType = 'github' | 'website' | 'hubspot';

export interface KnowledgeSource {
  id: string;
  /** Propriétaire du projet (même clé que knowledge.userId) */
  userId: string;
  /** Projet auquel la source est rattachée (null = base personnelle) */
  planId: string | null;
  type: KnowledgeSourceType;
  url: string;
  label: string;
  /** Dernière analyse réussie (ISO) — null si jamais synchronisée */
  lastSyncedAt: string | null;
  createdAt: string;
}

/** Proposition issue de l'analyse IA d'une source — soumise à l'utilisateur */
export interface KnowledgeSuggestion {
  action: 'create' | 'update';
  /** Fiche existante à mettre à jour (action = update) ; null pour une création */
  targetId: string | null;
  category: KnowledgeCategory;
  title: string;
  content: string;
  /** Libellé court de la source d'où provient l'information */
  source: string;
  /** Courte justification de la proposition par l'IA */
  reason: string;
}

// ── Contacts (prospects / clients / partenaires) ──────────────────────────────

export type ContactType = 'prospect' | 'client' | 'partner';

/** Étape du pipeline de vente (CRM). 'won'/'lost' = deal clos. */
export type DealStage = 'new' | 'qualified' | 'discussion' | 'proposal' | 'won' | 'lost';

export const DEAL_STAGES: DealStage[] = ['new', 'qualified', 'discussion', 'proposal', 'won', 'lost'];

export const STAGE_LABELS: Record<DealStage, string> = {
  new: 'Nouveau',
  qualified: 'Qualifié',
  discussion: 'En discussion',
  proposal: 'Proposition',
  won: 'Gagné',
  lost: 'Perdu',
};

export interface Contact {
  id: string;
  userId: string;
  /** Projet auquel ce contact appartient — chaque projet a son propre carnet */
  planId: string | null;
  name: string;
  email: string | null;
  company: string | null;
  /** Compte (entreprise) auquel ce contact est rattaché — CRM orienté comptes */
  companyId: string | null;
  type: ContactType;
  /** Étape dans le pipeline de vente. Défaut 'new'. */
  stage: DealStage;
  /** Montant du deal (devise du projet, EUR), null si non chiffré */
  amount: number | null;
  /** Id de l'enregistrement source externe (HubSpot…) — déduplication des imports */
  externalId: string | null;
  /** Date de clôture estimée du deal (ISO yyyy-mm-dd), null si non définie */
  expectedCloseDate: string | null;
  /** Prochaine action commerciale à mener (texte libre) */
  nextAction: string | null;
  /** Échéance de la prochaine action (ISO yyyy-mm-dd) — sert au badge « en retard » */
  nextActionAt: string | null;
  /** D'où vient ce contact : 'commentaire LinkedIn', 'boîte mail', 'manuel'… */
  source: string | null;
  /** Poste occupé (ex. « Head of Sales ») — saisi ou enrichi via Apollo */
  title: string | null;
  /** URL du profil LinkedIn — saisie ou enrichie via Apollo */
  linkedinUrl: string | null;
  /** Téléphone — saisi ou livré par le webhook Apollo (reveal_phone_number) */
  phone: string | null;
  /** Score d'intérêt 0-100 estimé par l'IA (null = jamais analysé) */
  interestScore: number | null;
  /** Justification du score par l'IA */
  interestSummary: string | null;
  notes: string | null;
  /** Derniers échanges — rempli AUTOMATIQUEMENT depuis les emails reçus (synchro) */
  lastInteraction: string | null;
  /** Échanges saisis à la main (appels, réunions…) — jamais écrasé par la synchro */
  manualLog: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Candidat détecté par l'analyse IA, avant import dans les contacts */
export interface LeadCandidate {
  name: string;
  email: string | null;
  company: string | null;
  suggestedType: ContactType;
  score: number;
  summary: string;
  excerpt: string;
}

/** Compte / entreprise (CRM orienté comptes) — regroupe contacts, deals et intel. */
export interface Company {
  id: string;
  userId: string;
  planId: string | null;
  name: string;
  /** Domaine web (acme.io) — sert au logo (favicon) et à l'enrichissement */
  domain: string | null;
  sector: string | null;
  size: string | null;
  /** SIREN (9 chiffres) — récupéré via l'API SIRENE (recherche-entreprises) */
  siren: string | null;
  /** Raison sociale officielle (registre SIRENE) */
  legalName: string | null;
  /** Code NAF/APE de l'activité principale (ex. « 62.01Z ») */
  naf: string | null;
  /** Adresse du siège social */
  address: string | null;
  /** CA du dernier exercice publié à l'INPI (« 311,4 M€ (2024) ») — null si comptes confidentiels */
  revenue: string | null;
  /** Description courte de ce que fait l'entreprise */
  description: string | null;
  /** Angles de vente adaptés à notre offre (markdown, puces) — enrichissement IA */
  salesAngles: string | null;
  /** Objections probables et parades (markdown, puces) — enrichissement IA */
  objections: string | null;
  /** Brief d'intelligence commerciale : activité détaillée, actualités (markdown) */
  intel: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmailDirection = 'sent' | 'received';

/** Email échangé avec un contact (journalisé à l'envoi ou synchronisé depuis la boîte). */
export interface ContactEmail {
  id: string;
  userId: string;
  contactId: string;
  direction: EmailDirection;
  subject: string | null;
  /** Extrait du corps (pas le corps intégral) */
  snippet: string | null;
  /** Date de l'email (ISO) */
  sentAt: string;
  /** Identifiant externe (messageId) pour la déduplication à la synchro */
  externalId: string | null;
  createdAt: string;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export interface TelegramLink {
  chatId: string;
  userId: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
  text: string;
  dueAt: string;
  sent: number;
  createdAt: string;
}

// ── Automatisations (cron jobs IA) ──────────────────────────────────────────
/**
 * Périodicité d'une automatisation. Deux familles :
 *  - « intraday » (hourly/every_3h/every_6h) : se relance toutes les N heures ;
 *  - « calendaire » (daily/weekly/monthly) : se relance à une HEURE précise de
 *    la journée (timeOfDay, fuseau Europe/Paris), éventuellement un jour de la
 *    semaine (weekly) ou du mois (monthly).
 */
export type CronFrequency = 'hourly' | 'every_3h' | 'every_6h' | 'daily' | 'weekly' | 'monthly';

/** Cadences intraday → minutes (les calendaires sont ancrées à une heure). */
export const CRON_FREQUENCY_MINUTES: Record<CronFrequency, number> = {
  hourly: 60,
  every_3h: 180,
  every_6h: 360,
  daily: 1440,
  weekly: 10080,
  monthly: 43200,
};

export const CRON_FREQUENCY_LABELS: Record<CronFrequency, string> = {
  hourly: 'Toutes les heures',
  every_3h: 'Toutes les 3 heures',
  every_6h: 'Toutes les 6 heures',
  daily: 'Chaque jour',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
};

/** True si la cadence se répète plusieurs fois par jour (pas d'heure fixe). */
export function isIntradayFrequency(freq: CronFrequency): boolean {
  return freq === 'hourly' || freq === 'every_3h' || freq === 'every_6h';
}

export type CronRunStatus = 'running' | 'ok' | 'error';

/** Une tâche IA récurrente : un objectif exécuté par la boucle agentique. */
export interface CronJob {
  id: string;
  userId: string;
  /** Projet auquel l'automatisation appartient (contexte d'exécution). */
  planId: string | null;
  title: string;
  /** Objectif en langage naturel — ce que l'IA doit accomplir à chaque exécution. */
  objective: string;
  /** Périodicité. */
  frequency: CronFrequency;
  /** Heure de déclenchement « HH:MM » (Europe/Paris) pour daily/weekly/monthly ; null en intraday. */
  timeOfDay: string | null;
  /** Jour de la semaine 1=lundi … 7=dimanche (weekly uniquement), sinon null. */
  weekday: number | null;
  /** Jour du mois 1–28 (monthly uniquement), sinon null. */
  dayOfMonth: number | null;
  /** Cadence en minutes — dérivée de la périodicité (affichage / intraday). */
  intervalMinutes: number;
  /** Active (1) ou en pause (0). */
  enabled: number;
  /** Prochaine exécution prévue (ISO). */
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: CronRunStatus | null;
  /** Dernier résultat produit par l'IA (texte). */
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Une exécution d'un cron job (historique). */
export interface CronRun {
  id: string;
  cronJobId: string;
  userId: string;
  status: CronRunStatus;
  result: string | null;
  /** Libellés des outils utilisés pendant l'exécution (JSON array). */
  actions: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ── Administration (founders only) ────────────────────────────────────────────

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  planCount: number;
  postCount: number;
  publishedPosts: number;
  lastActivityAt: string | null;
}

export interface AdminStats {
  totalUsers: number;
  newUsersLast7d: number;
  activeUsersLast7d: number;
  activeUsersLast30d: number;
  totalPlans: number;
  totalPosts: number;
  postsLast7d: number;
  publishedPostsLast7d: number;
  totalKnowledgeEntries: number;
}

export interface AdminEvent {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
