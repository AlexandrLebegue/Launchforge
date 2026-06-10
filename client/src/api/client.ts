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
): Promise<ApiResponse<LaunchPlan>> {
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
  platform: string;
  title: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  /** URL du post publié sur la plateforme (pour la synchro des métriques) */
  externalUrl: string | null;
  recurrence: Recurrence;
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
}): Promise<ApiResponse<GeneratedContent>> {
  return request('/content/generate', { method: 'POST', body: JSON.stringify(data) });
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
