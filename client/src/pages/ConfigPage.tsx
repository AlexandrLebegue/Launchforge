import { useState, useEffect, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, MessageCircle, Camera, Users, Mail, CalendarDays,
  MessagesSquare, Play, Gamepad2, Hash, GitBranch, Plug, Bot, Globe,
  Sparkles, BookOpen, Presentation, Send, ShieldCheck, Music2,
} from 'lucide-react';
import {
  getConfigStatus, setPublishMode, getTelegramLinkCode, connectToolkit, disconnectToolkit,
  setTelegramBot, removeTelegramBot, setMetricsSyncInterval,
  setMarpTheme, customizeMarpTheme, themePreviewUrl,
  getKnowledgeSources, addKnowledgeSource, deleteKnowledgeSource, setKnowledgeSyncInterval,
  ConfigStatus, OwnAppField, KnowledgeSource,
} from '../api/client';
import AccountDataSection from '../components/AccountDataSection';

const SYNC_INTERVALS = [
  { value: 0,    label: 'Désactivée' },
  { value: 60,   label: 'Toutes les heures' },
  { value: 360,  label: 'Toutes les 6 h' },
  { value: 720,  label: 'Toutes les 12 h' },
  { value: 1440, label: 'Une fois par jour' },
];

/** Base de connaissances : sources stables → cadence plus large que les métriques */
const KB_SYNC_INTERVALS = [
  { value: 0,     label: 'Désactivée' },
  { value: 1440,  label: 'Une fois par jour' },
  { value: 4320,  label: 'Tous les 3 jours' },
  { value: 10080, label: 'Une fois par semaine' },
];

const fmtKbDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'jamais';

/** Libellés lisibles des identifiants d'app développeur (NEEDS_OWN_APP) */
const OWN_APP_FIELD_LABELS: Record<string, string> = {
  client_id: 'Client ID',
  client_secret: 'Client Secret',
  generic_id: 'Bearer Token',
  scopes: 'Scopes',
};

const TOOLKIT_ICONS: Record<string, React.ReactNode> = {
  linkedin: <Briefcase size={18} />, twitter: <MessageCircle size={18} />, instagram: <Camera size={18} />,
  facebook: <Users size={18} />, gmail: <Mail size={18} />, googlecalendar: <CalendarDays size={18} />,
  reddit: <MessagesSquare size={18} />, youtube: <Play size={18} />, discord: <Gamepad2 size={18} />,
  slack: <Hash size={18} />, github: <GitBranch size={18} />, tiktok: <Music2 size={18} />,
};

/**
 * Onglets de la Configuration : une thématique par onglet pour aérer la page.
 * `tourTargets` liste les marqueurs `data-tour` hébergés par l'onglet, afin que la
 * visite guidée bascule sur le bon onglet avant d'éclairer sa cible (voir l'écoute
 * de l'évènement « tour:target » plus bas).
 */
type ConfigTabId = 'ai' | 'knowledge' | 'slides' | 'accounts' | 'telegram' | 'data';
const CONFIG_TABS: { id: ConfigTabId; label: string; icon: React.ReactNode; tourTargets?: string[] }[] = [
  { id: 'ai',        label: 'Intelligence artificielle', icon: <Sparkles size={16} />,     tourTargets: ['cfg-publish', 'cfg-metrics'] },
  { id: 'knowledge', label: 'Base de connaissances',     icon: <BookOpen size={16} />,     tourTargets: ['cfg-knowledge'] },
  { id: 'slides',    label: 'Présentations',             icon: <Presentation size={16} /> },
  { id: 'accounts',  label: 'Comptes connectés',         icon: <Plug size={16} />,         tourTargets: ['cfg-accounts'] },
  { id: 'telegram',  label: 'Bot Telegram',              icon: <Send size={16} /> },
  { id: 'data',      label: 'Vos données',               icon: <ShieldCheck size={16} /> },
];

export default function ConfigPage() {
  const [status,  setStatus]  = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ConfigTabId>('ai');
  const [tgCode,  setTgCode]  = useState<string | null>(null);
  const [tgError, setTgError] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  // Base de connaissances : sources déclarées + fréquence de mise à jour auto
  const [kbSources,    setKbSources]    = useState<KnowledgeSource[]>([]);
  const [kbGithub,     setKbGithub]     = useState('');
  const [kbWebsite,    setKbWebsite]    = useState('');
  const [kbSaving,     setKbSaving]     = useState<'github' | 'website' | null>(null);
  const [kbError,      setKbError]      = useState('');
  const [savingKbSync, setSavingKbSync] = useState(false);
  // Thème des présentations
  const [themeBusy,    setThemeBusy]    = useState(false);
  const [themePrompt,  setThemePrompt]  = useState('');
  const [themeError,   setThemeError]   = useState('');
  // Bot Telegram personnel
  const [botToken,  setBotToken]  = useState('');
  const [botSaving, setBotSaving] = useState(false);
  const [botError,  setBotError]  = useState('');

  // Connexion de comptes : lien OAuth généré + erreurs, par toolkit
  const [connectLinks,  setConnectLinks]  = useState<Record<string, string>>({});
  const [connecting,    setConnecting]    = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});
  // Toolkits sans auth gérée par Composio (X/Twitter, TikTok…) : l'utilisateur
  // fournit les identifiants de sa propre app développeur
  const [ownApp,       setOwnApp]       = useState<Record<string, { fields: OwnAppField[]; callbackUrl: string }>>({});
  const [ownAppValues, setOwnAppValues] = useState<Record<string, Record<string, string>>>({});
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = (fresh = false) => getConfigStatus(fresh).then((res) => {
    if (res.success && res.data) setStatus(res.data);
    setLoading(false);
    return res;
  });

  useEffect(() => {
    load();
    getKnowledgeSources().then((res) => { if (res.success && res.data) setKbSources(res.data); });
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  /** Visite guidée : avant d'éclairer une cible, bascule sur l'onglet qui l'héberge */
  useEffect(() => {
    const onTourTarget = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail;
      if (typeof sel !== 'string') return;
      const tab = CONFIG_TABS.find((t) => t.tourTargets?.some((m) => sel.includes(m)));
      if (tab) setActiveTab(tab.id);
    };
    window.addEventListener('tour:target', onTourTarget);
    return () => window.removeEventListener('tour:target', onTourTarget);
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
    // Formulaire « app développeur » ouvert et rempli → identifiants joints
    const values = ownAppValues[slug];
    const creds = ownApp[slug] && values && Object.values(values).some((v) => v.trim())
      ? values
      : undefined;
    const res = await connectToolkit(slug, creds);
    setConnecting(null);
    if (res.success && res.data) {
      setOwnApp((o) => { const { [slug]: _gone, ...rest } = o; return rest; });
      setOwnAppValues((o) => { const { [slug]: _gone, ...rest } = o; return rest; });
      setConnectLinks((l) => ({ ...l, [slug]: res.data!.redirectUrl }));
      // Ouverture directe ; le lien reste affiché si le navigateur bloque la popup
      window.open(res.data.redirectUrl, '_blank', 'noopener');
      startPolling(slug);
    } else if (res.code === 'NEEDS_OWN_APP' && Array.isArray(res.fields) && res.fields.length > 0) {
      // Pas d'auth « clé en main » pour ce toolkit : on ouvre le formulaire
      setOwnApp((o) => ({ ...o, [slug]: { fields: res.fields!, callbackUrl: res.callbackUrl ?? '' } }));
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

  // ── Base de connaissances ──────────────────────────────────────────────────
  const handleAddSource = async (type: 'github' | 'website') => {
    const url = (type === 'github' ? kbGithub : kbWebsite).trim();
    if (!url) return;
    setKbSaving(type);
    setKbError('');
    const res = await addKnowledgeSource({ type, url });
    setKbSaving(null);
    if (res.success && res.data) {
      if (type === 'github') setKbGithub(''); else setKbWebsite('');
      const list = await getKnowledgeSources();
      if (list.success && list.data) setKbSources(list.data);
    } else {
      setKbError(res.error || 'Source refusée.');
    }
  };

  const handleDeleteKbSource = async (id: string) => {
    const res = await deleteKnowledgeSource(id);
    if (res.success) setKbSources((prev) => prev.filter((s) => s.id !== id));
  };

  const handleKnowledgeSyncInterval = async (minutes: number) => {
    if (!status) return;
    setSavingKbSync(true);
    const res = await setKnowledgeSyncInterval(minutes);
    setSavingKbSync(false);
    if (res.success && res.data) {
      setStatus({ ...status, knowledgeSync: { intervalMinutes: res.data.intervalMinutes } });
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
    <div className="animate-fadeIn settings-page">
      <div className="dashboard-header">
        <div>
          <h1>Configuration</h1>
          <p>L'état de vos connexions — ce qui est fonctionnel, et où connecter le reste.</p>
        </div>
      </div>

      {/* Onglets : une thématique à la fois pour une page plus lisible */}
      <div className="settings-tabs" role="tablist" aria-label="Thématiques de configuration">
        {CONFIG_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`settings-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.icon}
            <span className="settings-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="settings">

        {/* ═══════════ Intelligence artificielle ═══════════ */}
        {activeTab === 'ai' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Intelligence artificielle</h2>
              <p className="settings-group-sub">Le moteur qui rédige vos contenus et alimente les automatisations.</p>
            </div>
          </div>

          <div className="settings-panel">
            {/* Moteur IA */}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-title">Moteur IA</span>
                <span className="settings-row-desc">
                  {status.ai.configured
                    ? <>Modèle <strong>{status.ai.model}</strong> (OpenRouter) — onboarding, plans, rédaction, scoring de leads, bot Telegram.</>
                    : <>Renseignez <code>OPENROUTER_API_KEY</code> dans le <code>.env</code> du serveur (clé sur openrouter.ai/keys) pour activer toute l'IA.</>}
                </span>
              </div>
              <div className="settings-row-control">
                {status.ai.configured
                  ? <span className="config-badge ok">Fonctionnelle</span>
                  : <span className="config-badge ko">Non configurée</span>}
              </div>
            </div>

            {/* Publication des contenus IA */}
            <div className="settings-row settings-row--block" data-tour="cfg-publish">
              <div className="settings-row-info">
                <span className="settings-row-title">Publication des contenus IA</span>
                <span className="settings-row-desc">
                  Quand l'IA rédige un contenu (tâche Kanban, demande Telegram) — réglage propre au projet actif.
                </span>
              </div>
              <div className="settings-row-control">
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
            </div>

            {/* Synchro des métriques */}
            <div className="settings-row settings-row--block" data-tour="cfg-metrics">
              <div className="settings-row-info">
                <span className="settings-row-title">
                  Synchro des métriques
                  {status.metricsSync.intervalMinutes > 0
                    ? <span className="config-badge ok">Active</span>
                    : <span className="config-badge warn">Désactivée</span>}
                </span>
                <span className="settings-row-desc">
                  Le serveur relit les métriques réelles (vues, likes, commentaires, partages) de vos posts
                  publiés des 30 derniers jours, via vos comptes connectés.
                </span>
              </div>
              <div className="settings-row-control">
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
              </div>
            </div>
          </div>
        </section>

        )}

        {/* ═══════════ Base de connaissances ═══════════ */}
        {activeTab === 'knowledge' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Base de connaissances</h2>
              <p className="settings-group-sub">L'IA enrichit votre base depuis vos sources officielles — propre au projet actif.</p>
            </div>
            {status.knowledgeSync.intervalMinutes > 0
              ? <span className="config-badge ok">Mise à jour auto</span>
              : <span className="config-badge warn">Manuelle</span>}
          </div>

          <div className="settings-panel">
            <div className="settings-body" data-tour="cfg-knowledge">
              <div className="settings-field-row">
                <label className="form-label-block">
                  <span className="kb-sync-field-label"><GitBranch size={15} /> Dépôt GitHub</span>
                  <div className="ai-assist-row">
                    <input
                      className="form-input" value={kbGithub} disabled={kbSaving === 'github'}
                      onChange={(e) => setKbGithub(e.target.value)}
                      placeholder="github.com/utilisateur/depot"
                    />
                    <button className="btn btn-ghost" onClick={() => handleAddSource('github')}
                      disabled={kbSaving === 'github' || !kbGithub.trim()}>
                      {kbSaving === 'github' ? '⏳…' : 'Ajouter'}
                    </button>
                  </div>
                </label>

                <label className="form-label-block">
                  <span className="kb-sync-field-label"><Globe size={15} /> Site web ou page</span>
                  <div className="ai-assist-row">
                    <input
                      className="form-input" value={kbWebsite} disabled={kbSaving === 'website'}
                      onChange={(e) => setKbWebsite(e.target.value)}
                      placeholder="https://monsite.com"
                    />
                    <button className="btn btn-ghost" onClick={() => handleAddSource('website')}
                      disabled={kbSaving === 'website' || !kbWebsite.trim()}>
                      {kbSaving === 'website' ? '⏳…' : 'Ajouter'}
                    </button>
                  </div>
                </label>
              </div>

              {kbError && <div className="chat-error">{kbError}</div>}

              {kbSources.length > 0 && (
                <div className="kb-sync-saved">
                  <div className="kb-sync-saved-title">Sources enregistrées</div>
                  {kbSources.map((s) => (
                    <div key={s.id} className="kb-sync-source-row">
                      <span className="kb-sync-source-icon">
                        {s.type === 'github' ? <GitBranch size={15} /> : <Globe size={15} />}
                      </span>
                      <span className="kb-sync-source-info">
                        <span className="kb-sync-source-label">{s.label || s.url}</span>
                        <span className="kb-sync-source-meta">Mise à jour : {fmtKbDate(s.lastSyncedAt)}</span>
                      </span>
                      <button className="kanban-delete" title="Retirer" onClick={() => handleDeleteKbSource(s.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <label className="form-label-block">
                Fréquence de mise à jour automatique
                <select
                  className="form-input"
                  value={status.knowledgeSync.intervalMinutes}
                  onChange={(e) => handleKnowledgeSyncInterval(Number(e.target.value))}
                  disabled={savingKbSync}
                >
                  {KB_SYNC_INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span className="form-hint-inline">
                  Chaque mise à jour consomme un appel IA et s'applique sans relecture — une fréquence
                  hebdomadaire suffit dans la plupart des cas (les sources changent rarement).
                </span>
              </label>
            </div>
          </div>
        </section>

        )}

        {/* ═══════════ Présentations ═══════════ */}
        {activeTab === 'slides' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Présentations</h2>
              <p className="settings-group-sub">Le style des decks générés par l'IA (onglet Slides du Hub).</p>
            </div>
            <a className="btn btn-ghost btn-sm" href={themePreviewUrl()} target="_blank" rel="noopener noreferrer">
              Aperçu
            </a>
          </div>

          <div className="settings-panel">
            <div className="settings-body">
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
              <label className="form-label-block">
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
          </div>
        </section>

        )}

        {/* ═══════════ Comptes connectés (Composio) ═══════════ */}
        {activeTab === 'accounts' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Comptes connectés</h2>
              <p className="settings-group-sub">Les plateformes utilisées pour publier, lire les métriques, gérer emails et agenda.</p>
            </div>
            {status.composio.configured
              ? <span className="config-badge ok">{connectedCount} connectée{connectedCount > 1 ? 's' : ''}</span>
              : <span className="config-badge ko">Non configuré</span>}
            <a
              className="btn btn-primary btn-sm"
              href={status.composio.dashboardUrl}
              target="_blank" rel="noopener noreferrer"
            >
              Gérer ↗
            </a>
          </div>

          <div className="settings-panel">
            <div className="settings-body" data-tour="cfg-accounts">
              {!status.composio.configured && (
                <p className="config-desc">
                  Renseignez <code>COMPOSIO_MCP_URL</code> et <code>COMPOSIO_API_KEY</code> dans le{' '}
                  <code>.env</code> du serveur, puis connectez vos comptes sur le dashboard Composio.
                </p>
              )}
              {status.composio.canManage === false && (
                <div className="settings-note">
                  👁️ Projet d'équipe : les comptes utilisés pour publier sont ceux de <strong>{status.composio.ownerName || 'son propriétaire'}</strong> — vous les voyez en lecture seule.
                </div>
              )}
              <div className="config-toolkits">
                {status.composio.toolkits.map((t) => (
                  <Fragment key={t.slug}>
                  <div className={`config-toolkit${t.connected ? ' on' : ''}`}>
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
                  {/* Pas d'auth « clé en main » (X/Twitter, TikTok…) : identifiants
                      de l'app développeur de l'utilisateur */}
                  {!t.connected && ownApp[t.slug] && (
                    <div className="config-ownapp">
                      <p className="config-ownapp-help">
                        {t.name} n'a pas d'authentification « clé en main » chez Composio : créez une app
                        (gratuite) sur le portail développeur de la plateforme
                        {t.slug === 'twitter' && <> (<a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer">developer.x.com</a> → Projects &amp; Apps → User authentication settings, type « Web App », et notez aussi le Bearer Token de l'app)</>}
                        {t.slug === 'tiktok' && <> (<a href="https://developers.tiktok.com/" target="_blank" rel="noopener noreferrer">developers.tiktok.com</a>)</>}
                        , déclarez l'URL de callback ci-dessous dans ses « Redirect URLs », puis collez ses
                        identifiants — ils restent chez Composio, jamais dans LaunchForge.
                      </p>
                      {ownApp[t.slug].callbackUrl && (
                        <div className="config-ownapp-callback">
                          <span>URL de callback à déclarer :</span>
                          <code>{ownApp[t.slug].callbackUrl}</code>
                          <button
                            type="button" className="btn btn-ghost btn-sm"
                            onClick={() => navigator.clipboard?.writeText(ownApp[t.slug].callbackUrl)}
                          >
                            Copier
                          </button>
                        </div>
                      )}
                      {ownApp[t.slug].fields.map((f) => (
                        <label key={f.name} className="config-ownapp-field">
                          <span>{OWN_APP_FIELD_LABELS[f.name] ?? f.name}</span>
                          <input
                            type={/secret/i.test(f.name) ? 'password' : 'text'}
                            placeholder={f.description.slice(0, 90)}
                            value={ownAppValues[t.slug]?.[f.name] ?? ''}
                            onChange={(e) => setOwnAppValues((o) => ({
                              ...o,
                              [t.slug]: { ...o[t.slug], [f.name]: e.target.value },
                            }))}
                          />
                        </label>
                      ))}
                      <div className="config-ownapp-actions">
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={connecting === t.slug
                            || !ownApp[t.slug].fields.every((f) => (ownAppValues[t.slug]?.[f.name] ?? '').trim())}
                          onClick={() => handleConnect(t.slug)}
                        >
                          {connecting === t.slug ? '⏳…' : 'Enregistrer et connecter'}
                        </button>
                        <button
                          type="button" className="btn btn-ghost btn-sm"
                          onClick={() => setOwnApp((o) => { const { [t.slug]: _gone, ...rest } = o; return rest; })}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
              <p className="form-hint">
                Cliquez sur « Connecter », autorisez l'accès dans l'onglet qui s'ouvre, et le compte
                devient utilisable — publication, métriques, emails, agenda. Le statut se rafraîchit
                automatiquement après l'autorisation.
              </p>
            </div>
          </div>
        </section>

        )}

        {/* ═══════════ Bot Telegram ═══════════ */}
        {activeTab === 'telegram' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Bot Telegram</h2>
              <p className="settings-group-sub">Pilotez tout depuis un chat : validation des contenus, rédaction, agenda, rappels.</p>
            </div>
            {!status.telegram.configured
              ? <span className="config-badge ko">Non configuré</span>
              : status.telegram.linked
                ? <span className="config-badge ok">Compte lié</span>
                : <span className="config-badge warn">À lier</span>}
          </div>

          <div className="settings-panel">
            <div className="settings-body">
              {/* Bot personnel : chaque utilisateur branche le sien */}
              {status.telegram.ownBot ? (
                <div className="config-toolkit on">
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
              )}
              {botError && <div className="chat-error">{botError}</div>}

              {/* Liaison par code (bot global partagé, ou 2e chat) */}
              {status.telegram.configured && (
                tgCode ? (
                  <div>
                    <div className="telegram-code">{tgCode}</div>
                    <p className="form-hint">Envoyez ce code à votre bot Telegram (valable 10 minutes).</p>
                  </div>
                ) : (
                  <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={handleTelegramCode}>
                    {status.telegram.linked ? 'Lier un autre chat' : 'Générer le code de liaison'}
                  </button>
                )
              )}
              {tgError && <div className="chat-error">{tgError}</div>}
            </div>
          </div>
        </section>

        )}

        {/* ═══════════ Vos données (RGPD) ═══════════ */}
        {activeTab === 'data' && (
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title">Vos données</h2>
              <p className="settings-group-sub">Portabilité et effacement (RGPD, articles 20 et 17) — en libre-service.</p>
            </div>
            <Link to="/profile" className="btn btn-ghost btn-sm">Mon profil ↗</Link>
          </div>

          <div className="settings-panel">
            <AccountDataSection />
          </div>
        </section>
        )}

      </div>
    </div>
  );
}
