/**
 * Storage service — better-sqlite3
 *
 * API changes vs sql.js:
 *   db.prepare(sql).run(...params)   — INSERT / UPDATE / DELETE
 *   db.prepare(sql).get(...params)   — SELECT single row (or undefined)
 *   db.prepare(sql).all(...params)   — SELECT multiple rows
 *
 * No stmt.bind() / stmt.step() / stmt.free() / stmt.getAsObject().
 * No saveDb() — every .run() is immediately durable on disk.
 */

import { getDb } from '../db';
import { encryptSecret, decryptSecret } from './secrets';
import { LaunchPlan, Feedback, User, Agent, AgentRun, OnboardingSession } from '../types';

export class Storage {
  // ──────────────────────────────────────────────────────────────
  // Users
  // ──────────────────────────────────────────────────────────────

  saveUser(user: User, hashedPassword: string): void {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, name, password, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(user.id, user.email, user.name, hashedPassword, user.createdAt);
  }

  getUserByEmail(
    email: string
  ): { id: string; email: string; name: string; password: string; createdAt: string } | undefined {
    return getDb()
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email) as any;
  }

  getUserById(id: string): User | undefined {
    return getDb()
      .prepare(`SELECT id, email, name, createdAt FROM users WHERE id = ?`)
      .get(id) as any;
  }

  // ──────────────────────────────────────────────────────────────
  // Plans
  // ──────────────────────────────────────────────────────────────

  savePlan(plan: LaunchPlan): void {
    const kanbanRaw = (plan as any).kanbanState
      ? JSON.stringify((plan as any).kanbanState)
      : '{}';

    getDb()
      .prepare(
        `INSERT INTO plans
           (id, userId, input,
            weekly_plan, community_targets, content_angles,
            outreach_strategy, launch_sequencing, validation_checklist,
            first_users_tactics, kanban_state, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        plan.id,
        plan.userId,
        JSON.stringify(plan.input),
        JSON.stringify(plan.weekly_plan),
        JSON.stringify(plan.community_targets),
        JSON.stringify(plan.content_angles),
        JSON.stringify(plan.outreach_strategy),
        JSON.stringify(plan.launch_sequencing),
        JSON.stringify(plan.validation_checklist),
        JSON.stringify(plan.first_users_tactics),
        kanbanRaw,
        plan.createdAt
      );
  }

  updateKanbanState(planId: string, kanbanState: unknown): void {
    getDb()
      .prepare(`UPDATE plans SET kanban_state = ? WHERE id = ?`)
      .run(JSON.stringify(kanbanState), planId);
  }

  getPlan(id: string): LaunchPlan | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM plans WHERE id = ?`)
      .get(id) as any;
    return row ? this.rowToPlan(row) : undefined;
  }

  getPlansByUserId(userId: string): LaunchPlan[] {
    const rows = getDb()
      .prepare(`SELECT * FROM plans WHERE userId = ? ORDER BY createdAt DESC`)
      .all(userId) as any[];
    return rows.map((r) => this.rowToPlan(r));
  }

  getAllPlans(): LaunchPlan[] {
    const rows = getDb()
      .prepare(`SELECT * FROM plans ORDER BY createdAt DESC`)
      .all() as any[];
    return rows.map((r) => this.rowToPlan(r));
  }

  // ──────────────────────────────────────────────────────────────
  // Feedback
  // ──────────────────────────────────────────────────────────────

  saveFeedback(feedback: Feedback): void {
    getDb()
      .prepare(
        `INSERT INTO feedback (id, planId, userId, rating, comment, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        feedback.id,
        feedback.planId,
        feedback.userId,
        feedback.rating,
        feedback.comment,
        feedback.createdAt
      );
  }

  getFeedbacksByPlanId(planId: string): Feedback[] {
    const rows = getDb()
      .prepare(`SELECT * FROM feedback WHERE planId = ? ORDER BY createdAt DESC`)
      .all(planId) as any[];
    return rows.map((r) => this.rowToFeedback(r));
  }

  getAllFeedbacks(): Feedback[] {
    const rows = getDb()
      .prepare(`SELECT * FROM feedback ORDER BY createdAt DESC`)
      .all() as any[];
    return rows.map((r) => this.rowToFeedback(r));
  }

  // ──────────────────────────────────────────────────────────────
  // Mappers
  // ──────────────────────────────────────────────────────────────

  private rowToPlan(row: any): LaunchPlan {
    let kanbanState: any;
    try {
      if (row.kanban_state) kanbanState = JSON.parse(row.kanban_state);
    } catch {}

    return {
      id:                   row.id,
      userId:               row.userId,
      createdAt:            row.createdAt,
      input:                JSON.parse(row.input),
      weekly_plan:          JSON.parse(row.weekly_plan),
      community_targets:    JSON.parse(row.community_targets),
      content_angles:       JSON.parse(row.content_angles),
      outreach_strategy:    JSON.parse(row.outreach_strategy),
      launch_sequencing:    JSON.parse(row.launch_sequencing),
      validation_checklist: JSON.parse(row.validation_checklist),
      first_users_tactics:  JSON.parse(row.first_users_tactics),
      kanbanState,
    };
  }

  private rowToFeedback(row: any): Feedback {
    return {
      id:        row.id,
      planId:    row.planId,
      userId:    row.userId,
      rating:    row.rating,
      comment:   row.comment,
      createdAt: row.createdAt,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Onboarding sessions
  // ──────────────────────────────────────────────────────────────

  saveOnboardingSession(session: OnboardingSession): void {
    getDb()
      .prepare(
        `INSERT INTO onboarding_sessions (id, userId, status, messages, profile, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.userId,
        session.status,
        JSON.stringify(session.messages),
        session.profile ? JSON.stringify(session.profile) : null,
        session.createdAt,
        session.updatedAt
      );
  }

  updateOnboardingSession(session: OnboardingSession): void {
    getDb()
      .prepare(
        `UPDATE onboarding_sessions
         SET status = ?, messages = ?, profile = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        session.status,
        JSON.stringify(session.messages),
        session.profile ? JSON.stringify(session.profile) : null,
        session.updatedAt,
        session.id
      );
  }

  getOnboardingSession(id: string): OnboardingSession | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM onboarding_sessions WHERE id = ?`)
      .get(id) as any;
    if (!row) return undefined;
    return {
      id:        row.id,
      userId:    row.userId,
      status:    row.status,
      messages:  JSON.parse(row.messages),
      profile:   row.profile ? JSON.parse(row.profile) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Agents
  // ──────────────────────────────────────────────────────────────

  saveAgent(agent: Agent): void {
    getDb()
      .prepare(
        `INSERT INTO agents (id, userId, name, platform, api_key, status, lastRunAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.userId,
        agent.name,
        agent.platform,
        encryptSecret(agent.apiKey),
        agent.status,
        agent.lastRunAt,
        agent.createdAt
      );
  }

  getAgentById(id: string): Agent | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM agents WHERE id = ?`)
      .get(id) as any;
    return row ? this.rowToAgent(row) : undefined;
  }

  getAgentsByUserId(userId: string): Agent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agents WHERE userId = ? ORDER BY createdAt DESC`)
      .all(userId) as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'apiKey' | 'status' | 'lastRunAt'>>): void {
    const fields: string[] = [];
    const vals: any[]      = [];

    if (patch.name      !== undefined) { fields.push('name = ?');      vals.push(patch.name); }
    if (patch.apiKey    !== undefined) { fields.push('api_key = ?');   vals.push(encryptSecret(patch.apiKey)); }
    if (patch.status    !== undefined) { fields.push('status = ?');    vals.push(patch.status); }
    if (patch.lastRunAt !== undefined) { fields.push('lastRunAt = ?'); vals.push(patch.lastRunAt); }

    if (fields.length === 0) return;
    vals.push(id);
    getDb()
      .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`)
      .run(...vals);
  }

  deleteAgent(id: string): void {
    getDb().prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Agent Runs
  // ──────────────────────────────────────────────────────────────

  saveAgentRun(run: AgentRun): void {
    getDb()
      .prepare(
        `INSERT INTO agent_runs
           (id, agentId, planId, cardId, cardTitle, status, result, startedAt, completedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.agentId,
        run.planId,
        run.cardId,
        run.cardTitle,
        run.status,
        run.result,
        run.startedAt,
        run.completedAt
      );
  }

  getRunsByAgentId(agentId: string): AgentRun[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agent_runs WHERE agentId = ? ORDER BY startedAt DESC`)
      .all(agentId) as any[];
    return rows.map((r) => this.rowToRun(r));
  }

  getRunsByPlanId(planId: string): AgentRun[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agent_runs WHERE planId = ? ORDER BY startedAt DESC`)
      .all(planId) as any[];
    return rows.map((r) => this.rowToRun(r));
  }

  updateRunStatus(id: string, status: AgentRun['status'], result?: string): void {
    getDb()
      .prepare(`UPDATE agent_runs SET status = ?, result = ?, completedAt = ? WHERE id = ?`)
      .run(status, result ?? null, new Date().toISOString(), id);
  }

  private rowToAgent(row: any): Agent {
    return {
      id:        row.id,
      userId:    row.userId,
      name:      row.name,
      platform:  row.platform,
      apiKey:    decryptSecret(row.api_key),
      status:    row.status,
      lastRunAt: row.lastRunAt ?? null,
      createdAt: row.createdAt,
    };
  }

  private rowToRun(row: any): AgentRun {
    return {
      id:          row.id,
      agentId:     row.agentId,
      planId:      row.planId,
      cardId:      row.cardId,
      cardTitle:   row.cardTitle,
      status:      row.status,
      result:      row.result ?? null,
      startedAt:   row.startedAt,
      completedAt: row.completedAt ?? null,
    };
  }
}

export const storage = new Storage();
