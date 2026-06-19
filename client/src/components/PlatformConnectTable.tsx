import { useState, useEffect, useRef, Fragment } from 'react';
import {
  Briefcase, MessageCircle, Camera, Users, Mail, CalendarDays,
  MessagesSquare, Play, Gamepad2, Hash, GitBranch, Plug, CheckCircle2, ExternalLink, Music2,
} from 'lucide-react';
import {
  getConfigStatus, connectToolkit, disconnectToolkit, recordActivePlatforms,
  ConfigStatus, ConfigToolkit, OwnAppField,
} from '../api/client';

/**
 * Tableau réutilisable de connexion des comptes (Composio) : une ligne par
 * plateforme avec un bouton « Connecter » / « Déconnecter », la gestion du flux
 * OAuth (popup + polling) et le formulaire « app développeur » (NEEDS_OWN_APP).
 * Utilisé par la Configuration et par l'étape de configuration de l'onboarding.
 */

const TOOLKIT_ICONS: Record<string, React.ReactNode> = {
  linkedin: <Briefcase size={18} />, twitter: <MessageCircle size={18} />, instagram: <Camera size={18} />,
  facebook: <Users size={18} />, gmail: <Mail size={18} />, googlecalendar: <CalendarDays size={18} />,
  reddit: <MessagesSquare size={18} />, youtube: <Play size={18} />, discord: <Gamepad2 size={18} />,
  slack: <Hash size={18} />, github: <GitBranch size={18} />, tiktok: <Music2 size={18} />,
};

const OWN_APP_FIELD_LABELS: Record<string, string> = {
  client_id: 'Client ID',
  client_secret: 'Client Secret',
  generic_id: 'Bearer Token',
  scopes: 'Scopes',
};

export default function PlatformConnectTable({
  only,
  onChange,
  recordOnConnect = true,
}: {
  /** Restreindre aux slugs indiqués (défaut : toutes les plateformes proposées) */
  only?: string[];
  /** Appelé avec la liste des slugs connectés à chaque changement */
  onChange?: (connected: string[]) => void;
  /** Écrire les plateformes connectées dans la base de connaissances du projet
   *  actif à chaque (dé)connexion. À désactiver quand aucun projet n'existe
   *  encore (onboarding) — la consignation se fera après la création du plan. */
  recordOnConnect?: boolean;
}) {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectLinks, setConnectLinks] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ownApp, setOwnApp] = useState<Record<string, { fields: OwnAppField[]; callbackUrl: string }>>({});
  const [ownAppValues, setOwnAppValues] = useState<Record<string, Record<string, string>>>({});
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const emitChange = (s: ConfigStatus | null) => {
    if (s && onChange) onChange(s.composio.toolkits.filter((t) => t.connected).map((t) => t.slug));
  };

  const load = (fresh = false) => getConfigStatus(fresh).then((res) => {
    if (res.success && res.data) { setStatus(res.data); emitChange(res.data); }
    setLoading(false);
    return res;
  });

  useEffect(() => {
    load();
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = (slug: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let remaining = 24; // ~2 minutes par pas de 5 s
    pollTimer.current = setInterval(async () => {
      remaining -= 1;
      const res = await load(true);
      const done = res.success && Boolean(res.data?.composio.toolkits.find((t) => t.slug === slug)?.connected);
      if ((done || remaining <= 0) && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
        if (done) {
          // Compte fraîchement connecté → on met à jour la base de connaissances
          if (recordOnConnect) recordActivePlatforms().catch(() => { /* best-effort */ });
        } else {
          // OAuth non finalisé (timeout) : le lien d'autorisation est à usage
          // unique et peut être périmé — on l'efface pour réafficher « Connecter ».
          setConnectLinks((l) => { const { [slug]: _g, ...rest } = l; return rest; });
        }
      }
    }, 5000);
  };

  const handleConnect = async (slug: string) => {
    setConnecting(slug);
    setErrors((e) => ({ ...e, [slug]: '' }));
    const values = ownAppValues[slug];
    const creds = ownApp[slug] && values && Object.values(values).some((v) => v.trim()) ? values : undefined;
    const res = await connectToolkit(slug, creds);
    setConnecting(null);
    if (res.success && res.data) {
      setOwnApp((o) => { const { [slug]: _g, ...rest } = o; return rest; });
      setOwnAppValues((o) => { const { [slug]: _g, ...rest } = o; return rest; });
      setConnectLinks((l) => ({ ...l, [slug]: res.data!.redirectUrl }));
      window.open(res.data.redirectUrl, '_blank', 'noopener');
      startPolling(slug);
    } else if (res.code === 'NEEDS_OWN_APP' && Array.isArray(res.fields) && res.fields.length > 0) {
      setOwnApp((o) => ({ ...o, [slug]: { fields: res.fields!, callbackUrl: res.callbackUrl ?? '' } }));
    } else {
      setErrors((e) => ({
        ...e,
        [slug]: res.error === 'COMPOSIO_NOT_CONFIGURED'
          ? 'Composio non configuré côté serveur.'
          : res.error || 'Connexion impossible.',
      }));
    }
  };

  const handleDisconnect = async (slug: string, name: string) => {
    if (!window.confirm(`Déconnecter ${name} ?`)) return;
    setDisconnecting(slug);
    setErrors((e) => ({ ...e, [slug]: '' }));
    const res = await disconnectToolkit(slug);
    setDisconnecting(null);
    if (res.success) {
      setConnectLinks((l) => { const { [slug]: _g, ...rest } = l; return rest; });
      await load(true);
      if (recordOnConnect) recordActivePlatforms().catch(() => { /* best-effort */ });
    } else {
      setErrors((e) => ({ ...e, [slug]: res.error || 'Déconnexion impossible.' }));
    }
  };

  if (loading) return <div className="loading">⏳ Chargement des plateformes…</div>;
  if (!status) return <div className="error-banner">Impossible de charger les plateformes.</div>;
  if (!status.composio.configured) {
    return <div className="form-hint-inline">La connexion de comptes nécessite Composio (non configuré côté serveur pour l'instant).</div>;
  }
  if (status.composio.canManage === false) {
    return <div className="form-hint-inline">Les comptes de ce projet sont gérés par {status.composio.ownerName || 'son propriétaire'}.</div>;
  }

  const toolkits: ConfigToolkit[] = only
    ? status.composio.toolkits.filter((t) => only.includes(t.slug))
    : status.composio.toolkits;

  return (
    <div className="platform-connect-table" data-tour="onboarding-platforms">
      <table className="data-table platform-table">
        <thead>
          <tr><th>Plateforme</th><th>Ce que ça débloque</th><th style={{ textAlign: 'right' }}>Connexion</th></tr>
        </thead>
        <tbody>
          {toolkits.map((t) => (
            <Fragment key={t.slug}>
              <tr>
                <td data-label="Plateforme">
                  <span className="platform-cell">
                    <span className="platform-cell-icon">{TOOLKIT_ICONS[t.slug] ?? <Plug size={18} />}</span>
                    <strong>{t.name}</strong>
                  </span>
                </td>
                <td data-label="Capacité" style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{t.capability}</td>
                <td data-label="Connexion" style={{ textAlign: 'right' }}>
                  {t.connected ? (
                    <span className="platform-actions">
                      <span className="badge-connected"><CheckCircle2 size={14} /> Connecté</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDisconnect(t.slug, t.name)}
                        disabled={disconnecting === t.slug}
                      >
                        {disconnecting === t.slug ? '…' : 'Déconnecter'}
                      </button>
                    </span>
                  ) : connectLinks[t.slug] ? (
                    <a className="btn btn-secondary btn-sm" href={connectLinks[t.slug]} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} /> Autoriser
                    </a>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleConnect(t.slug)}
                      disabled={connecting === t.slug}
                    >
                      {connecting === t.slug ? '⏳…' : 'Connecter'}
                    </button>
                  )}
                </td>
              </tr>

              {ownApp[t.slug] && (
                <tr>
                  <td colSpan={3}>
                    <div className="own-app-form">
                      <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                        {t.name} requiert votre propre app développeur. Renseignez vos identifiants
                        {ownApp[t.slug].callbackUrl && <> (URL de redirection à déclarer : <code>{ownApp[t.slug].callbackUrl}</code>)</>}.
                      </p>
                      {ownApp[t.slug].fields.map((f) => (
                        <label key={f.name} className="form-label-block">
                          {OWN_APP_FIELD_LABELS[f.name] ?? f.name}
                          <input
                            className="form-input"
                            type="text"
                            value={ownAppValues[t.slug]?.[f.name] ?? ''}
                            placeholder={f.description}
                            onChange={(e) => setOwnAppValues((o) => ({ ...o, [t.slug]: { ...o[t.slug], [f.name]: e.target.value } }))}
                          />
                        </label>
                      ))}
                      <button className="btn btn-primary btn-sm" onClick={() => handleConnect(t.slug)} disabled={connecting === t.slug}>
                        {connecting === t.slug ? '⏳…' : 'Enregistrer et connecter'}
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {errors[t.slug] && (
                <tr><td colSpan={3}><div className="chat-error" style={{ margin: 0 }}>{errors[t.slug]}</div></td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
