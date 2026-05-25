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

export interface PlanInput {
  productName: string;
  description: string;
  targetAudience: string;
  niche: string;
  goals: string[];
  pricing: string;
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
export type RunStatus   = 'pending' | 'running' | 'done' | 'failed';

export interface Agent {
  id: string;
  userId: string;
  name: string;
  platform: AgentPlatform;
  apiKey: string;
  status: AgentStatus;
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
}): Promise<ApiResponse<Agent>> {
  return request('/agents', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAgent(id: string, data: Partial<Pick<Agent, 'name' | 'apiKey' | 'status'>>): Promise<ApiResponse<Agent>> {
  return request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteAgent(id: string): Promise<ApiResponse<null>> {
  return request(`/agents/${id}`, { method: 'DELETE' });
}

export async function getAgentRuns(agentId: string): Promise<ApiResponse<AgentRun[]>> {
  return request(`/agents/${agentId}/runs`);
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
