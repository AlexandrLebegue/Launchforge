import { useState, useEffect, ReactNode } from 'react';
import { Building2, Target, ShieldAlert, Newspaper, Search, RotateCw, Hourglass } from 'lucide-react';
import Loader from './Loader';
import Markdown from './Markdown';
import { getCompany, enrichCompany, CompanyDetail, Contact } from '../api/client';

const fmtEur = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')} €`;
const fmtSiren = (siren: string): string => siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

/** Encart titré du brief commercial (description, angles de vente, objections…). */
function Section({ icon, title, accent, children }: {
  icon: ReactNode;
  title: string;
  accent?: 'angles' | 'objections';
  children: ReactNode;
}) {
  return (
    <div className={`company-section${accent ? ` company-section--${accent}` : ''}`}>
      <div className="company-section-title"><span aria-hidden>{icon}</span>{title}</div>
      <div className="company-section-body">{children}</div>
    </div>
  );
}

/**
 * Fiche entreprise (compte) : logo (favicon), profil, identité légale (SIREN,
 * raison sociale, NAF, siège — registre SIRENE), brief commercial structuré
 * (description, angles de vente, objections probables — enrichissement IA),
 * agrégats de pipeline et contacts rattachés.
 * Réutilisée dans l'onglet « Entreprise » d'un contact et dans la vue Entreprises.
 */
export default function CompanyPanel({ companyId, companyName, readOnly = false, onOpenContact }: {
  companyId: string | null;
  companyName?: string | null;
  readOnly?: boolean;
  onOpenContact?: (c: Contact) => void;
}) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    getCompany(companyId).then((res) => {
      if (res.success && res.data) setCompany(res.data);
      setLoading(false);
    });
  }, [companyId]);

  const enrich = async () => {
    if (!company) return;
    setEnriching(true);
    setError('');
    const res = await enrichCompany(company.id);
    setEnriching(false);
    if (res.success && res.data) setCompany({ ...company, ...res.data });
    else setError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur.' : res.error || 'Enrichissement impossible.');
  };

  if (!companyId) {
    return (
      <div className="form-hint-inline">
        {companyName
          ? `Aucune fiche pour « ${companyName} » — renseignez l'entreprise du contact pour la créer.`
          : 'Aucune entreprise renseignée pour ce contact.'}
      </div>
    );
  }
  if (loading) return <Loader text="Chargement de la fiche entreprise…" />;
  if (!company) return <div className="chat-error">Fiche entreprise introuvable.</div>;

  const favicon = company.domain ? `https://www.google.com/s2/favicons?domain=${company.domain}&sz=64` : null;

  return (
    <div className="company-panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {favicon
          ? <img src={favicon} alt="" width={40} height={40} style={{ borderRadius: 8, flexShrink: 0 }} />
          : <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-surface)', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{company.name.slice(0, 1).toUpperCase()}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{company.name}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
            {[company.sector, company.size].filter(Boolean).join(' · ')}
            {company.domain && <> {(company.sector || company.size) ? '· ' : ''}<a href={`https://${company.domain}`} target="_blank" rel="noreferrer">{company.domain} ↗</a></>}
          </div>
        </div>
        {!readOnly && (
          <button className="btn btn-secondary btn-sm" onClick={enrich} disabled={enriching} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {enriching
              ? <><Hourglass size={14} /> Analyse…</>
              : company.intel ? <><RotateCw size={14} /> Ré-analyser</> : <><Search size={14} /> Analyser (IA)</>}
          </button>
        )}
      </div>

      {error && <div className="chat-error">{error}</div>}

      {(company.siren || company.legalName || company.naf || company.address || company.revenue) && (
        <div className="company-legal">
          {company.siren && (
            <div className="company-legal-item">
              <em>SIREN</em>
              <span>
                <a href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}`} target="_blank" rel="noreferrer" title="Fiche sur l'Annuaire des Entreprises">
                  {fmtSiren(company.siren)} ↗
                </a>
              </span>
            </div>
          )}
          {company.legalName && (
            <div className="company-legal-item"><em>Raison sociale</em><span>{company.legalName}</span></div>
          )}
          {company.naf && (
            <div className="company-legal-item"><em>Code NAF</em><span>{company.naf}</span></div>
          )}
          {company.revenue && (
            <div className="company-legal-item"><em>CA publié</em><span>{company.revenue}</span></div>
          )}
          {company.address && (
            <div className="company-legal-item"><em>Siège</em><span>{company.address}</span></div>
          )}
        </div>
      )}

      {company.description && (
        <Section icon={<Building2 size={13} />} title="Description">
          <p>{company.description}</p>
        </Section>
      )}
      {company.salesAngles && (
        <Section icon={<Target size={13} />} title="Angles de vente" accent="angles">
          <Markdown text={company.salesAngles} />
        </Section>
      )}
      {company.objections && (
        <Section icon={<ShieldAlert size={13} />} title="Objections probables" accent="objections">
          <Markdown text={company.objections} />
        </Section>
      )}
      {company.intel && (
        <Section icon={<Newspaper size={13} />} title="Activité & actualités">
          <Markdown text={company.intel} />
        </Section>
      )}
      {!company.intel && !company.description && !company.salesAngles && (
        <div className="form-hint-inline" style={{ marginTop: 10 }}>
          Pas encore d'analyse. « Analyser (IA) » récupère le SIREN (registre SIRENE) et produit un brief : description, angles de vente, objections probables.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, margin: '14px 0', flexWrap: 'wrap' }}>
        <div className="stat-card" style={{ flex: '1 1 110px' }}>
          <div className="stat-card-value">{company.contactCount}</div>
          <div className="stat-card-label">Contacts</div>
        </div>
        <div className="stat-card" style={{ flex: '1 1 110px' }}>
          <div className="stat-card-value">{fmtEur(company.openValue)}</div>
          <div className="stat-card-label">Pipeline ouvert</div>
        </div>
        <div className="stat-card" style={{ flex: '1 1 110px' }}>
          <div className="stat-card-value" style={{ color: '#34d399' }}>{fmtEur(company.wonValue)}</div>
          <div className="stat-card-label">CA gagné</div>
        </div>
      </div>

      {company.contacts.length > 0 && (
        <>
          <div className="card-header" style={{ fontSize: '0.85rem' }}>Contacts chez {company.name}</div>
          <div>
            {company.contacts.map((c) => (
              <div
                key={c.id}
                onClick={() => onOpenContact?.(c)}
                style={{ cursor: onOpenContact ? 'pointer' : 'default', padding: '7px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 8, alignItems: 'baseline' }}
              >
                <strong style={{ fontSize: '0.88rem' }}>{c.name}</strong>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                  {c.type}{c.amount != null ? ` · ${fmtEur(c.amount)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
