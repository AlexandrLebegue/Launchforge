import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { createLinkCode, consumeLinkCode, dispatchDueReminders } from '../src/services/telegramBot';
import app from '../src/app';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const res = await request(app).post('/api/auth/register').send({
    email: 'telegram@launchforge.dev',
    password: 'password123',
    name: 'Telegram Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

describe('Liaison Telegram', () => {
  it('link-code retourne 503 sans TELEGRAM_BOT_TOKEN', async () => {
    const res = await request(app)
      .post('/api/telegram/link-code')
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('TELEGRAM_NOT_CONFIGURED');
  });

  it('link-code requiert une authentification', async () => {
    const res = await request(app).post('/api/telegram/link-code');
    expect(res.status).toBe(401);
  });

  it('un code se consomme une seule fois et expire', () => {
    const code = createLinkCode(userId);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(consumeLinkCode(code.toLowerCase())).toBe(userId); // insensible à la casse
    expect(consumeLinkCode(code)).toBeNull();                  // déjà consommé
    expect(consumeLinkCode('ZZZZZZ')).toBeNull();              // inconnu
  });

  it('persiste et retrouve une liaison chat ↔ compte', () => {
    storage.saveTelegramLink({ chatId: '12345', userId, createdAt: new Date().toISOString() });
    expect(storage.getTelegramLinkByChatId('12345')?.userId).toBe(userId);
    expect(storage.getTelegramLinksByUserId(userId)).toHaveLength(1);
  });
});

describe('Rappels Telegram', () => {
  it('envoie les rappels dus sur le chat lié puis les marque envoyés', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    storage.saveReminder({ id: uuid(), userId, text: 'Relancer Marie', dueAt: past, sent: 0, createdAt: past });
    storage.saveReminder({ id: uuid(), userId, text: 'Plus tard', dueAt: future, sent: 0, createdAt: past });

    const sentTo: { chatId: string; text: string }[] = [];
    const sent = await dispatchDueReminders(new Date(), async (chatId, text) => {
      sentTo.push({ chatId, text });
    });

    expect(sent).toBe(1);
    expect(sentTo).toHaveLength(1);
    expect(sentTo[0].chatId).toBe('12345');
    expect(sentTo[0].text).toContain('Relancer Marie');

    // Plus rien à envoyer au tick suivant ; le rappel futur reste en attente
    const again = await dispatchDueReminders(new Date(), async () => {});
    expect(again).toBe(0);
    expect(storage.getPendingRemindersByUserId(userId)).toHaveLength(1);
  });
});
