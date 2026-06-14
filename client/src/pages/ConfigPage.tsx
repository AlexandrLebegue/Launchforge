import { useState, useEffect, useRef } from 'react';
import {
  Briefcase, MessageCircle, Camera, Users, Mail, CalendarDays,
  MessagesSquare, Play, Gamepad2, Hash, GitBranch, Plug, Bot,
} from 'lucide-react';
import {
  getConfigStatus, setPublishMode, getTelegramLinkCode, connectToolkit, disconnectToolkit,
  exportMyData, deleteAccount, setToken,
  setTelegramBot, removeTelegramBot, setMetricsSyncInterval,
  setMarpTheme, customizeMarpTheme, themePreviewUrl,
  ConfigStatus,
} from '../api/client';

const SYNC_INTERVALS = [
  { value: 0,    label: 'Désactivée' },
  { value: 60,   label: 'Toutes les heures' },
  { value: 360,  label: 'Toutes les 6 h' },
  { value: 720,  label: 'Toutes les 12 h' },
  { value: 1440, label: 'Une fois par jour' },
];

const TOOLKIT_ICONS: Record<string, React.ReactNode> = {
  linkedin: <Briefcase size={18} />, twitter: <MessageCircle size={18} />, instagram: <Camera size={18} />,
  facebook: <Users size={18} />, gmail: <Mail size={18} />, googlecalendar: <CalendarDays size={18} />,
  reddit: <MessagesSquare size={18} />, youtube: <Play size={18} />, discord: <Gamepad2 size={18} />,
  slack: <Hash size={18} />, github: <GitBranch size={18} />,
};

export default function ConfigPage() {
  const [status,  setStatus]  = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tgCode,  setTgCode]  = useState<string | null>(null);
  const [tgError, setTgError] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  // Thème des présentations
  const [themeBusy,    setThemeBusy]    = useState(false);
  const [themePrompt,  setThemePrompt]  = useState('');
  const [themeError,   setThemeError]   = useState('');
  // Bot Telegram personnel
  const [botToken,  setBotToken]  = useState('');
  const [botSaving, setBotSaving] = useState(false);
  const [botError,  setBotError]  = useState('');
  // RGPD : export des données + suppression du compte
  const [exporting,    setExporting]    = useState(false);
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [deletePwd,    setDeletePwd]    = useState('');
  const [deleting,     setDeleting]     = useState(false);
  const [deleteError,  setDeleteError]  = useState('');

  const handleExport = async () => {
    setExporting(true);
    const blob = await exportMyData();
    setExporting(false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'launchforge-mes-donnees.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (!deletePwd) { setDeleteError('Saisissez votre mot de passe.'); return; }
    if (!window.confirm('Suppression DÉFINITIVE : compte, projets, posts, contacts, connaissances, médias et connexions. Aucune récupération possible. Continuer ?')) return;
    setDeleting(true);
    setDeleteError('');
    const res = await deleteAccount(deletePwd);
    setDeleting(false);
    if (res.success) {
      setToken(null);
      window.location.href = '/';
    } else {
      setDeleteError(res.error || 'Suppression impossible.');
    }
  };

  // Connexion de comptes : lien OAuth généré + erreurs, par toolkit
  const [connectLinks,  setConnectLinks]  = useState<Record<string, string>>({});
  const [connecting,    setConnecting]    = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
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

  /** Déconnexion d'un compte — utile pour re-autoriser avec de nouveaux droits OAuth */
  const handleDisconnect = async (slug: string, name: string) => {
    if (!window.confirm(`Déconnecter ${name} ? Les publications et synchros via ce compte cesseront jusqu'à reconnexion.`)) return;
    setDisconnecting(slug);
    setConnectErrors((e) => ({ ...e, [slug]: '' }));
    const res = await disconnectToolkit(slug);
    setDisconnecting(null);
    if (res.success) {
      // Le lien OAuth précédent n'est plus valable pour une reconnexion propre
      setConnectLinks((l) => { const { [slug]: _gone, ...rest } = l; return rest; });
      load(true);
    } else {
      setConnectErrors((e) => ({ ...e, [slug]: res.error || 'Déconnexion impossible.' }));
    }
  };

  const handleMode = async (mode: 'auto' | 'manual') => {
    if (!status || status.publishMode === mode) return;
    setSavingMode(true);
    const res = await setPublishMode(mode);
    setSavingMode(false);
    if (res.success) setStatus({ ...status, publishMode: mode });
  };

  const handleSyncInterval = async (minutes: number) => {
    if (!status) return;
    setSavingSync(true);
    const res = await setMetricsSyncInterval(minutes);
    setSavingSync(false);
    if (res.success && res.data) {
      setStatus({ ...status, metricsSync: { intervalMinutes: res.data.intervalMinutes } });
    }
  };

  const handleTheme = async (theme: string) => {
    if (!status) return;
    setThemeBusy(true);
    setThemeError('');
    const res = await setMarpTheme(theme);
    setThemeBusy(false);
    if (res.success) setStatus({ ...status, marp: { ...status.marp, theme } });
    else setThemeError(res.error || 'Changement de thème impossible.');
  };

  const handleCustomizeTheme = async () => {
    if (!status || !themePrompt.trim()) return;
    setThemeBusy(true);
    setThemeError('');
    const res = await customizeMarpTheme(themePrompt.trim());
    setThemeBusy(false);
    if (res.success) {
      setStatus({ ...status, marp: { ...status.marp, theme: 'custom', hasCustomCss: true } });
      setThemePrompt('');
      window.open(themePreviewUrl(), '_blank', 'noopener');
    } else {
      setThemeError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Génération du thème échouée.');
    }
  };

  const handleSaveBot = async () => {
    setBotError('');
    setBotSaving(true);
    const res = await setTelegramBot(botToken.trim());
    setBotSaving(false);
    if (res.success && res.data) {
      setBotToken('');
      setStatus((s) => s ? { ...s, telegram: { ...s.telegram, configured: true, ownBot: true, botUsername: res.data!.botUsername } } : s);
    } else {
      setBotError(res.error || 'Token refusé.');
    }
  };

  const handleRemoveBot = async () => {
    setBotError('');
    setBotSaving(true);
    const res = await removeTelegramBot();
    setBotSaving(false);
    if (res.success) {
      // Le statut « configuré » peut rester vrai si un bot global existe — recharge
      load(true);
    } else {
      setBotError(res.error || 'Suppression impossible.');
    }
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
          <h1>Configuration</h1>
          <p>L'état de vos connexions — ce qui est fonctionnel, et où connecter le reste.</p>
        </div>
      </div>

      <div className="config-grid">
        {/* ── IA ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">Intelligence artificielle</span>
            {status.ai.configured
              ? <span className="config-badge ok">Fonctionnelle</span>
              : <span className="config-badge ko">Non configurée</span>}
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
        <div className="card config-card" data-tour="cfg-publish">
          <div className="config-card-head">
            <span className="config-card-title">Publication des contenus IA</span>
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
              <span className="approval-mode-title">Soumis à votre validation</span>
              <span className="approval-mode-desc">Chaque contenu attend votre relecture dans Validations (recommandé)</span>
            </button>
            <button
              type="button"
              className={`approval-mode-option${status.publishMode === 'auto' ? ' selected' : ''}`}
              onClick={() => handleMode('auto')}
              disabled={savingMode}
            >
              <span className="approval-mode-title">Publié directement</span>
              <span className="approval-mode-desc">Sans confirmation — réservé aux comptes de confiance</span>
            </button>
          </div>
        </div>

        {/* ── Synchro automatique des métriques ── */}
        <div className="card config-card" data-tour="cfg-metrics">
          <div className="config-card-head">
            <span className="config-card-title">Synchro des métriques</span>
            {status.metricsSync.intervalMinutes > 0
              ? <span className="config-badge ok">Active</span>
              : <span className="config-badge warn">Désactivée</span>}
          </div>
          <p className="config-desc">
            Le serveur relit automatiquement les métriques réelles (vues, likes,
            commentaires, partages) de vos posts publiés des 30 derniers jours,
            via vos comptes Composio. L'URL du post est enregistrée automatiquement
            quand la publication passe par l'app — à saisir uniquement pour les
            posts publiés à la main.
          </p>
          <label className="form-label-block">
            Fréquence
            <select
              className="form-input"
              value={status.metricsSync.intervalMinutes}
              onChange={(e) => handleSyncInterval(Number(e.target.value))}
              disabled={savingSync}
            >
              {SYNC_INTERVALS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="form-hint-inline">
              Chaque synchro consomme un appel IA — une fréquence quotidienne suffit
              dans la plupart des cas. Vous pouvez aussi demander une synchro ponctuelle
              à l'assistant : « combien de likes sur mon dernier post ? ».
            </span>
          </label>
        </div>

        {/* ── Thème des présentations (Marp) ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">Thème des présentations</span>
            <a
              className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
              href={themePreviewUrl()} target="_blank" rel="noopener noreferrer"
            >
              Aperçu
            </a>
          </div>
          <p className="config-desc">
            Habille les decks générés par l'IA (onglet Slides du Hub) : pitch decks,
            carrousels LinkedIn, slides produit.
          </p>
          <label className="form-label-block">
            Thème
            <select
              className="form-input"
              value={status.marp.theme}
              onChange={(e) => handleTheme(e.target.value)}
              disabled={themeBusy}
            >
              {status.marp.themes
                .filter((t) => t.value !== 'custom' || status.marp.hasCustomCss)
                .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="form-label-block" style={{ marginTop: 8 }}>
            Créer mon thème avec l'IA
            <div className="ai-assist-row">
              <input
                className="form-input"
                value={themePrompt}
                onChange={(e) => setThemePrompt(e.target.value)}
                placeholder="ex. « fond crème, accents vert forêt, typo élégante, très épuré »"
                disabled={themeBusy}
              />
              <button type="button" className="btn btn-primary" onClick={handleCustomizeTheme} disabled={themeBusy || !themePrompt.trim()}>
                {themeBusy ? '⏳…' : 'Générer'}
              </button>
            </div>
            <span className="form-hint-inline">
              L'IA fabrique la feuille de style (validée puis appliquée) et ouvre l'aperçu. Recommencez jusqu'à satisfaction.
            </span>
          </label>
          {themeError && <div className="chat-error">{themeError}</div>}
        </div>

        {/* ── Composio ── */}
        <div className="card config-card config-card-wide" data-tour="cfg-accounts">
          <div className="config-card-head">
            <span className="config-card-title">Connexions plateformes (Composio)</span>
            {status.composio.configured
              ? <span className="config-badge ok">{connectedCount} connectée{connectedCount > 1 ? 's' : ''}</span>
              : <span className="config-badge ko">Non configuré</span>}
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
          {status.composio.canManage === false && (
            <div className="config-desc" style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
              👁️ Projet d'équipe : les comptes utilisés pour publier sont ceux de <strong>{status.composio.ownerName || 'son propriétaire'}</strong> — vous les voyez en lecture seule.
            </div>
          )}
          <div className="config-toolkits">
            {status.composio.toolkits.map((t) => (
              <div key={t.slug} className={`config-toolkit${t.connected ? ' on' : ''}`}>
                <span className="config-toolkit-icon">{TOOLKIT_ICONS[t.slug] ?? <Plug size={18} />}</span>
                <span className="config-toolkit-main">
                  <span className="config-toolkit-name">{t.name}</span>
                  <span className="config-toolkit-cap">{t.capability}</span>
                  {connectErrors[t.slug] && (
                    <span className="config-toolkit-cap" style={{ color: 'var(--color-danger, #f87171)' }}>
                      {connectErrors[t.slug]}
                    </span>
                  )}
                </span>
                {status.composio.canManage === false ? (
                  <span className={`config-badge ${t.connected ? 'ok' : 'warn'}`}>{t.connected ? 'Connecté' : 'Non connecté'}</span>
                ) : t.connected ? (
                  <>
                    <span className="config-badge ok">Fonctionnel</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDisconnect(t.slug, t.name)}
                      disabled={disconnecting === t.slug}
                      title="Supprime le compte connecté chez Composio — reconnectez ensuite pour re-autoriser avec les droits à jour"
                    >
                      {disconnecting === t.slug ? '⏳…' : '✕ Déconnecter'}
                    </button>
                  </>
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
                    {connecting === t.slug ? '⏳…' : 'Connecter'}
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
            <span className="config-card-title">Bot Telegram</span>
            {!status.telegram.configured
              ? <span className="config-badge ko">Non configuré</span>
              : status.telegram.linked
                ? <span className="config-badge ok">Compte lié</span>
                : <span className="config-badge warn">À lier</span>}
          </div>
          <p className="config-desc">
            Pilotez tout depuis un chat : état des activités, validation des contenus,
            rédaction de posts/emails, agenda, rappels.
          </p>

          {/* Bot personnel : chaque utilisateur branche le sien */}
          {status.telegram.ownBot ? (
            <div className="config-toolkit on" style={{ marginBottom: 10 }}>
              <span className="config-toolkit-icon"><Bot size={18} /></span>
              <span className="config-toolkit-main">
                <span className="config-toolkit-name">Votre bot {status.telegram.botUsername}</span>
                <span className="config-toolkit-cap">Écrivez-lui /start sur Telegram — la liaison est automatique.</span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={handleRemoveBot} disabled={botSaving}>
                Supprimer
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <label className="form-label-block">
                Token de votre bot <span className="form-hint-inline">(créez-le en 1 min : @BotFather → /newbot)</span>
                <div className="ai-assist-row">
                  <input
                    className="form-input"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456789:ABCdef…"
                    disabled={botSaving}
                  />
                  <button className="btn btn-primary" onClick={handleSaveBot} disabled={botSaving || !botToken.trim()}>
                    {botSaving ? '⏳…' : 'Activer'}
                  </button>
                </div>
              </label>
            </div>
          )}
          {botError && <div className="chat-error" style={{ marginBottom: 8 }}>{botError}</div>}

          {/* Liaison par code (bot global partagé, ou 2e chat) */}
          {status.telegram.configured && (
            tgCode ? (
              <>
                <div className="telegram-code">{tgCode}</div>
                <p className="form-hint">Envoyez ce code à votre bot Telegram (valable 10 minutes).</p>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={handleTelegramCode}>
                {status.telegram.linked ? 'Lier un autre chat' : 'Générer le code de liaison'}
              </button>
            )
          )}
          {tgError && <div className="chat-error">{tgError}</div>}
        </div>

        {/* ── Vos données (RGPD) ── */}
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">Vos données (RGPD)</span>
          </div>
          <p className="config-desc">
            Vous disposez du droit à la portabilité et à l'effacement de vos données
            (articles 20 et 17 du RGPD) — en libre-service, sans rien demander à personne.
          </p>
          <button className="btn btn-ghost" onClick={handleExport} disabled={exporting} style={{ alignSelf: 'flex-start' }}>
            {exporting ? '⏳ Préparation…' : 'Télécharger toutes mes données (JSON)'}
          </button>

          <div className="danger-zone">
            <div className="danger-zone-title">Zone dangereuse</div>
            {!deleteOpen ? (
              <button className="btn btn-ghost btn-danger" onClick={() => setDeleteOpen(true)}>
                Supprimer mon compte et toutes mes données
              </button>
            ) : (
              <>
                <p className="form-hint" style={{ marginBottom: 8 }}>
                  Suppression <strong>définitive et immédiate</strong> : compte, projets, posts,
                  contacts, base de connaissances, médias hébergés, liaisons Telegram et comptes
                  connectés Composio. Confirmez avec votre mot de passe.
                </p>
                <div className="ai-assist-row">
                  <input
                    type="password"
                    className="form-input"
                    value={deletePwd}
                    onChange={(e) => setDeletePwd(e.target.value)}
                    placeholder="Votre mot de passe"
                    autoComplete="current-password"
                  />
                  <button className="btn btn-danger-solid" onClick={handleDeleteAccount} disabled={deleting}>
                    {deleting ? '⏳ Suppression…' : 'Supprimer définitivement'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setDeleteOpen(false); setDeletePwd(''); setDeleteError(''); }}>
                    Annuler
                  </button>
                </div>
                {deleteError && <div className="chat-error" style={{ marginTop: 8 }}>{deleteError}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
