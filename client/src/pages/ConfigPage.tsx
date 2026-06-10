import { useState, useEffect } from 'react';
import {
  getConfigStatus, setPublishMode, getTelegramLinkCode,
  ConfigStatus,
} from '../api/client';

const TOOLKIT_ICONS: Record<string, string> = {
  linkedin: '💼', twitter: '🐦', instagram: '📸', facebook: '📘',
  gmail: '✉️', googlecalendar: '🗓️', reddit: '🟠',
};

export default function ConfigPage() {
  const [status,  setStatus]  = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tgCode,  setTgCode]  = useState<string | null>(null);
  const [tgError, setTgError] = useState('');
  const [savingMode, setSavingMode] = useState(false);

  const load = () => getConfigStatus().then((res) => {
    if (res.success && res.data) setStatus(res.data);
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

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
                </span>
                {t.connected
                  ? <span className="config-badge ok">Fonctionnel</span>
                  : (
                    <a
                      className="config-badge ko link"
                      href={status.composio.dashboardUrl}
                      target="_blank" rel="noopener noreferrer"
                      title="Connecter ce compte sur Composio"
                    >
                      Non configuré ↗
                    </a>
                  )}
              </div>
            ))}
          </div>
          <p className="form-hint">
            Connectez un compte sur dashboard.composio.dev (même user_id que votre serveur MCP),
            il devient immédiatement utilisable — publication, métriques, emails, agenda.
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
