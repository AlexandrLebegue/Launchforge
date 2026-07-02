import { describe, it, expect, vi } from 'vitest';
import { verifyApolloKey, enrichPersonWithApollo, enrichOrganizationWithApollo } from '../src/services/apollo';

/** Fabrique un faux fetch qui renvoie (status, body) et capture la requête. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: any, _init?: any) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as any;
}

describe('apollo — verifyApolloKey', () => {
  it('accepte une clé reconnue par le health check', async () => {
    const fetchFn = fakeFetch(200, { is_logged_in: true });
    await expect(verifyApolloKey('bonne-cle', fetchFn)).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('/auth/health');
    expect(init.headers['x-api-key']).toBe('bonne-cle');
  });

  it('refuse une clé invalide (401 ou is_logged_in=false)', async () => {
    await expect(verifyApolloKey('x', fakeFetch(401, {}))).resolves.toBe(false);
    await expect(verifyApolloKey('x', fakeFetch(200, { is_logged_in: false }))).resolves.toBe(false);
  });
});

describe('apollo — enrichPersonWithApollo', () => {
  const person = {
    title: 'Head of Sales',
    headline: 'Head of Sales @ Acme',
    linkedin_url: 'https://linkedin.com/in/marie-dupont',
    email: 'marie@acme.io',
    city: 'Paris',
    country: 'France',
    phone_numbers: [{ sanitized_number: '+33612345678', raw_number: '06 12 34 56 78' }],
    organization: {
      name: 'Acme',
      primary_domain: 'acme.io',
      industry: 'information technology & services',
      estimated_num_employees: 120,
      short_description: 'Acme fabrique des trucs.',
      linkedin_url: 'https://linkedin.com/company/acme',
      sanitized_phone: '+33123456789',
    },
  };

  it('mappe la personne (téléphone inclus) et son entreprise, sans emails persos', async () => {
    const fetchFn = fakeFetch(200, { person });
    const out = await enrichPersonWithApollo('cle', { name: 'Marie Dupont', company: 'Acme' }, null, fetchFn);

    expect(out).toMatchObject({
      title: 'Head of Sales',
      linkedinUrl: 'https://linkedin.com/in/marie-dupont',
      email: 'marie@acme.io',
      phone: '+33612345678',
      organization: { name: 'Acme', domain: 'acme.io', size: '~120 pers.', phone: '+33123456789' },
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('/people/match');
    const body = JSON.parse(init.body);
    expect(body.reveal_personal_emails).toBe(false);
    // Sans URL de webhook publique, pas de révélation de téléphone possible
    expect(body.reveal_phone_number).toBe(false);
    expect(body.webhook_url).toBeUndefined();
    expect(body.organization_name).toBe('Acme');
  });

  it('active reveal_phone_number + webhook_url quand une URL publique est fournie', async () => {
    const fetchFn = fakeFetch(200, { person });
    await enrichPersonWithApollo('cle', { name: 'Marie' }, 'https://app.example.com/api/webhooks/apollo-phone?contactId=c1&token=t', fetchFn);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.reveal_phone_number).toBe(true);
    expect(body.webhook_url).toContain('/api/webhooks/apollo-phone');
  });

  it('renvoie null si Apollo ne trouve personne', async () => {
    await expect(
      enrichPersonWithApollo('cle', { name: 'Inconnu' }, null, fakeFetch(200, { person: null })),
    ).resolves.toBeNull();
  });

  it('masque les emails verrouillés (email_not_unlocked@…)', async () => {
    const locked = { ...person, email: 'email_not_unlocked@domain.com' };
    const out = await enrichPersonWithApollo('cle', { name: 'Marie' }, null, fakeFetch(200, { person: locked }));
    expect(out?.email).toBeNull();
  });

  it('traduit les erreurs HTTP en messages actionnables', async () => {
    await expect(enrichPersonWithApollo('cle', { name: 'X' }, null, fakeFetch(401, {})))
      .rejects.toThrow(/Clé API Apollo invalide/);
    await expect(enrichPersonWithApollo('cle', { name: 'X' }, null, fakeFetch(402, {})))
      .rejects.toThrow(/Crédits Apollo épuisés/);
    await expect(enrichPersonWithApollo('cle', { name: 'X' }, null, fakeFetch(403, {})))
      .rejects.toThrow(/plan Apollo/);
    await expect(enrichPersonWithApollo('cle', { name: 'X' }, null, fakeFetch(429, {})))
      .rejects.toThrow(/Limite de requêtes/);
  });
});

describe('apollo — enrichOrganizationWithApollo (repli entreprise seule)', () => {
  it('lit la fiche entreprise par domaine/nom', async () => {
    const fetchFn = fakeFetch(200, {
      organization: {
        name: 'Acme', primary_domain: 'acme.io', industry: 'software',
        estimated_num_employees: 40, short_description: 'Editeur SaaS.', phone: '+33 1 99 00 11 22',
      },
    });
    const out = await enrichOrganizationWithApollo('cle', { name: 'Acme', domain: 'acme.io' }, fetchFn);
    expect(out).toMatchObject({ name: 'Acme', domain: 'acme.io', size: '~40 pers.', phone: '+33 1 99 00 11 22' });

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('/organizations/enrich');
    expect(String(url)).toContain('domain=acme.io');
    expect(init.headers['x-api-key']).toBe('cle');
  });

  it('renvoie null sans paramètre exploitable ou si rien n\'est trouvé', async () => {
    await expect(enrichOrganizationWithApollo('cle', {}, fakeFetch(200, {}))).resolves.toBeNull();
    await expect(enrichOrganizationWithApollo('cle', { name: 'X' }, fakeFetch(200, { organization: null }))).resolves.toBeNull();
  });
});
