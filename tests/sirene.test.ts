import { describe, it, expect, vi } from 'vitest';
import { lookupCompanyLegal, pickBestLegalMatch, normalizeCompanyName, formatSiren, latestRevenue } from '../src/services/sirene';

/** Fabrique un faux fetch qui renvoie (status, body) et capture la requête. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: any, _init?: any) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as any;
}

describe('sirene — normalizeCompanyName', () => {
  it('neutralise casse, accents, ponctuation et forme juridique', () => {
    expect(normalizeCompanyName('Boulangerie Épi & Grain SARL')).toBe('boulangerie epi grain');
    expect(normalizeCompanyName('ACME SAS')).toBe('acme');
    expect(normalizeCompanyName('acme')).toBe('acme');
  });
});

describe('sirene — pickBestLegalMatch', () => {
  const results = [
    { siren: '111111111', nom_complet: 'ACME CONSULTING', nom_raison_sociale: 'ACME CONSULTING' },
    { siren: '222222222', nom_complet: 'ACME', nom_raison_sociale: 'ACME SAS' },
    { siren: '333333333', nom_complet: 'TOTALEMENT AUTRE CHOSE', nom_raison_sociale: 'TAC' },
  ];

  it('préfère la correspondance exacte au simple préfixe', () => {
    expect(pickBestLegalMatch('Acme', results)?.siren).toBe('222222222');
    expect(pickBestLegalMatch('acme consulting', results)?.siren).toBe('111111111');
  });

  it("renvoie null quand rien n'est assez proche (jamais de SIREN d'une autre entreprise)", () => {
    expect(pickBestLegalMatch('Zenith Robotics', results)).toBeNull();
    expect(pickBestLegalMatch('Acme', [])).toBeNull();
  });

  it('ignore les résultats sans SIREN valide (9 chiffres)', () => {
    expect(pickBestLegalMatch('Acme', [{ siren: '12345', nom_complet: 'ACME' }])).toBeNull();
  });

  it('une requête SIREN (9 chiffres) matche par identifiant, pas par nom', () => {
    expect(pickBestLegalMatch('222222222', results)?.nom_complet).toBe('ACME');
    expect(pickBestLegalMatch('999999999', results)).toBeNull();
  });
});

describe('sirene — latestRevenue', () => {
  it('prend le CA du dernier exercice publié, formaté à la française', () => {
    expect(latestRevenue({
      '2023': { ca: 950_000, resultat_net: 10_000 },
      '2024': { ca: 311_448_000, resultat_net: -127_499_000 },
    })).toBe('311,4 M€ (2024)');
    expect(latestRevenue({ '2023': { ca: 850_000 } })).toBe('850 k€ (2023)');
    expect(latestRevenue({ '2024': { ca: 2_100_000_000 } })).toBe('2,1 Md€ (2024)');
  });

  it('retombe sur un exercice antérieur si le dernier n\'a pas de CA, null sinon', () => {
    expect(latestRevenue({
      '2023': { ca: 500_000 },
      '2024': { ca: null },
    })).toBe('500 k€ (2023)');
    expect(latestRevenue(undefined)).toBeNull();
    expect(latestRevenue({})).toBeNull();
    expect(latestRevenue({ '2024': { resultat_net: -5000 } })).toBeNull();
  });
});

describe('sirene — lookupCompanyLegal', () => {
  const apiResult = {
    results: [{
      siren: '356000000',
      nom_complet: 'LA POSTE',
      nom_raison_sociale: 'LA POSTE',
      activite_principale: '53.10Z',
      siege: { adresse: '9 RUE DU COLONEL PIERRE AVIA 75015 PARIS' },
      finances: { '2024': { ca: 34_100_000_000, resultat_net: 1_000_000 } },
    }],
  };

  it("extrait SIREN, raison sociale, NAF, adresse du siège et CA publié", async () => {
    const fetchFn = fakeFetch(200, apiResult);
    const out = await lookupCompanyLegal('La Poste', fetchFn);
    expect(out).toEqual({
      siren: '356000000',
      legalName: 'LA POSTE',
      naf: '53.10Z',
      address: '9 RUE DU COLONEL PIERRE AVIA 75015 PARIS',
      revenue: '34,1 Md€ (2024)',
    });
    expect(String(fetchFn.mock.calls[0][0])).toContain('recherche-entreprises.api.gouv.fr/search?q=La%20Poste');
  });

  it("renvoie null sans lever quand l'API échoue ou ne trouve rien", async () => {
    await expect(lookupCompanyLegal('La Poste', fakeFetch(500, {}))).resolves.toBeNull();
    await expect(lookupCompanyLegal('La Poste', fakeFetch(200, { results: [] }))).resolves.toBeNull();
    const throwing = vi.fn(async () => { throw new Error('réseau HS'); }) as any;
    await expect(lookupCompanyLegal('La Poste', throwing)).resolves.toBeNull();
  });

  it('ne cherche pas les noms trop courts (bruit garanti)', async () => {
    const fetchFn = fakeFetch(200, apiResult);
    await expect(lookupCompanyLegal('A', fetchFn)).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('sirene — formatSiren', () => {
  it('groupe le SIREN par 3 chiffres', () => {
    expect(formatSiren('356000000')).toBe('356 000 000');
  });
});
