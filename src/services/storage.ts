import { getDb, saveDb } from '../db';
import { LaunchPlan, Feedback, User } from '../types';

export class Storage {
  saveUser(user: User, hashedPassword: string): void {
    const db = getDb();
    db.run(
      'INSERT INTO users (id, email, name, password, createdAt) VALUES (?, ?, ?, ?, ?)',
      [user.id, user.email, user.name, hashedPassword, user.createdAt]
    );
    saveDb();
  }

  getUserByEmail(email: string): { id: string; email: string; name: string; password: string; createdAt: string } | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      return stmt.getAsObject() as any;
    }
    stmt.free();
    return undefined;
  }

  getUserById(id: string): User | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT id, email, name, createdAt FROM users WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  savePlan(plan: LaunchPlan): void {
    const db = getDb();
    db.run(
      `INSERT INTO plans (id, userId, input, weekly_plan, community_targets, content_angles, outreach_strategy, launch_sequencing, validation_checklist, first_users_tactics, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        plan.createdAt,
      ]
    );
    saveDb();
  }

  getPlan(id: string): LaunchPlan | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM plans WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      return this.rowToPlan(row);
    }
    stmt.free();
    return undefined;
  }

  getPlansByUserId(userId: string): LaunchPlan[] {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM plans WHERE userId = ? ORDER BY createdAt DESC');
    stmt.bind([userId]);
    const plans: LaunchPlan[] = [];
    while (stmt.step()) {
      plans.push(this.rowToPlan(stmt.getAsObject() as any));
    }
    stmt.free();
    return plans;
  }

  getAllPlans(): LaunchPlan[] {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM plans ORDER BY createdAt DESC');
    const plans: LaunchPlan[] = [];
    while (stmt.step()) {
      plans.push(this.rowToPlan(stmt.getAsObject() as any));
    }
    stmt.free();
    return plans;
  }

  saveFeedback(feedback: Feedback): void {
    const db = getDb();
    db.run(
      'INSERT INTO feedback (id, planId, userId, rating, comment, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [feedback.id, feedback.planId, feedback.userId, feedback.rating, feedback.comment, feedback.createdAt]
    );
    saveDb();
  }

  getFeedbacksByPlanId(planId: string): Feedback[] {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM feedback WHERE planId = ? ORDER BY createdAt DESC');
    stmt.bind([planId]);
    const feedbacks: Feedback[] = [];
    while (stmt.step()) {
      feedbacks.push(this.rowToFeedback(stmt.getAsObject() as any));
    }
    stmt.free();
    return feedbacks;
  }

  getAllFeedbacks(): Feedback[] {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM feedback ORDER BY createdAt DESC');
    const feedbacks: Feedback[] = [];
    while (stmt.step()) {
      feedbacks.push(this.rowToFeedback(stmt.getAsObject() as any));
    }
    stmt.free();
    return feedbacks;
  }

  private rowToPlan(row: any): LaunchPlan {
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      input: JSON.parse(row.input),
      weekly_plan: JSON.parse(row.weekly_plan),
      community_targets: JSON.parse(row.community_targets),
      content_angles: JSON.parse(row.content_angles),
      outreach_strategy: JSON.parse(row.outreach_strategy),
      launch_sequencing: JSON.parse(row.launch_sequencing),
      validation_checklist: JSON.parse(row.validation_checklist),
      first_users_tactics: JSON.parse(row.first_users_tactics),
    };
  }

  private rowToFeedback(row: any): Feedback {
    return {
      id: row.id,
      planId: row.planId,
      userId: row.userId,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt,
    };
  }
}

export const storage = new Storage();
