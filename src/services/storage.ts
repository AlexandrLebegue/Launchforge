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
import { LaunchPlan, Feedback, User, Agent, AgentRun, OnboardingSession, Post, PostComment, CommentItem, KnowledgeEntry, KnowledgeSource, KnowledgeSourceType, Contact, Company, ContactEmail, TelegramLink, Reminder, CronJob, CronRun, ProjectSummary, Overview, Team, TeamSummary, TeamMemberInfo, TeamInvite, TeamRole, Conversation, ConversationMessage, ConversationSummary, SubscriptionRecord, SubscriptionStatus, UsageKind } from '../types';

export class Storage {
  // ──────────────────────────────────────────────────────────────
  // Users
  // ──────────────────────────────────────────────────────────────

  saveUser(user: User, hashedPassword: string): void {
    // tutorialPending = 1 : nouveau compte → tutoriel d'accueil à montrer
    getDb()
      .prepare(
        `INSERT INTO users (id, email, name, password, createdAt, tutorialPending)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run(user.id, user.email, user.name, hashedPassword, user.createdAt);
  }

  getUserByEmail(
    email: string
  ): { id: string; email: string; name: string; password: string; createdAt: string } | undefined {
    // COLLATE NOCASE : recherche insensible à la casse. Sans cela, une connexion
    // Google (qui force l'email en minuscules) ne retrouve pas un compte inscrit
    // avec une casse mixte (« Alex@… ») et en crée un DOUBLON — ce qui relance le
    // tutoriel et scinde les données. Couvre login, /register et le lien OAuth.
    return getDb()
      .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
      .get(email) as any;
  }

  getUserById(id: string): User | undefined {
    const row = getDb()
      .prepare(`SELECT id, email, name, createdAt, tutorialPending, password, authProvider FROM users WHERE id = ?`)
      .get(id) as any;
    if (!row) return undefined;
    // Construction explicite : le hash du mot de passe est lu pour calculer
    // `hasPassword` mais ne doit JAMAIS sortir d'ici (pas de spread de `row`).
    // SQLite stocke le booléen en INTEGER (0/1) → conversion explicite.
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      tutorialPending: !!row.tutorialPending,
      hasPassword: Boolean(row.password && row.password.length > 0),
      authProvider: row.authProvider ?? null,
    };
  }

  /** Marque le tutoriel d'accueil comme vu (ne se reproposera plus) */
  clearTutorialPending(userId: string): void {
    getDb().prepare(`UPDATE users SET tutorialPending = 0 WHERE id = ?`).run(userId);
  }

  // ── Abonnement & facturation (offres Braise / Brasier) ────────────────────

  /** Démarre l'essai « reverse trial » : accès complet pendant `days` jours.
   *  Ne réécrit jamais une date déjà posée (idempotent à l'inscription). */
  startTrial(userId: string, days = 15): void {
    const endsAt = new Date(Date.now() + days * 86_400_000).toISOString();
    getDb()
      .prepare(`UPDATE users SET trialEndsAt = COALESCE(trialEndsAt, ?) WHERE id = ?`)
      .run(endsAt, userId);
  }

  /** État d'abonnement brut de l'utilisateur (null si compte introuvable) */
  getSubscription(userId: string): SubscriptionRecord | null {
    const row = getDb()
      .prepare(
        `SELECT subscriptionStatus, subscriptionPlan, stripeCustomerId, stripeSubscriptionId,
                subscriptionInterval, subscriptionCurrentPeriodEnd,
                subscriptionCancelAt, trialEndsAt, firstPaidAt
         FROM users WHERE id = ?`
      )
      .get(userId) as any;
    if (!row) return null;
    return {
      status:               (row.subscriptionStatus ?? 'none') as SubscriptionStatus,
      plan:                 row.subscriptionPlan ?? null,
      stripeCustomerId:     row.stripeCustomerId ?? null,
      stripeSubscriptionId: row.stripeSubscriptionId ?? null,
      interval:             row.subscriptionInterval ?? null,
      currentPeriodEnd:     row.subscriptionCurrentPeriodEnd ?? null,
      cancelAt:             row.subscriptionCancelAt ?? null,
      trialEndsAt:          row.trialEndsAt ?? null,
      firstPaidAt:          row.firstPaidAt ?? null,
    };
  }

  /** Mémorise l'identifiant client Stripe (1re session de paiement) */
  setStripeCustomerId(userId: string, customerId: string): void {
    getDb().prepare(`UPDATE users SET stripeCustomerId = ? WHERE id = ?`).run(customerId, userId);
  }

  /** Retrouve l'utilisateur par son client Stripe (résolution des webhooks) */
  getUserIdByStripeCustomerId(customerId: string): string | null {
    const row = getDb().prepare(`SELECT id FROM users WHERE stripeCustomerId = ?`).get(customerId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Met à jour l'état d'abonnement depuis Stripe (webhook ou checkout) */
  updateSubscription(userId: string, patch: Partial<SubscriptionRecord>): void {
    const map: Record<string, string> = {
      status:               'subscriptionStatus',
      plan:                 'subscriptionPlan',
      stripeCustomerId:     'stripeCustomerId',
      stripeSubscriptionId: 'stripeSubscriptionId',
      interval:             'subscriptionInterval',
      currentPeriodEnd:     'subscriptionCurrentPeriodEnd',
      cancelAt:             'subscriptionCancelAt',
      trialEndsAt:          'trialEndsAt',
      firstPaidAt:          'firstPaidAt',
    };
    const fields: string[] = [];
    const vals: any[] = [];
    for (const [key, col] of Object.entries(map)) {
      if (key in patch) { fields.push(`${col} = ?`); vals.push((patch as any)[key]); }
    }
    if (fields.length === 0) return;
    vals.push(userId);
    getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  /** Pose la date du 1er paiement une seule fois (fenêtre de remboursement) */
  markFirstPaidAt(userId: string, iso: string): void {
    getDb().prepare(`UPDATE users SET firstPaidAt = COALESCE(firstPaidAt, ?) WHERE id = ?`).run(iso, userId);
  }

  // ── Compteurs d'usage IA mensuel (bornes de l'offre Braise) ───────────────

  /** Enregistre une unité d'usage IA pour le mois courant */
  recordUsage(userId: string, kind: UsageKind, at = new Date()): void {
    const month = at.toISOString().slice(0, 7); // 'YYYY-MM'
    getDb()
      .prepare(`INSERT INTO usage_events (id, userId, kind, month, createdAt) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), userId, kind, month, at.toISOString());
  }

  /** Nombre d'unités d'usage consommées ce mois (par défaut le mois courant) */
  countUsage(userId: string, kind: UsageKind, month = new Date().toISOString().slice(0, 7)): number {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE userId = ? AND kind = ? AND month = ?`)
      .get(userId, kind, month) as { n: number };
    return row.n;
  }

  /** Nombre de projets (plans) possédés par l'utilisateur — borne Braise */
  countOwnedPlans(userId: string): number {
    const row = getDb().prepare(`SELECT COUNT(*) AS n FROM plans WHERE userId = ?`).get(userId) as { n: number };
    return row.n;
  }

  // ── Authentification OAuth (Google & co) ─────────────────────────────────

  /** Crée un compte issu d'un fournisseur OAuth (password vide, jamais utilisé) */
  saveOAuthUser(user: User, provider: string, providerId: string): void {
    // tutorialPending = 1 : nouveau compte (même init que /register)
    getDb()
      .prepare(
        `INSERT INTO users (id, email, name, password, createdAt, authProvider, providerId, tutorialPending)
         VALUES (?, ?, ?, '', ?, ?, ?, 1)`
      )
      .run(user.id, user.email, user.name, user.createdAt, provider, providerId);
  }

  /** Retrouve un compte par (fournisseur, identifiant chez le fournisseur) */
  getUserByProvider(provider: string, providerId: string): User | undefined {
    return getDb()
      .prepare(
        `SELECT id, email, name, createdAt FROM users WHERE authProvider = ? AND providerId = ?`
      )
      .get(provider, providerId) as any;
  }

  /** Rattache un fournisseur OAuth à un compte existant (login par même email) */
  linkProvider(userId: string, provider: string, providerId: string): void {
    getDb()
      .prepare(`UPDATE users SET authProvider = ?, providerId = ? WHERE id = ?`)
      .run(provider, providerId, userId);
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

  /** RGPD art. 16 (rectification) : met à jour nom et/ou email du compte.
   *  Seuls les champs fournis sont touchés ; l'unicité de l'email est vérifiée
   *  en amont par la route (contrainte applicative, casse insensible). */
  updateUserProfile(userId: string, fields: { name?: string; email?: string }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined)  { sets.push('name = ?');  vals.push(fields.name); }
    if (fields.email !== undefined) { sets.push('email = ?'); vals.push(fields.email); }
    if (sets.length === 0) return;
    vals.push(userId);
    getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  // ── RGPD : portabilité (art. 20) et effacement (art. 17) ─────────────────

  /** Toutes les données de l'utilisateur, prêtes à télécharger (sans secrets) */
  exportUserData(userId: string): Record<string, unknown> {
    const db = getDb();
    const all = (sql: string) => db.prepare(sql).all(userId);
    return {
      exportedAt: new Date().toISOString(),
      user: this.getUserById(userId) ?? null,
      plans: all(`SELECT * FROM plans WHERE userId = ?`),
      posts: all(`SELECT * FROM posts WHERE userId = ?`),
      knowledge: all(`SELECT * FROM knowledge WHERE userId = ?`),
      contacts: all(`SELECT * FROM contacts WHERE userId = ?`),
      agents: all(`SELECT id, name, platform, approval_mode, status, lastRunAt, createdAt FROM agents WHERE userId = ?`),
      agentRuns: all(`SELECT r.* FROM agent_runs r JOIN agents a ON a.id = r.agentId WHERE a.userId = ?`),
      decks: all(`SELECT * FROM decks WHERE userId = ?`),
      campaignReports: all(`SELECT * FROM campaign_reports WHERE userId = ?`),
      onboardingSessions: all(`SELECT * FROM onboarding_sessions WHERE userId = ?`),
      conversations: all(`SELECT * FROM conversations WHERE userId = ?`),
      assistantMemory: all(`SELECT * FROM assistant_memory WHERE userId = ?`),
      reminders: all(`SELECT * FROM reminders WHERE userId = ?`),
      cronJobs: all(`SELECT * FROM cron_jobs WHERE userId = ?`),
      telegramLinks: all(`SELECT chatId, createdAt FROM telegram_links WHERE userId = ?`),
      metricHistory: all(`SELECT * FROM metric_history WHERE userId = ?`),
      feedback: all(`SELECT * FROM feedback WHERE userId = ?`),
    };
  }

  /**
   * Effacement COMPLET et transactionnel de toutes les données de
   * l'utilisateur. Retourne les noms des fichiers médias locaux (/uploads)
   * que ses posts référençaient, à supprimer du disque par l'appelant.
   */
  deleteUserData(userId: string): string[] {
    const db = getDb();
    const mediaFiles = (db.prepare(`SELECT imageUrl FROM posts WHERE userId = ? AND imageUrl LIKE '%/uploads/%'`)
      .all(userId) as { imageUrl: string }[])
      .map((r) => r.imageUrl.match(/\/uploads\/([\w.-]+)/)?.[1])
      .filter((f): f is string => Boolean(f));

    db.transaction(() => {
      db.prepare(`DELETE FROM agent_runs WHERE agentId IN (SELECT id FROM agents WHERE userId = ?)`).run(userId);
      for (const table of ['agents', 'feedback', 'metric_history', 'posts', 'knowledge', 'knowledge_sources', 'contacts',
                           'telegram_links', 'reminders', 'cron_runs', 'cron_jobs', 'decks', 'campaign_reports', 'onboarding_sessions', 'conversations', 'assistant_memory', 'usage_events', 'plans']) {
        db.prepare(`DELETE FROM ${table} WHERE userId = ?`).run(userId);
      }
      // Équipes possédées : on supprime l'équipe, ses invitations et ses membres
      db.prepare(`DELETE FROM team_invites WHERE teamId IN (SELECT id FROM teams WHERE ownerId = ?)`).run(userId);
      db.prepare(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE ownerId = ?)`).run(userId);
      db.prepare(`DELETE FROM teams WHERE ownerId = ?`).run(userId);
      // Appartenances de l'utilisateur à d'autres équipes
      db.prepare(`DELETE FROM team_members WHERE userId = ?`).run(userId);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    })();

    return [...new Set(mediaFiles)];
  }

  // ──────────────────────────────────────────────────────────────
  // Équipes (collaboration sur des projets partagés)
  // ──────────────────────────────────────────────────────────────

  /** Crée une équipe et y inscrit le créateur comme propriétaire */
  createTeam(name: string, ownerId: string): Team {
    const team: Team = { id: randomUUID(), name, ownerId, createdAt: new Date().toISOString() };
    const db = getDb();
    db.prepare(`INSERT INTO teams (id, name, ownerId, createdAt) VALUES (?, ?, ?, ?)`)
      .run(team.id, team.name, team.ownerId, team.createdAt);
    db.prepare(`INSERT INTO team_members (teamId, userId, role, createdAt) VALUES (?, ?, 'owner', ?)`)
      .run(team.id, ownerId, team.createdAt);
    return team;
  }

  renameTeam(teamId: string, name: string): void {
    getDb().prepare(`UPDATE teams SET name = ? WHERE id = ?`).run(name, teamId);
  }

  /** Supprime l'équipe et tout son rattachement (membres, invitations).
   *  Les projets de l'équipe redeviennent personnels (teamId = NULL). */
  deleteTeam(teamId: string): void {
    const db = getDb();
    db.prepare(`UPDATE plans SET teamId = NULL WHERE teamId = ?`).run(teamId);
    db.prepare(`DELETE FROM team_invites WHERE teamId = ?`).run(teamId);
    db.prepare(`DELETE FROM team_members WHERE teamId = ?`).run(teamId);
    db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
  }

  getTeamById(teamId: string): Team | undefined {
    return getDb().prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as Team | undefined;
  }

  /** Équipes de l'utilisateur, avec son rôle et le nombre de membres */
  getTeamsByUserId(userId: string): TeamSummary[] {
    return getDb()
      .prepare(
        `SELECT t.id, t.name, t.ownerId, t.createdAt, m.role,
                (SELECT COUNT(*) FROM team_members mm WHERE mm.teamId = t.id) AS memberCount
         FROM teams t
         JOIN team_members m ON m.teamId = t.id AND m.userId = ?
         ORDER BY t.createdAt DESC`
      )
      .all(userId) as TeamSummary[];
  }

  /** Rôle de l'utilisateur dans l'équipe — null s'il n'est pas membre */
  getTeamRole(teamId: string, userId: string): TeamRole | null {
    const row = getDb()
      .prepare(`SELECT role FROM team_members WHERE teamId = ? AND userId = ?`)
      .get(teamId, userId) as { role: TeamRole } | undefined;
    return row?.role ?? null;
  }

  getTeamMembers(teamId: string): TeamMemberInfo[] {
    return getDb()
      .prepare(
        `SELECT m.userId, u.name, u.email, m.role, m.createdAt
         FROM team_members m JOIN users u ON u.id = m.userId
         WHERE m.teamId = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.createdAt ASC`
      )
      .all(teamId) as TeamMemberInfo[];
  }

  addTeamMember(teamId: string, userId: string, role: TeamRole): void {
    getDb()
      .prepare(
        `INSERT INTO team_members (teamId, userId, role, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(teamId, userId) DO UPDATE SET role = excluded.role`
      )
      .run(teamId, userId, role, new Date().toISOString());
  }

  updateTeamMemberRole(teamId: string, userId: string, role: TeamRole): void {
    getDb().prepare(`UPDATE team_members SET role = ? WHERE teamId = ? AND userId = ?`).run(role, teamId, userId);
  }

  removeTeamMember(teamId: string, userId: string): void {
    getDb().prepare(`DELETE FROM team_members WHERE teamId = ? AND userId = ?`).run(teamId, userId);
  }

  createTeamInvite(teamId: string, code: string, role: TeamRole, expiresAt: string | null): TeamInvite {
    const invite: TeamInvite = { id: randomUUID(), teamId, code, role, createdAt: new Date().toISOString(), expiresAt };
    getDb()
      .prepare(`INSERT INTO team_invites (id, teamId, code, role, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(invite.id, invite.teamId, invite.code, invite.role, invite.createdAt, invite.expiresAt);
    return invite;
  }

  getTeamInvites(teamId: string): TeamInvite[] {
    return getDb()
      .prepare(`SELECT * FROM team_invites WHERE teamId = ? ORDER BY createdAt DESC`)
      .all(teamId) as TeamInvite[];
  }

  getTeamInviteByCode(code: string): TeamInvite | undefined {
    return getDb().prepare(`SELECT * FROM team_invites WHERE code = ?`).get(code) as TeamInvite | undefined;
  }

  deleteTeamInvite(inviteId: string): void {
    getDb().prepare(`DELETE FROM team_invites WHERE id = ?`).run(inviteId);
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

  /** Enregistre (chiffrée) ou supprime (null) la clé API Apollo.io personnelle */
  setApolloApiKey(userId: string, key: string | null): void {
    getDb()
      .prepare(`UPDATE users SET apolloApiKey = ? WHERE id = ?`)
      .run(key ? encryptSecret(key) : null, userId);
  }

  getApolloApiKey(userId: string): string | null {
    const row = getDb().prepare(`SELECT apolloApiKey FROM users WHERE id = ?`).get(userId) as any;
    if (!row?.apolloApiKey) return null;
    return decryptSecret(row.apolloApiKey) || null;
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

  // ── Rapports de campagne archivés (historique des analyses IA) ───────────

  saveCampaignReport(r: { id: string; userId: string; planId: string | null; report: string; createdAt: string }): void {
    getDb()
      .prepare(`INSERT INTO campaign_reports (id, userId, planId, report, createdAt) VALUES (?, ?, ?, ?, ?)`)
      .run(r.id, r.userId, r.planId, r.report, r.createdAt);
  }

  getCampaignReportsByPlan(userId: string, planId: string | null): { id: string; report: string; createdAt: string }[] {
    return getDb()
      .prepare(`SELECT id, report, createdAt FROM campaign_reports WHERE userId = ? AND planId IS ? ORDER BY createdAt DESC LIMIT 12`)
      .all(userId, planId) as any[];
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

  /** Agenda préféré pour la synchro des posts ('googlecalendar' | 'outlook'),
   *  ou null = automatique (le seul agenda connecté est utilisé). */
  setPreferredCalendar(userId: string, calendar: string | null): void {
    getDb().prepare(`UPDATE users SET preferredCalendar = ? WHERE id = ?`).run(calendar, userId);
  }

  getPreferredCalendar(userId: string): string | null {
    const row = getDb().prepare(`SELECT preferredCalendar FROM users WHERE id = ?`).get(userId) as any;
    return row?.preferredCalendar ?? null;
  }

  // ── Mise à jour automatique de la base de connaissances ───────────────────

  /** Intervalle de mise à jour de la base de connaissances (minutes, 0 = off) */
  setKnowledgeSyncMinutes(userId: string, minutes: number): void {
    getDb().prepare(`UPDATE users SET knowledgeSyncMinutes = ? WHERE id = ?`).run(minutes, userId);
  }

  getKnowledgeSyncMinutes(userId: string): number {
    const row = getDb().prepare(`SELECT knowledgeSyncMinutes FROM users WHERE id = ?`).get(userId) as any;
    return row?.knowledgeSyncMinutes ?? 0;
  }

  /**
   * Sources à ré-analyser : leur propriétaire a activé la mise à jour
   * automatique et la fenêtre d'intervalle est écoulée (jamais synchronisée
   * incluse). Les plus anciennes d'abord. julianday digère les dates ISO.
   */
  getKnowledgeSyncDueSources(nowIso: string, limit = 3): KnowledgeSource[] {
    return getDb()
      .prepare(
        `SELECT s.* FROM knowledge_sources s
         JOIN users u ON u.id = s.userId
         WHERE u.knowledgeSyncMinutes > 0
           AND (s.lastSyncedAt IS NULL
                OR julianday(s.lastSyncedAt) <= julianday(?) - u.knowledgeSyncMinutes / 1440.0)
         ORDER BY s.lastSyncedAt IS NOT NULL, s.lastSyncedAt ASC
         LIMIT ?`
      )
      .all(nowIso, limit) as KnowledgeSource[];
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
  // Commentaires des posts (contenu réel récupéré chez la plateforme)
  // ──────────────────────────────────────────────────────────────

  /** Nombre de commentaires conservés par post (borne la croissance) */
  private static readonly MAX_COMMENTS_PER_POST = 50;

  /**
   * Persiste les commentaires d'un post (dédup par externalId, idempotent).
   * Les commentaires sans externalId reçoivent un id de repli stable
   * (hash texte+auteur) pour rester dédupliqués entre deux synchros.
   * Borne le total conservé par post aux plus récents/likés.
   * Retourne le nombre de NOUVEAUX commentaires insérés.
   */
  upsertPostComments(post: Post, items: CommentItem[], fetchedAtIso = new Date().toISOString()): number {
    const clean = items
      .filter((c) => c && typeof c.text === 'string' && c.text.trim().length > 0)
      .map((c) => ({
        externalId: c.externalId ? String(c.externalId).slice(0, 200) : null,
        author: c.author ? String(c.author).slice(0, 200) : null,
        text: String(c.text).trim().slice(0, 4000),
        likeCount: Number.isFinite(Number(c.likeCount)) && Number(c.likeCount) >= 0 ? Math.round(Number(c.likeCount)) : 0,
        commentedAt: c.commentedAt ? String(c.commentedAt) : null,
      }));
    if (clean.length === 0) return 0;

    const db = getDb();
    // Repli pour la dédup quand la plateforme ne renvoie pas d'id : un dérivé
    // stable du contenu (le UNIQUE(postId, externalId) ignore alors les doublons).
    const dedupId = (c: { externalId: string | null; author: string | null; text: string }) =>
      c.externalId ?? `t:${(c.author ?? '').toLowerCase()}:${c.text.slice(0, 80).toLowerCase()}`;

    const insert = db.prepare(
      `INSERT OR IGNORE INTO post_comments
         (id, postId, userId, planId, platform, externalId, author, text, likeCount, commentedAt, fetchedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction((rows: typeof clean) => {
      let added = 0;
      for (const c of rows) {
        const info = insert.run(
          randomUUID(), post.id, post.userId, post.planId, post.platform,
          dedupId(c), c.author, c.text, c.likeCount, c.commentedAt, fetchedAtIso,
        );
        added += info.changes;
      }
      return added;
    });
    const added = tx(clean);

    // Borne : ne garde que les N plus pertinents (likes puis récence) pour ce post
    db.prepare(
      `DELETE FROM post_comments WHERE postId = ? AND id NOT IN (
         SELECT id FROM post_comments WHERE postId = ?
         ORDER BY likeCount DESC, COALESCE(commentedAt, fetchedAt) DESC
         LIMIT ?
       )`
    ).run(post.id, post.id, Storage.MAX_COMMENTS_PER_POST);

    return added;
  }

  /** Commentaires du projet (les plus likés/récents d'abord) */
  getPostCommentsByPlan(userId: string, planId: string | null): PostComment[] {
    return getDb()
      .prepare(
        `SELECT * FROM post_comments
         WHERE userId = ? AND planId IS ?
         ORDER BY likeCount DESC, COALESCE(commentedAt, fetchedAt) DESC`
      )
      .all(userId, planId) as PostComment[];
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

  // ── Projet actif (par utilisateur) & accès aux projets d'équipe ───────────

  /** Métadonnées d'accès d'un projet (sans parser les gros blobs JSON) */
  getPlanMeta(planId: string): { id: string; userId: string; teamId: string | null } | undefined {
    return getDb().prepare(`SELECT id, userId, teamId FROM plans WHERE id = ?`).get(planId) as any;
  }

  /**
   * Rôle de l'utilisateur sur un projet (owner/editor/viewer) — null = aucun
   * accès. Projet personnel : seul son créateur est « owner ». Projet d'équipe :
   * le rôle du membre dans l'équipe.
   */
  getProjectRole(userId: string, planId: string): TeamRole | null {
    const meta = this.getPlanMeta(planId);
    if (!meta) return null;
    if (meta.teamId) return this.getTeamRole(meta.teamId, userId);
    return meta.userId === userId ? 'owner' : null;
  }

  /** Rôle pour une ressource projet — gère le cas legacy (planId null = perso) */
  accessRole(userId: string, planId: string | null, ownerUserId: string): TeamRole | null {
    if (planId) return this.getProjectRole(userId, planId);
    return ownerUserId === userId ? 'owner' : null;
  }

  /** Plan le plus récent accessible (perso ou via une équipe) — pour le repli */
  private mostRecentAccessiblePlanId(userId: string): string | null {
    const row = getDb()
      .prepare(
        `SELECT p.id FROM plans p
         LEFT JOIN team_members tm ON tm.teamId = p.teamId AND tm.userId = @uid
         WHERE p.userId = @uid OR tm.userId IS NOT NULL
         ORDER BY p.createdAt DESC LIMIT 1`
      )
      .get({ uid: userId }) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Définit le projet actif de l'utilisateur (vérifie l'accès) */
  setActivePlan(userId: string, planId: string): void {
    if (!this.getProjectRole(userId, planId)) return; // pas d'accès → no-op
    getDb().prepare(`UPDATE users SET activePlanId = ? WHERE id = ?`).run(planId, userId);
  }

  /** Id du projet actif — clé d'isolation. Repli sur le plus récent accessible. */
  getActivePlanId(userId: string): string | null {
    const row = getDb().prepare(`SELECT activePlanId FROM users WHERE id = ?`).get(userId) as { activePlanId: string | null } | undefined;
    const pid = row?.activePlanId ?? null;
    if (pid && this.getProjectRole(userId, pid)) return pid;
    return this.mostRecentAccessiblePlanId(userId);
  }

  getActivePlan(userId: string): LaunchPlan | undefined {
    const id = this.getActivePlanId(userId);
    return id ? this.getPlan(id) : undefined;
  }

  /**
   * Contexte du projet actif : l'id, le PROPRIÉTAIRE (clé des données et des
   * comptes Composio) et le rôle de l'utilisateur courant. Pour un projet
   * personnel, ownerUserId = l'utilisateur lui-même.
   */
  resolveActiveProject(userId: string): { planId: string | null; ownerUserId: string; role: TeamRole } {
    const planId = this.getActivePlanId(userId);
    if (!planId) return { planId: null, ownerUserId: userId, role: 'owner' };
    const meta = this.getPlanMeta(planId);
    if (!meta) return { planId: null, ownerUserId: userId, role: 'owner' };
    const role = meta.teamId ? (this.getTeamRole(meta.teamId, userId) ?? 'viewer') : 'owner';
    return { planId, ownerUserId: meta.userId, role };
  }

  /** Rattache (teamId) ou détache (null) un projet à une équipe */
  setPlanTeam(planId: string, teamId: string | null): void {
    getDb().prepare(`UPDATE plans SET teamId = ? WHERE id = ?`).run(teamId, planId);
  }

  // ──────────────────────────────────────────────────────────────
  // Vue d'ensemble (un seul aller-retour pour le shell de l'app)
  // ──────────────────────────────────────────────────────────────

  /**
   * Liste légère des projets pour la sidebar : extraction SQL des seuls
   * champs utiles — pas de parse des gros blobs JSON (plan hebdo, kanban…).
   */
  getProjectSummaries(userId: string): ProjectSummary[] {
    const activeId = this.getActivePlanId(userId);
    const rows = getDb()
      .prepare(
        `SELECT p.id, p.createdAt, p.teamId,
                json_extract(p.input, '$.productName')    AS productName,
                json_extract(p.input, '$.niche')          AS niche,
                json_extract(p.input, '$.targetAudience') AS targetAudience,
                json_extract(p.input, '$.company.name')   AS companyName,
                t.name AS teamName,
                COALESCE(tm.role, 'owner') AS role
         FROM plans p
         LEFT JOIN teams t ON t.id = p.teamId
         LEFT JOIN team_members tm ON tm.teamId = p.teamId AND tm.userId = @uid
         WHERE p.userId = @uid OR (p.teamId IS NOT NULL AND tm.userId IS NOT NULL)
         ORDER BY p.createdAt DESC`
      )
      .all({ uid: userId }) as any[];
    return rows.map((r) => ({ ...r, active: r.id === activeId ? 1 : 0 })) as ProjectSummary[];
  }

  /**
   * Tout le contexte du projet actif en UNE réponse : projets (légers),
   * stats Kanban, compteurs de posts + prochain post, validations en attente.
   * Quelques statements SQLite indexés — pas d'aller-retours multiples.
   */
  getOverview(userId: string): Overview {
    const db = getDb();
    const projects = this.getProjectSummaries(userId);
    // Projet actif + son propriétaire (clé des données pour un projet d'équipe)
    const ctx = this.resolveActiveProject(userId);
    const planId = ctx.planId;
    const ownerUserId = ctx.ownerUserId;
    const project = projects.find((p) => p.id === planId) ?? projects[0] ?? null;

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
      .get(ownerUserId, planId) as { scheduled: number; published: number; drafts: number };

    const nextPost = db
      .prepare(
        `SELECT id, title, platform, scheduledAt
         FROM posts
         WHERE userId = ? AND planId IS ? AND status = 'scheduled' AND scheduledAt IS NOT NULL
         ORDER BY scheduledAt ASC LIMIT 1`
      )
      .get(ownerUserId, planId) as Overview['posts']['next'] | undefined;

    const approvals = (db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM agent_runs r JOIN agents a ON a.id = r.agentId
         WHERE a.userId = ? AND r.planId IS ? AND r.status = 'awaiting_approval'`
      )
      .get(ownerUserId, planId) as { c: number }).c;

    return {
      projects,
      project,
      tasks,
      posts: { ...postCounts, next: nextPost ?? null },
      approvals,
    };
  }

  getPlansByUserId(userId: string): LaunchPlan[] {
    const activeId = this.getActivePlanId(userId);
    const rows = getDb()
      .prepare(`SELECT * FROM plans WHERE userId = ? ORDER BY createdAt DESC`)
      .all(userId) as any[];
    // Le drapeau « actif » vient de users.activePlanId (source de vérité), pas
    // de l'ancienne colonne plans.active
    return rows.map((r) => { const p = this.rowToPlan(r); p.active = p.id === activeId ? 1 : 0; return p; });
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
  // Conversations avec l'assistant (historique)
  // ──────────────────────────────────────────────────────────────

  /** Liste des fils de l'utilisateur, du plus récent au plus ancien (sans le corps des messages) */
  listConversations(userId: string): ConversationSummary[] {
    const rows = getDb()
      .prepare(
        `SELECT id, title, messages, createdAt, updatedAt
           FROM conversations WHERE userId = ? ORDER BY updatedAt DESC`
      )
      .all(userId) as { id: string; title: string; messages: string; createdAt: string; updatedAt: string }[];

    return rows.map((row) => {
      let messages: ConversationMessage[] = [];
      try { messages = JSON.parse(row.messages); } catch { /* blob corrompu → fil vide */ }
      const last = messages[messages.length - 1];
      return {
        id:           row.id,
        title:        row.title || 'Nouvelle conversation',
        preview:      last ? last.text.replace(/\s+/g, ' ').slice(0, 120) : '',
        messageCount: messages.length,
        createdAt:    row.createdAt,
        updatedAt:    row.updatedAt,
      };
    });
  }

  /** Un fil complet — scopé à l'utilisateur (renvoie undefined si absent ou appartenant à un autre) */
  getConversation(id: string, userId: string): Conversation | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM conversations WHERE id = ? AND userId = ?`)
      .get(id, userId) as any;
    if (!row) return undefined;
    let messages: ConversationMessage[] = [];
    try { messages = JSON.parse(row.messages); } catch { /* blob corrompu */ }
    return {
      id:        row.id,
      userId:    row.userId,
      planId:    row.planId ?? null,
      title:     row.title,
      messages,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Crée ou met à jour un fil (UPSERT sur l'id). Le titre est dérivé du premier
   * message utilisateur si non fourni ; createdAt est préservé à la mise à jour.
   */
  upsertConversation(params: {
    id: string;
    userId: string;
    planId: string | null;
    messages: ConversationMessage[];
    title?: string;
  }): void {
    const now = new Date().toISOString();
    const firstUser = params.messages.find((m) => m.role === 'user');
    const title = (params.title || firstUser?.text || 'Nouvelle conversation')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    getDb()
      .prepare(
        `INSERT INTO conversations (id, userId, planId, title, messages, createdAt, updatedAt)
         VALUES (@id, @userId, @planId, @title, @messages, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           planId    = excluded.planId,
           title     = excluded.title,
           messages  = excluded.messages,
           updatedAt = excluded.updatedAt`
      )
      .run({
        id:       params.id,
        userId:   params.userId,
        planId:   params.planId,
        title,
        messages: JSON.stringify(params.messages),
        now,
      });
  }

  /** Supprime un fil de l'utilisateur. Retourne true si une ligne a été supprimée. */
  deleteConversation(id: string, userId: string): boolean {
    const info = getDb()
      .prepare(`DELETE FROM conversations WHERE id = ? AND userId = ?`)
      .run(id, userId);
    return info.changes > 0;
  }

  /** Purge les fils inactifs depuis avant `cutoffIso` (rétention). Retourne le nombre supprimé. */
  deleteExpiredConversations(cutoffIso: string): number {
    return getDb()
      .prepare(`DELETE FROM conversations WHERE updatedAt < ?`)
      .run(cutoffIso).changes;
  }

  /**
   * Recherche plein-texte (LIKE) dans les fils de l'utilisateur — pour la
   * remémoration inter-sessions (« de quoi a-t-on parlé à propos de X ? »).
   * Renvoie un extrait autour de la première occurrence de chaque fil trouvé.
   */
  searchConversations(userId: string, query: string, limit = 5): { id: string; title: string; updatedAt: string; snippet: string }[] {
    const term = query.trim();
    if (term.length < 2) return [];
    const like = `%${term.replace(/[\\%_]/g, ' ')}%`;
    const rows = getDb()
      .prepare(
        `SELECT id, title, messages, updatedAt FROM conversations
           WHERE userId = ? AND messages LIKE ? COLLATE NOCASE
           ORDER BY updatedAt DESC LIMIT ?`
      )
      .all(userId, like, limit) as { id: string; title: string; messages: string; updatedAt: string }[];

    const needle = term.toLowerCase();
    return rows.map((row) => {
      let messages: ConversationMessage[] = [];
      try { messages = JSON.parse(row.messages); } catch { /* blob corrompu */ }
      const hit = messages.find((m) => m.text?.toLowerCase().includes(needle));
      let snippet = '';
      if (hit) {
        const text = hit.text.replace(/\s+/g, ' ');
        const at = text.toLowerCase().indexOf(needle);
        const start = Math.max(0, at - 80);
        snippet = `${start > 0 ? '…' : ''}${text.slice(start, at + needle.length + 120)}…`;
      }
      return { id: row.id, title: row.title || 'Conversation', updatedAt: row.updatedAt, snippet };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Mémoire inter-sessions de l'assistant (note durable par projet)
  // ──────────────────────────────────────────────────────────────

  /** Mémoire durable de l'assistant pour (utilisateur, projet) — null si vide */
  getAssistantMemory(userId: string, planId: string | null): { content: string; updatedAt: string } | null {
    const row = getDb()
      .prepare(`SELECT content, updatedAt FROM assistant_memory WHERE userId = ? AND planId = ?`)
      .get(userId, planId ?? '') as { content: string; updatedAt: string } | undefined;
    return row && row.content ? row : null;
  }

  /** Écrit (upsert) la mémoire durable de l'assistant pour (utilisateur, projet) */
  saveAssistantMemory(userId: string, planId: string | null, content: string): void {
    getDb()
      .prepare(
        `INSERT INTO assistant_memory (userId, planId, content, updatedAt)
         VALUES (@userId, @planId, @content, @now)
         ON CONFLICT(userId, planId) DO UPDATE SET content = excluded.content, updatedAt = excluded.updatedAt`
      )
      .run({ userId, planId: planId ?? '', content, now: new Date().toISOString() });
  }

  // ──────────────────────────────────────────────────────────────
  // Posts (Content Hub)
  // ──────────────────────────────────────────────────────────────

  savePost(post: Post): void {
    getDb()
      .prepare(
        `INSERT INTO posts
           (id, userId, planId, platform, title, content, status, scheduledAt, publishedAt,
            externalUrl, externalId, imageUrl, subreddit, recurrence, recurrenceBrief, seriesId,
            recurrenceUseNews, recurrenceUseKnowledge, recurrenceUpdateKb, crossPostId,
            autoPublish, publishError, calendarSynced,
            impressions, likes, comments, shares, clicks, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        post.id, post.userId, post.planId, post.platform, post.title, post.content, post.status,
        post.scheduledAt, post.publishedAt, post.externalUrl, post.externalId ?? null, post.imageUrl, post.subreddit ?? null,
        post.recurrence, post.recurrenceBrief,
        post.seriesId ?? null, post.recurrenceUseNews ?? 0, post.recurrenceUseKnowledge ?? 1, post.recurrenceUpdateKb ?? 0,
        post.crossPostId ?? null,
        post.autoPublish, post.publishError, post.calendarSynced,
        post.impressions, post.likes, post.comments, post.shares, post.clicks,
        post.createdAt, post.updatedAt
      );
  }

  /**
   * Post déjà présent correspondant à une référence externe — pour dédupliquer
   * l'import d'historique (et ne jamais réimporter un post déjà publié via l'app).
   * Cherche d'abord par identifiant natif (le plus fiable), puis par URL.
   * Scopé au projet : `IS ?` matche aussi un planId NULL.
   */
  getImportedPost(
    userId: string,
    planId: string | null,
    platform: string,
    externalId: string | null,
    externalUrl: string | null,
  ): Post | undefined {
    const db = getDb();
    if (externalId) {
      const byId = db
        .prepare(`SELECT * FROM posts WHERE userId = ? AND planId IS ? AND platform = ? AND externalId = ? LIMIT 1`)
        .get(userId, planId, platform, externalId) as Post | undefined;
      if (byId) return byId;
    }
    if (externalUrl) {
      return db
        .prepare(`SELECT * FROM posts WHERE userId = ? AND planId IS ? AND externalUrl = ? LIMIT 1`)
        .get(userId, planId, externalUrl) as Post | undefined;
    }
    return undefined;
  }

  updatePost(id: string, patch: Partial<Post>): void {
    const allowed: (keyof Post)[] = [
      'platform', 'title', 'content', 'status', 'scheduledAt', 'publishedAt',
      'externalUrl', 'imageUrl', 'subreddit', 'recurrence', 'recurrenceBrief', 'seriesId',
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

  /** Posts NON publiés (hors excludePostId) qui référencent encore ce fichier média */
  countPendingPostsUsingMedia(fileName: string, excludePostId: string): number {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM posts WHERE id != ? AND status != 'published' AND imageUrl LIKE ?`)
      .get(excludePostId, `%/uploads/${fileName}%`) as { n: number };
    return row.n;
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
    getDb().prepare(`DELETE FROM post_comments WHERE postId = ?`).run(id);
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
  // Sources de connaissances (mise à jour automatique de la base)
  // ──────────────────────────────────────────────────────────────

  /** Sources déclarées pour un projet (GitHub, site web) */
  getKnowledgeSources(userId: string, planId: string | null): KnowledgeSource[] {
    return getDb()
      .prepare(`SELECT * FROM knowledge_sources WHERE userId = ? AND planId IS ? ORDER BY createdAt ASC`)
      .all(userId, planId) as KnowledgeSource[];
  }

  getKnowledgeSourceById(id: string): KnowledgeSource | undefined {
    return getDb().prepare(`SELECT * FROM knowledge_sources WHERE id = ?`).get(id) as KnowledgeSource | undefined;
  }

  /**
   * Enregistre une source en évitant les doublons : si une source du même type
   * et de la même URL existe déjà pour ce projet, on la renvoie (et on met à
   * jour son libellé) plutôt que d'en créer une seconde.
   */
  upsertKnowledgeSource(
    userId: string,
    planId: string | null,
    type: KnowledgeSourceType,
    url: string,
    label: string,
  ): KnowledgeSource {
    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM knowledge_sources WHERE userId = ? AND planId IS ? AND type = ? AND url = ?`)
      .get(userId, planId, type, url) as KnowledgeSource | undefined;
    if (existing) {
      if (label && label !== existing.label) {
        db.prepare(`UPDATE knowledge_sources SET label = ? WHERE id = ?`).run(label, existing.id);
        return { ...existing, label };
      }
      return existing;
    }
    const source: KnowledgeSource = {
      id: randomUUID(), userId, planId, type, url, label,
      lastSyncedAt: null, createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO knowledge_sources (id, userId, planId, type, url, label, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(source.id, source.userId, source.planId, source.type, source.url, source.label, source.lastSyncedAt, source.createdAt);
    return source;
  }

  markKnowledgeSourceSynced(id: string, at: string): void {
    getDb().prepare(`UPDATE knowledge_sources SET lastSyncedAt = ? WHERE id = ?`).run(at, id);
  }

  deleteKnowledgeSource(id: string): void {
    getDb().prepare(`DELETE FROM knowledge_sources WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Contacts
  // ──────────────────────────────────────────────────────────────

  saveContact(contact: Contact): void {
    getDb()
      .prepare(
        `INSERT INTO contacts
           (id, userId, planId, name, email, company, companyId, type, stage, amount, externalId,
            expectedCloseDate, nextAction, nextActionAt,
            source, title, linkedinUrl, phone, interestScore, interestSummary, notes, lastInteraction, manualLog, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contact.id, contact.userId, contact.planId, contact.name, contact.email, contact.company, contact.companyId,
        contact.type, contact.stage, contact.amount, contact.externalId,
        contact.expectedCloseDate, contact.nextAction, contact.nextActionAt,
        contact.source, contact.title, contact.linkedinUrl, contact.phone, contact.interestScore, contact.interestSummary,
        contact.notes, contact.lastInteraction, contact.manualLog, contact.createdAt, contact.updatedAt
      );
  }

  updateContact(id: string, patch: Partial<Contact>): void {
    const allowed: (keyof Contact)[] = [
      'name', 'email', 'company', 'companyId', 'type', 'stage', 'amount',
      'expectedCloseDate', 'nextAction', 'nextActionAt', 'source', 'title', 'linkedinUrl', 'phone',
      'interestScore', 'interestSummary', 'notes', 'lastInteraction', 'manualLog',
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

  /** Dédup des imports externes (HubSpot…) : un enregistrement source par projet */
  getContactByExternalId(userId: string, planId: string | null, externalId: string): Contact | undefined {
    return getDb()
      .prepare(`SELECT * FROM contacts WHERE userId = ? AND planId IS ? AND externalId = ?`)
      .get(userId, planId, externalId) as Contact | undefined;
  }

  deleteContact(id: string): void {
    getDb().prepare(`DELETE FROM contact_emails WHERE contactId = ?`).run(id);
    getDb().prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  }

  // ──────────────────────────────────────────────────────────────
  // Comptes (entreprises) & emails des contacts — CRM orienté comptes
  // ──────────────────────────────────────────────────────────────

  saveCompany(company: Company): void {
    getDb()
      .prepare(
        `INSERT INTO companies (id, userId, planId, name, domain, sector, size, siren, legalName, naf, address, revenue, description, salesAngles, objections, intel, notes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        company.id, company.userId, company.planId, company.name, company.domain, company.sector,
        company.size, company.siren, company.legalName, company.naf, company.address, company.revenue,
        company.description, company.salesAngles, company.objections, company.intel, company.notes,
        company.createdAt, company.updatedAt
      );
  }

  updateCompany(id: string, patch: Partial<Company>): void {
    const allowed: (keyof Company)[] = [
      'name', 'domain', 'sector', 'size', 'siren', 'legalName', 'naf', 'address', 'revenue',
      'description', 'salesAngles', 'objections', 'intel', 'notes',
    ];
    const fields: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (patch[key] !== undefined) { fields.push(`${key} = ?`); vals.push(patch[key]); }
    }
    if (fields.length === 0) return;
    fields.push('updatedAt = ?');
    vals.push(new Date().toISOString(), id);
    getDb().prepare(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  }

  getCompanyById(id: string): Company | undefined {
    return getDb().prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as Company | undefined;
  }

  getCompaniesByPlan(userId: string, planId: string | null): Company[] {
    return getDb()
      .prepare(`SELECT * FROM companies WHERE userId = ? AND planId IS ? ORDER BY updatedAt DESC`)
      .all(userId, planId) as Company[];
  }

  /** Trouve un compte par nom (insensible à la casse) dans le projet. */
  getCompanyByName(userId: string, planId: string | null, name: string): Company | undefined {
    return getDb()
      .prepare(`SELECT * FROM companies WHERE userId = ? AND planId IS ? AND LOWER(name) = LOWER(?)`)
      .get(userId, planId, name) as Company | undefined;
  }

  deleteCompany(id: string): void {
    getDb().prepare(`UPDATE contacts SET companyId = NULL WHERE companyId = ?`).run(id);
    getDb().prepare(`DELETE FROM companies WHERE id = ?`).run(id);
  }

  getContactsByCompany(companyId: string): Contact[] {
    return getDb()
      .prepare(`SELECT * FROM contacts WHERE companyId = ? ORDER BY amount DESC, updatedAt DESC`)
      .all(companyId) as Contact[];
  }

  saveContactEmail(email: ContactEmail): void {
    getDb()
      .prepare(
        `INSERT INTO contact_emails (id, userId, contactId, direction, subject, snippet, sentAt, externalId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(email.id, email.userId, email.contactId, email.direction, email.subject, email.snippet, email.sentAt, email.externalId, email.createdAt);
  }

  getEmailsByContact(contactId: string): ContactEmail[] {
    return getDb()
      .prepare(`SELECT * FROM contact_emails WHERE contactId = ? ORDER BY sentAt DESC`)
      .all(contactId) as ContactEmail[];
  }

  getContactEmailByExternalId(contactId: string, externalId: string): ContactEmail | undefined {
    return getDb()
      .prepare(`SELECT * FROM contact_emails WHERE contactId = ? AND externalId = ?`)
      .get(contactId, externalId) as ContactEmail | undefined;
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
  // Automatisations (cron jobs IA)
  // ──────────────────────────────────────────────────────────────

  saveCronJob(job: CronJob): void {
    getDb().prepare(`
      INSERT INTO cron_jobs (id, userId, planId, title, objective, frequency, timeOfDay, weekday, dayOfMonth, intervalMinutes, enabled, nextRunAt, lastRunAt, lastStatus, lastResult, createdAt, updatedAt)
      VALUES (@id, @userId, @planId, @title, @objective, @frequency, @timeOfDay, @weekday, @dayOfMonth, @intervalMinutes, @enabled, @nextRunAt, @lastRunAt, @lastStatus, @lastResult, @createdAt, @updatedAt)
    `).run(job);
  }

  getCronJobById(id: string): CronJob | undefined {
    return getDb().prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronJob | undefined;
  }

  /** Automatisations d'un projet (les plus récentes d'abord). */
  getCronJobsByPlan(userId: string, planId: string | null): CronJob[] {
    return getDb()
      .prepare(`SELECT * FROM cron_jobs WHERE userId = ? AND (planId IS ? OR planId = ?) ORDER BY createdAt DESC`)
      .all(userId, planId, planId) as CronJob[];
  }

  updateCronJob(id: string, patch: Partial<CronJob>): void {
    const allowed: (keyof CronJob)[] = ['title', 'objective', 'frequency', 'timeOfDay', 'weekday', 'dayOfMonth', 'intervalMinutes', 'enabled', 'nextRunAt', 'lastRunAt', 'lastStatus', 'lastResult', 'updatedAt'];
    const keys = allowed.filter((k) => k in patch);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    getDb().prepare(`UPDATE cron_jobs SET ${setClause} WHERE id = @id`).run({ id, ...patch } as Record<string, unknown>);
  }

  deleteCronJob(id: string): void {
    getDb().transaction(() => {
      getDb().prepare(`DELETE FROM cron_runs WHERE cronJobId = ?`).run(id);
      getDb().prepare(`DELETE FROM cron_jobs WHERE id = ?`).run(id);
    })();
  }

  /** Automatisations actives dont l'échéance est passée (traitées par le worker). */
  getDueCronJobs(nowIso: string): CronJob[] {
    return getDb()
      .prepare(`SELECT * FROM cron_jobs WHERE enabled = 1 AND nextRunAt <= ? ORDER BY nextRunAt ASC LIMIT 20`)
      .all(nowIso) as CronJob[];
  }

  saveCronRun(run: CronRun): void {
    getDb().prepare(`
      INSERT INTO cron_runs (id, cronJobId, userId, status, result, actions, startedAt, completedAt)
      VALUES (@id, @cronJobId, @userId, @status, @result, @actions, @startedAt, @completedAt)
    `).run(run);
  }

  updateCronRun(id: string, patch: Partial<CronRun>): void {
    const allowed: (keyof CronRun)[] = ['status', 'result', 'actions', 'completedAt'];
    const keys = allowed.filter((k) => k in patch);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    getDb().prepare(`UPDATE cron_runs SET ${setClause} WHERE id = @id`).run({ id, ...patch } as Record<string, unknown>);
  }

  getCronRunsByJob(cronJobId: string, limit = 20): CronRun[] {
    return getDb()
      .prepare(`SELECT * FROM cron_runs WHERE cronJobId = ? ORDER BY startedAt DESC LIMIT ?`)
      .all(cronJobId, limit) as CronRun[];
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
         WHERE a.userId = ?
           AND (r.planId IS ? OR (? IS NULL AND r.planId = ''))
           AND r.status = 'awaiting_approval'
         ORDER BY r.startedAt DESC`
      )
      .all(userId, planId, planId) as any[];
    return rows.map((r) => ({
      ...this.rowToRun(r),
      agentName: r.agentName,
      agentPlatform: r.agentPlatform,
    }));
  }

  /**
   * Historique des validations du projet : runs terminés (envoyés, échoués,
   * rejetés) avec le résultat exact de la publication — l'attestation de ce
   * qui est réellement parti (ou pas).
   */
  getRunHistoryByPlan(userId: string, planId: string | null, limit = 30): (AgentRun & { agentName: string; agentPlatform: string })[] {
    const rows = getDb()
      .prepare(
        `SELECT r.*, a.name AS agentName, a.platform AS agentPlatform
         FROM agent_runs r
         JOIN agents a ON a.id = r.agentId
         WHERE a.userId = ?
           AND (r.planId IS ? OR (? IS NULL AND r.planId = ''))
           AND r.status IN ('done', 'failed', 'rejected')
         ORDER BY COALESCE(r.completedAt, r.startedAt) DESC
         LIMIT ?`
      )
      .all(userId, planId, planId, limit) as any[];
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

  // ──────────────────────────────────────────────────────────────
  // Administration (founders only — lecture seule)
  // ──────────────────────────────────────────────────────────────

  adminGetStats(): import('../types').AdminStats {
    const db = getDb();
    const now = new Date();
    const d7  = new Date(now.getTime() - 7  * 24 * 3600 * 1000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const n = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { n: number }).n;
    return {
      totalUsers:           n(`SELECT COUNT(*) as n FROM users`),
      newUsersLast7d:       n(`SELECT COUNT(*) as n FROM users WHERE createdAt >= ?`, d7),
      activeUsersLast7d:    n(`SELECT COUNT(DISTINCT userId) as n FROM admin_events WHERE createdAt >= ?`, d7),
      activeUsersLast30d:   n(`SELECT COUNT(DISTINCT userId) as n FROM admin_events WHERE createdAt >= ?`, d30),
      totalPlans:           n(`SELECT COUNT(*) as n FROM plans`),
      totalPosts:           n(`SELECT COUNT(*) as n FROM posts`),
      postsLast7d:          n(`SELECT COUNT(*) as n FROM posts WHERE createdAt >= ?`, d7),
      publishedPostsLast7d: n(`SELECT COUNT(*) as n FROM posts WHERE status = 'published' AND updatedAt >= ?`, d7),
      totalKnowledgeEntries:n(`SELECT COUNT(*) as n FROM knowledge`),
    };
  }

  adminGetAllUsers(): import('../types').AdminUserSummary[] {
    return (getDb()
      .prepare(
        `SELECT u.id, u.email, u.name, u.createdAt,
                (SELECT COUNT(*) FROM plans   WHERE userId = u.id) as planCount,
                (SELECT COUNT(*) FROM posts   WHERE userId = u.id) as postCount,
                (SELECT COUNT(*) FROM posts   WHERE userId = u.id AND status = 'published') as publishedPosts,
                (SELECT MAX(createdAt) FROM admin_events WHERE userId = u.id) as lastActivityAt
         FROM users u
         ORDER BY u.createdAt DESC`
      )
      .all() as import('../types').AdminUserSummary[]);
  }

  adminGetActivity(limit = 100, before?: string): import('../types').AdminEvent[] {
    const cursor = before ?? new Date(Date.now() + 60_000).toISOString();
    return (getDb()
      .prepare(
        `SELECT ae.id, ae.userId, ae.action, ae.target, ae.metadata, ae.createdAt,
                u.email as userEmail, u.name as userName
         FROM admin_events ae
         JOIN users u ON u.id = ae.userId
         WHERE ae.createdAt < ?
         ORDER BY ae.createdAt DESC
         LIMIT ?`
      )
      .all(cursor, limit) as any[])
      .map((r) => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      })) as import('../types').AdminEvent[];
  }

  adminGetUserActivity(userId: string, limit = 50): import('../types').AdminEvent[] {
    return (getDb()
      .prepare(
        `SELECT ae.id, ae.userId, ae.action, ae.target, ae.metadata, ae.createdAt,
                u.email as userEmail, u.name as userName
         FROM admin_events ae
         JOIN users u ON u.id = ae.userId
         WHERE ae.userId = ?
         ORDER BY ae.createdAt DESC
         LIMIT ?`
      )
      .all(userId, limit) as any[])
      .map((r) => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      })) as import('../types').AdminEvent[];
  }
}

export const storage = new Storage();
