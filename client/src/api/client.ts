const API_BASE = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function getToken(): string | null {
  return localStorage.getItem('launchforge_token');
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem('launchforge_token', token);
  else localStorage.removeItem('launchforge_token');
  // Le cache « vue d'ensemble » est un singleton de module : on le vide à tout
  // changement d'identité (connexion, inscription, déconnexion) pour qu'un
  // utilisateur ne lise jamais les projets du précédent — ce qui, combiné au
  // tutoriel, le déclencherait à tort sur 0 projet réel.
  invalidateOverview();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    return { success: false, error: 'Connexion au serveur impossible' } as ApiResponse<T>;
  }
  // Réponse non-JSON (ex. page HTML d'erreur si la route n'existe pas côté
  // serveur) : on ne laisse PAS échouer le parse — sinon la promesse rejette
  // et l'appelant reste bloqué (chargement infini). On renvoie une erreur claire.
  try {
    return await res.json();
  } catch {
    return {
      success: false,
      error: res.status === 404
        ? 'Ressource introuvable — le serveur n\'est peut-être pas à jour (redémarrez-le).'
        : `Réponse invalide du serveur (HTTP ${res.status}).`,
    } as ApiResponse<T>;
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /** Tutoriel d'accueil en attente : posé à la création du compte, lancé après
   *  le 1er projet. Absent/false = déjà vu ou compte ancien. */
  tutorialPending?: boolean;
  /** Le compte a un mot de passe local (faux pour un compte créé via Google
   *  seul) — pilote l'affichage du profil (changement de mot de passe, etc.). */
  hasPassword?: boolean;
  /** Fournisseur OAuth rattaché (« google ») ou null pour un compte local. */
  authProvider?: string | null;
}

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

export type PrimaryObjective = 'launch' | 'grow-revenue' | 'both';
export type Traction = 'pre-revenue' | 'first-customers' | 'early-revenue' | 'scaling';
export type SalesMotion = 'self-serve' | 'sales-led' | 'hybrid';

/** Contexte go-to-market / commercial — oriente le plan, la base de
 *  connaissances et les relances vers la vente. Tous optionnels. */
export interface GoToMarket {
  primaryObjective?: PrimaryObjective;
  traction?: Traction;
  salesMotion?: SalesMotion;
  buyer?: string;
  bottleneck?: string;
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
  mode?: 'ai' | 'template';
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
  /** 1 = projet actif (contexte de travail courant) */
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

export async function register(
  email: string,
  password: string,
  name: string
): Promise<ApiResponse<{ user: User; token: string }>> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export async function login(
  email: string,
  password: string
): Promise<ApiResponse<{ user: User; token: string }>> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe(): Promise<ApiResponse<User>> {
  return request('/auth/me');
}

/** RGPD art. 16 (rectification) : met à jour nom, email et/ou mot de passe.
 *  Un changement d'email renvoie un nouveau jeton (à restocker côté client). */
export async function updateProfile(data: {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<ApiResponse<{ user: User; token?: string }>> {
  return request('/auth/me', { method: 'PATCH', body: JSON.stringify(data) });
}

/** Consomme le drapeau « tutoriel d'accueil » côté serveur (montré une seule fois) */
export async function markTutorialSeen(): Promise<ApiResponse<{ tutorialPending: boolean }>> {
  return request('/auth/tutorial-seen', { method: 'POST' });
}

/** Fournisseurs OAuth activés côté serveur (bouton affiché en conséquence) */
export async function getOAuthStatus(): Promise<ApiResponse<{ google: boolean }>> {
  return request('/auth/oauth-status');
}

/** URL de démarrage du flux Google — navigation pleine page (pas un fetch) */
export const GOOGLE_LOGIN_URL = `${API_BASE}/auth/google`;

/** RGPD : télécharge toutes ses données (JSON) */
export async function exportMyData(): Promise<Blob | null> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/auth/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.ok ? res.blob() : null;
}

/** RGPD : suppression définitive du compte et de toutes les données */
export async function deleteAccount(): Promise<ApiResponse<{ deleted: boolean }>> {
  return request('/auth/account', { method: 'DELETE' });
}

/** Demande de réinitialisation — réponse toujours générique côté serveur */
export async function forgotPassword(email: string): Promise<ApiResponse<{ message: string }>> {
  return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Nouveau mot de passe via le jeton reçu par email — connecte directement */
export async function resetPassword(
  token: string,
  password: string
): Promise<ApiResponse<{ user: User; token: string }>> {
  return request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}

export async function getTemplates(): Promise<ApiResponse<any[]>> {
  return request('/templates');
}

export async function createPlan(
  input: PlanInput
): Promise<ApiResponse<LaunchPlan> & { bootstrappedPosts?: number }> {
  return request('/plan', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getPlans(): Promise<ApiResponse<LaunchPlan[]>> {
  return request('/plan');
}

export async function getPlan(
  id: string
): Promise<ApiResponse<LaunchPlan>> {
  return request(`/plan/${id}`);
}

/** Définit le projet de travail courant (sidebar) */
export async function activatePlan(id: string): Promise<ApiResponse<{ activePlanId: string }>> {
  return request(`/plan/${id}/activate`, { method: 'POST' });
}

// ── AI Onboarding ─────────────────────────────────────────────────────────────

export interface OnboardingAttachment {
  name: string;
  /** Texte brut, ou base64 pour les PDF */
  content: string;
  type?: 'text' | 'pdf';
}

export interface OnboardingChatMessage {
  role: 'assistant' | 'user';
  text: string;
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
  profile: OnboardingProfile | null;
  createdAt: string;
  updatedAt: string;
}

export async function startOnboarding(): Promise<ApiResponse<OnboardingSession>> {
  return request('/onboarding', { method: 'POST' });
}

export async function getOnboardingSession(
  id: string
): Promise<ApiResponse<OnboardingSession>> {
  return request(`/onboarding/${id}`);
}

export async function sendOnboardingMessage(
  id: string,
  message: string,
  attachments: OnboardingAttachment[] = []
): Promise<ApiResponse<OnboardingSession>> {
  return request(`/onboarding/${id}/message`, {
    method: 'POST',
    body: JSON.stringify({ message, attachments }),
  });
}

export interface OnboardingStreamHandlers {
  onDelta: (text: string) => void;
  onAction: (text: string) => void;
  onDone: (session: OnboardingSession) => void;
  onError: (error: string) => void;
}

/**
 * Streaming version of sendOnboardingMessage — consumes the SSE response so
 * the reply appears token by token and web searches show up live.
 */
export async function streamOnboardingMessage(
  id: string,
  message: string,
  attachments: OnboardingAttachment[],
  handlers: OnboardingStreamHandlers
): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: globalThis.Response;
  try {
    res = await fetch(`${API_BASE}/onboarding/${id}/message/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, attachments }),
    });
  } catch {
    handlers.onError('Connexion au serveur impossible');
    return;
  }

  if (!res.ok || !res.body) {
    try {
      const json = await res.json();
      handlers.onError(json.error || `Erreur serveur (${res.status})`);
    } catch {
      handlers.onError(`Erreur serveur (${res.status})`);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.type === 'delta') handlers.onDelta(payload.text);
        else if (payload.type === 'action') handlers.onAction(payload.text);
        else if (payload.type === 'done') { finished = true; handlers.onDone(payload.session); }
        else if (payload.type === 'error') { finished = true; handlers.onError(payload.error); }
      } catch {
        // malformed chunk — skip
      }
    }
  }

  if (!finished) {
    handlers.onError('La connexion a été interrompue — réessayez.');
  }
}

export interface ResearchResult {
  productName: string;
  competitors: { name: string; description: string }[];
  communities: { name: string; url: string; relevance: string }[];
  trends: string[];
  potentialAngles: string[];
}

export async function researchProduct(
  productName: string,
  description: string,
  niche: string
): Promise<ApiResponse<ResearchResult>> {
  return request('/research', {
    method: 'POST',
    body: JSON.stringify({ productName, description, niche }),
  });
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

export async function updateKanban(planId: string, state: KanbanState): Promise<ApiResponse<KanbanState>> {
  return request(`/plan/${planId}/kanban`, {
    method: 'PATCH',
    body: JSON.stringify(state),
  });
}

// ── Agents ────────────────────────────────────────────────────────────────────

export type AgentPlatform =
  | 'reddit' | 'twitter' | 'linkedin' | 'instagram'
  | 'producthunt' | 'hackernews' | 'indiehackers'
  | 'discord' | 'slack' | 'github';

export type AgentStatus = 'active' | 'inactive' | 'error';
export type RunStatus   = 'pending' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'rejected';
/** Pipeline : publication immédiate ('auto') ou validation utilisateur ('manual') */
export type ApprovalMode = 'auto' | 'manual';

export interface Agent {
  id: string;
  userId: string;
  name: string;
  platform: AgentPlatform;
  /** La clé API n'est jamais renvoyée par le serveur — uniquement ce booléen */
  hasApiKey: boolean;
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

export interface AgentTemplate {
  platform: AgentPlatform;
  name: string;
  icon: string;
  description: string;
  composioApp: string;
}

export async function getAgents(): Promise<ApiResponse<Agent[]>> {
  return request('/agents');
}

export async function getCatalog(): Promise<ApiResponse<AgentTemplate[]>> {
  return request('/agents/catalog');
}

export async function createAgent(data: {
  platform: AgentPlatform;
  name?: string;
  apiKey?: string;
  approvalMode?: ApprovalMode;
}): Promise<ApiResponse<Agent>> {
  return request('/agents', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAgent(
  id: string,
  data: { name?: string; apiKey?: string; status?: AgentStatus; approvalMode?: ApprovalMode }
): Promise<ApiResponse<Agent>> {
  return request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteAgent(id: string): Promise<ApiResponse<null>> {
  return request(`/agents/${id}`, { method: 'DELETE' });
}

export async function getAgentRuns(agentId: string): Promise<ApiResponse<AgentRun[]>> {
  return request(`/agents/${agentId}/runs`);
}

/** Runs des agents pour un plan (badges temps réel sur le Kanban) */
export async function getPlanRuns(planId: string): Promise<ApiResponse<AgentRun[]>> {
  return request(`/plan/${planId}/runs`);
}

// ── Validations (pipeline d'approbation) ─────────────────────────────────────

export interface ApprovalItem extends AgentRun {
  agentName: string;
  agentPlatform: AgentPlatform;
}

export async function getApprovals(): Promise<ApiResponse<ApprovalItem[]>> {
  return request('/approvals');
}

/** Historique des validations : runs terminés avec le résultat exact de l'envoi */
export async function getApprovalHistory(): Promise<ApiResponse<ApprovalItem[]>> {
  return request('/approvals/history');
}

export async function approveRun(
  runId: string,
  content?: string
): Promise<ApiResponse<AgentRun>> {
  return request(`/approvals/${runId}/approve`, {
    method: 'POST',
    body: JSON.stringify(content ? { content } : {}),
  });
}

export async function rejectRun(
  runId: string,
  reason?: string
): Promise<ApiResponse<AgentRun>> {
  return request(`/approvals/${runId}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
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
  /** URL du post publié sur la plateforme (pour la synchro des métriques) */
  externalUrl: string | null;
  /** Identifiant natif du post chez la plateforme (renseigné par l'import d'historique) */
  externalId: string | null;
  /** URL du visuel à joindre au post */
  imageUrl: string | null;
  /** Reddit : subreddit cible (sans le préfixe « r/ ») */
  subreddit: string | null;
  recurrence: Recurrence;
  /** Instruction de régénération IA : chaque nouvelle occurrence est réécrite
   *  par l'IA à partir de cette consigne (null = même contenu repris) */
  recurrenceBrief: string | null;
  /** Id du post d'origine de la série récurrente (null = tête de série) */
  seriesId: string | null;
  /** 1 = la régénération IA s'appuie sur une recherche d'actualités web */
  recurrenceUseNews: number;
  /** 1 = la régénération IA s'appuie sur la base de connaissances */
  recurrenceUseKnowledge: number;
  /** 1 = l'IA archive les actus utilisées dans la fiche 📰 Veille */
  recurrenceUpdateKb: number;
  /** Groupe multi-plateformes (même contenu décliné sur plusieurs plateformes) */
  crossPostId: string | null;
  /** 1 = publié automatiquement à l'heure programmée par le worker (Composio) */
  autoPublish: number;
  /** Dernière erreur de publication automatique */
  publishError: string | null;
  /** 1 = événement créé dans le calendrier personnel */
  calendarSynced: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

export async function getPosts(): Promise<ApiResponse<Post[]>> {
  return request('/posts');
}

export async function createPost(data: Partial<Post> & { platform: string }): Promise<ApiResponse<Post>> {
  return request('/posts', { method: 'POST', body: JSON.stringify(data) });
}

/** Importe un post déjà publié depuis son URL : créé en statut « publié »
 *  (plateforme déduite du domaine, surchargeable), puis analyse Composio
 *  immédiate (vues/likes/commentaires). `synced` = métriques récupérées. */
export async function importPost(
  url: string,
  platform?: string,
): Promise<ApiResponse<{ post: Post; synced: boolean; note?: string; commentsAdded: number }>> {
  return request('/posts/import', { method: 'POST', body: JSON.stringify({ url, platform }) });
}

export async function updatePost(id: string, data: Partial<Post>): Promise<ApiResponse<Post>> {
  return request(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

/** Capacité d'import d'historique d'une plateforme (pilote la modale d'import) */
export interface HistoryCapability {
  platform: string;
  label: string;
  importable: boolean;
  handleField?: { label: string; placeholder: string; required: boolean };
  note: string;
}

/** Plateformes pour lesquelles l'import en masse de l'historique est possible */
export async function getImportHistoryOptions(): Promise<ApiResponse<{ platforms: HistoryCapability[] }>> {
  return request('/posts/import-history/options');
}

/** Importe EN MASSE les anciens posts d'un compte connecté (dédup automatique).
 *  `handle` : handle YouTube ou username Reddit quand la plateforme le demande. */
export async function importHistory(
  platform: string,
  handle?: string,
  limit?: number,
): Promise<ApiResponse<{
  platform: string; found: number; imported: number; skipped: number; failed: number; note: string; posts: Post[];
}>> {
  return request('/posts/import-history', {
    method: 'POST',
    body: JSON.stringify({ platform, ...(handle ? { handle } : {}), ...(limit ? { limit } : {}) }),
  });
}

export async function deletePost(id: string): Promise<ApiResponse<null>> {
  return request(`/posts/${id}`, { method: 'DELETE' });
}

export interface PublishOutcome { platform: string; ok: boolean; message: string; url?: string }

/** Publication immédiate et RÉELLE via Composio. group=true publie aussi les
 *  exemplaires multi-plateformes non publiés — un résultat par plateforme. */
export async function publishPostNow(
  id: string,
  group = false,
): Promise<ApiResponse<{ post: Post; results: PublishOutcome[]; message: string }>> {
  return request(`/posts/${id}/publish-now`, { method: 'POST', body: JSON.stringify({ group }) });
}

export async function publishPost(id: string): Promise<ApiResponse<{ post: Post; next: Post | null }>> {
  return request(`/posts/${id}/publish`, { method: 'POST' });
}

/** Décline un post vers d'autres plateformes (adapt = réécriture IA par plateforme) */
export async function crosspostPost(
  id: string,
  platforms: string[],
  adapt: boolean,
): Promise<ApiResponse<{ posts: Post[]; post: Post; skipped: number }>> {
  return request(`/posts/${id}/crosspost`, { method: 'POST', body: JSON.stringify({ platforms, adapt }) });
}

/** Mode simulé : génère la prochaine occurrence d'une série récurrente sans rien enregistrer */
export async function previewRecurrence(
  id: string,
  opts: { recurrenceBrief?: string; recurrenceUseNews?: boolean; recurrenceUseKnowledge?: boolean },
): Promise<ApiResponse<{ title: string; content: string }>> {
  return request(`/posts/${id}/recurrence/preview`, { method: 'POST', body: JSON.stringify(opts) });
}

/** Synchronise les métriques réelles via le serveur MCP Composio */
export async function syncPostMetrics(
  id: string
): Promise<ApiResponse<{ post: Post; note?: string }>> {
  return request(`/posts/${id}/sync-metrics`, { method: 'POST' });
}

export interface EmbedCheck {
  embeddable: boolean;
  embedUrl: string | null;
  /** 'youtube' | 'headers-ok' | 'x-frame-options' | 'csp' | 'no-url' | 'unreachable' */
  reason: string;
}

/** Vérifie si le post publié peut être affiché dans une iframe (sonde côté serveur). */
export async function checkPostEmbed(id: string): Promise<ApiResponse<EmbedCheck>> {
  return request(`/posts/${id}/embed`);
}

// ── Base de connaissances ─────────────────────────────────────────────────────

export type KnowledgeCategory = 'company' | 'product' | 'audience' | 'tone' | 'offers' | 'learnings' | 'news' | 'other';

export interface KnowledgeEntry {
  id: string;
  userId: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export async function getKnowledge(): Promise<ApiResponse<KnowledgeEntry[]>> {
  return request('/knowledge');
}

export async function createKnowledge(data: {
  title: string; content: string; category: KnowledgeCategory;
}): Promise<ApiResponse<KnowledgeEntry>> {
  return request('/knowledge', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateKnowledge(
  id: string,
  data: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'category'>>
): Promise<ApiResponse<KnowledgeEntry>> {
  return request(`/knowledge/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteKnowledge(id: string): Promise<ApiResponse<null>> {
  return request(`/knowledge/${id}`, { method: 'DELETE' });
}

// ── Mise à jour automatique de la base (sources GitHub / site web / HubSpot) ──

export type KnowledgeSourceType = 'github' | 'website' | 'hubspot';

export interface KnowledgeSource {
  id: string;
  userId: string;
  planId: string | null;
  type: KnowledgeSourceType;
  url: string;
  label: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface KnowledgeSuggestion {
  action: 'create' | 'update';
  targetId: string | null;
  category: KnowledgeCategory;
  title: string;
  content: string;
  source: string;
  reason: string;
}

export interface KnowledgeSyncResult {
  suggestions: KnowledgeSuggestion[];
  fetched: { type: KnowledgeSourceType; url: string; label: string; chars: number }[];
  errors: { url: string; error: string }[];
}

export async function getKnowledgeSources(): Promise<ApiResponse<KnowledgeSource[]>> {
  return request('/knowledge/sources');
}

export async function addKnowledgeSource(data: {
  // HubSpot est lié au compte Composio connecté : aucune URL à fournir.
  type: KnowledgeSourceType; url?: string; label?: string;
}): Promise<ApiResponse<KnowledgeSource>> {
  return request('/knowledge/sources', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteKnowledgeSource(id: string): Promise<ApiResponse<null>> {
  return request(`/knowledge/sources/${id}`, { method: 'DELETE' });
}

export async function analyzeKnowledgeSources(data: {
  github?: string; website?: string; crawl?: boolean; sourceIds?: string[];
}): Promise<ApiResponse<KnowledgeSyncResult>> {
  return request('/knowledge/sync/analyze', { method: 'POST', body: JSON.stringify(data) });
}

export async function applyKnowledgeSuggestions(
  suggestions: KnowledgeSuggestion[]
): Promise<ApiResponse<{ applied: KnowledgeEntry[] }>> {
  return request('/knowledge/sync/apply', { method: 'POST', body: JSON.stringify({ suggestions }) });
}

/** Mise à jour « maintenant » : analyse les sources enregistrées et applique
 *  directement les fiches (même cycle que la mise à jour automatique). */
export async function runKnowledgeSync(crawl = false): Promise<ApiResponse<{
  applied: KnowledgeEntry[];
  errors: { id: string; url: string; error: string }[];
  syncedAt: string | null;
}>> {
  return request('/knowledge/sync/run', { method: 'POST', body: JSON.stringify({ crawl }) });
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
  name: string;
  email: string | null;
  company: string | null;
  companyId: string | null;
  type: ContactType;
  /** Étape dans le pipeline de vente. Défaut 'new'. */
  stage: DealStage;
  /** Montant du deal (EUR), null si non chiffré */
  amount: number | null;
  /** Id de l'enregistrement source externe (HubSpot…) */
  externalId: string | null;
  /** Date de clôture estimée (ISO yyyy-mm-dd) */
  expectedCloseDate: string | null;
  /** Prochaine action commerciale à mener */
  nextAction: string | null;
  /** Échéance de la prochaine action (ISO yyyy-mm-dd) */
  nextActionAt: string | null;
  source: string | null;
  /** Poste occupé (ex. « Head of Sales ») — saisi ou enrichi via Apollo */
  title: string | null;
  /** URL du profil LinkedIn — saisie ou enrichie via Apollo */
  linkedinUrl: string | null;
  /** Téléphone — saisi ou livré par le webhook Apollo */
  phone: string | null;
  interestScore: number | null;
  interestSummary: string | null;
  notes: string | null;
  /** Derniers échanges — auto depuis les emails reçus (synchro) */
  lastInteraction: string | null;
  /** Échanges saisis à la main — jamais écrasé par la synchro */
  manualLog: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadCandidate {
  name: string;
  email: string | null;
  company: string | null;
  suggestedType: ContactType;
  score: number;
  summary: string;
  excerpt: string;
}

// ── Comptes (entreprises) & emails des contacts ───────────────────────────────

export interface Company {
  id: string;
  userId: string;
  name: string;
  domain: string | null;
  sector: string | null;
  size: string | null;
  /** SIREN (9 chiffres) — récupéré via le registre SIRENE à l'enrichissement */
  siren: string | null;
  /** Raison sociale officielle (registre SIRENE) */
  legalName: string | null;
  /** Code NAF/APE (ex. « 62.01Z ») */
  naf: string | null;
  /** Adresse du siège social */
  address: string | null;
  /** CA du dernier exercice publié à l'INPI (« 311,4 M€ (2024) ») — null si comptes confidentiels */
  revenue: string | null;
  description: string | null;
  /** Angles de vente (markdown, puces) — enrichissement IA */
  salesAngles: string | null;
  /** Objections probables + parades (markdown, puces) — enrichissement IA */
  objections: string | null;
  /** Brief d'intelligence commerciale (markdown) : activité, actualités */
  intel: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyWithStats extends Company {
  contactCount: number;
  dealCount: number;
  openValue: number;
  wonValue: number;
}

export interface CompanyDetail extends CompanyWithStats {
  contacts: Contact[];
}

export type EmailDirection = 'sent' | 'received';

export interface ContactEmail {
  id: string;
  contactId: string;
  direction: EmailDirection;
  subject: string | null;
  snippet: string | null;
  sentAt: string;
  externalId: string | null;
  createdAt: string;
}

export async function getCompanies(): Promise<ApiResponse<CompanyWithStats[]>> {
  return request('/companies');
}
export async function getCompany(id: string): Promise<ApiResponse<CompanyDetail>> {
  return request(`/companies/${id}`);
}
export async function createCompany(data: { name: string; domain?: string }): Promise<ApiResponse<CompanyWithStats>> {
  return request('/companies', { method: 'POST', body: JSON.stringify(data) });
}
export async function updateCompany(id: string, patch: Partial<Company>): Promise<ApiResponse<CompanyWithStats>> {
  return request(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function deleteCompany(id: string): Promise<ApiResponse<null>> {
  return request(`/companies/${id}`, { method: 'DELETE' });
}
/** Enrichissement IA d'un compte (recherche web + brief commercial) */
export async function enrichCompany(id: string): Promise<ApiResponse<CompanyWithStats>> {
  return request(`/companies/${id}/enrich`, { method: 'POST' });
}

/** Emails journalisés d'un contact (timeline) */
export async function getContactEmails(contactId: string): Promise<ApiResponse<ContactEmail[]>> {
  return request(`/contacts/${contactId}/emails`);
}
/** Trace de diagnostic de la synchro emails (débogage) */
export interface EmailSyncDebug {
  address: string;
  okCalls: number;
  failedCalls: number;
  parsedEmails: number;
  replyPreview: string;
  parseError?: string;
  warning?: string;
  source?: string;
}
/** Synchronise depuis la boîte mail les emails échangés avec ce contact */
export async function syncContactEmails(contactId: string): Promise<ApiResponse<{ added: number; emails: ContactEmail[]; debug?: EmailSyncDebug }>> {
  return request(`/contacts/${contactId}/emails/sync`, { method: 'POST' });
}

/** (Ré)analyse par l'IA le score d'intérêt d'un seul contact */
export async function scoreContact(id: string): Promise<ApiResponse<Contact>> {
  return request(`/contacts/${id}/score`, { method: 'POST' });
}

export async function getContacts(): Promise<ApiResponse<Contact[]>> {
  return request('/contacts');
}

export async function createContact(data: Partial<Contact> & { name: string }): Promise<ApiResponse<Contact>> {
  return request('/contacts', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateContact(id: string, data: Partial<Contact>): Promise<ApiResponse<Contact>> {
  return request(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteContact(id: string): Promise<ApiResponse<null>> {
  return request(`/contacts/${id}`, { method: 'DELETE' });
}

/** Analyse IA d'un bloc de commentaires/messages collés */
export async function analyzeLeads(text: string, source: string): Promise<ApiResponse<LeadCandidate[]>> {
  return request('/contacts/analyze', { method: 'POST', body: JSON.stringify({ text, source }) });
}

/** Détection des leads dans la boîte mail (Composio MCP) */
export interface InboxScanResult {
  updated: { id: string; name: string; score: number | null }[];
  candidates: LeadCandidate[];
  scanned: number;
  debug?: { rawCount: number; replyPreview: string };
}
export async function scanInbox(opts?: { maxEmails?: number; daysBack?: number; discoverNew?: boolean }): Promise<ApiResponse<InboxScanResult>> {
  return request('/contacts/scan-inbox', { method: 'POST', body: JSON.stringify(opts ?? {}) });
}

/** Détection des leads dans les likes/commentaires d'un post publié (Composio MCP) */
export async function scanPost(postId: string): Promise<ApiResponse<LeadCandidate[]>> {
  return request('/contacts/scan-post', { method: 'POST', body: JSON.stringify({ postId }) });
}

/** Candidat lu dans HubSpot (préversion de l'import CRM) */
export interface HubSpotCandidate {
  externalId: string;
  name: string;
  email: string | null;
  company: string | null;
  type: ContactType;
  stage: DealStage;
  amount: number | null;
  expectedCloseDate: string | null;
  source: string;
  summary: string | null;
  /** true = déjà importé (le ré-import mettra la fiche à jour) */
  existing: boolean;
}

/** Liste les deals + contacts du CRM HubSpot SANS les importer (l'utilisateur choisit) */
export async function previewHubSpot(): Promise<ApiResponse<HubSpotCandidate[]>> {
  return request('/contacts/import-hubspot/preview');
}

/** Importe le CRM HubSpot (deals + contacts) dans le projet actif (Composio, déterministe).
 *  `externalIds` restreint l'import à la sélection faite dans la préversion. */
export async function importHubSpot(externalIds?: string[]): Promise<ApiResponse<{ imported: number; updated: number }>> {
  return request('/contacts/import-hubspot', {
    method: 'POST',
    body: JSON.stringify(externalIds ? { externalIds } : {}),
  });
}

export async function draftContactEmail(
  id: string,
  goal: string
): Promise<ApiResponse<{ subject: string; body: string }>> {
  return request(`/contacts/${id}/draft-email`, { method: 'POST', body: JSON.stringify({ goal }) });
}

export async function sendContactEmail(
  id: string,
  subject: string,
  body: string
): Promise<ApiResponse<{ result: string; contact: Contact }>> {
  return request(`/contacts/${id}/send-email`, { method: 'POST', body: JSON.stringify({ subject, body }) });
}

// ── Automatisations (cron jobs IA) ───────────────────────────────────────────

export type CronFrequency = 'hourly' | 'every_3h' | 'every_6h' | 'daily' | 'weekly' | 'monthly';

export const CRON_FREQUENCY_LABELS: Record<CronFrequency, string> = {
  hourly: 'Toutes les heures',
  every_3h: 'Toutes les 3 heures',
  every_6h: 'Toutes les 6 heures',
  daily: 'Chaque jour',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
};

/** Cadences « intraday » (plusieurs fois par jour) — pas d'heure fixe. */
export function isIntradayFrequency(freq: CronFrequency): boolean {
  return freq === 'hourly' || freq === 'every_3h' || freq === 'every_6h';
}

export const WEEKDAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Lundi' }, { value: 2, label: 'Mardi' }, { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' }, { value: 5, label: 'Vendredi' }, { value: 6, label: 'Samedi' }, { value: 7, label: 'Dimanche' },
];

export type CronRunStatus = 'running' | 'ok' | 'error';

export interface CronJob {
  id: string;
  userId: string;
  planId: string | null;
  title: string;
  objective: string;
  frequency: CronFrequency;
  timeOfDay: string | null;
  weekday: number | null;
  dayOfMonth: number | null;
  intervalMinutes: number;
  enabled: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: CronRunStatus | null;
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Libellé lisible d'une cadence (« Chaque lundi à 9h », « Toutes les 3 heures »…). */
export function describeCronSchedule(j: Pick<CronJob, 'frequency' | 'timeOfDay' | 'weekday' | 'dayOfMonth'>): string {
  const t = j.timeOfDay || '09:00';
  const [hh, mm] = t.split(':');
  const pretty = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  switch (j.frequency) {
    case 'hourly':   return 'Toutes les heures';
    case 'every_3h': return 'Toutes les 3 heures';
    case 'every_6h': return 'Toutes les 6 heures';
    case 'daily':    return `Chaque jour à ${pretty}`;
    case 'weekly':   return `Chaque ${(WEEKDAY_LABELS.find((w) => w.value === (j.weekday ?? 1))?.label ?? 'lundi').toLowerCase()} à ${pretty}`;
    case 'monthly':  return `Le ${j.dayOfMonth ?? 1} de chaque mois à ${pretty}`;
    default:         return 'Périodique';
  }
}

export interface CronRun {
  id: string;
  cronJobId: string;
  userId: string;
  status: CronRunStatus;
  result: string | null;
  actions: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CronJobInput {
  title: string;
  objective: string;
  frequency: CronFrequency;
  /** « HH:MM » (Europe/Paris) pour daily/weekly/monthly. */
  timeOfDay?: string | null;
  /** 1=lundi … 7=dimanche (weekly). */
  weekday?: number | null;
  /** 1–28 (monthly). */
  dayOfMonth?: number | null;
  enabled?: boolean;
}

export async function getCronJobs(): Promise<ApiResponse<CronJob[]>> {
  return request('/cron');
}

export async function createCronJob(data: CronJobInput): Promise<ApiResponse<CronJob>> {
  return request('/cron', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCronJob(
  id: string,
  data: Partial<CronJobInput>,
): Promise<ApiResponse<CronJob>> {
  return request(`/cron/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteCronJob(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
  return request(`/cron/${id}`, { method: 'DELETE' });
}

/** Exécute maintenant (synchrone) — la réponse contient le compte rendu produit. */
export async function runCronJob(id: string): Promise<ApiResponse<CronRun>> {
  return request(`/cron/${id}/run`, { method: 'POST' });
}

export async function getCronRuns(id: string): Promise<ApiResponse<CronRun[]>> {
  return request(`/cron/${id}/runs`);
}

// ── Vue d'ensemble (shell de l'app) ──────────────────────────────────────────

/** Projet « léger » pour la sidebar et le tableau de bord */
export interface ProjectSummary {
  id: string;
  active: number;
  createdAt: string;
  productName: string;
  niche: string;
  targetAudience: string;
  companyName: string | null;
  /** Projet d'équipe : id + nom de l'équipe (absent = projet personnel) */
  teamId?: string | null;
  teamName?: string | null;
  /** Rôle de l'utilisateur courant sur ce projet */
  role?: TeamRole;
}

/** Rattache (teamId) ou détache (null) un projet à une équipe */
export async function assignPlanToTeam(planId: string, teamId: string | null): Promise<ApiResponse<{ teamId: string | null }>> {
  return request(`/plan/${planId}/team`, { method: 'POST', body: JSON.stringify({ teamId }) });
}

export interface Overview {
  projects: ProjectSummary[];
  project: ProjectSummary | null;
  tasks: { total: number; done: number; inProgress: number; progress: number };
  posts: {
    scheduled: number;
    published: number;
    drafts: number;
    next: { id: string; title: string; platform: string; scheduledAt: string } | null;
  };
  approvals: number;
}

// Cache court + déduplication des requêtes en vol : la sidebar et le tableau
// de bord partagent la même réponse au lieu de tirer chacun leurs requêtes.
let overviewCache: { at: number; data: Overview } | null = null;
let overviewInflight: Promise<ApiResponse<Overview>> | null = null;

export async function getOverview(maxAgeMs = 5000): Promise<ApiResponse<Overview>> {
  if (overviewCache && Date.now() - overviewCache.at < maxAgeMs) {
    return { success: true, data: overviewCache.data };
  }
  if (overviewInflight) return overviewInflight;
  overviewInflight = request<Overview>('/overview').then((res) => {
    if (res.success && res.data) overviewCache = { at: Date.now(), data: res.data };
    overviewInflight = null;
    return res;
  });
  return overviewInflight;
}

/** À appeler après une action qui change le contexte (création de projet…) */
export function invalidateOverview(): void {
  overviewCache = null;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ConfigToolkit {
  slug: string;
  name: string;
  capability: string;
  connected: boolean;
}

export interface ConfigStatus {
  ai: { configured: boolean; model: string | null };
  composio: { configured: boolean; dashboardUrl: string; toolkits: ConfigToolkit[]; canManage?: boolean; ownerName?: string | null; preferredCalendar?: string | null };
  marp: { theme: string; hasCustomCss: boolean; themes: { value: string; label: string }[] };
  metricsSync: { intervalMinutes: number };
  knowledgeSync: { intervalMinutes: number };
  telegram: { configured: boolean; linked: boolean; ownBot: boolean; botUsername: string | null };
  /** Clé API Apollo.io personnelle (enrichissement de contacts) — jamais renvoyée, juste l'état */
  apollo: { configured: boolean };
  publishMode: 'auto' | 'manual';
}

export async function getConfigStatus(fresh = false): Promise<ApiResponse<ConfigStatus>> {
  return request(`/config/status${fresh ? '?fresh=1' : ''}`);
}

/** Champ d'identifiant exigé par un toolkit sans auth gérée (ex. X/Twitter) */
export interface OwnAppField { name: string; description: string }

export type ConnectToolkitResponse = ApiResponse<{ redirectUrl: string }> & {
  /** NEEDS_OWN_APP : fournir les identifiants de sa propre app développeur */
  code?: string;
  fields?: OwnAppField[];
  callbackUrl?: string;
};

/** Prépare la connexion d'un compte et renvoie le lien d'autorisation OAuth */
export async function connectToolkit(
  toolkit: string,
  credentials?: Record<string, string>,
): Promise<ConnectToolkitResponse> {
  return request('/config/connect', {
    method: 'POST',
    body: JSON.stringify({ toolkit, ...(credentials ? { credentials } : {}) }),
  });
}

/** Déconnecte un compte (supprime les comptes connectés du toolkit chez Composio) */
export async function disconnectToolkit(toolkit: string): Promise<ApiResponse<{ removed: number }>> {
  return request('/config/disconnect', { method: 'POST', body: JSON.stringify({ toolkit }) });
}

/** Consigne dans la base de connaissances du projet actif les plateformes
 *  sociales actuellement connectées (le serveur détecte la liste lui-même). */
export async function recordActivePlatforms(): Promise<ApiResponse<{ platforms: string[]; added: number }>> {
  return request('/config/active-platforms', { method: 'POST' });
}

/** Enregistre le bot Telegram personnel (token @BotFather) et démarre son poller */
export async function setTelegramBot(token: string): Promise<ApiResponse<{ ownBot: boolean; botUsername: string }>> {
  return request('/config/telegram-bot', { method: 'PATCH', body: JSON.stringify({ token }) });
}

/** Supprime le bot Telegram personnel */
export async function removeTelegramBot(): Promise<ApiResponse<{ ownBot: boolean }>> {
  return request('/config/telegram-bot', { method: 'DELETE' });
}

/** Enregistre la clé API Apollo.io personnelle (vérifiée auprès d'Apollo avant stockage) */
export async function setApolloApiKey(key: string): Promise<ApiResponse<{ configured: boolean }>> {
  return request('/config/apollo-key', { method: 'PATCH', body: JSON.stringify({ key }) });
}

/** Supprime la clé API Apollo.io personnelle */
export async function removeApolloApiKey(): Promise<ApiResponse<{ configured: boolean }>> {
  return request('/config/apollo-key', { method: 'DELETE' });
}

/** Fiche entreprise renvoyée par Apollo */
export interface ApolloOrganization {
  name: string | null; domain: string | null; industry: string | null;
  size: string | null; description: string | null; linkedinUrl: string | null;
  phone: string | null;
}

/** Données trouvées par Apollo pour un contact (aperçu post-enrichissement) */
export interface ApolloEnrichment {
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  email: string | null;
  /** Téléphone direct si présent — sinon livré plus tard par le webhook Apollo */
  phone: string | null;
  city: string | null;
  country: string | null;
  organization: ApolloOrganization | null;
}

/**
 * Enrichit un contact via Apollo.io (clé personnelle — crédits Apollo de l'utilisateur).
 * `enrichment` peut être null (personne introuvable ou plan Apollo sans people/match) :
 * `organization` porte alors la fiche entreprise obtenue en repli, `warnings` explique.
 */
export async function enrichContactApollo(contactId: string): Promise<ApiResponse<{
  contact: Contact;
  company: Company | null;
  enrichment: ApolloEnrichment | null;
  organization: ApolloOrganization | null;
  warnings: string[];
}>> {
  return request(`/contacts/${contactId}/enrich-apollo`, { method: 'POST' });
}

/** Génère un visuel IA hébergé (attaché au post si postId) ; publicUrl null = repli local (non public) */
export async function generatePostImage(brief: string, postId?: string): Promise<ApiResponse<{ url: string; publicUrl: string | null }>> {
  return request('/content/image', { method: 'POST', body: JSON.stringify({ brief, postId }) });
}

/** Héberge une image fournie par l'utilisateur (base64/data-URL) ; publicUrl null = repli local (non public) */
export async function uploadPostImage(imageBase64: string, postId?: string): Promise<ApiResponse<{ url: string; publicUrl: string | null }>> {
  return request('/content/image/upload', { method: 'POST', body: JSON.stringify({ imageBase64, postId }) });
}

/** Téléverse une vidéo de l'utilisateur (binaire brut — mp4/webm/mov, 3 Go max, supprimée du serveur après publication) */
export async function uploadPostVideo(file: File, postId?: string): Promise<ApiResponse<{ url: string; publicUrl: string | null }>> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/content/video/upload${postId ? `?postId=${encodeURIComponent(postId)}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'video/mp4',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  return res.json();
}

// ── Présentations (decks Marp) ────────────────────────────────────────────────

export interface DeckSummary { id: string; title: string; createdAt: string }

export async function getDecks(): Promise<ApiResponse<DeckSummary[]>> {
  return request('/decks');
}

export async function createDeck(brief: string, slides: number): Promise<ApiResponse<DeckSummary>> {
  return request('/decks', { method: 'POST', body: JSON.stringify({ brief, slides }) });
}

export async function deleteDeck(id: string): Promise<ApiResponse<null>> {
  return request(`/decks/${id}`, { method: 'DELETE' });
}

/** URL de présentation plein écran (ouverte en nouvel onglet → token en query) */
export function deckHtmlUrl(id: string): string {
  return `${API_BASE}/decks/${id}/html?token=${encodeURIComponent(getToken() ?? '')}`;
}

export function deckMarkdownUrl(id: string): string {
  return `${API_BASE}/decks/${id}/markdown?token=${encodeURIComponent(getToken() ?? '')}`;
}

/** Rend un deck en GIF animé ou MP4 (fondus entre slides) */
export async function renderDeckMedia(
  id: string,
  format: 'gif' | 'mp4',
  postId?: string
): Promise<ApiResponse<{ url: string; publicUrl: string | null }>> {
  return request(`/decks/${id}/render`, { method: 'POST', body: JSON.stringify({ format, postId }) });
}

export function themePreviewUrl(): string {
  return `${API_BASE}/decks/theme-preview?token=${encodeURIComponent(getToken() ?? '')}`;
}

export async function setMarpTheme(theme: string): Promise<ApiResponse<{ theme: string }>> {
  return request('/config/marp-theme', { method: 'PATCH', body: JSON.stringify({ theme }) });
}

export async function customizeMarpTheme(instructions: string): Promise<ApiResponse<{ theme: string }>> {
  return request('/config/marp-theme/customize', { method: 'POST', body: JSON.stringify({ instructions }) });
}

/** Intervalle de synchro automatique des métriques (minutes, 0 = désactivée) */
export async function setMetricsSyncInterval(intervalMinutes: number): Promise<ApiResponse<{ intervalMinutes: number }>> {
  return request('/config/metrics-sync', { method: 'PATCH', body: JSON.stringify({ intervalMinutes }) });
}

/** Intervalle de mise à jour auto de la base de connaissances (minutes, 0 = désactivée) */
export async function setKnowledgeSyncInterval(intervalMinutes: number): Promise<ApiResponse<{ intervalMinutes: number }>> {
  return request('/config/knowledge-sync', { method: 'PATCH', body: JSON.stringify({ intervalMinutes }) });
}

/** Agenda préféré pour la synchro des posts quand plusieurs sont connectés */
export async function setPreferredCalendar(
  calendar: 'googlecalendar' | 'outlook' | 'auto',
): Promise<ApiResponse<{ preferredCalendar: string | null }>> {
  return request('/config/calendar', { method: 'PATCH', body: JSON.stringify({ calendar }) });
}

export async function setPublishMode(mode: 'auto' | 'manual'): Promise<ApiResponse<{ publishMode: string }>> {
  return request('/config/publish-mode', { method: 'PATCH', body: JSON.stringify({ mode }) });
}

/** Assigne une tâche Kanban à une plateforme (l'agent est géré côté serveur) */
export async function assignPlatformToCard(data: {
  platform: string;
  planId: string;
  cardId: string;
  cardTitle: string;
  cardDescription: string;
  cardCategory: string;
  cardEffort: 'low' | 'medium' | 'high';
}): Promise<ApiResponse<AgentRun>> {
  return request('/agents/assign-platform', { method: 'POST', body: JSON.stringify(data) });
}

/** Post-mortem IA d'un post publié (les enseignements alimentent la base de connaissances) */
export async function analyzePostPerf(id: string): Promise<ApiResponse<{ analysis: string; learnings: string[] }>> {
  return request(`/posts/${id}/analyze`, { method: 'POST' });
}

export interface PerformanceSeries {
  weekly: { week: string; posts: number; impressions: number; likes: number; relImpressions: number | null; relLikes: number | null }[];
  daily: { date: string; impressions: number; likes: number }[];
  hasHistory: boolean;
}

/** Séries pour les graphiques de la vue Performances (sans IA, instantané) */
export async function getPerformance(): Promise<ApiResponse<PerformanceSeries>> {
  return request('/content/performance');
}

/** Rapport de campagne narratif du projet actif */
export async function getCampaignReport(): Promise<ApiResponse<{ report: string; stats: unknown }>> {
  return request('/content/report');
}

export interface CampaignReportItem { id: string; report: string; createdAt: string }

/** Historique des analyses de campagne archivées (projet actif) */
export async function getCampaignReports(): Promise<ApiResponse<CampaignReportItem[]>> {
  return request('/content/reports');
}

// ── Commentaires des posts (contenu réel, regroupé par type de post) ─────────

export interface CommentEntry {
  author: string | null;
  text: string;
  likeCount: number;
  commentedAt: string | null;
}

export interface CommentStats {
  total: number;
  byPlatform: { platform: string; total: number; comments: CommentEntry[] }[];
}

export type CommentSentiment = 'positif' | 'mitigé' | 'négatif' | 'n/a';

export interface CommentAnalysis {
  byPlatform: { platform: string; total: number; sentiment: CommentSentiment; summary: string; themes: string[] }[];
  overall: string;
}

/** Commentaires récupérés du projet actif, groupés par plateforme (sans IA) */
export async function getComments(): Promise<ApiResponse<CommentStats>> {
  return request('/content/comments');
}

/** Récupère via Composio le contenu des commentaires des posts publiés (borné) */
export async function refreshComments(): Promise<ApiResponse<{ added: number; scanned: number; eligible: number; stats: CommentStats }>> {
  return request('/content/comments/refresh', { method: 'POST' });
}

/** Lecture IA des commentaires : sentiment + thèmes par plateforme */
export async function analyzeComments(): Promise<ApiResponse<CommentAnalysis>> {
  return request('/content/comments/analyze', { method: 'POST' });
}

/** Synchronise tous les posts programmés vers le calendrier personnel */
export async function syncAllToCalendar(): Promise<ApiResponse<{ synced: number; message?: string }>> {
  return request('/posts/sync-calendar', { method: 'POST' });
}

// ── Assistant de création de posts (chat) ────────────────────────────────────

export interface PostChatMessage {
  role: 'user' | 'assistant';
  text: string;
  actions?: string[];
}

export interface PostChatHandlers {
  onDelta: (text: string) => void;
  onAction: (text: string) => void;
  onSaved: (postId: string, title: string) => void;
  onDone: (reply: string, actions: string[]) => void;
  onError: (error: string) => void;
  /** Appelé quand l'utilisateur interrompt volontairement le flux (abort) — pas une erreur */
  onAbort?: () => void;
}

/** Lecteur SSE commun aux chats (création de posts, assistant intégré) */
async function streamChat(
  path: string,
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: Omit<PostChatHandlers, 'onSaved'> & { onSaved?: PostChatHandlers['onSaved'] },
  signal?: AbortSignal,
  extra?: Record<string, unknown>
): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const isAbort = (err: unknown) => Boolean(signal?.aborted) || (err as { name?: string })?.name === 'AbortError';

  let res: globalThis.Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, ...extra }),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) handlers.onAbort?.();
    else handlers.onError('Connexion au serveur impossible');
    return;
  }

  if (!res.ok || !res.body) {
    try {
      const json = await res.json();
      handlers.onError(json.error || `Erreur serveur (${res.status})`);
    } catch {
      handlers.onError(`Erreur serveur (${res.status})`);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'delta') handlers.onDelta(payload.text);
          else if (payload.type === 'action') handlers.onAction(payload.text);
          else if (payload.type === 'saved') handlers.onSaved?.(payload.postId, payload.title);
          else if (payload.type === 'done') { finished = true; handlers.onDone(payload.reply, payload.actions || []); }
          else if (payload.type === 'error') { finished = true; handlers.onError(payload.error); }
        } catch { /* chunk malformé — ignoré */ }
      }
    }
  } catch (err) {
    // Abandon volontaire (clic « Stop ») → pas une erreur ; on garde le texte déjà reçu
    if (isAbort(err)) { handlers.onAbort?.(); return; }
    handlers.onError('La connexion a été interrompue — réessayez.');
    return;
  }

  if (!finished) {
    if (signal?.aborted) handlers.onAbort?.();
    else handlers.onError('La connexion a été interrompue — réessayez.');
  }
}

/** Chat de création de posts — SSE (deltas, recherches web, posts enregistrés) */
export async function streamPostChat(
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: PostChatHandlers
): Promise<void> {
  return streamChat('/content/chat/stream', messages, handlers);
}

/** Copilote « prochaine action » d'un contact — SSE (deltas) */
export async function streamContactNextAction(
  contactId: string,
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: Omit<PostChatHandlers, 'onSaved'>,
  signal?: AbortSignal,
): Promise<void> {
  return streamChat(`/contacts/${contactId}/next-action/stream`, messages, handlers, signal);
}

/** Pièce jointe envoyée à l'assistant (fichier brut en base64) */
export interface AssistantAttachment {
  name: string;
  mime: string;
  /** contenu base64 sans préfixe data: */
  data: string;
}

/** Assistant LaunchForge intégré (vue 💬 Assistant) — mêmes outils que le bot Telegram */
export async function streamAssistantChat(
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: Omit<PostChatHandlers, 'onSaved'>,
  signal?: AbortSignal,
  attachments: AssistantAttachment[] = [],
  conversationId?: string
): Promise<void> {
  const extra: Record<string, unknown> = {};
  if (attachments.length) extra.attachments = attachments;
  if (conversationId) extra.conversationId = conversationId;
  return streamChat('/assistant/chat/stream', messages, handlers, signal,
    Object.keys(extra).length ? extra : undefined);
}

// ── Historique des conversations avec l'assistant ─────────────────────────────

/** Entrée légère de la liste d'historique (sans le corps des messages) */
export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  planId: string | null;
  title: string;
  messages: PostChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Liste les fils de l'utilisateur (du plus récent au plus ancien) */
export async function listConversations(): Promise<ApiResponse<ConversationSummary[]>> {
  return request('/assistant/conversations');
}

/** Récupère un fil complet (avec tous ses messages) */
export async function getConversation(id: string): Promise<ApiResponse<Conversation>> {
  return request(`/assistant/conversations/${id}`);
}

/** Supprime définitivement un fil */
export async function deleteConversation(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
  return request(`/assistant/conversations/${id}`, { method: 'DELETE' });
}

// ── Telegram ──────────────────────────────────────────────────────────────────

/** Génère un code de liaison à envoyer au bot Telegram (valable 10 min) */
export async function getTelegramLinkCode(): Promise<ApiResponse<{ code: string; linked: boolean }>> {
  return request('/telegram/link-code', { method: 'POST' });
}

// ── Assistant de contenu ──────────────────────────────────────────────────────

export interface GeneratedContent {
  title: string;
  content: string;
  hashtags: string[];
}

export async function generateContent(data: {
  platform: string;
  brief: string;
  tone?: string;
  baseContent?: string;
  useNews?: boolean;
}): Promise<ApiResponse<GeneratedContent>> {
  return request('/content/generate', { method: 'POST', body: JSON.stringify(data) });
}

/** Génère un calendrier éditorial complet (posts rédigés + programmés) */
export async function generateCalendar(data: {
  weeks: number;
  postsPerWeek: number;
  platforms: string[];
  startDate?: string;
}): Promise<ApiResponse<Post[]>> {
  return request('/content/calendar', { method: 'POST', body: JSON.stringify(data) });
}

export async function assignCardToAgent(
  agentId: string,
  data: {
    planId:          string;
    cardId:          string;
    cardTitle:       string;
    cardDescription: string;
    cardCategory:    string;
    cardEffort:      'low' | 'medium' | 'high';
  }
): Promise<ApiResponse<AgentRun>> {
  return request(`/agents/${agentId}/runs`, { method: 'POST', body: JSON.stringify(data) });
}

// ── Équipes (collaboration) ───────────────────────────────────────────────────

export type TeamRole = 'owner' | 'editor' | 'viewer';

export interface TeamSummary {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
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

export interface TeamDetail {
  team: { id: string; name: string; ownerId: string; createdAt: string };
  role: TeamRole;
  members: TeamMemberInfo[];
  invites: TeamInvite[];
}

export async function getTeams(): Promise<ApiResponse<TeamSummary[]>> {
  return request('/teams');
}

export async function createTeam(name: string): Promise<ApiResponse<TeamSummary>> {
  return request('/teams', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function getTeam(id: string): Promise<ApiResponse<TeamDetail>> {
  return request(`/teams/${id}`);
}

export async function renameTeam(id: string, name: string): Promise<ApiResponse<TeamSummary>> {
  return request(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export async function deleteTeam(id: string): Promise<ApiResponse<null>> {
  return request(`/teams/${id}`, { method: 'DELETE' });
}

export async function createTeamInvite(id: string, role: TeamRole, expiresInDays = 7): Promise<ApiResponse<TeamInvite>> {
  return request(`/teams/${id}/invites`, { method: 'POST', body: JSON.stringify({ role, expiresInDays }) });
}

export async function deleteTeamInvite(teamId: string, inviteId: string): Promise<ApiResponse<null>> {
  return request(`/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' });
}

export async function updateTeamMemberRole(teamId: string, userId: string, role: TeamRole): Promise<ApiResponse<null>> {
  return request(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export async function removeTeamMember(teamId: string, userId: string): Promise<ApiResponse<null>> {
  return request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
}

export async function joinTeam(code: string): Promise<ApiResponse<{ team: TeamSummary; role: TeamRole; alreadyMember: boolean }>> {
  return request('/teams/join', { method: 'POST', body: JSON.stringify({ code }) });
}

export interface InvitePreview {
  valid: boolean;
  expired: boolean;
  teamName: string | null;
  role: TeamRole;
}

/** Aperçu PUBLIC d'une invitation (nom de l'équipe + validité), sans connexion */
export async function getInvitePreview(code: string): Promise<ApiResponse<InvitePreview>> {
  return request(`/teams/invite/${encodeURIComponent(code)}`);
}

// ── Administration (fondateurs) ───────────────────────────────────────────────

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

export async function getAdminStats(): Promise<ApiResponse<AdminStats>> {
  return request('/admin/stats');
}

export async function getAdminUsers(): Promise<ApiResponse<AdminUserSummary[]>> {
  return request('/admin/users');
}

export async function getAdminUserActivity(userId: string, limit = 50): Promise<ApiResponse<AdminEvent[]>> {
  return request(`/admin/users/${userId}/activity?limit=${limit}`);
}

export async function getAdminActivity(limit = 50, before?: string): Promise<ApiResponse<AdminEvent[]>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return request(`/admin/activity?${params}`);
}

// ── Abonnement & facturation (offres Braise / Brasier / Brasier PLUS) ─────────

export type PlanTier = 'braise' | 'brasier' | 'plus';
export type PaidPlan = 'brasier' | 'plus';
export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';

export interface UsageMetric {
  used: number;
  /** null = illimité */
  limit: number | null;
}

export interface PlanPricing {
  monthly: number;
  annualMonthly: number;
  annualTotal: number;
}

export interface BillingStatus {
  tier: PlanTier;
  status: SubscriptionStatus;
  /** Offre payante souscrite (null si jamais abonné) */
  plan: PaidPlan | null;
  founder: boolean;
  trial: { active: boolean; endsAt: string | null; daysLeft: number };
  subscription: { interval: 'month' | 'year' | null; currentPeriodEnd: string | null; cancelAt: string | null };
  refundEligible: boolean;
  enforcement: boolean;
  usage: { aiGenerations: UsageMetric; aiImages: UsageMetric; projects: UsageMetric };
  pricing: { currency: string; brasier: PlanPricing; plus: PlanPricing };
  /** Libellés marketing des modèles IA (standard / premium) */
  aiModels: { standard: string; plus: string };
  trialDays: number;
  refundDays: number;
  billingConfigured: boolean;
  plusConfigured: boolean;
}

export interface RefundResult {
  refunded: boolean;
  amount: number | null;
  currency: string | null;
  reason?: string;
}

/** État de l'offre, de l'essai et de l'usage du compte courant */
export async function getBillingStatus(): Promise<ApiResponse<BillingStatus>> {
  return request('/billing/status');
}

/** Démarre le paiement Stripe (URL Checkout), ou change l'offre d'un abonné
 *  existant (`upgraded: true`, prorata appliqué par Stripe) */
export async function startCheckout(interval: 'month' | 'year', plan: PaidPlan = 'brasier'): Promise<ApiResponse<{ url?: string; upgraded?: boolean }>> {
  return request('/billing/checkout', { method: 'POST', body: JSON.stringify({ interval, plan }) });
}

/** Ouvre le portail client Stripe (gérer/résilier) */
export async function openBillingPortal(): Promise<ApiResponse<{ url: string }>> {
  return request('/billing/portal', { method: 'POST' });
}

/** Remboursement self-service (garantie 14 jours) */
export async function requestRefund(): Promise<ApiResponse<RefundResult>> {
  return request('/billing/refund', { method: 'POST' });
}
