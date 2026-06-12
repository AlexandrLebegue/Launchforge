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

import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { encryptSecret, decryptSecret } from './secrets';
import { LaunchPlan, Feedback, User, Agent, AgentRun, OnboardingSession, Post, KnowledgeEntry, Contact, TelegramLink, Reminder, ProjectSummary, Overview } from '../types';

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

  // ── Réinitialisation de mot de passe ─────────────────────────────────────

  /** Pose (ou efface avec null) le jeton de réinitialisation, stocké haché */
  setResetToken(userId: string, tokenHash: string | null, expiresAt: string | null): void {
    getDb()
      .prepare(`UPDATE users SET resetTokenHash = ?, resetTokenExpiresAt = ? WHERE id = ?`)
      .run(tokenHash, expiresAt, userId);
  }

  getUserByResetTokenHash(tokenHash: string): { id: string; email: string; resetTokenExpiresAt: string | null } | undefined {
    return getDb()
      .prepare(`SELECT id, email, resetTokenExpiresAt FROM users WHERE resetTokenHash = ?`)
      .get(tokenHash) as any;
  }

  updateUserPassword(userId: string, hashedPassword: string): void {
    getDb().prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hashedPassword, userId);
  }

  // ── Réglages multi-utilisateur (identité Composio, bot Telegram) ─────────

  setComposioUserId(userId: string, composioUserId: string): void {
    getDb().prepare(`UPDATE users SET composioUserId = ? WHERE id = ?`).run(composioUserId, userId);
  }

  /** Identité Composio de l'utilisateur — null = legacy (user_id de l'env) */
  getComposioUserId(userId: string): string | null {
    const row = getDb().prepare(`SELECT composioUserId FROM users WHERE id = ?`).get(userId) as any;
    return row?.composioUserId ?? null;
  }

  /** Enregistre (chiffré) ou supprime (null) le bot Telegram personnel */
  setTelegramBot(userId: string, token: string | null, botName: string | null): void {
    getDb()
      .prepare(`UPDATE users SET telegramBotToken = ?, telegramBotName = ? WHERE id = ?`)
      .run(token ? encryptSecret(token) : null, botName, userId);
  }

  getTelegramBot(userId: string): { token: string; botName: string | null } | null {
    const row = getDb()
      .prepare(`SELECT telegramBotToken, telegramBotName FROM users WHERE id = ?`)
      .get(userId) as any;
    if (!row?.telegramBotToken) return null;
    return { token: decryptSecret(row.telegramBotToken), botName: row.telegramBotName ?? null };
  }

  /** Tous les bots personnels (démarrage des pollers au boot) */
  getAllTelegramBots(): { userId: string; token: string }[] {
    const rows = getDb()
      .prepare(`SELECT id, telegramBotToken FROM users WHERE telegramBotToken IS NOT NULL`)
      .all() as any[];
    return rows.map((r) => ({ userId: r.id, token: decryptSecret(r.telegramBotToken) }));
  }

  // ── Thème Marp (présentations) ───────────────────────────────────────────

  setMarpTheme(userId: string, theme: string, customCss?: string | null): void {
    if (customCss !== undefined) {
      getDb().prepare(`UPDATE users SET marpTheme = ?, marpCustomCss = ? WHERE id = ?`).run(theme, customCss, userId);
    } else {
      getDb().prepare(`UPDATE users SET marpTheme = ? WHERE id = ?`).run(theme, userId);
    }
  }

  getMarpTheme(userId: string): { theme: string; customCss: string | null } {
    const row = getDb().prepare(`SELECT marpTheme, marpCustomCss FROM users WHERE id = ?`).get(userId) as any;
    return { theme: row?.marpTheme ?? 'launchforge', customCss: row?.marpCustomCss ?? null };
  }

  // ── Présentations (decks Marp) ───────────────────────────────────────────

  saveDeck(deck: { id: string; userId: string; planId: string | null; title: string; markdown: string; createdAt: string }): void {
    getDb()
      .prepare(`INSERT INTO decks (id, userId, planId, title, markdown, createdAt) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(deck.id, deck.userId, deck.planId, deck.title, deck.markdown, deck.createdAt);
  }

  getDeckById(id: string): { id: string; userId: string; planId: string | null; title: string; markdown: string; createdAt: string } | undefined {
    return getDb().prepare(`SELECT * FROM decks WHERE id = ?`).get(id) as any;
  }

  getDecksByPlan(userId: string, planId: string | null): { id: string; title: string; createdAt: string }[] {
    return getDb()
      .prepare(`SELECT id, title, createdAt FROM decks WHERE userId = ? AND planId IS ? ORDER BY createdAt DESC`)
      .all(userId, planId) as any[];
  }

  deleteDeck(id: string): void {
    getDb().prepare(`DELETE FROM decks WHERE id = ?`).run(id);
  }

  // ── Rapport de campagne hebdomadaire ─────────────────────────────────────

  /** Utilisateurs avec un chat Telegram lié dont le rapport hebdo est dû (> 6 jours) */
  getUsersDueWeeklyReport(nowIso: string): { userId: string }[] {
    return getDb()
      .prepare(
        `SELECT DISTINCT u.id AS userId
         FROM users u
         JOIN telegram_links t ON t.userId = u.id
         WHERE u.lastWeeklyReportAt IS NULL
            OR julianday(u.lastWeeklyReportAt) <= julianday(?) - 6`
      )
      .all(nowIso) as { userId: string }[];
  }

  markWeeklyReportSent(userId: string, atIso: string): void {
    getDb().prepare(`UPDATE users SET lastWeeklyReportAt = ? WHERE id = ?`).run(atIso, userId);
  }

  // ── Synchro automatique des métriques ────────────────────────────────────

  /** Intervalle de synchro des métriques (minutes, 0 = désactivée) */
  setMetricsSyncMinutes(userId: string, minutes: number): void {
    getDb().prepare(`UPDATE users SET metricsSyncMinutes = ? WHERE id = ?`).run(minutes, userId);
  }

  getMetricsSyncMinutes(userId: string): number {
    const row = getDb().prepare(`SELECT metricsSyncMinutes FROM users WHERE id = ?`).get(userId) as any;
    return row?.metricsSyncMinutes ?? 0;
  }

  /**
   * Posts publiés dont les métriques sont à resynchroniser : URL renseignée,
   * synchro activée chez leur propriétaire, fenêtre d'intervalle écoulée, et
   * publiés depuis moins de 30 jours (au-delà les chiffres ne bougent plus —
   * chaque synchro coûte un appel IA). julianday digère les dates ISO.
   */
  getMetricsSyncDuePosts(nowIso: string, limit = 5): Post[] {
    return getDb()
      .prepare(
        `SELECT p.* FROM posts p
         JOIN users u ON u.id = p.userId
         WHERE p.status = 'published'
           AND p.externalUrl IS NOT NULL
           AND u.metricsSyncMinutes > 0
           AND p.publishedAt IS NOT NULL
           AND julianday(p.publishedAt) >= julianday(?) - 30
           AND (p.metricsSyncedAt IS NULL
                OR julianday(p.metricsSyncedAt) <= julianday(?) - u.metricsSyncMinutes / 1440.0)
         ORDER BY p.metricsSyncedAt IS NOT NULL, p.metricsSyncedAt ASC
         LIMIT ?`
      )
      .all(nowIso, nowIso, limit) as Post[];
  }

  /** Horodate la tentative de synchro (avant l'appel : pas de boucle de retry) */
  markMetricsSynced(postId: string, atIso: string): void {
    getDb().prepare(`UPDATE posts SET metricsSyncedAt = ? WHERE id = ?`).run(atIso, postId);
  }

  /** Instantané des métriques d'un post (courbes temporelles de Performances) */
  recordMetricSnapshot(post: Post, atIso = new Date().toISOString()): void {
    getDb()
      .prepare(
        `INSERT INTO metric_history (id, postId, userId, planId, at, impressions, likes, comments, shares, clicks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        post.id, post.userId, post.planId, atIso,
        post.impressions, post.likes, post.comments, post.shares, post.clicks,
      );
  }

  /** Snapshots du projet, ordonnés (90 derniers jours) */
  getMetricSnapshots(userId: string, planId: string | null): { postId: string; at: string; impressions: number; likes: number }[] {
    return getDb()
      .prepare(
        `SELECT postId, at, impressions, likes FROM metric_history
         WHERE userId = ? AND planId IS ? AND julianday(at) >= julianday('now') - 90
         ORDER BY at ASC`
      )
      .all(userId, planId) as any[];
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

  /** Id du projet actif — clé d'isolation de toutes les données projet */
  getActivePlanId(userId: string): string | null {
    return this.getActivePlan(userId)?.id ?? null;
  }

  // ──────────────────────────────────────────────────────────────
  // Vue d'ensemble (un seul aller-retour pour le shell de l'app)
  // ──────────────────────────────────────────────────────────────

  /**
   * Liste légère des projets pour la sidebar : extraction SQL des seuls
   * champs utiles — pas de parse des gros blobs JSON (plan hebdo, kanban…).
   */
  getProjectSummaries(userId: string): ProjectSummary[] {
    return getDb()
      .prepare(
        `SELECT id, active, createdAt,
                json_extract(input, '$.productName')    AS productName,
                json_extract(input, '$.niche')          AS niche,
                json_extract(input, '$.targetAudience') AS targetAudience,
                json_extract(input, '$.company.name')   AS companyName
         FROM plans WHERE userId = ?
         ORDER BY active DESC, createdAt DESC`
      )
      .all(userId) as ProjectSummary[];
  }

  /**
   * Tout le contexte du projet actif en UNE réponse : projets (légers),
   * stats Kanban, compteurs de posts + prochain post, validations en attente.
   * Quelques statements SQLite indexés — pas d'aller-retours multiples.
   */
  getOverview(userId: string): Overview {
    const db = getDb();
    const projects = this.getProjectSummaries(userId);
    const project  = projects.find((p) => p.active) ?? projects[0] ?? null;
    const planId   = project?.id ?? null;

    // Stats Kanban : seul le kanban_state du projet actif est parsé
    const tasks = { total: 0, done: 0, inProgress: 0, progress: 0 };
    if (planId) {
      const row = db.prepare(`SELECT kanban_state FROM plans WHERE id = ?`).get(planId) as any;
      try {
        const cols = JSON.parse(row?.kanban_state || '{}')?.columns as Record<string, unknown[]> | undefined;
        if (cols) {
          tasks.total      = Object.values(cols).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
          tasks.done       = Array.isArray(cols.done) ? cols.done.length : 0;
          tasks.inProgress = Array.isArray(cols.in_progress) ? cols.in_progress.length : 0;
          tasks.progress   = tasks.total === 0 ? 0 : Math.round((tasks.done / tasks.total) * 100);
        }
      } catch { /* kanban illisible : stats à zéro */ }
    }

    const postCounts = db
      .prepare(
        `SELECT COALESCE(SUM(status = 'scheduled'), 0)            AS scheduled,
                COALESCE(SUM(status = 'published'), 0)            AS published,
                COALESCE(SUM(status IN ('draft', 'idea')), 0)     AS drafts
         FROM posts WHERE userId = ? AND planId IS ?`
      )
      .get(userId, planId) as { scheduled: number; published: number; drafts: number };

    const nextPost = db
      .prepare(
        `SELECT id, title, platform, scheduledAt
         FROM posts
         WHERE userId = ? AND planId IS ? AND status = 'scheduled' AND scheduledAt IS NOT NULL
         ORDER BY scheduledAt ASC LIMIT 1`
      )
      .get(userId, planId) as Overview['posts']['next'] | undefined;

    const approvals = (db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM agent_runs r JOIN agents a ON a.id = r.agentId
         WHERE a.userId = ? AND r.planId IS ? AND r.status = 'awaiting_approval'`
      )
      .get(userId, planId) as { c: number }).c;

    return {
      projects,
      project,
      tasks,
      posts: { ...postCounts, next: nextPost ?? null },
      approvals,
    };
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
            externalUrl, imageUrl, recurrence, recurrenceBrief, seriesId,
            recurrenceUseNews, recurrenceUseKnowledge, recurrenceUpdateKb, crossPostId,
            autoPublish, publishError, calendarSynced,
            impressions, likes, comments, shares, clicks, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        post.id, post.userId, post.planId, post.platform, post.title, post.content, post.status,
        post.scheduledAt, post.publishedAt, post.externalUrl, post.imageUrl, post.recurrence, post.recurrenceBrief,
        post.seriesId ?? null, post.recurrenceUseNews ?? 0, post.recurrenceUseKnowledge ?? 1, post.recurrenceUpdateKb ?? 0,
        post.crossPostId ?? null,
        post.autoPublish, post.publishError, post.calendarSynced,
        post.impressions, post.likes, post.comments, post.shares, post.clicks,
        post.createdAt, post.updatedAt
      );
  }

  updatePost(id: string, patch: Partial<Post>): void {
    const allowed: (keyof Post)[] = [
      'platform', 'title', 'content', 'status', 'scheduledAt', 'publishedAt',
      'externalUrl', 'imageUrl', 'recurrence', 'recurrenceBrief', 'seriesId',
      'recurrenceUseNews', 'recurrenceUseKnowledge', 'recurrenceUpdateKb', 'crossPostId',
      'autoPublish', 'publishError', 'calendarSynced',
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

  /** Exemplaires d'un groupe multi-plateformes (même contenu, plateformes différentes) */
  getCrossPostGroup(crossPostId: string): Post[] {
    return getDb()
      .prepare(`SELECT * FROM posts WHERE crossPostId = ? ORDER BY createdAt ASC`)
      .all(crossPostId) as Post[];
  }

  /** Occurrences déjà publiées d'une série récurrente, de la plus récente à la plus ancienne */
  getSeriesHistory(seriesId: string, limit = 8): Post[] {
    return getDb()
      .prepare(
        `SELECT * FROM posts
         WHERE (seriesId = ? OR id = ?) AND status = 'published'
         ORDER BY publishedAt DESC LIMIT ?`
      )
      .all(seriesId, seriesId, limit) as Post[];
  }

  getPostsByUserId(userId: string): Post[] {
    return getDb()
      .prepare(
        `SELECT * FROM posts WHERE userId = ?
         ORDER BY CASE WHEN scheduledAt IS NULL THEN 1 ELSE 0 END, scheduledAt ASC, createdAt DESC`
      )
      .all(userId) as Post[];
  }

  /** Posts du projet — `IS ?` matche aussi NULL (utilisateur sans projet) */
  getPostsByPlan(userId: string, planId: string | null): Post[] {
    return getDb()
      .prepare(
        `SELECT * FROM posts WHERE userId = ? AND planId IS ?
         ORDER BY CASE WHEN scheduledAt IS NULL THEN 1 ELSE 0 END, scheduledAt ASC, createdAt DESC`
      )
      .all(userId, planId) as Post[];
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
        `INSERT INTO knowledge (id, userId, planId, category, title, content, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.userId, entry.planId, entry.category, entry.title, entry.content, entry.createdAt, entry.updatedAt);
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

  /** Base de connaissances du projet */
  getKnowledgeByPlan(userId: string, planId: string | null): KnowledgeEntry[] {
    return getDb()
      .prepare(`SELECT * FROM knowledge WHERE userId = ? AND planId IS ? ORDER BY updatedAt DESC`)
      .all(userId, planId) as KnowledgeEntry[];
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
           (id, userId, planId, name, email, company, type, source, interestScore,
            interestSummary, notes, lastInteraction, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contact.id, contact.userId, contact.planId, contact.name, contact.email, contact.company,
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

  /** Contacts du projet */
  getContactsByPlan(userId: string, planId: string | null): Contact[] {
    return getDb()
      .prepare(
        `SELECT * FROM contacts WHERE userId = ? AND planId IS ?
         ORDER BY CASE WHEN interestScore IS NULL THEN 1 ELSE 0 END, interestScore DESC, updatedAt DESC`
      )
      .all(userId, planId) as Contact[];
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
        `INSERT INTO agents (id, userId, planId, name, platform, api_key, status, approval_mode, lastRunAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.userId,
        agent.planId,
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

  /** Agents (et leur mode de validation) du projet */
  getAgentsByPlan(userId: string, planId: string | null): Agent[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agents WHERE userId = ? AND planId IS ? ORDER BY createdAt DESC`)
      .all(userId, planId) as any[];
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

  /** Validations en attente du projet (les runs portent le planId du Kanban) */
  getPendingApprovalsByPlan(userId: string, planId: string | null): (AgentRun & { agentName: string; agentPlatform: string })[] {
    const rows = getDb()
      .prepare(
        `SELECT r.*, a.name AS agentName, a.platform AS agentPlatform
         FROM agent_runs r
         JOIN agents a ON a.id = r.agentId
         WHERE a.userId = ? AND r.planId IS ? AND r.status = 'awaiting_approval'
         ORDER BY r.startedAt DESC`
      )
      .all(userId, planId) as any[];
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
      planId:       row.planId ?? null,
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
