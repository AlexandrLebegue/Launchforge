import { describe, it, expect } from 'vitest';
import { extractPublishedRef, canonicalPostUrl, resolvePublishedUrl } from '../src/services/composio';

describe('extractPublishedRef', () => {
  it('renvoie l\'URL quand la réponse en contient une (point final retiré)', () => {
    expect(extractPublishedRef('OK: publié https://x.com/lf/status/9876543210.'))
      .toBe('https://x.com/lf/status/9876543210');
  });

  it('préserve l\'URN LinkedIn ENTIER (préfixe urn: conservé)', () => {
    expect(extractPublishedRef('OK: post LinkedIn publié urn:li:share:7123456789 (image jointe)'))
      .toBe('urn:li:share:7123456789');
    expect(extractPublishedRef('OK: publié urn:li:activity:7000000000000000000 (via proxy)'))
      .toBe('urn:li:activity:7000000000000000000');
  });

  it('renvoie l\'id long à défaut d\'URL/URN (média Instagram)', () => {
    expect(extractPublishedRef('OK: publication Instagram créée (id 17912345678901234)'))
      .toBe('17912345678901234');
  });

  it('renvoie null si la réponse n\'est pas un succès', () => {
    expect(extractPublishedRef('ECHEC: compte non connecté')).toBeNull();
  });
});

describe('canonicalPostUrl', () => {
  it('LinkedIn : reconstruit l\'URL du feed depuis l\'URN (et la forme amputée)', () => {
    expect(canonicalPostUrl('linkedin', 'urn:li:share:7123'))
      .toBe('https://www.linkedin.com/feed/update/urn:li:share:7123/');
    // forme historiquement amputée du préfixe urn:
    expect(canonicalPostUrl('linkedin', 'li:activity:7123'))
      .toBe('https://www.linkedin.com/feed/update/urn:li:activity:7123/');
  });

  it('Twitter : reconstruit l\'URL du statut depuis l\'id', () => {
    expect(canonicalPostUrl('twitter', '1790000000000000001'))
      .toBe('https://x.com/i/web/status/1790000000000000001');
  });

  it('YouTube : reconstruit youtu.be depuis l\'id à 11 caractères', () => {
    expect(canonicalPostUrl('youtube', 'abc123XYZ_-'))
      .toBe('https://youtu.be/abc123XYZ_-');
  });

  it('conserve une URL déjà fournie (Reddit, Facebook…)', () => {
    expect(canonicalPostUrl('reddit', 'https://www.reddit.com/r/startups/comments/1u4zw0e/x/'))
      .toBe('https://www.reddit.com/r/startups/comments/1u4zw0e/x/');
  });

  it('Instagram / TikTok : pas d\'URL déterministe → null', () => {
    expect(canonicalPostUrl('instagram', '17912345678901234')).toBeNull();
    expect(canonicalPostUrl('tiktok', '7300000000000000000')).toBeNull();
  });

  it('garantit que l\'URL LinkedIn reste lisible par la synchro des métriques', () => {
    const url = canonicalPostUrl('linkedin', 'urn:li:share:7123')!;
    expect(url).toMatch(/urn:li:share:\d+/); // le regex de syncMetricsDirect matche
  });
});

describe('resolvePublishedUrl (point d\'entrée des 3 voies de publication)', () => {
  it('LinkedIn auto-publié (URN) → URL cliquable du feed', () => {
    expect(resolvePublishedUrl('linkedin', 'OK: post LinkedIn publié urn:li:share:7123 (image jointe)'))
      .toBe('https://www.linkedin.com/feed/update/urn:li:share:7123/');
  });

  it('Instagram → id brut conservé (utile aux métriques, pas de lien)', () => {
    expect(resolvePublishedUrl('instagram', 'OK: publication Instagram créée (id 17912345678901234)'))
      .toBe('17912345678901234');
  });

  it('Twitter avec URL déjà fournie → inchangée', () => {
    expect(resolvePublishedUrl('twitter', 'OK: tweet publié https://x.com/i/web/status/123'))
      .toBe('https://x.com/i/web/status/123');
  });

  it('échec → null', () => {
    expect(resolvePublishedUrl('linkedin', 'ECHEC: refusé')).toBeNull();
  });
});
