/**
 * /api/webhooks — callbacks entrants de services externes (SANS auth JWT :
 * chaque route vérifie sa propre signature).
 *
 * apollo-phone : Apollo.io livre les téléphones en ASYNCHRONE. Quand un
 * enrichissement demande reveal_phone_number, on passe à Apollo une URL de
 * webhook contenant l'id du contact + un jeton HMAC (dérivé de JWT_SECRET) —
 * impossible à forger sans le secret du serveur.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { storage } from '../services/storage';

const router = Router();

/** Jeton anti-forge de l'URL de webhook d'un contact. */
export function apolloWebhookToken(contactId: string): string {
  const secret = process.env.JWT_SECRET || 'launchforge-dev-secret-change-in-production';
  return crypto.createHmac('sha256', secret).update(`apollo-phone:${contactId}`).digest('hex').slice(0, 32);
}

/** URL publique à transmettre à Apollo (null si APP_URL n'est pas configurée). */
export function apolloPhoneWebhookUrl(contactId: string): string | null {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!appUrl) return null;
  return `${appUrl}/api/webhooks/apollo-phone?contactId=${encodeURIComponent(contactId)}&token=${apolloWebhookToken(contactId)}`;
}

router.post('/apollo-phone', (req: Request, res: Response) => {
  const contactId = String(req.query.contactId || '');
  const token = String(req.query.token || '');
  if (!contactId || token !== apolloWebhookToken(contactId)) {
    return res.status(403).json({ success: false, error: 'invalid token' });
  }
  const contact = storage.getContactById(contactId);
  if (!contact) return res.status(404).json({ success: false, error: 'contact not found' });

  // Payload Apollo : { people: [{ phone_numbers: [{ sanitized_number, raw_number, … }] }] }
  const people: any[] = Array.isArray(req.body?.people) ? req.body.people : [];
  const numbers = people
    .flatMap((p) => (Array.isArray(p?.phone_numbers) ? p.phone_numbers : []))
    .map((n: any) => (typeof n?.sanitized_number === 'string' && n.sanitized_number.trim())
      || (typeof n?.raw_number === 'string' && n.raw_number.trim()) || '')
    .filter(Boolean);

  if (numbers.length > 0 && !contact.phone) {
    storage.updateContact(contact.id, { phone: String(numbers[0]).slice(0, 40) });
  }
  console.log(`[apollo-webhook] contact=${contactId} numéros reçus=${numbers.length}`);
  res.json({ success: true });
});

export default router;
