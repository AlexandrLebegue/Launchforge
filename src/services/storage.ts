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
import { LaunchPlan, Feedback, User, Agent, AgentRun, OnboardingSession, Post, KnowledgeEntry, Contact, TelegramLink, Reminder } from '../types';

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
           (id, userId, active, input,
            weekly_plan, community_targets, content_angles,
            outreach_strategy, launch_sequencing, validation_checklist,
            first_users_tactics, kanban_state, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        plan.id,
        plan.userId,
        plan.active ?? 0,
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

  /** Définit le projet actif de l'utilisateur (un seul à la fois) */
  setActivePlan(userId: string, planId: string): void {
    const db = getDb();
    db.prepare(`UPDATE plans SET active = 0 WHERE userId = ?`).run(userId);
    db.prepare(`UPDATE plans SET active = 1 WHERE id = ? AND userId = ?`).run(planId, userId);
  }

  /** Projet actif de l'utilisateur (à défaut : le plus récent) */
  getActivePlan(userId: string): LaunchPlan | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM plans WHERE userId = ? AND active = 1 LIMIT 1`)
      .get(userId) as any;
    if (row) return this.rowToPlan(row);
    return this.getPlansByUserId(userId)[0];
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
      active:               row.active ?? 0,
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
  // Posts (Content Hub)
  // ──────────────────────────────────────────────────────────────

  savePost(post: Post): void {
    getDb()
      .prepare(
        `INSERT INTO posts
           (id, userId, planId, platform, title, content, status, scheduledAt, publishedAt,
            externalUrl, imageUrl, recurrence, recurrenceBrief, autoPublish, publishError, calendarSynced,
            impressions, likes, comments, shares, clicks, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        post.id, post.userId, post.planId, post.platform, post.title, post.content, post.status,
        post.scheduledAt, post.publishedAt, post.externalUrl, post.imageUrl, post.recurrence, post.recurrenceBrief,
        post.autoPublish, post.publishError, post.calendarSynced,
        post.impressions, post.likes, post.comments, post.shares, post.clicks,
        post.createdAt, post.updatedAt
      );
  }

  updatePost(id: string, patch: Partial<Post>): void {
    const allowed: (keyof Post)[] = [
      'platform', 'title', 'content', 'status', 'scheduledAt', 'publishedAt',
      'externalUrl', 'imageUrl', 'recurrence', 'recurrenceBrief', 'autoPublish', 'publishError', 'calendarSynced',
      'impressions', 'likes', 'comments', 'shares', 'clicks',
    ];
    const fields: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        fields.push(`${key} = ?`);
        vals.push(patch[key]);
      }
    }
    if (fields.length === 0) return;
    fields.push('updatedAt = ?');
    vals.push(new Date().toISOString(), id);
    getDb().prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  getPostById(id: string): Post | undefined {
    return getDb().prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as Post | undefined;
  }

  getPostsByUserId(userId: string): Post[] {
    return getDb()
      .prepare(
        `SELECT * FROM posts WHERE userId = ?
         ORDER BY CASE WHEN scheduledAt IS NULL THEN 1 ELSE 0 END, scheduledAt ASC, createdAt DESC`
      )
      .all(userId) as Post[];
  }

  deletePost(id: string): void {
    getDb().prepare(`DELETE FROM posts WHERE id = ?`).run(id);
  }

  /** Posts programmés à publier automatiquement dont l'heure est passée */
  getDueAutoPublishPosts(nowIso: string): Post[] {
    return getDb()
      .prepare(
        `SELECT * FROM posts
         WHERE status = 'scheduled' AND autoPublish = 1
           AND scheduledAt IS NOT NULL AND scheduledAt <= ?
         ORDER BY scheduledAt ASC
         LIMIT 10`
      )
      .all(nowIso) as Post[];
  }

  // ──────────────────────────────────────────────────────────────
  // Base de connaissances
  // ──────────────────────────────────────────────────────────────

  saveKnowledge(entry: KnowledgeEntry): void {
    getDb()
      .prepare(
        `INSERT INTO knowledge (id, userId, category, title, content, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.userId, entry.category, entry.title, entry.content, entry.createdAt, entry.updatedAt);
  }

  updateKnowledge(id: string, patch: Partial<Pick<KnowledgeEntry, 'category' | 'title' | 'content'>>): void {
    const fields: string[] = [];
    const vals: any[] = [];
    if (patch.category !== undefined) { fields.push('category = ?'); vals.push(patch.category); }
    if (patch.title    !== undefined) { fields.push('title = ?');    vals.push(patch.title); }
    if (patch.content  !== undefined) { fields.push('content = ?');  vals.push(patch.content); }
    if (fields.length === 0) return;
    fields.push('updatedAt = ?');
    vals.push(new Date().toISOString(), id);
    getDb().prepare(`UPDATE knowledge SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  getKnowledgeById(id: string): KnowledgeEntry | undefined {
    return getDb().prepare(`SELECT * FROM knowledge WHERE id = ?`).get(id) as KnowledgeEntry | undefined;
  }

  getKnowledgeByUserId(userId: string): KnowledgeEntry[] {
    return getDb()
      .prepare(`SELECT * FROM knowledge WHERE userId = ? ORDER BY updatedAt DESC`)
      .all(userId) as KnowledgeEntry[];
  }

  deleteKnowledge(id: string): void {
    getDb().prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Contacts
  // ──────────────────────────────────────────────────────────────

  saveContact(contact: Contact): void {
    getDb()
      .prepare(
        `INSERT INTO contacts
           (id, userId, name, email, company, type, source, interestScore,
            interestSummary, notes, lastInteraction, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contact.id, contact.userId, contact.name, contact.email, contact.company,
        contact.type, contact.source, contact.interestScore, contact.interestSummary,
        contact.notes, contact.lastInteraction, contact.createdAt, contact.updatedAt
      );
  }

  updateContact(id: string, patch: Partial<Contact>): void {
    const allowed: (keyof Contact)[] = [
      'name', 'email', 'company', 'type', 'source',
      'interestScore', 'interestSummary', 'notes', 'lastInteraction',
    ];
    const fields: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        fields.push(`${key} = ?`);
        vals.push(patch[key]);
      }
    }
    if (fields.length === 0) return;
    fields.push('updatedAt = ?');
    vals.push(new Date().toISOString(), id);
    getDb().prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  getContactById(id: string): Contact | undefined {
    return getDb().prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as Contact | undefined;
  }

  getContactsByUserId(userId: string): Contact[] {
    return getDb()
      .prepare(
        `SELECT * FROM contacts WHERE userId = ?
         ORDER BY CASE WHEN interestScore IS NULL THEN 1 ELSE 0 END, interestScore DESC, updatedAt DESC`
      )
      .all(userId) as Contact[];
  }

  deleteContact(id: string): void {
    getDb().prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Telegram & rappels
  // ──────────────────────────────────────────────────────────────

  saveTelegramLink(link: TelegramLink): void {
    getDb()
      .prepare(`INSERT OR REPLACE INTO telegram_links (chatId, userId, createdAt) VALUES (?, ?, ?)`)
      .run(link.chatId, link.userId, link.createdAt);
  }

  getTelegramLinkByChatId(chatId: string): TelegramLink | undefined {
    return getDb().prepare(`SELECT * FROM telegram_links WHERE chatId = ?`).get(chatId) as TelegramLink | undefined;
  }

  getTelegramLinksByUserId(userId: string): TelegramLink[] {
    return getDb().prepare(`SELECT * FROM telegram_links WHERE userId = ?`).all(userId) as TelegramLink[];
  }

  deleteTelegramLink(chatId: string): void {
    getDb().prepare(`DELETE FROM telegram_links WHERE chatId = ?`).run(chatId);
  }

  saveReminder(reminder: Reminder): void {
    getDb()
      .prepare(`INSERT INTO reminders (id, userId, text, dueAt, sent, createdAt) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(reminder.id, reminder.userId, reminder.text, reminder.dueAt, reminder.sent, reminder.createdAt);
  }

  getPendingRemindersByUserId(userId: string): Reminder[] {
    return getDb()
      .prepare(`SELECT * FROM reminders WHERE userId = ? AND sent = 0 ORDER BY dueAt ASC`)
      .all(userId) as Reminder[];
  }

  /** Rappels dont l'échéance est passée et pas encore envoyés */
  getDueReminders(nowIso: string): Reminder[] {
    return getDb()
      .prepare(`SELECT * FROM reminders WHERE sent = 0 AND dueAt <= ? ORDER BY dueAt ASC LIMIT 20`)
      .all(nowIso) as Reminder[];
  }

  markReminderSent(id: string): void {
    getDb().prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Agents
  // ──────────────────────────────────────────────────────────────

  saveAgent(agent: Agent): void {
    getDb()
      .prepare(
        `INSERT INTO agents (id, userId, name, platform, api_key, status, approval_mode, lastRunAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.userId,
        agent.name,
        agent.platform,
        encryptSecret(agent.apiKey),
        agent.status,
        agent.approvalMode,
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

  updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'apiKey' | 'status' | 'approvalMode' | 'lastRunAt'>>): void {
    const fields: string[] = [];
    const vals: any[]      = [];

    if (patch.name         !== undefined) { fields.push('name = ?');          vals.push(patch.name); }
    if (patch.apiKey       !== undefined) { fields.push('api_key = ?');       vals.push(encryptSecret(patch.apiKey)); }
    if (patch.status       !== undefined) { fields.push('status = ?');        vals.push(patch.status); }
    if (patch.approvalMode !== undefined) { fields.push('approval_mode = ?'); vals.push(patch.approvalMode); }
    if (patch.lastRunAt    !== undefined) { fields.push('lastRunAt = ?');     vals.push(patch.lastRunAt); }

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
    // completedAt n'est posé que pour les statuts terminaux — un run en
    // attente de validation n'est pas terminé.
    const terminal = status === 'done' || status === 'failed' || status === 'rejected';
    getDb()
      .prepare(`UPDATE agent_runs SET status = ?, result = ?, completedAt = ? WHERE id = ?`)
      .run(status, result ?? null, terminal ? new Date().toISOString() : null, id);
  }

  getRunById(id: string): AgentRun | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM agent_runs WHERE id = ?`)
      .get(id) as any;
    return row ? this.rowToRun(row) : undefined;
  }

  /** Runs en attente de validation pour tous les agents de l'utilisateur */
  getPendingApprovalsByUserId(userId: string): (AgentRun & { agentName: string; agentPlatform: string })[] {
    const rows = getDb()
      .prepare(
        `SELECT r.*, a.name AS agentName, a.platform AS agentPlatform
         FROM agent_runs r
         JOIN agents a ON a.id = r.agentId
         WHERE a.userId = ? AND r.status = 'awaiting_approval'
         ORDER BY r.startedAt DESC`
      )
      .all(userId) as any[];
    return rows.map((r) => ({
      ...this.rowToRun(r),
      agentName: r.agentName,
      agentPlatform: r.agentPlatform,
    }));
  }

  private rowToAgent(row: any): Agent {
    return {
      id:           row.id,
      userId:       row.userId,
      name:         row.name,
      platform:     row.platform,
      apiKey:       decryptSecret(row.api_key),
      status:       row.status,
      approvalMode: row.approval_mode === 'auto' ? 'auto' : 'manual',
      lastRunAt:    row.lastRunAt ?? null,
      createdAt:    row.createdAt,
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
