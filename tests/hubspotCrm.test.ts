import { describe, it, expect, vi } from 'vitest';

// composioUserIdFor touche le storage/env : on le neutralise pour tester le
// mapping pur, et on injecte un exécuteur Composio factice dans fetchHubSpotCrm.
vi.mock('../src/services/composioConnect', () => ({
  composioUserIdFor: () => 'lf-test',
}));

import { fetchHubSpotCrm, fetchHubSpotDeals, fetchHubSpotContacts, mapDealStage, mapLifecycle } from '../src/services/hubspotCrm';

describe('hubspotCrm — mapping des étapes', () => {
  it('mapDealStage classe les stages HubSpot par mot-clé', () => {
    expect(mapDealStage('closedwon')).toBe('won');
    expect(mapDealStage('closedlost')).toBe('lost');
    expect(mapDealStage('qualifiedtobuy')).toBe('qualified');
    expect(mapDealStage('contractsent')).toBe('proposal');
    expect(mapDealStage('appointmentscheduled')).toBe('discussion');
    expect(mapDealStage('un-stage-custom')).toBe('new');
  });

  it('mapLifecycle déduit étape + type du lifecyclestage', () => {
    expect(mapLifecycle('customer')).toEqual({ stage: 'won', type: 'client' });
    expect(mapLifecycle('salesqualifiedlead')).toEqual({ stage: 'qualified', type: 'prospect' });
    expect(mapLifecycle('evangelist')).toEqual({ stage: 'won', type: 'partner' });
    expect(mapLifecycle('lead')).toEqual({ stage: 'new', type: 'prospect' });
  });
});

describe('hubspotCrm — fetchHubSpotCrm', () => {
  it('parse deals + contacts et fabrique des externalId déduplicables', async () => {
    const exec = vi.fn(async (_cuid: string, slug: string) => {
      if (slug === 'HUBSPOT_HUBSPOT_LIST_DEALS') {
        return { results: [{ id: '1', properties: { dealname: 'Acme', amount: '12000', dealstage: 'closedwon', pipeline: 'default' } }] };
      }
      return { results: [{ id: '9', properties: { firstname: 'Marie', lastname: 'Dupont', email: 'marie@acme.io', company: 'Acme', lifecyclestage: 'customer' } }] };
    });

    const out = await fetchHubSpotCrm('user-1', exec as any);

    const deal = out.find((c) => c.externalId === 'hs-deal:1')!;
    expect(deal).toBeDefined();
    expect(deal.name).toBe('Acme');
    expect(deal.amount).toBe(12000);
    expect(deal.stage).toBe('won');
    expect(deal.source).toBe('HubSpot — deal');

    const contact = out.find((c) => c.externalId === 'hs-contact:9')!;
    expect(contact.name).toBe('Marie Dupont');
    expect(contact.email).toBe('marie@acme.io');
    expect(contact.type).toBe('client');
    expect(contact.stage).toBe('won');
  });

  it('bascule sur le second slug de contacts si le premier échoue', async () => {
    const exec = vi.fn(async (_cuid: string, slug: string) => {
      if (slug === 'HUBSPOT_HUBSPOT_LIST_DEALS') return { results: [] };
      if (slug === 'HUBSPOT_HUBSPOT_LIST_CONTACTS_PAGE') throw new Error('404 not found');
      return { results: [{ id: '5', properties: { email: 'x@y.io', lifecyclestage: 'lead' } }] };
    });

    const out = await fetchHubSpotCrm('user-1', exec as any);
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('hs-contact:5');
    expect(out[0].name).toBe('x@y.io'); // pas de nom → repli sur l'email
  });

  it('lève si rien n’est exploitable', async () => {
    const exec = vi.fn(async () => { throw new Error('boom'); });
    await expect(fetchHubSpotCrm('user-1', exec as any)).rejects.toThrow(/Aucune donnée HubSpot/);
  });
});

describe('hubspotCrm — lectures séparées (outils assistant)', () => {
  it('fetchHubSpotDeals lit uniquement les deals (et lève en cas d’échec API)', async () => {
    const exec = vi.fn(async (_cuid: string, slug: string) => {
      expect(slug).toBe('HUBSPOT_HUBSPOT_LIST_DEALS');
      return { results: [{ id: '7', properties: { dealname: 'Beta Corp', amount: '900', dealstage: 'presentationscheduled', closedate: '2026-08-01' } }] };
    });

    const deals = await fetchHubSpotDeals('user-1', exec as any);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      externalId: 'hs-deal:7', name: 'Beta Corp', amount: 900, stage: 'proposal', expectedCloseDate: '2026-08-01',
    });
    expect(exec).toHaveBeenCalledTimes(1); // les contacts ne sont PAS interrogés

    const boom = vi.fn(async () => { throw new Error('403 forbidden'); });
    await expect(fetchHubSpotDeals('user-1', boom as any)).rejects.toThrow('403 forbidden');
  });

  it('fetchHubSpotContacts bascule de slug et lève si toutes les variantes échouent', async () => {
    const exec = vi.fn(async (_cuid: string, slug: string) => {
      if (slug === 'HUBSPOT_HUBSPOT_LIST_CONTACTS_PAGE') throw new Error('404 not found');
      return { results: [{ id: '3', properties: { firstname: 'Léa', email: 'lea@z.io', lifecyclestage: 'opportunity' } }] };
    });

    const people = await fetchHubSpotContacts('user-1', exec as any);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ externalId: 'hs-contact:3', name: 'Léa', stage: 'qualified', type: 'prospect' });

    const boom = vi.fn(async () => { throw new Error('500'); });
    await expect(fetchHubSpotContacts('user-1', boom as any)).rejects.toThrow();
  });
});
