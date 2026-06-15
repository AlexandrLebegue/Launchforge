import { randomUUID } from 'crypto';
import { getDb } from '../db';

export type AdminAction =
  | 'user.register'
  | 'user.login'
  | 'user.delete'
  | 'plan.created'
  | 'plan.deleted'
  | 'post.published'
  | 'post.scheduled'
  | 'agent.run'
  | 'knowledge.created'
  | 'team.created'
  | 'team.joined';

export function logEvent(
  userId: string,
  action: AdminAction,
  target?: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO admin_events (id, userId, action, target, metadata, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        userId,
        action,
        target ?? null,
        metadata ? JSON.stringify(metadata) : null,
        new Date().toISOString(),
      );
  } catch {
    // silently ignore — audit log must never break a user-facing route
  }
}
