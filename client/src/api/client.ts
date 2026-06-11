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

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const json = await res.json();
  return json;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
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

export interface PlanInput {
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
  /** URL du visuel à joindre au post */
  imageUrl: string | null;
  recurrence: Recurrence;
  /** Instruction de régénération IA : chaque nouvelle occurrence est réécrite
   *  par l'IA à partir de cette consigne (null = même contenu repris) */
  recurrenceBrief: string | null;
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

export async function updatePost(id: string, data: Partial<Post>): Promise<ApiResponse<Post>> {
  return request(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deletePost(id: string): Promise<ApiResponse<null>> {
  return request(`/posts/${id}`, { method: 'DELETE' });
}

export async function publishPost(id: string): Promise<ApiResponse<{ post: Post; next: Post | null }>> {
  return request(`/posts/${id}/publish`, { method: 'POST' });
}

/** Synchronise les métriques réelles via le serveur MCP Composio */
export async function syncPostMetrics(
  id: string
): Promise<ApiResponse<{ post: Post; note?: string }>> {
  return request(`/posts/${id}/sync-metrics`, { method: 'POST' });
}

// ── Base de connaissances ─────────────────────────────────────────────────────

export type KnowledgeCategory = 'company' | 'product' | 'audience' | 'tone' | 'offers' | 'other';

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

// ── Contacts (prospects / clients / partenaires) ──────────────────────────────

export type ContactType = 'prospect' | 'client' | 'partner';

export interface Contact {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  company: string | null;
  type: ContactType;
  source: string | null;
  interestScore: number | null;
  interestSummary: string | null;
  notes: string | null;
  lastInteraction: string | null;
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
export async function scanInbox(): Promise<ApiResponse<LeadCandidate[]>> {
  return request('/contacts/scan-inbox', { method: 'POST' });
}

/** Détection des leads dans les likes/commentaires d'un post publié (Composio MCP) */
export async function scanPost(postId: string): Promise<ApiResponse<LeadCandidate[]>> {
  return request('/contacts/scan-post', { method: 'POST', body: JSON.stringify({ postId }) });
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
  composio: { configured: boolean; dashboardUrl: string; toolkits: ConfigToolkit[] };
  marp: { theme: string; hasCustomCss: boolean; themes: { value: string; label: string }[] };
  metricsSync: { intervalMinutes: number };
  telegram: { configured: boolean; linked: boolean; ownBot: boolean; botUsername: string | null };
  publishMode: 'auto' | 'manual';
}

export async function getConfigStatus(fresh = false): Promise<ApiResponse<ConfigStatus>> {
  return request(`/config/status${fresh ? '?fresh=1' : ''}`);
}

/** Prépare la connexion d'un compte et renvoie le lien d'autorisation OAuth */
export async function connectToolkit(toolkit: string): Promise<ApiResponse<{ redirectUrl: string }>> {
  return request('/config/connect', { method: 'POST', body: JSON.stringify({ toolkit }) });
}

/** Enregistre le bot Telegram personnel (token @BotFather) et démarre son poller */
export async function setTelegramBot(token: string): Promise<ApiResponse<{ ownBot: boolean; botUsername: string }>> {
  return request('/config/telegram-bot', { method: 'PATCH', body: JSON.stringify({ token }) });
}

/** Supprime le bot Telegram personnel */
export async function removeTelegramBot(): Promise<ApiResponse<{ ownBot: boolean }>> {
  return request('/config/telegram-bot', { method: 'DELETE' });
}

/** Génère un visuel IA hébergé publiquement (attaché au post si postId) */
export async function generatePostImage(brief: string, postId?: string): Promise<ApiResponse<{ url: string }>> {
  return request('/content/image', { method: 'POST', body: JSON.stringify({ brief, postId }) });
}

/** Héberge une image fournie par l'utilisateur (base64/data-URL) → URL publique */
export async function uploadPostImage(imageBase64: string, postId?: string): Promise<ApiResponse<{ url: string }>> {
  return request('/content/image/upload', { method: 'POST', body: JSON.stringify({ imageBase64, postId }) });
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
}

/** Lecteur SSE commun aux chats (création de posts, assistant intégré) */
async function streamChat(
  path: string,
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: Omit<PostChatHandlers, 'onSaved'> & { onSaved?: PostChatHandlers['onSaved'] }
): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: globalThis.Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages }),
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
        else if (payload.type === 'saved') handlers.onSaved?.(payload.postId, payload.title);
        else if (payload.type === 'done') { finished = true; handlers.onDone(payload.reply, payload.actions || []); }
        else if (payload.type === 'error') { finished = true; handlers.onError(payload.error); }
      } catch { /* chunk malformé — ignoré */ }
    }
  }

  if (!finished) handlers.onError('La connexion a été interrompue — réessayez.');
}

/** Chat de création de posts — SSE (deltas, recherches web, posts enregistrés) */
export async function streamPostChat(
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: PostChatHandlers
): Promise<void> {
  return streamChat('/content/chat/stream', messages, handlers);
}

/** Assistant LaunchForge intégré (vue 💬 Assistant) — mêmes outils que le bot Telegram */
export async function streamAssistantChat(
  messages: { role: 'user' | 'assistant'; text: string }[],
  handlers: Omit<PostChatHandlers, 'onSaved'>
): Promise<void> {
  return streamChat('/assistant/chat/stream', messages, handlers);
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
