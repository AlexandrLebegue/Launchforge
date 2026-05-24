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
import { LaunchPlan, Feedback, User } from '../types';

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
}

export const storage = new Storage();
