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

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  sections: string[];
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
