import { useState, useEffect, useRef } from 'react';
import {
  getConfigStatus, setPublishMode, getTelegramLinkCode, connectToolkit,
  ConfigStatus,
} from '../api/client';

const TOOLKIT_ICONS: Record<string, string> = {
  linkedin: '💼', twitter: '🐦', instagram: '📸', facebook: '📘',
  gmail: '✉️', googlecalendar: '🗓️', reddit: '🟠',
  youtube: '▶️', discord: '🎮', slack: '💬', github: '🐙',
};

export default function ConfigPage() {
  const [status,  setStatus]  = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tgCode,  setTgCode]  = useState<string | null>(null);
  const [tgError, setTgError] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  // Connexion de comptes : lien OAuth généré + erreurs, par toolkit
  const [connectLinks,  setConnectLinks]  = useState<Record<string, string>>({});
  const [connecting,    setConnecting]    = useState<string | null>(null);
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = (fresh = false) => getConfigStatus(fresh).then((res) => {
    if (res.success && res.data) setStatus(res.data);
    setLoading(false);
    return res;
  });

  useEffect(() => {
    load();
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  /** Après ouverture du lien OAuth : rafraîchit le statut jusqu'à voir le compte connecté */
  const startPolling = (slug: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let remaining = 24; // ~2 minutes par pas de 5 s
    pollTimer.current = setInterval(async () => {
      remaining -= 1;
      const res = await load(true);
      const done = res.success &&
        Boolean(res.data?.composio.toolkits.find((t) => t.slug === slug)?.connected);
      if ((done || remaining <= 0) && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 5000);
  };

  const handleConnect = async (slug: string) => {
    setConnecting(slug);
    setConnectErrors((e) => ({ ...e, [slug]: '' }));
    const res = await connectToolkit(slug);
    setConnecting(null);
    if (res.success && res.data) {
      setConnectLinks((l) => ({ ...l, [slug]: res.data!.redirectUrl }));
      // Ouverture directe ; le lien reste affiché si le navigateur bloque la popup
      window.open(res.data.redirectUrl, '_blank', 'noopener');
      startPolling(slug);
    } else {
      setConnectErrors((e) => ({
        ...e,
        [slug]: res.error === 'COMPOSIO_NOT_CONFIGURED'
          ? 'Composio non configuré côté serveur (COMPOSIO_MCP_URL + COMPOSIO_API_KEY).'
          : res.error || 'Connexion impossible.',
      }));
    }
  };

  const handleMode = async (mode: 'auto' | 'manual') => {
    if (!status || status.publishMode === mode) return;
    setSavingMode(true);
    const res = await setPublishMode(mode);
    setSavingMode(false);
    if (res.success) setStatus({ ...status, publishMode: mode });
  };

  const handleTelegramCode = async () => {
    setTgError('');
    const res = await getTelegramLinkCode();
    if (res.success && res.data) setTgCode(res.data.code);
    else setTgError(res.error === 'TELEGRAM_NOT_CONFIGURED'
      ? 'Bot non configuré côté serveur : créez un bot via @BotFather et renseignez TELEGRAM_BOT_TOKEN dans le .env.'
      : res.error || 'Erreur');
  };

  if (loading) return <div className="loading">⏳ Chargement de la configuration…</div>;
  if (!status) return <div className="error-banner">Impossible de charger la configuration</div>;

  const connectedCount = status.composio.toolkits.filter((t) => t.connected).length;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>⚙️ Configuration</h1>
          <p>L'état de vos connexions — ce qui est fonctionnel, et où connecter le reste.</p>
        </div>
      </div>

      <div className="config-grid">
        {/* ── IA ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">🧠 Intelligence artificielle</span>
            {status.ai.configured
              ? <span className="config-badge ok">✅ Fonctionnelle</span>
              : <span className="config-badge ko">⚠️ Non configurée</span>}
          </div>
          {status.ai.configured ? (
            <p className="config-desc">
              Modèle : <strong>{status.ai.model}</strong> (OpenRouter). Alimente l'onboarding,
              les plans, la rédaction de contenu, le scoring de leads et le bot Telegram.
            </p>
          ) : (
            <p className="config-desc">
              Renseignez <code>OPENROUTER_API_KEY</code> dans le <code>.env</code> du serveur
              (clé sur openrouter.ai/keys) pour activer toute l'IA.
            </p>
          )}
        </div>

        {/* ── Pipeline de publication ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">🚦 Publication des contenus IA</span>
          </div>
          <p className="config-desc">
            Quand l'IA rédige un contenu (tâche Kanban, demande Telegram), il est :
            <span className="form-hint-inline"> — réglage propre au projet actif</span>
          </p>
          <div className="approval-mode-picker">
            <button
              type="button"
              className={`approval-mode-option${status.publishMode === 'manual' ? ' selected' : ''}`}
              onClick={() => handleMode('manual')}
              disabled={savingMode}
            >
              <span className="approval-mode-title">✋ Soumis à votre validation</span>
              <span className="approval-mode-desc">Chaque contenu attend votre relecture dans Validations (recommandé)</span>
            </button>
            <button
              type="button"
              className={`approval-mode-option${status.publishMode === 'auto' ? ' selected' : ''}`}
              onClick={() => handleMode('auto')}
              disabled={savingMode}
            >
              <span className="approval-mode-title">⚡ Publié directement</span>
              <span className="approval-mode-desc">Sans confirmation — réservé aux comptes de confiance</span>
            </button>
          </div>
        </div>

        {/* ── Composio ── */}
        <div className="card config-card config-card-wide">
          <div className="config-card-head">
            <span className="config-card-title">🔌 Connexions plateformes (Composio)</span>
            {status.composio.configured
              ? <span className="config-badge ok">✅ {connectedCount} connectée{connectedCount > 1 ? 's' : ''}</span>
              : <span className="config-badge ko">⚠️ Non configuré</span>}
            <a
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 'auto' }}
              href={status.composio.dashboardUrl}
              target="_blank" rel="noopener noreferrer"
            >
              Gérer sur Composio ↗
            </a>
          </div>
          {!status.composio.configured && (
            <p className="config-desc">
              Renseignez <code>COMPOSIO_MCP_URL</code> et <code>COMPOSIO_API_KEY</code> dans le{' '}
              <code>.env</code> du serveur, puis connectez vos comptes sur le dashboard Composio.
            </p>
          )}
          <div className="config-toolkits">
            {status.composio.toolkits.map((t) => (
              <div key={t.slug} className={`config-toolkit${t.connected ? ' on' : ''}`}>
                <span className="config-toolkit-icon">{TOOLKIT_ICONS[t.slug] ?? '🔧'}</span>
                <span className="config-toolkit-main">
                  <span className="config-toolkit-name">{t.name}</span>
                  <span className="config-toolkit-cap">{t.capability}</span>
                  {!t.connected && connectErrors[t.slug] && (
                    <span className="config-toolkit-cap" style={{ color: 'var(--color-danger, #f87171)' }}>
                      ⚠️ {connectErrors[t.slug]}
                    </span>
                  )}
                </span>
                {t.connected ? (
                  <span className="config-badge ok">Fonctionnel</span>
                ) : connectLinks[t.slug] ? (
                  <a
                    className="config-badge warn link"
                    href={connectLinks[t.slug]}
                    target="_blank" rel="noopener noreferrer"
                    title="Ouvrez ce lien et autorisez l'accès — le statut se met à jour tout seul"
                  >
                    ⏳ Autoriser ↗
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleConnect(t.slug)}
                    disabled={connecting === t.slug || !status.composio.configured}
                    title="Génère le lien d'autorisation et l'ouvre dans un nouvel onglet"
                  >
                    {connecting === t.slug ? '⏳…' : '🔗 Connecter'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="form-hint">
            Cliquez sur « Connecter », autorisez l'accès dans l'onglet qui s'ouvre, et le compte
            devient utilisable — publication, métriques, emails, agenda. Le statut se rafraîchit
            automatiquement après l'autorisation.
          </p>
        </div>

        {/* ── Telegram ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">💬 Bot Telegram</span>
            {!status.telegram.configured
              ? <span className="config-badge ko">⚠️ Non configuré</span>
              : status.telegram.linked
                ? <span className="config-badge ok">✅ Compte lié</span>
                : <span className="config-badge warn">À lier</span>}
          </div>
          <p className="config-desc">
            Pilotez tout depuis un chat : état des activités, validation des contenus,
            rédaction de posts/emails, rappels.
          </p>
          {status.telegram.configured ? (
            tgCode ? (
              <>
                <div className="telegram-code">{tgCode}</div>
                <p className="form-hint">Envoyez ce code à votre bot Telegram (valable 10 minutes).</p>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={handleTelegramCode}>
                🔗 {status.telegram.linked ? 'Lier un autre chat' : 'Générer le code de liaison'}
              </button>
            )
          ) : (
            <p className="config-desc">
              Créez un bot via <strong>@BotFather</strong> sur Telegram et renseignez{' '}
              <code>TELEGRAM_BOT_TOKEN</code> dans le <code>.env</code> du serveur.
            </p>
          )}
          {tgError && <div className="chat-error">{tgError}</div>}
        </div>
      </div>
    </div>
  );
}
