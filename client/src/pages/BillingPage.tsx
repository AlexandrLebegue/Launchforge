import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Flame, Check, Zap, CreditCard, Loader2, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  getBillingStatus, startCheckout, openBillingPortal, requestRefund,
  BillingStatus, invalidateOverview,
} from '../api/client';

// Palette « braise » (cohérente avec la landing)
const EMBER = '#ff6b35';
const EMBER_SOFT = 'rgba(255, 107, 53, 0.12)';

/** Liste de bénéfices d'une offre */
function FeatureList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'grid', gap: 10 }}>
      {items.map((it) => (
        <li key={it} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45 }}>
          <Check size={16} style={{ color: EMBER, flexShrink: 0, marginTop: 2 }} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Barre d'usage used/limit (Braise) */
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const unlimited = limit === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const danger = !unlimited && used >= limit;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
        <span style={{ opacity: 0.85 }}>{label}</span>
        <span style={{ fontWeight: 600, color: danger ? '#e8590c' : 'inherit' }}>
          {used}{unlimited ? '' : ` / ${limit}`}{unlimited && <span style={{ opacity: 0.7, fontWeight: 400 }}> · illimité</span>}
        </span>
      </div>
      {!unlimited && (
        <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: danger ? '#e8590c' : EMBER, transition: 'width .3s' }} />
        </div>
      )}
    </div>
  );
}

const BRAISE_FEATURES = [
  '1 projet',
  '30 générations de contenu IA / mois',
  '2 images IA / mois',
  'Plan de lancement IA, rédaction manuelle & calendrier',
  'Assistant IA (dans la limite des 30 générations)',
  'Export & suppression RGPD en libre-service',
];

const BRAISE_LOCKED = 'Publication · analytics · détection de leads · séries récurrentes · Telegram';

const BRASIER_FEATURES = [
  'Projets illimités',
  'Publication multi-plateformes & auto-publication',
  'Analytics complets + post-mortem IA',
  'Détection de leads & CRM',
  'Séries récurrentes & pilotage Telegram',
  '1000 générations + 50 images IA / mois (usage équitable)',
  'Support prioritaire',
];

/** Formate un montant € à la française (12,90 €) */
const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<'year' | 'month'>('year');
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'refund' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    const res = await getBillingStatus();
    if (res.success && res.data) setStatus(res.data);
    else setError(res.error || 'Chargement impossible');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Retour de Stripe Checkout (?checkout=success|cancel)
  useEffect(() => {
    const c = params.get('checkout');
    if (!c) return;
    if (c === 'success') {
      setNotice({ kind: 'ok', text: '🎉 Bienvenue dans Brasier ! Votre abonnement est en cours d\'activation. Profitez de tout, sans limites.' });
      invalidateOverview();
      // Le webhook Stripe est asynchrone : on rafraîchit le statut (immédiat puis
      // après un court délai, le temps que le webhook enregistre l'abonnement).
      load();
      window.setTimeout(load, 2500);
    } else if (c === 'cancel') {
      setNotice({ kind: 'err', text: 'Paiement annulé — vous pouvez réessayer quand vous voulez.' });
    }
    params.delete('checkout');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const goCheckout = async () => {
    setBusy('checkout');
    const res = await startCheckout(interval);
    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    setBusy(null);
    setNotice({ kind: 'err', text: res.error === 'BILLING_NOT_CONFIGURED'
      ? 'Le paiement n\'est pas encore activé sur cette instance.'
      : (res.error || 'Paiement indisponible.') });
  };

  const goPortal = async () => {
    setBusy('portal');
    const res = await openBillingPortal();
    if (res.success && res.data?.url) { window.location.href = res.data.url; return; }
    setBusy(null);
    setNotice({ kind: 'err', text: res.error || 'Portail indisponible.' });
  };

  const goRefund = async () => {
    if (!window.confirm('Demander le remboursement de votre dernier paiement et résilier Brasier ?')) return;
    setBusy('refund');
    const res = await requestRefund();
    setBusy(null);
    if (res.success && res.data?.refunded) {
      setNotice({ kind: 'ok', text: `Remboursement effectué${res.data.amount ? ` (${res.data.amount} ${res.data.currency})` : ''}. Votre compte est repassé sur Braise.` });
      load();
    } else {
      setNotice({ kind: 'err', text: res.error || 'Remboursement impossible.' });
    }
  };

  if (loading) {
    return <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.7 }}><Loader2 className="spin" size={18} /> Chargement…</div>;
  }
  if (error || !status) {
    return <div style={{ padding: 40, color: '#e8590c' }}>{error || 'Erreur'}</div>;
  }

  const isBrasier = status.tier === 'brasier';
  const paidActive = status.status === 'active' || status.status === 'past_due';
  const priceLine = interval === 'year'
    ? `${euro(status.pricing.annualMonthly)}/mois`
    : `${euro(status.pricing.monthly)}/mois`;
  const subPriceNote = interval === 'year'
    ? `facturé ${euro(status.pricing.annualTotal)}/an`
    : 'facturé chaque mois';

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 26, marginBottom: 6 }}>
        <Flame size={24} style={{ color: EMBER }} /> Abonnement
      </h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Votre offre, votre essai et votre consommation du mois.</p>

      {notice && (
        <div style={{
          margin: '14px 0', padding: '12px 14px', borderRadius: 10, fontSize: 14,
          background: notice.kind === 'ok' ? 'rgba(46, 160, 67, 0.12)' : 'rgba(232, 89, 12, 0.12)',
          border: `1px solid ${notice.kind === 'ok' ? 'rgba(46,160,67,0.4)' : 'rgba(232,89,12,0.4)'}`,
        }}>{notice.text}</div>
      )}

      {/* ── Statut courant ── */}
      <div style={{ background: EMBER_SOFT, border: `1px solid ${EMBER}`, borderRadius: 14, padding: 18, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            Offre actuelle : {isBrasier ? 'Brasier 🔥' : 'Braise'}
          </span>
          {status.trial.active && (
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 99, background: EMBER, color: '#fff', fontWeight: 600 }}>
              Essai · {status.trial.daysLeft} jour{status.trial.daysLeft > 1 ? 's' : ''} d'accès complet
            </span>
          )}
          {status.founder && (
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 99, background: 'rgba(255,255,255,0.12)' }}>Compte fondateur</span>
          )}
        </div>
        {status.trial.active && (
          <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.85 }}>
            Vous profitez de <strong>Brasier en accès complet</strong> pendant votre essai. À la fin, votre compte
            repasse automatiquement sur Braise (gratuit) — rien ne se bloque, vous gardez tout votre travail.
          </p>
        )}
        {paidActive && (
          <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.85 }}>
            {status.subscription.cancelAt
              ? <>Abonnement résilié — accès Brasier maintenu jusqu'au <strong>{new Date(status.subscription.cancelAt).toLocaleDateString('fr-FR')}</strong>.</>
              : <>Abonnement actif{status.subscription.currentPeriodEnd ? <> — prochain renouvellement le <strong>{new Date(status.subscription.currentPeriodEnd).toLocaleDateString('fr-FR')}</strong></> : ''}.</>}
          </p>
        )}
        {!status.enforcement && (
          <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.7 }}>
            <AlertCircle size={13} style={{ verticalAlign: -2 }} /> Limites désactivées sur cette instance (lancement souple).
          </p>
        )}
      </div>

      {/* ── Usage du mois ── */}
      <div style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Consommation du mois</h2>
        <UsageBar label="Générations de contenu IA" used={status.usage.aiGenerations.used} limit={status.usage.aiGenerations.limit} />
        <UsageBar label="Images IA" used={status.usage.aiImages.used} limit={status.usage.aiImages.limit} />
        <UsageBar label="Projets" used={status.usage.projects.used} limit={status.usage.projects.limit} />
        <p style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
          Les compteurs mensuels se réinitialisent le 1<sup>er</sup> de chaque mois (UTC).
        </p>
      </div>

      {/* ── Les deux offres ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 26 }}>
        {/* Braise */}
        <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 22, opacity: isBrasier ? 0.7 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} style={{ opacity: 0.7 }} />
            <h3 style={{ margin: 0, fontSize: 19 }}>Braise</h3>
            {!isBrasier && <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>Offre actuelle</span>}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 12 }}>Gratuit</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>pour toujours</div>
          <FeatureList items={BRAISE_FEATURES} />
          <p style={{ fontSize: 12, opacity: 0.55, marginTop: 14, lineHeight: 1.4 }}>
            Non inclus : {BRAISE_LOCKED} — réservés à Brasier.
          </p>
        </div>

        {/* Brasier */}
        <div style={{ border: `2px solid ${EMBER}`, borderRadius: 14, padding: 22, position: 'relative', boxShadow: `0 0 0 4px ${EMBER_SOFT}` }}>
          <span style={{ position: 'absolute', top: -11, right: 16, background: EMBER, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
            RECOMMANDÉ
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Flame size={18} style={{ color: EMBER }} />
            <h3 style={{ margin: 0, fontSize: 19 }}>Brasier</h3>
          </div>

          {/* Bascule mensuel / annuel */}
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.07)', borderRadius: 99, padding: 3, marginTop: 12, fontSize: 13 }}>
            <button onClick={() => setInterval('year')} style={{
              border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 99,
              background: interval === 'year' ? EMBER : 'transparent', color: interval === 'year' ? '#fff' : 'inherit', fontWeight: 600,
            }}>Annuel −19%</button>
            <button onClick={() => setInterval('month')} style={{
              border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 99,
              background: interval === 'month' ? EMBER : 'transparent', color: interval === 'month' ? '#fff' : 'inherit', fontWeight: 600,
            }}>Mensuel</button>
          </div>

          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 12 }}>{priceLine}</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{subPriceNote}</div>
          <FeatureList items={BRASIER_FEATURES} />

          <div style={{ marginTop: 18 }}>
            {isBrasier && paidActive ? (
              <>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={goPortal} disabled={busy !== null}>
                  {busy === 'portal' ? <Loader2 className="spin" size={15} /> : <CreditCard size={15} />} Gérer mon abonnement
                </button>
                {status.refundEligible && (
                  <button onClick={goRefund} disabled={busy !== null} style={{ width: '100%', marginTop: 8, background: 'none', border: 0, color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
                    {busy === 'refund' ? 'Traitement…' : `Demander un remboursement (garantie ${status.refundDays} j)`}
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={goCheckout}
                  disabled={busy !== null || (!status.billingConfigured)}>
                  {busy === 'checkout' ? <Loader2 className="spin" size={15} /> : <Zap size={15} />}
                  {status.billingConfigured ? ' Passer à Brasier' : ' Paiement bientôt disponible'}
                </button>
                <p style={{ fontSize: 12, opacity: 0.65, textAlign: 'center', marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                  <ShieldCheck size={13} /> {status.trialDays} j d'essai complet · garantie {status.refundDays} j satisfait ou remboursé
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
