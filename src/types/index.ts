export interface PlanInput {
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

export interface OnboardingProfile {
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
}

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

export type KnowledgeSourceType = 'github' | 'website';

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

export interface Contact {
  id: string;
  userId: string;
  /** Projet auquel ce contact appartient — chaque projet a son propre carnet */
  planId: string | null;
  name: string;
  email: string | null;
  company: string | null;
  type: ContactType;
  /** D'où vient ce contact : 'commentaire LinkedIn', 'boîte mail', 'manuel'… */
  source: string | null;
  /** Score d'intérêt 0-100 estimé par l'IA (null = jamais analysé) */
  interestScore: number | null;
  /** Justification du score par l'IA */
  interestSummary: string | null;
  notes: string | null;
  /** Derniers échanges (commentaires/messages collés ou extraits de la boîte mail) */
  lastInteraction: string | null;
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
