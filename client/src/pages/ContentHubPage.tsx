import { useState, useEffect, useMemo, useCallback, useRef, FormEvent } from 'react';
import Loader from '../components/Loader';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Eye, TrendingUp, Megaphone, Sparkles, Wand2, MessageSquare, LayoutGrid, Table2, ArrowUpDown, Lock, ExternalLink, RefreshCw, BarChart3, Download } from 'lucide-react';
import {
  getPosts, createPost, importPost, updatePost, deletePost, publishPost, generateContent, syncPostMetrics,
  previewRecurrence, crosspostPost, publishPostNow, PublishOutcome,
  generateCalendar, getOverview,
  generatePostImage, uploadPostImage, uploadPostVideo, getDecks, createDeck, deleteDeck, deckHtmlUrl, deckMarkdownUrl, renderDeckMedia, DeckSummary,
  analyzePostPerf, checkPostEmbed, EmbedCheck,
  Post, PostStatus, Recurrence,
} from '../api/client';
import PostAssistant from '../components/PostAssistant';
import PlatformIcon from '../components/PlatformIcon';
import { Send } from 'lucide-react';
import Markdown from '../components/Markdown';
import ForgeProgress from '../components/ForgeProgress';
import PublishingOverlay from '../components/PublishingOverlay';

export const PLATFORMS: { value: string; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'X / Twitter' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'blog', label: 'Blog / SEO' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'producthunt', label: 'Product Hunt' },
  { value: 'hackernews', label: 'Hacker News' },
  { value: 'indiehackers', label: 'Indie Hackers' },
];

export const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

/** Plateformes dont les métriques sont récupérables automatiquement à l'import (Composio). */
const SYNCABLE_PLATFORMS = new Set(['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'reddit', 'tiktok']);

const PLATFORM_HOSTS: { re: RegExp; platform: string }[] = [
  { re: /(?:^|\.)(?:x|twitter)\.com$/i,                      platform: 'twitter' },
  { re: /(?:^|\.)linkedin\.com$/i,                           platform: 'linkedin' },
  { re: /(?:^|\.)instagram\.com$/i,                          platform: 'instagram' },
  { re: /(?:^|\.)(?:facebook|fb)\.com$|(?:^|\.)fb\.watch$/i, platform: 'facebook' },
  { re: /(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/i,         platform: 'youtube' },
  { re: /(?:^|\.)reddit\.com$|(?:^|\.)redd\.it$/i,           platform: 'reddit' },
  { re: /(?:^|\.)tiktok\.com$/i,                             platform: 'tiktok' },
  { re: /(?:^|\.)producthunt\.com$/i,                        platform: 'producthunt' },
  { re: /(?:^|\.)ycombinator\.com$/i,                        platform: 'hackernews' },
  { re: /(?:^|\.)indiehackers\.com$/i,                       platform: 'indiehackers' },
];

/** Déduit la plateforme depuis le domaine d'une URL (aperçu côté client). */
export function detectPlatformFromUrl(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./i, '');
    return PLATFORM_HOSTS.find((e) => e.re.test(host))?.platform ?? null;
  } catch {
    return null;
  }
}

export const STATUS_META: Record<PostStatus, { label: string; cls: string }> = {
  idea:      { label: 'Idée',       cls: 'post-status-idea' },
  draft:     { label: 'Brouillon',  cls: 'post-status-draft' },
  scheduled: { label: 'Programmé', cls: 'post-status-scheduled' },
  published: { label: 'Publié',     cls: 'post-status-published' },
};

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none:     'Ponctuel',
  daily:    'Quotidien',
  weekly:   'Hebdomadaire',
  biweekly: 'Toutes les 2 semaines',
  monthly:  'Mensuel',
};

export function engagementRate(p: Post): number | null {
  if (p.impressions <= 0) return null;
  return ((p.likes + p.comments + p.shares) / p.impressions) * 100;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtDateShort = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : <span style={{ color: 'var(--color-border)' }}>—</span>;

const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n));

/** Date affichée en bas de chaque carte, selon le statut du post */
const cardDateLabel = (p: Post): string => {
  if (p.status === 'published') return `Publié le ${fmtDate(p.publishedAt ?? p.updatedAt)}`;
  if (p.status === 'scheduled') return `Programmé le ${fmtDate(p.scheduledAt)}`;
  return `Créé le ${fmtDate(p.createdAt)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Éditeur de post (modal) avec assistant IA
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Aperçus par plateforme — mini-rendus aux couleurs des vraies apps
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewProps {
  platform: string;
  title: string;
  content: string;
  mediaUrl: string;
  mediaIsVideo: boolean;
  subreddit?: string;
}

function PlatformPreview({ platform, title, content, mediaUrl, mediaIsVideo, subreddit }: PreviewProps) {
  const text = content.trim();
  const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).style.display = 'none';
  };
  const media = mediaUrl
    ? (mediaIsVideo
      ? <video src={mediaUrl} className="pv-media" controls loop muted playsInline />
      : <img src={mediaUrl} alt="" className="pv-media" onError={hideOnError} />)
    : null;
  const empty = <span className="pe-preview-empty">Le post apparaîtra ici au fil de la frappe…</span>;

  if (platform === 'linkedin') {
    return (
      <div className="pv pv-light pv-linkedin">
        <div className="pv-head">
          <span className="pv-avatar" style={{ background: '#0A66C2' }}>V</span>
          <span className="pv-id">
            <strong>Vous</strong>
            <em>Fondateur·euse · 1ᵉʳ</em>
            <em>Maintenant · Visible de tous</em>
          </span>
        </div>
        <div className="pv-text">{text ? <Markdown text={text} /> : empty}</div>
        {media}
        <div className="pv-actionbar">
          <span>J'aime</span><span>Commenter</span><span>Republier</span><span>Envoyer</span>
        </div>
      </div>
    );
  }

  if (platform === 'twitter') {
    return (
      <div className="pv pv-x">
        <div className="pv-head">
          <span className="pv-avatar" style={{ background: '#333' }}>V</span>
          <span className="pv-id pv-id-inline">
            <strong>Vous</strong>
            <em>@vous · 1 min</em>
          </span>
        </div>
        <div className="pv-text">{text ? <Markdown text={text} /> : empty}</div>
        {media && <div className="pv-media-rounded">{media}</div>}
        <div className="pv-actionbar pv-actionbar-x">
          <span>12</span><span>4</span><span>87</span><span>2,1 k</span>
        </div>
      </div>
    );
  }

  if (platform === 'instagram') {
    return (
      <div className="pv pv-light pv-instagram">
        <div className="pv-head">
          <span className="pv-avatar pv-avatar-ig">V</span>
          <span className="pv-id"><strong>vous</strong></span>
          <span className="pv-more">···</span>
        </div>
        {media
          ? <div className="pv-ig-media">{media}</div>
          : <div className="pv-ig-placeholder">Ajoutez un visuel — obligatoire sur Instagram</div>}
        <div className="pv-ig-likes">128 J'aime</div>
        <div className="pv-text pv-ig-caption">
          {text ? <><strong>vous</strong> <Markdown text={text} /></> : empty}
        </div>
      </div>
    );
  }

  if (platform === 'reddit') {
    const lines = text.split('\n');
    const rTitle = title.trim() || lines[0] || '';
    const body = title.trim() ? text : lines.slice(1).join('\n').trim();
    return (
      <div className="pv pv-light pv-reddit">
        <div className="pv-reddit-meta">r/{subreddit?.trim() || 'votre-communauté'} · publié par u/vous · il y a 1 h</div>
        <div className="pv-reddit-title">{rTitle || empty}</div>
        {body && <div className="pv-text pv-reddit-body"><Markdown text={body} /></div>}
        {media}
        <div className="pv-actionbar pv-actionbar-reddit">
          <span className="pv-votes">▲ 247 ▼</span><span>38 commentaires</span><span>Partager</span>
        </div>
      </div>
    );
  }

  if (platform === 'youtube') {
    const lines = text.split('\n');
    const vTitle = title.trim() || lines[0] || '';
    const desc = (title.trim() ? text : lines.slice(1).join('\n').trim());
    return (
      <div className="pv pv-youtube">
        {media
          ? <div className="pv-yt-thumb">{media}</div>
          : <div className="pv-yt-thumb pv-yt-placeholder"><span>▶</span>Ajoutez une vidéo ou une vignette</div>}
        <div className="pv-yt-title">{vTitle || empty}</div>
        <div className="pv-yt-channel">
          <span className="pv-avatar" style={{ background: '#FF0000', width: 26, height: 26, fontSize: '0.7rem' }}>V</span>
          <span className="pv-id">
            <strong>Votre chaîne</strong>
            <em>1,2 k abonnés</em>
          </span>
          <span className="pv-yt-subscribe">S'abonner</span>
        </div>
        {desc && <div className="pv-text pv-yt-desc"><Markdown text={desc} /></div>}
      </div>
    );
  }

  // Autres plateformes : carte générique (badge + texte + média)
  return (
    <div className="pe-preview-card">
      <div className="pe-preview-head">
        <span className="pe-preview-platform">
          <PlatformIcon platform={platform} size={15} /> {platformLabel(platform)}
        </span>
      </div>
      <div className="pe-preview-body">{text ? <Markdown text={text} /> : empty}</div>
      {media && <div className="pe-preview-media-wrap">{media}</div>}
    </div>
  );
}

interface EditorProps {
  post: Post | null;            // null = création
  /** Date pré-remplie pour une création depuis le calendrier */
  initialScheduledAt?: string | null;
  /** Rôle Lecteur : consultation seule (pas d'enregistrement ni de publication) */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (post: Post) => void;
  /** Des exemplaires multi-plateformes ont été créés → la liste doit être rechargée */
  onCrossposted?: () => void;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue « post publié » — lecture seule. Un post en ligne ne se modifie plus :
// on affiche la vraie publication (iframe si la plateforme l'autorise, sinon
// aperçu fidèle + lien), le suivi des performances et la seule aide IA pertinente
// à ce stade : l'analyse de performance.
// ─────────────────────────────────────────────────────────────────────────────

function PublishedPostView({ post, readOnly = false, onClose, onSaved }: {
  post: Post;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (p: Post) => void;
}) {
  const [externalUrl, setExternalUrl] = useState(post.externalUrl ?? '');
  const [savedUrl,    setSavedUrl]    = useState(post.externalUrl ?? '');
  const [metrics, setMetrics] = useState({
    impressions: post.impressions, likes: post.likes, comments: post.comments,
    shares: post.shares, clicks: post.clicks,
  });
  const [manual, setManual] = useState(false);

  // Détection « peut-on iframe le post ? »
  const [embed,        setEmbed]        = useState<EmbedCheck | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);
  const [iframeBroken, setIframeBroken] = useState(false);

  const [syncing,  setSyncing]  = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [error,    setError]    = useState('');
  const [analysis,  setAnalysis]  = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  // Contenu local : un post importé peut arriver SANS texte (LinkedIn refuse le
  // corps via son API → 403). On laisse alors l'utilisateur le coller à la main.
  const [title, setTitle] = useState(post.title);
  const [body,  setBody]  = useState(post.content);
  const [savedBody, setSavedBody] = useState(post.content);
  const [savingBody, setSavingBody] = useState(false);

  const hasUrl = /^https?:\/\//i.test(savedUrl.trim());

  const handleSaveBody = async () => {
    setSavingBody(true); setError('');
    const res = await updatePost(post.id, { title, content: body });
    setSavingBody(false);
    if (res.success && res.data) { setSavedBody(body); onSaved(res.data); }
    else setError(res.error || 'Enregistrement impossible.');
  };

  const runEmbedCheck = useCallback(() => {
    setEmbedLoading(true);
    setIframeBroken(false);
    checkPostEmbed(post.id).then((res) => {
      setEmbedLoading(false);
      setEmbed(res.success && res.data ? res.data : { embeddable: false, embedUrl: null, reason: 'unreachable' });
    });
  }, [post.id]);

  useEffect(() => {
    if (hasUrl) runEmbedCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engagement = metrics.impressions > 0
    ? ((metrics.likes + metrics.comments + metrics.shares) / metrics.impressions) * 100
    : null;

  const mediaUrl = (post.imageUrl ?? '').trim();
  const mediaIsVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrl);

  // Attache / met à jour l'URL publiée → relance la détection iframe.
  const persistUrl = async (): Promise<boolean> => {
    const url = externalUrl.trim();
    if (url === savedUrl.trim()) return true;
    const res = await updatePost(post.id, { externalUrl: url || null });
    if (!res.success || !res.data) { setError(res.error || 'Enregistrement impossible.'); return false; }
    setSavedUrl(url);
    onSaved(res.data);
    if (/^https?:\/\//i.test(url)) runEmbedCheck();
    else setEmbed(null);
    return true;
  };

  const handleSync = async () => {
    if (!/^https?:\/\//i.test(externalUrl.trim())) {
      setError('Renseignez l\'URL du post publié pour synchroniser ses métriques.');
      return;
    }
    setSyncing(true); setError(''); setSyncNote('');
    await persistUrl();
    const res = await syncPostMetrics(post.id);
    setSyncing(false);
    if (res.success && res.data) {
      const p = res.data.post;
      setMetrics({ impressions: p.impressions, likes: p.likes, comments: p.comments, shares: p.shares, clicks: p.clicks });
      setSyncNote(`Métriques synchronisées${res.data.note ? ` — ${res.data.note}` : ''}`);
      onSaved(p);
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Composio non configuré — connectez vos comptes pour synchroniser, ou saisissez les chiffres à la main.'
        : res.error || 'La synchronisation a échoué.');
    }
  };

  const handleSaveMetrics = async () => {
    setError('');
    const res = await updatePost(post.id, {
      impressions: Number(metrics.impressions) || 0,
      likes:       Number(metrics.likes) || 0,
      comments:    Number(metrics.comments) || 0,
      shares:      Number(metrics.shares) || 0,
      clicks:      Number(metrics.clicks) || 0,
    });
    if (res.success && res.data) { onSaved(res.data); setManual(false); setSyncNote('Métriques enregistrées.'); }
    else setError(res.error || 'Enregistrement impossible.');
  };

  const handleAnalyze = async () => {
    setAnalyzing(true); setError('');
    const res = await analyzePostPerf(post.id);
    setAnalyzing(false);
    if (res.success && res.data) {
      setAnalysis(res.data.analysis + (res.data.learnings.length
        ? `\n\n---\n**${res.data.learnings.length} enseignement(s) ajouté(s) à la base de connaissances** — les prochaines générations en tiendront compte.`
        : ''));
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Analyse échouée.');
    }
  };

  const showIframe = Boolean(embed?.embeddable && embed.embedUrl && !iframeBroken);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-xl pe-modal-enter" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{post.title || platformLabel(post.platform)}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Bandeau : statut + raison du verrouillage, d'un coup d'œil */}
        <div className="pub-banner">
          <span className="pub-banner-badge"><CheckCircle2 size={15} /> Publié</span>
          <span className="pub-banner-meta">
            <PlatformIcon platform={post.platform} size={14} /> {platformLabel(post.platform)}
            <span className="pub-banner-sep">·</span>
            {fmtDate(post.publishedAt ?? post.updatedAt)}
          </span>
          <span className="pub-banner-lock"><Lock size={12} /> Lecture seule — en ligne, ce post ne se modifie plus.</span>
          {hasUrl && (
            <a className="pub-banner-link" href={savedUrl.trim()} target="_blank" rel="noopener noreferrer">
              Voir sur {platformLabel(post.platform)} <ExternalLink size={13} />
            </a>
          )}
        </div>

        <div className="pe-form">
          <div className="pe-grid">

            {/* ════ GAUCHE : le post tel qu'il est en ligne ════ */}
            <div className="pe-col">
              <section className="pe-panel pub-embed-panel">
                <h3 className="pe-panel-title"><Eye size={14} /> Le post en ligne</h3>
                {!readOnly && !savedBody.trim() && (
                  <div className="pub-paste-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    <p className="pub-fallback-note" style={{ margin: 0 }}>
                      {post.platform === 'linkedin'
                        ? 'LinkedIn ne donne pas le texte du post via son API (seules les réactions sont lisibles) — collez le contenu ici pour l\'archiver et permettre l\'analyse.'
                        : 'Le texte n\'a pas pu être récupéré automatiquement — collez-le ici si vous le souhaitez.'}
                    </p>
                    <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre (optionnel)" />
                    <textarea className="form-input post-content-area" rows={6} value={body}
                              onChange={(e) => setBody(e.target.value)} placeholder="Collez le texte du post…" />
                    <div className="ai-assist-row">
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveBody} disabled={savingBody || !body.trim()}>
                        {savingBody ? '⏳…' : 'Enregistrer le contenu'}
                      </button>
                    </div>
                  </div>
                )}
                {!hasUrl ? (
                  <div className="pub-fallback">
                    <p className="pub-fallback-note">
                      Ajoutez l'URL du post publié (panneau de droite) pour afficher la vraie publication ici.
                      En attendant, voici l'aperçu fidèle de ce que vous avez publié.
                    </p>
                    <PlatformPreview platform={post.platform} title={title} content={body}
                                     mediaUrl={mediaUrl} mediaIsVideo={mediaIsVideo} subreddit={post.subreddit ?? undefined} />
                  </div>
                ) : embedLoading ? (
                  <Loader text="Vérification de l'affichage intégré…" variant="inline" />
                ) : showIframe ? (
                  <div className="pub-embed-frame">
                    <iframe
                      src={embed!.embedUrl!}
                      title="Post publié"
                      loading="lazy"
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                      referrerPolicy="no-referrer-when-downgrade"
                      onError={() => setIframeBroken(true)}
                    />
                  </div>
                ) : (
                  <div className="pub-fallback">
                    <p className="pub-fallback-note">
                      {platformLabel(post.platform)} n'autorise pas l'affichage intégré — voici l'aperçu fidèle de votre publication.{' '}
                      <a href={savedUrl.trim()} target="_blank" rel="noopener noreferrer">Ouvrir la vraie publication ↗</a>
                    </p>
                    <PlatformPreview platform={post.platform} title={title} content={body}
                                     mediaUrl={mediaUrl} mediaIsVideo={mediaIsVideo} subreddit={post.subreddit ?? undefined} />
                  </div>
                )}
              </section>
            </div>

            {/* ════ DROITE : suivi des performances + analyse IA ════ */}
            <div className="pe-col pe-col-right">

              <section className="pe-panel">
                <h3 className="pe-panel-title"><BarChart3 size={14} /> Performances</h3>
                <div className="pub-metrics">
                  {([
                    [fmtNum(metrics.impressions), 'Impressions'],
                    [fmtNum(metrics.likes), 'Likes'],
                    [fmtNum(metrics.comments), 'Commentaires'],
                    [fmtNum(metrics.shares), 'Partages'],
                    [fmtNum(metrics.clicks), 'Clics'],
                    [engagement !== null ? `${engagement.toFixed(1)} %` : '—', 'Engagement'],
                  ] as const).map(([value, label]) => (
                    <div key={label} className="pub-metric">
                      <span className="pub-metric-value">{value}</span>
                      <span className="pub-metric-label">{label}</span>
                    </div>
                  ))}
                </div>

                {!readOnly && (
                  <>
                    <label className="form-label-block">
                      URL du post publié
                      <div className="ai-assist-row">
                        <input
                          className="form-input"
                          value={externalUrl}
                          onChange={(e) => setExternalUrl(e.target.value)}
                          onBlur={persistUrl}
                          placeholder="ex. https://x.com/vous/status/12345…"
                        />
                        <button type="button" className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
                          {syncing ? '⏳…' : <><RefreshCw size={14} /> Synchroniser</>}
                        </button>
                      </div>
                      <span className="form-hint-inline">
                        La synchro lit les métriques réelles via vos comptes Composio. Sinon, saisie manuelle.
                      </span>
                    </label>
                    {syncNote && <div className="approval-feedback" style={{ marginBottom: 0 }}>{syncNote}</div>}

                    {manual ? (
                      <>
                        <div className="metrics-grid">
                          {([
                            ['impressions', 'Impressions'], ['likes', 'Likes'], ['comments', 'Commentaires'],
                            ['shares', 'Partages'], ['clicks', 'Clics'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="form-label-block">
                              {label}
                              <input
                                type="number" min={0} className="form-input"
                                value={metrics[key]}
                                onChange={(e) => setMetrics((m) => ({ ...m, [key]: Number(e.target.value) }))}
                              />
                            </label>
                          ))}
                        </div>
                        <div className="ai-assist-row">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManual(false)}>Annuler</button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveMetrics}>Enregistrer les chiffres</button>
                        </div>
                      </>
                    ) : (
                      <button type="button" className="pub-manual-toggle" onClick={() => setManual(true)}>
                        Saisir les chiffres manuellement
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* Seule aide IA conservée pour un post publié : l'analyse */}
              <section className="pe-panel pe-ai">
                <h3 className="pe-panel-title">
                  <Sparkles size={14} /> Analyse de performance
                  {!readOnly && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                            onClick={handleAnalyze} disabled={analyzing}>
                      {analyzing ? '⏳ Analyse…' : analysis ? '↺ Re-analyser' : 'Analyser ce post'}
                    </button>
                  )}
                </h3>
                <p className="form-hint" style={{ margin: 0 }}>
                  L'IA explique pourquoi ce post a marché (ou non) et nourrit votre base de connaissances pour les prochains.
                </p>
                {analysis && <div style={{ fontSize: '0.85rem' }}><Markdown text={analysis} /></div>}
              </section>
            </div>
          </div>

          {error && <div className="chat-error" style={{ marginTop: 10 }}>{error}</div>}
          <div className="modal-footer pe-footer">
            {readOnly && <span className="form-hint-inline pe-footer-error">👁️ Lecture seule — vous êtes Lecteur sur ce projet.</span>}
            <button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function PostEditor({ post, initialScheduledAt, readOnly = false, onClose, onSaved, onCrossposted }: EditorProps) {
  const [form, setForm] = useState({
    platform:    post?.platform ?? 'linkedin',
    title:       post?.title ?? '',
    content:     post?.content ?? '',
    status:      (post?.status ?? (initialScheduledAt ? 'scheduled' : 'draft')) as PostStatus,
    scheduledAt: toLocalInput(post?.scheduledAt ?? initialScheduledAt ?? null),
    externalUrl: post?.externalUrl ?? '',
    imageUrl:    post?.imageUrl ?? '',
    subreddit:   post?.subreddit ?? '',
    recurrence:  (post?.recurrence ?? 'none') as Recurrence,
    recurrenceBrief: post?.recurrenceBrief ?? '',
    recurrenceUseNews:      Boolean(post?.recurrenceUseNews),
    recurrenceUseKnowledge: post ? Boolean(post.recurrenceUseKnowledge) : true,
    recurrenceUpdateKb:     Boolean(post?.recurrenceUpdateKb),
    autoPublish: Boolean(post?.autoPublish),
    impressions: post?.impressions ?? 0,
    likes:       post?.likes ?? 0,
    comments:    post?.comments ?? 0,
    shares:      post?.shares ?? 0,
    clicks:      post?.clicks ?? 0,
  });
  const [brief,      setBrief]      = useState('');
  const [imgPrompt,  setImgPrompt]  = useState('');
  const [imgBusy,    setImgBusy]    = useState(false);
  const [imgError,   setImgError]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Présentations du projet : transformables en GIF animé attaché au post
  const [decks,        setDecks]        = useState<DeckSummary[]>([]);
  const [selectedDeck, setSelectedDeck] = useState('');

  useEffect(() => {
    getDecks().then((res) => {
      if (res.success && res.data) setDecks(res.data);
    });
  }, []);

  const handleDeckGif = async () => {
    if (!selectedDeck) return;
    setImgBusy(true);
    setImgError('');
    const res = await renderDeckMedia(selectedDeck, 'gif', post?.id);
    setImgBusy(false);
    if (res.success && res.data) {
      if (res.data.publicUrl) {
        set('imageUrl', res.data.publicUrl);
      } else {
        set('imageUrl', res.data.url);
        setImgError('GIF généré mais hébergement public indisponible — l\'aperçu fonctionne, la publication sur les plateformes nécessitera une URL publique.');
      }
    } else {
      setImgError(res.error || 'Rendu du GIF échoué.');
    }
  };

  const handleGenerateImage = async () => {
    setImgBusy(true);
    setImgError('');
    const res = await generatePostImage(imgPrompt.trim(), post?.id);
    setImgBusy(false);
    if (res.success && res.data) {
      set('imageUrl', res.data.url);
      setImgPrompt('');
      if (!res.data.publicUrl) {
        setImgError('Image générée et hébergée localement (service d\'hébergement public indisponible) — l\'aperçu marche ; pour publier sur les plateformes, configurez APP_URL (URL publique du serveur).');
      }
    } else {
      setImgError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Génération échouée.');
    }
  };

  const handleUploadMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImgError('');

    // Vidéo : envoi binaire brut, stockée sur le serveur (purge à 90 jours)
    if (file.type.startsWith('video/')) {
      if (file.size > 3 * 1024 * 1024 * 1024) { setImgError('Vidéo trop lourde (3 Go max).'); return; }
      setImgBusy(true);
      uploadPostVideo(file, post?.id).then((res) => {
        setImgBusy(false);
        if (res.success && res.data) {
          set('imageUrl', res.data.url);
          if (!res.data.publicUrl) {
            setImgError('Vidéo hébergée sur ce serveur — l\'aperçu fonctionne ; pour publier sur les plateformes, configurez APP_URL en production (URL publique).');
          }
        } else {
          setImgError(res.error || 'Téléversement de la vidéo échoué.');
        }
      });
      return;
    }

    // Image : base64 vers l'hébergement public
    if (file.size > 8 * 1024 * 1024) { setImgError('Image trop lourde (8 Mo max).'); return; }
    setImgBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const res = await uploadPostImage(String(reader.result), post?.id);
      setImgBusy(false);
      if (res.success && res.data) {
        set('imageUrl', res.data.url);
        if (!res.data.publicUrl) {
          setImgError('Image hébergée localement (service d\'hébergement public indisponible) — l\'aperçu marche ; pour publier sur les plateformes, configurez APP_URL (URL publique du serveur).');
        }
      } else {
        setImgError(res.error || 'Téléversement échoué.');
      }
    };
    reader.onerror = () => { setImgBusy(false); setImgError('Lecture du fichier impossible.'); };
    reader.readAsDataURL(file);
  };
  const [useNews,    setUseNews]    = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncNote,   setSyncNote]   = useState('');
  const [error,      setError]      = useState('');
  const [analysis,   setAnalysis]   = useState('');
  const [analyzing,  setAnalyzing]  = useState(false);
  // Sélection multi-plateformes ORDONNÉE : la première est la plateforme
  // principale du post, les suivantes deviennent des exemplaires liés
  // (groupe multi-plateformes) à l'enregistrement.
  const [selPlatforms, setSelPlatforms] = useState<string[]>([post?.platform ?? 'linkedin']);
  const [crossAdapt,   setCrossAdapt]   = useState(true);
  const crossTargets = selPlatforms.slice(1);
  const togglePlatform = (pf: string) =>
    setSelPlatforms((prev) => {
      const next = prev.includes(pf) ? prev.filter((x) => x !== pf) : [...prev, pf];
      if (next.length === 0) return prev; // toujours au moins une plateforme
      setForm((f) => ({ ...f, platform: next[0] }));
      return next;
    });
  // Carrousel d'aperçus (un par plateforme sélectionnée)
  const [previewIdx, setPreviewIdx] = useState(0);
  const pvIdx = Math.min(previewIdx, selPlatforms.length - 1);
  const pvPlatform = selPlatforms[pvIdx];
  // Mode simulé : aperçu de la prochaine occurrence de la série (rien n'est enregistré)
  const [simBusy,    setSimBusy]    = useState(false);
  const [simResult,  setSimResult]  = useState<{ title: string; content: string } | null>(null);
  const [simError,   setSimError]   = useState('');

  const handleSimulate = async () => {
    if (!post) return;
    setSimBusy(true);
    setSimError('');
    setSimResult(null);
    const res = await previewRecurrence(post.id, {
      recurrenceBrief: form.recurrenceBrief.trim() || undefined,
      recurrenceUseNews: form.recurrenceUseNews,
      recurrenceUseKnowledge: form.recurrenceUseKnowledge,
    });
    setSimBusy(false);
    if (res.success && res.data) setSimResult(res.data);
    else setSimError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Simulation échouée.');
  };

  const handleAnalyze = async () => {
    if (!post) return;
    setAnalyzing(true);
    setError('');
    const res = await analyzePostPerf(post.id);
    setAnalyzing(false);
    if (res.success && res.data) {
      setAnalysis(res.data.analysis + (res.data.learnings.length
        ? `\n\n---\n**${res.data.learnings.length} enseignement(s) ajouté(s) à la base de connaissances** — les prochaines générations en tiendront compte.`
        : ''));
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Analyse échouée.');
    }
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleGenerate = async (improve: boolean) => {
    if (!brief.trim() && !improve) { setError('Décrivez le sujet du post dans le brief.'); return; }
    setGenerating(true);
    setError('');
    const res = await generateContent({
      platform: form.platform,
      brief: brief.trim() || 'Améliore la clarté et l\'impact de ce contenu sans en changer le fond.',
      baseContent: improve ? form.content : undefined,
      useNews,
    });
    setGenerating(false);
    if (res.success && res.data) {
      setForm((f) => ({
        ...f,
        title: f.title || res.data!.title,
        content: res.data!.content + (res.data!.hashtags.length ? `\n\n${res.data!.hashtags.map((h) => `#${h}`).join(' ')}` : ''),
      }));
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED'
        ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).'
        : res.error || 'La génération a échoué.');
    }
  };

  const handleSync = async () => {
    if (!post) return;
    if (!form.externalUrl.trim()) {
      setError('Renseignez l\'URL du post publié pour synchroniser ses métriques.');
      return;
    }
    setSyncing(true);
    setError('');
    setSyncNote('');
    // L'URL doit être connue du serveur avant la synchro
    await updatePost(post.id, { externalUrl: form.externalUrl.trim(), status: form.status });
    const res = await syncPostMetrics(post.id);
    setSyncing(false);
    if (res.success && res.data) {
      const p = res.data.post;
      setForm((f) => ({
        ...f,
        impressions: p.impressions, likes: p.likes, comments: p.comments,
        shares: p.shares, clicks: p.clicks,
      }));
      setSyncNote(`Métriques synchronisées${res.data.note ? ` — ${res.data.note}` : ''}`);
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Composio non configuré (COMPOSIO_MCP_URL) — connectez vos comptes sur dashboard.composio.dev et renseignez l\'URL MCP côté serveur.'
        : res.error || 'La synchronisation a échoué.');
    }
  };

  // État de la publication immédiate (résultat affiché dans le pied de modale)
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ ok: boolean; lines: PublishOutcome[] } | null>(null);

  /** Enregistre le post (création ou mise à jour) + déclinaisons. Retourne le post sauvé. */
  const persist = async (): Promise<Post | null> => {
    setError('');
    const payload: Partial<Post> = {
      platform:    form.platform,
      title:       form.title,
      content:     form.content,
      status:      form.status,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      externalUrl: form.externalUrl.trim() || null,
      imageUrl:    form.imageUrl.trim() || null,
      subreddit:   form.subreddit.trim() || null,
      recurrence:  form.recurrence,
      recurrenceBrief: form.recurrence !== 'none' && form.recurrenceBrief.trim() ? form.recurrenceBrief.trim() : null,
      recurrenceUseNews:      form.recurrenceUseNews ? 1 : 0,
      recurrenceUseKnowledge: form.recurrenceUseKnowledge ? 1 : 0,
      recurrenceUpdateKb:     form.recurrenceUpdateKb ? 1 : 0,
      autoPublish: form.autoPublish ? 1 : 0,
      impressions: Number(form.impressions) || 0,
      likes:       Number(form.likes) || 0,
      comments:    Number(form.comments) || 0,
      shares:      Number(form.shares) || 0,
      clicks:      Number(form.clicks) || 0,
    };
    const res = post
      ? await updatePost(post.id, payload)
      : await createPost(payload as Partial<Post> & { platform: string });
    if (!res.success || !res.data) {
      setError(res.error || 'Enregistrement impossible.');
      return null;
    }
    // Déclinaison vers les autres plateformes sélectionnées (exemplaires liés)
    if (crossTargets.length > 0) {
      const cross = await crosspostPost(res.data.id, crossTargets, crossAdapt);
      if (!cross.success) {
        setError(`Post enregistré, mais déclinaison échouée : ${cross.error || 'erreur inconnue'}`);
        return null;
      }
      onCrossposted?.();
    }
    return res.data;
  };

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    const saved = await persist();
    setSaving(false);
    if (saved) onSaved(saved);
  };

  /** Publication immédiate et RÉELLE : enregistre d'abord, publie via Composio,
   *  puis affiche le résultat exact (lien publié ou raison de l'échec). */
  const handlePublishNow = async () => {
    setPublishing(true);
    setPublishResult(null);
    const saved = await persist();
    if (!saved) { setPublishing(false); return; }

    // Groupe : ce post + tous les exemplaires multi-plateformes non publiés
    const publishGroup = crossTargets.length > 0 || Boolean(saved.crossPostId);
    const res = await publishPostNow(saved.id, publishGroup);
    setPublishing(false);
    const lines: PublishOutcome[] = res.data?.results
      ?? [{ platform: saved.platform, ok: false, message: res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Composio n\'est pas configuré — connectez vos comptes dans Configuration pour publier depuis l\'app.'
        : res.error || 'erreur inconnue' }];
    const anyOk = lines.some((l) => l.ok);
    if (anyOk) {
      setForm((f) => ({
        ...f,
        status: res.data!.post.status as PostStatus,
        externalUrl: res.data!.post.externalUrl ?? f.externalUrl,
      }));
    }
    setPublishResult({ ok: anyOk, lines });
    onCrossposted?.(); // recharge la liste du Hub sans fermer l'éditeur
  };

  // Aperçu : le média attaché peut être une image, un GIF animé ou une vidéo
  const mediaUrl = form.imageUrl.trim();
  const mediaIsVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrl);

  return createPortal(
    <>
      {publishing && <PublishingOverlay />}
      <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-xl pe-modal-enter" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{post ? 'Modifier le post' : 'Nouveau post'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="post-editor pe-form">
          <div className="pe-grid">

            {/* ════ Colonne gauche : ce que VOUS écrivez et réglez ════ */}
            <div className="pe-col">

              {/* 1. Plateformes : multiselect — la première est la principale */}
              <section className="pe-panel" data-tour="pe-platforms">
                <h3 className="pe-panel-title">
                  Plateformes
                  {post?.crossPostId && <span className="form-hint-inline"> — fait partie d'un groupe multi-plateformes</span>}
                </h3>
                <div className="pf-select">
                  {PLATFORMS.map((p) => {
                    const pos = selPlatforms.indexOf(p.value);
                    return (
                      <button
                        key={p.value}
                        type="button"
                        className={`pf-chip${pos >= 0 ? ' on' : ''}${pos === 0 ? ' primary' : ''}`}
                        onClick={() => togglePlatform(p.value)}
                        title={pos === 0 ? 'Plateforme principale' : pos > 0 ? 'Exemplaire lié — re-cliquez pour retirer' : 'Ajouter cette plateforme'}
                      >
                        <PlatformIcon platform={p.value} size={15} />
                        {p.label}
                        {pos === 0 && selPlatforms.length > 1 && <em>principale</em>}
                      </button>
                    );
                  })}
                </div>
                {crossTargets.length > 0 && (
                  <>
                    <label className="ai-news-toggle">
                      <input type="checkbox" checked={crossAdapt} onChange={(e) => setCrossAdapt(e.target.checked)} />
                      Adapter le texte aux codes de chaque plateforme par l'IA (sinon copie telle quelle)
                    </label>
                    <span className="form-hint-inline">
                      À l'enregistrement, un exemplaire indépendant est créé par plateforme (même date, même
                      auto-publication) — chacun se publie et se mesure séparément.
                    </span>
                  </>
                )}
                {selPlatforms.includes('reddit') && (
                  <label className="form-label-block" style={{ marginTop: 12 }}>
                    Subreddit <span className="form-hint-inline">— obligatoire pour publier sur Reddit</span>
                    <div className="ai-assist-row">
                      <span style={{ alignSelf: 'center', color: 'var(--color-text-muted)', fontWeight: 600 }}>r/</span>
                      <input
                        className="form-input"
                        value={form.subreddit}
                        onChange={(e) => set('subreddit', e.target.value.replace(/^\/?r\//i, '').replace(/[^A-Za-z0-9_]/g, ''))}
                        placeholder="ex. SaaS, startups, Entrepreneur"
                      />
                    </div>
                    <span className="form-hint-inline">Le nom exact de la communauté, sans le « r/ ».</span>
                  </label>
                )}
              </section>

              {/* 2. Contenu */}
              <section className="pe-panel" data-tour="pe-content">
                <h3 className="pe-panel-title">Contenu</h3>
                <label className="form-label-block">
                  Statut
                  <select value={form.status} onChange={(e) => set('status', e.target.value as PostStatus)} className="form-input">
                    <option value="idea">Idée</option>
                    <option value="draft">Brouillon</option>
                    <option value="scheduled">Programmé</option>
                    <option value="published">Publié</option>
                  </select>
                </label>
                <label className="form-label-block">
                  Titre <span className="form-hint-inline">(usage interne)</span>
                  <input className="form-input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="ex. Annonce nouvelle fonctionnalité" />
                </label>
                <label className="form-label-block">
                  Texte du post
                  <textarea
                    className="form-input post-content-area"
                    value={form.content}
                    onChange={(e) => set('content', e.target.value)}
                    rows={12}
                    placeholder="Écrivez ici — ou briefez l'IA dans le panneau de droite, elle remplit ce champ."
                  />
                  <span className="form-hint-inline">{form.content.length} caractères</span>
                </label>
              </section>

              {/* 2. Média */}
              <section className="pe-panel" data-tour="pe-media">
                <h3 className="pe-panel-title">Média <span className="form-hint-inline">— image, GIF ou vidéo joint à la publication (obligatoire pour Instagram)</span></h3>
                <div className="ai-assist-row">
                  <input
                    className="form-input"
                    value={form.imageUrl}
                    onChange={(e) => set('imageUrl', e.target.value)}
                    placeholder="https://…/visuel.png — collez une URL, téléversez, ou générez à droite"
                  />
                  <button
                    type="button" className="btn btn-ghost"
                    onClick={() => fileRef.current?.click()}
                    disabled={imgBusy}
                    title="Téléverser une image (8 Mo max) ou une vidéo mp4/webm/mov (3 Go max) — la vidéo est supprimée du serveur une fois publiée"
                  >
                    {imgBusy ? '⏳…' : 'Téléverser'}
                  </button>
                  <input
                    ref={fileRef} type="file"
                    accept="image/*,video/mp4,video/webm,video/quicktime"
                    style={{ display: 'none' }}
                    onChange={handleUploadMedia}
                  />
                </div>
                <span className="form-hint-inline">
                  Vidéos jusqu'à 3 Go : le serveur ne sert que de relais — la vidéo est supprimée
                  automatiquement dès que la plateforme l'a récupérée, le post garde le lien publié.
                </span>
              </section>

              {/* 3. Planification */}
              <section className="pe-panel" data-tour="pe-schedule">
                <h3 className="pe-panel-title">Planification</h3>
                <div className="post-editor-row">
                  <label className="form-label-block">
                    Date de publication prévue
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={form.scheduledAt}
                      onChange={(e) => set('scheduledAt', e.target.value)}
                    />
                  </label>
                  <label className="form-label-block">
                    Récurrence
                    <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)} className="form-input">
                      {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((r) => (
                        <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                      ))}
                    </select>
                    {form.recurrence !== 'none' && (
                      <span className="form-hint-inline">Réglez l'IA de la série dans le panneau de droite.</span>
                    )}
                  </label>
                </div>
                {form.status === 'scheduled' && (
                  <label className={`autopublish-toggle${form.autoPublish ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={form.autoPublish}
                      onChange={(e) => set('autoPublish', e.target.checked)}
                    />
                    <span className="autopublish-text">
                      <span className="autopublish-title">Publication automatique</span>
                      <span className="form-hint-inline">
                        Le worker publie ce post tout seul à l'heure programmée via vos comptes Composio —
                        vérifiez le contenu avant d'activer.
                      </span>
                    </span>
                  </label>
                )}
                {post?.publishError && (
                  <div className="chat-error">
                    La publication automatique a échoué : {post.publishError} — corrigez puis réactivez l'option, ou publiez manuellement.
                  </div>
                )}
              </section>

              {/* 5. Mesure (posts publiés) */}
              {form.status === 'published' && (
                <section className="pe-panel">
                  <h3 className="pe-panel-title">Mesure</h3>
                  <label className="form-label-block">
                    URL du post publié
                    <div className="ai-assist-row">
                      <input
                        className="form-input"
                        value={form.externalUrl}
                        onChange={(e) => set('externalUrl', e.target.value)}
                        placeholder="ex. https://x.com/vous/status/12345…"
                      />
                      {post && (
                        <button type="button" className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
                          {syncing ? '⏳ Synchro…' : 'Synchroniser'}
                        </button>
                      )}
                      {/^https?:\/\//i.test(form.externalUrl.trim()) && (
                        <a className="btn btn-ghost" href={form.externalUrl.trim()} target="_blank" rel="noopener noreferrer"
                           title="Ouvrir le post publié sur la plateforme">
                          Ouvrir ↗
                        </a>
                      )}
                    </div>
                    <span className="form-hint-inline">
                      La synchro lit les métriques réelles via vos comptes connectés sur Composio. Sinon, saisie manuelle.
                    </span>
                  </label>
                  {syncNote && <div className="approval-feedback" style={{ marginBottom: 0 }}>{syncNote}</div>}
                  <div className="metrics-grid">
                    {([
                      ['impressions', 'Impressions'], ['likes', 'Likes'], ['comments', 'Commentaires'],
                      ['shares', 'Partages'], ['clicks', 'Clics'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="form-label-block">
                        {label}
                        <input
                          type="number" min={0} className="form-input"
                          value={form[key]}
                          onChange={(e) => set(key, Number(e.target.value) as never)}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* ════ Colonne droite : aperçu en direct + copilote IA ════ */}
            <div className="pe-col pe-col-right">

              {/* Aperçu — un rendu par plateforme sélectionnée, en carrousel */}
              <section className="pe-panel pe-preview" data-tour="pe-preview">
                <h3 className="pe-panel-title">
                  Aperçu
                  <span className="pe-preview-meta" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
                    {STATUS_META[form.status].label}
                    {form.scheduledAt && ` · ${new Date(form.scheduledAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </h3>
                {selPlatforms.length > 1 && (
                  <div className="pv-nav">
                    <button type="button" className="pv-nav-btn" onClick={() => setPreviewIdx((pvIdx - 1 + selPlatforms.length) % selPlatforms.length)}>‹</button>
                    <span className="pv-nav-label">
                      <PlatformIcon platform={pvPlatform} size={14} /> {platformLabel(pvPlatform)}
                      <em>{pvIdx + 1} / {selPlatforms.length}</em>
                    </span>
                    <button type="button" className="pv-nav-btn" onClick={() => setPreviewIdx((pvIdx + 1) % selPlatforms.length)}>›</button>
                  </div>
                )}
                <PlatformPreview
                  platform={pvPlatform}
                  title={form.title}
                  content={form.content}
                  mediaUrl={mediaUrl}
                  mediaIsVideo={mediaIsVideo}
                  subreddit={form.subreddit}
                />
                {pvIdx > 0 && crossAdapt && (
                  <span className="form-hint-inline">Le texte sera adapté aux codes de {platformLabel(pvPlatform)} par l'IA à l'enregistrement.</span>
                )}
                {selPlatforms.length > 1 && (
                  <div className="pv-dots">
                    {selPlatforms.map((pf, i) => (
                      <button key={pf} type="button" className={`pv-dot${i === pvIdx ? ' on' : ''}`} onClick={() => setPreviewIdx(i)} title={platformLabel(pf)} />
                    ))}
                  </div>
                )}
              </section>

              {/* Rédaction par l'IA */}
              <section className="pe-panel pe-ai" data-tour="pe-ai">
                <h3 className="pe-panel-title"><Sparkles size={14} /> Rédaction par l'IA</h3>
                <p className="form-hint" style={{ marginBottom: 8 }}>
                  S'appuie sur votre <Link to="/knowledge">base de connaissances</Link> et écrit
                  directement dans le texte du post, à gauche.
                </p>
                <textarea
                  className="form-input"
                  rows={2}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Brief : sujet, angle, objectif… ex. « Annoncer la v2 avec un avant/après client »"
                  disabled={generating}
                />
                <label className="ai-news-toggle">
                  <input type="checkbox" checked={useNews} onChange={(e) => setUseNews(e.target.checked)} />
                  S'appuyer sur les actus du web
                </label>
                <div className="ai-assist-row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-primary" onClick={() => handleGenerate(false)} disabled={generating || !brief.trim()}>
                    {generating ? '⏳ Rédaction…' : <><Sparkles size={15} /> Rédiger le post</>}
                  </button>
                  {form.content.trim() && (
                    <button type="button" className="btn btn-ghost" onClick={() => handleGenerate(true)} disabled={generating}>
                      <Wand2 size={15} /> Améliorer l'existant
                    </button>
                  )}
                </div>
                {generating && <ForgeProgress label="L'IA rédige votre post… (~20 s)" />}
              </section>

              {/* Visuel par l'IA */}
              <section className="pe-panel pe-ai">
                <h3 className="pe-panel-title"><Sparkles size={14} /> Visuel par l'IA</h3>
                <div className="ai-assist-row">
                  <input
                    className="form-input"
                    value={imgPrompt}
                    onChange={(e) => setImgPrompt(e.target.value)}
                    placeholder="Décrivez le visuel à générer (~0,04 $)…"
                    disabled={imgBusy}
                  />
                  <button type="button" className="btn btn-primary" onClick={handleGenerateImage} disabled={imgBusy || !imgPrompt.trim()}>
                    {imgBusy ? '⏳…' : 'Générer'}
                  </button>
                </div>
                {decks.length > 0 && (
                  <div className="ai-assist-row" style={{ marginTop: 8 }}>
                    <select
                      className="form-input"
                      value={selectedDeck}
                      onChange={(e) => setSelectedDeck(e.target.value)}
                      disabled={imgBusy}
                    >
                      <option value="">Depuis une présentation (onglet Slides)…</option>
                      {decks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost" onClick={handleDeckGif} disabled={imgBusy || !selectedDeck}
                            title="Transforme la présentation en GIF animé (fondus) et l'attache au post">
                      {imgBusy ? '⏳…' : 'GIF animé'}
                    </button>
                  </div>
                )}
                <span className="form-hint-inline">Le résultat s'attache au post et s'affiche dans l'aperçu ci-dessus.</span>
                {imgBusy && <ForgeProgress label="Génération du visuel en cours… (~15 s)" />}
                {imgError && <div className="chat-error" style={{ marginTop: 6 }}>{imgError}</div>}
              </section>

              {/* Série récurrente : pilotage de l'IA + mode simulé */}
              {form.recurrence !== 'none' && (
                <section className="pe-panel pe-ai">
                  <h3 className="pe-panel-title"><Sparkles size={14} /> Série récurrente — IA</h3>
                  <label className="form-label-block">
                    Instruction de régénération <span className="form-hint-inline">(sujet, angle, ce que l'IA doit chercher)</span>
                    <textarea
                      className="form-input"
                      value={form.recurrenceBrief}
                      onChange={(e) => set('recurrenceBrief', e.target.value)}
                      rows={3}
                      maxLength={600}
                      placeholder="ex. « Partage un conseil actionnable différent à chaque fois sur la prospection LinkedIn, avec un exemple concret »"
                    />
                    <span className="form-hint-inline">
                      Si renseignée, chaque occurrence est <strong>réécrite par l'IA</strong> — qui voit les
                      occurrences déjà publiées pour ne jamais se répéter. Vide = même contenu repris.
                    </span>
                  </label>
                  <div className="recur-toggles">
                    <label className="recur-toggle">
                      <input type="checkbox" checked={form.recurrenceUseKnowledge}
                             onChange={(e) => set('recurrenceUseKnowledge', e.target.checked)} />
                      S'appuyer sur la <Link to="/knowledge">base de connaissances</Link>
                    </label>
                    <label className="recur-toggle">
                      <input type="checkbox" checked={form.recurrenceUseNews}
                             onChange={(e) => set('recurrenceUseNews', e.target.checked)} />
                      Rechercher les actualités du web sur le sujet
                    </label>
                    {form.recurrenceUseNews && (
                      <label className="recur-toggle">
                        <input type="checkbox" checked={form.recurrenceUpdateKb}
                               onChange={(e) => set('recurrenceUpdateKb', e.target.checked)} />
                        Archiver les actus utilisées dans la fiche « Veille »
                      </label>
                    )}
                  </div>
                  <div className="ai-assist-row" style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn-ghost" onClick={handleSimulate}
                            disabled={simBusy || !post || !form.recurrenceBrief.trim()}
                            title={!post ? 'Enregistrez d\'abord le post pour pouvoir simuler'
                              : !form.recurrenceBrief.trim() ? 'Renseignez l\'instruction de régénération'
                              : 'Génère la prochaine occurrence avec ces réglages — rien n\'est enregistré'}>
                      {simBusy ? '⏳ Simulation…' : 'Simuler la prochaine occurrence'}
                    </button>
                    {!post && <span className="form-hint-inline">Enregistrez d'abord le post.</span>}
                  </div>
                  {simError && <div className="chat-error" style={{ marginTop: 6 }}>{simError}</div>}
                  {simResult && (
                    <div className="recur-sim-result">
                      <div className="recur-sim-head">
                        <span>Simulation — <strong>{simResult.title}</strong></span>
                        <button type="button" className="btn btn-ghost btn-sm"
                                onClick={() => { set('title', simResult.title); set('content', simResult.content); setSimResult(null); }}
                                title="Remplace le titre et le contenu du post par cette simulation">
                          Utiliser ce contenu
                        </button>
                      </div>
                      <div className="recur-sim-body"><Markdown text={simResult.content} /></div>
                      <span className="form-hint-inline">Simple aperçu : rien n'a été enregistré ni archivé.</span>
                    </div>
                  )}
                </section>
              )}

              {/* Analyse IA du post publié */}
              {post && form.status === 'published' && (
                <section className="pe-panel pe-ai">
                  <h3 className="pe-panel-title">
                    <Sparkles size={14} /> Analyse de performance
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                            onClick={handleAnalyze} disabled={analyzing}>
                      {analyzing ? '⏳ Analyse…' : analysis ? '↺ Re-analyser' : 'Analyser ce post'}
                    </button>
                  </h3>
                  {analysis && (
                    <div style={{ fontSize: '0.85rem', marginTop: 6 }}>
                      <Markdown text={analysis} />
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          {publishResult && (
            <div className="publish-results" role="status">
              {publishResult.lines.map((l) => (
                <div key={l.platform} className={`publish-result${l.ok ? ' ok' : ' ko'}`}>
                  <span>{l.ok ? '✓' : '✗'}</span>
                  <span className="publish-result-platform">{platformLabel(l.platform)}</span>
                  <span className="publish-result-text">{l.message}</span>
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noopener noreferrer">Voir le post ↗</a>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="modal-footer pe-footer">
            {error && <span className="chat-error pe-footer-error">{error}</span>}
            {readOnly && <span className="form-hint-inline pe-footer-error">👁️ Lecture seule — vous êtes Lecteur sur ce projet.</span>}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {publishResult?.ok ? 'Fermer' : (readOnly ? 'Fermer' : 'Annuler')}
            </button>
            {!readOnly && (
            <button type="submit" className="btn btn-ghost pe-save-btn" disabled={saving || publishing}>
              {saving
                ? (crossTargets.length > 0 ? '⏳ Enregistrement + déclinaison…' : '⏳ Enregistrement…')
                : crossTargets.length > 0 ? `Enregistrer sur ${selPlatforms.length} plateformes` : 'Enregistrer'}
            </button>
            )}
            {!readOnly && form.status !== 'published' && (
              <button
                type="button"
                data-tour="pe-publish"
                className="btn btn-primary btn-primary-glow"
                onClick={handlePublishNow}
                disabled={publishing || saving || !form.content.trim()}
                title={crossTargets.length > 0 || post?.crossPostId
                  ? 'Enregistre puis publie immédiatement ce post ET tous ses exemplaires multi-plateformes non publiés — un résultat par plateforme'
                  : `Enregistre puis publie immédiatement sur ${platformLabel(form.platform)} via vos comptes connectés`}
              >
                {publishing
                  ? '⏳ Publication en cours…'
                  : <><Send size={15} /> {selPlatforms.length > 1
                      ? `Publier maintenant sur ${selPlatforms.length} plateformes`
                      : post?.crossPostId
                        ? 'Publier maintenant (tout le groupe)'
                        : `Publier maintenant sur ${platformLabel(form.platform)}`}</>}
              </button>
            )}
          </div>
        </form>
      </div>
      </div>
    </>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — génération du calendrier éditorial
// ─────────────────────────────────────────────────────────────────────────────

const CALENDAR_PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'reddit', 'blog', 'newsletter'];

function CalendarModal({ onClose, onGenerated }: {
  onClose: () => void;
  onGenerated: (posts: Post[]) => void;
}) {
  const [weeks,        setWeeks]        = useState(2);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [platforms,    setPlatforms]    = useState<Set<string>>(new Set(['linkedin', 'twitter']));
  const [startDate,    setStartDate]    = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });

  const generate = async () => {
    if (platforms.size === 0) { setError('Choisissez au moins une plateforme.'); return; }
    setBusy(true);
    setError('');
    const res = await generateCalendar({
      weeks,
      postsPerWeek,
      platforms: [...platforms],
      startDate: new Date(`${startDate}T09:00:00`).toISOString(),
    });
    setBusy(false);
    if (res.success && res.data) {
      onGenerated(res.data);
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED'
        ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).'
        : res.error || 'La génération a échoué — réessayez.');
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Générer mon calendrier</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="post-editor">
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
            L'IA rédige et programme un lot de posts complets à partir de votre
            plan de lancement et de votre base de connaissances — progression
            cohérente : teasing → valeur → preuve sociale → conversion.
          </p>

          <div className="post-editor-row">
            <label className="form-label-block">
              Durée
              <select className="form-input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w} semaine{w > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <label className="form-label-block">
              Posts par semaine
              <select className="form-input" value={postsPerWeek} onChange={(e) => setPostsPerWeek(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <label className="form-label-block">
            Date de début
            <input type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>

          <label className="form-label-block">
            Plateformes
            <div className="calendar-platforms">
              {CALENDAR_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`knowledge-cat${platforms.has(p) ? ' active' : ''}`}
                  onClick={() => togglePlatform(p)}
                >
                  {platformLabel(p)}
                </button>
              ))}
            </div>
          </label>

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={generate} disabled={busy}>
              {busy ? '⏳ Rédaction de vos posts… (≈ 1 min)' : <><Sparkles size={15} /> Générer {Math.min(weeks * postsPerWeek, 20)} posts</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — import d'un post déjà publié (par son URL)
// ─────────────────────────────────────────────────────────────────────────────

function ImportPostModal({ onClose, onImported }: {
  onClose: () => void;
  onImported: (post: Post, info: { synced: boolean; note?: string; commentsAdded: number }) => void;
}) {
  const [url,      setUrl]      = useState('');
  const [platform, setPlatform] = useState('');   // '' = détection automatique
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const detected = useMemo(() => detectPlatformFromUrl(url), [url]);
  const urlValid = /^https?:\/\/\S+/i.test(url.trim());
  // Reflète la déduction du backend : domaine inconnu → « blog » (non syncable)
  const effective = platform || detected || (urlValid ? 'blog' : '');
  const noMetrics = Boolean(effective) && !SYNCABLE_PLATFORMS.has(effective);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const clean = url.trim();
    if (!/^https?:\/\/\S+/i.test(clean)) {
      setError('Collez l\'URL complète (https://…) du post publié.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await importPost(clean, platform || undefined);
    setBusy(false);
    if (res.success && res.data) {
      onImported(res.data.post, { synced: res.data.synced, note: res.data.note, commentsAdded: res.data.commentsAdded });
    } else {
      setError(res.error || 'Import échoué — vérifiez l\'URL et réessayez.');
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importer un post publié</h2>
          <button className="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <form className="post-editor" onSubmit={submit}>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
            Collez le lien d'un post déjà en ligne : il rejoint le Hub en statut
            <strong> Publié</strong>, et l'analyse récupère aussitôt ses vues, likes
            et commentaires via vos comptes connectés.
          </p>

          <label className="form-label-block">
            URL du post
            <input
              className="form-input"
              type="url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/feed/update/…"
              disabled={busy}
            />
          </label>

          <label className="form-label-block">
            Plateforme
            <select className="form-input" value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={busy}>
              <option value="">{detected ? `Détectée : ${platformLabel(detected)}` : 'Détection automatique'}</option>
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>

          {noMetrics && (
            <p className="form-hint-inline">
              Cette plateforme n'a pas de récupération automatique des métriques — le
              post sera importé sans chiffres (saisie manuelle possible ensuite).
            </p>
          )}

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? '⏳ Import + analyse en cours…' : <><Download size={15} /> Importer &amp; analyser</>}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'posts' | 'decks';

export default function ContentHubPage() {
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [activeProject, setActiveProject] = useState<{ id: string; name: string; role?: string } | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<Tab>('posts');
  const [editing,  setEditing]  = useState<Post | null | 'new'>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [feedback,     setFeedback]     = useState('');
  const [publishingNowId, setPublishingNowId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Arrivée depuis la génération du plan : accueil + brouillons à valider
  useEffect(() => {
    const drafts = searchParams.get('drafts');
    if (drafts !== null) {
      setFeedback(Number(drafts) > 0
        ? `Votre plan est prêt — et ${drafts} idées de posts ont été rédigées et datées par l'IA (statut Brouillon). Relisez-les, ajustez, puis programmez-les.`
        : 'Votre plan est prêt ! Générez votre calendrier de contenu avec le bouton ci-dessus.');
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tutoriel « éditeur de post » : ouvre un nouveau post pour que la visite
  // guidée puisse pointer ses champs (déclenché par ?tutorial=post)
  useEffect(() => {
    if (searchParams.get('tutorial') === 'post') {
      setEditing('new');
      searchParams.delete('tutorial');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [statusFilter,   setStatusFilter]   = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [search,   setSearch]   = useState('');
  const [sortBy,   setSortBy]   = useState<'createdAt' | 'scheduledAt' | 'publishedAt'>('createdAt');
  const [sortDir,  setSortDir]  = useState<'desc' | 'asc'>('desc');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [actionMenu, setActionMenu] = useState<{ post: Post; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    // Posts déjà scopés au projet actif côté serveur ; l'overview (léger,
    // souvent en cache) ne sert qu'au nom du projet affiché en en-tête.
    const [postsRes, overviewRes] = await Promise.all([getPosts(), getOverview()]);
    if (postsRes.success && postsRes.data) setAllPosts(postsRes.data);
    if (overviewRes.success && overviewRes.data?.project) {
      const p = overviewRes.data.project;
      setActiveProject({ id: p.id, name: p.productName, role: p.role });
    }
    setLoading(false);
  }, []);

  const posts = allPosts;

  // Le menu d'actions est en position: fixed — on le ferme dès qu'on scrolle
  // (n'importe quel conteneur) ou qu'on redimensionne pour éviter qu'il se détache.
  useEffect(() => {
    if (!actionMenu) return;
    const close = () => setActionMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenu]);

  useEffect(() => { load(); }, [load]);

  // ?edit=<postId> (vue Performances) → ouvre directement l'éditeur du post
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && allPosts.length > 0) {
      const target = allPosts.find((p) => p.id === editId);
      if (target) {
        setEditing(target);
        searchParams.delete('edit');
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPosts]);

  const handleSaved = (saved: Post) => {
    setEditing(null);
    setAllPosts((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
    });
  };

  // Mise à jour d'un post publié (synchro métriques, URL) sans fermer la vue
  const handlePublishedUpdate = (saved: Post) => {
    setAllPosts((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
  };

  // Post importé depuis une URL : ajouté en tête (publié), métriques déjà
  // récupérées si l'analyse a abouti. On neutralise tout filtre/recherche qui le
  // masquerait, sinon il resterait invisible malgré le message de succès.
  const handleImported = (post: Post, info: { synced: boolean; note?: string; commentsAdded: number }) => {
    setShowImport(false);
    setAllPosts((prev) => (prev.some((p) => p.id === post.id)
      ? prev.map((p) => (p.id === post.id ? post : p))
      : [post, ...prev]));
    if (statusFilter !== 'all' && statusFilter !== 'published') setStatusFilter('all');
    if (platformFilter !== 'all' && platformFilter !== post.platform) setPlatformFilter('all');
    if (search.trim()) setSearch('');
    const bits = [`Post importé (${platformLabel(post.platform)})`];
    if (info.synced) {
      bits.push(`analyse OK : ${fmtNum(post.impressions)} vues · ${fmtNum(post.likes)} likes`
        + (info.commentsAdded > 0 ? ` · ${info.commentsAdded} commentaire${info.commentsAdded > 1 ? 's' : ''} récupéré${info.commentsAdded > 1 ? 's' : ''}` : ''));
    }
    // Note toujours affichée si présente (ex. « LinkedIn n'expose pas les vues »),
    // y compris sur une analyse réussie — cohérent avec la synchro manuelle.
    if (info.note) bits.push(info.note);
    // Contenu non récupéré (LinkedIn refuse le corps via son API) → on invite à
    // le coller en ouvrant le post.
    if (!post.content) {
      bits.push(post.platform === 'linkedin'
        ? 'LinkedIn ne fournit pas le texte du post — ouvrez-le pour le coller'
        : 'texte non récupéré — ouvrez le post pour le compléter');
    }
    setFeedback(bits.join(' — '));
  };

  const handleDelete = async (post: Post) => {
    if (!window.confirm(`Supprimer « ${post.title || platformLabel(post.platform)} » ?`)) return;
    const res = await deletePost(post.id);
    if (res.success) setAllPosts((prev) => prev.filter((p) => p.id !== post.id));
  };

  const handlePublish = async (post: Post) => {
    const res = await publishPost(post.id);
    if (res.success && res.data) {
      const { post: updated, next } = res.data;
      setAllPosts((prev) => {
        const out = prev.map((p) => (p.id === updated.id ? updated : p));
        return next ? [next, ...out] : out;
      });
    }
  };

  // Publication réelle immédiate depuis la liste (groupe entier si multi-post)
  const handlePublishNow = async (post: Post) => {
    if (publishingNowId) return;
    setPublishingNowId(post.id);
    try {
      const res = await publishPostNow(post.id, Boolean(post.crossPostId));
      if (res.success && res.data) {
        const lines = res.data.results
          .map((r: PublishOutcome) => `${platformLabel(r.platform)} : ${r.ok ? 'publié ✓' : r.message}`)
          .join(' — ');
        setFeedback(lines || res.data.message);
      } else {
        setFeedback(`Échec de la publication : ${res.error || 'erreur inconnue'}`);
      }
    } finally {
      setPublishingNowId(null);
      load();
    }
  };

  // ── Données dérivées ──
  const now = Date.now();
  const upcoming = useMemo(
    () => posts
      .filter((p) => p.status === 'scheduled' && p.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
      .slice(0, 5),
    [posts],
  );
  const published = useMemo(() => posts.filter((p) => p.status === 'published'), [posts]);

  // Séries récurrentes actives : la prochaine occurrence (programmée ou brouillon)
  // de chaque série, avec le nombre d'occurrences déjà publiées
  const recurringSeries = useMemo(() => {
    const heads = posts.filter((p) => p.recurrence !== 'none' && (p.status === 'scheduled' || p.status === 'draft'));
    return heads.map((p) => {
      const sid = p.seriesId ?? p.id;
      const publishedCount = posts.filter((x) => (x.seriesId ?? x.id) === sid && x.status === 'published').length;
      return { post: p, publishedCount };
    });
  }, [posts]);

  const totals = useMemo(() => {
    const impressions = published.reduce((s, p) => s + p.impressions, 0);
    const interactions = published.reduce((s, p) => s + p.likes + p.comments + p.shares, 0);
    return {
      published: published.length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      impressions,
      engagement: impressions > 0 ? (interactions / impressions) * 100 : null,
    };
  }, [posts, published]);

  const filtered = useMemo(() => {
    const result = posts.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (platformFilter !== 'all' && p.platform !== platformFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !p.content.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    result.sort((a, b) => {
      const av = a[sortBy] ? new Date(a[sortBy]!).getTime() : 0;
      const bv = b[sortBy] ? new Date(b[sortBy]!).getTime() : 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return result;
  }, [posts, statusFilter, platformFilter, search, sortBy, sortDir]);

  if (loading) return <Loader text="Chargement du hub de contenu…" />;

  const readOnly = activeProject?.role === 'viewer';

  return (
    <div className="animate-fadeIn">
      {publishingNowId && <PublishingOverlay />}
      <div className="dashboard-header">
        <div>
          <h1>Hub de contenu</h1>
          <p>
            {activeProject && <span className="chip chip-project">Projet : {activeProject.name}</span>}
            {' '}Planifiez, rédigez avec l'IA, publiez et suivez les performances.
          </p>
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" data-tour="hub-assistant" onClick={() => setShowAssistant(true)} title="Chat IA : idées, recherche web, rédaction, enregistrement direct">
              Assistant
            </button>
            <button className="btn btn-ghost" data-tour="hub-calendar" onClick={() => setShowCalendar(true)} title="L'IA rédige et programme plusieurs semaines de posts d'après votre plan et vos connaissances">
              Générer mon calendrier
            </button>
            <button className="btn btn-ghost" data-tour="hub-import" onClick={() => setShowImport(true)} title="Importer un post déjà publié par son URL — likes et commentaires récupérés automatiquement">
              <Download size={15} /> Importer un post
            </button>
            <button className="btn btn-primary" data-tour="hub-new" onClick={() => setEditing('new')}>＋ Nouveau post</button>
          </div>
        )}
      </div>

      {readOnly && (
        <div className="approval-feedback" style={{ background: 'var(--color-surface-2)' }}>
          👁️ Vous consultez ce projet en <strong>Lecteur</strong> — la création et la publication sont réservées aux éditeurs.
        </div>
      )}

      {feedback && (
        <div className="approval-feedback" onClick={() => setFeedback('')}>{feedback}</div>
      )}

      {/* Stats */}
      <div className="dashboard-stats">
        <div className="stat-card"><span className="stat-card-icon"><CalendarClock size={20} /></span><div className="stat-card-value">{totals.scheduled}</div><div className="stat-card-label">Programmés</div></div>
        <div className="stat-card"><span className="stat-card-icon"><CheckCircle2 size={20} /></span><div className="stat-card-value">{totals.published}</div><div className="stat-card-label">Publiés</div></div>
        <div className="stat-card"><span className="stat-card-icon"><Eye size={20} /></span><div className="stat-card-value">{fmtNum(totals.impressions)}</div><div className="stat-card-label">Impressions</div></div>
        <div className="stat-card"><span className="stat-card-icon"><TrendingUp size={20} /></span><div className="stat-card-value">{totals.engagement !== null ? `${totals.engagement.toFixed(1)} %` : '—'}</div><div className="stat-card-label">Engagement moyen</div></div>
      </div>

      {/* À publier prochainement */}
      {upcoming.length > 0 && (
        <div className="upcoming-strip">
          <div className="upcoming-title">⏭ Prochaines publications</div>
          {upcoming.map((p) => {
            const overdue = new Date(p.scheduledAt!).getTime() < now;
            return (
              <div key={p.id} className={`upcoming-item${overdue ? ' overdue' : ''}`}>
                <span className="upcoming-name" onClick={() => setEditing(p)}>{p.title || platformLabel(p.platform)}</span>
                {p.recurrence !== 'none' && <span className="chip chip-recur">{RECURRENCE_LABELS[p.recurrence]}</span>}
                {p.recurrence !== 'none' && p.recurrenceBrief && <span className="chip chip-recur" title="Chaque occurrence est régénérée par l'IA à partir de votre instruction">IA</span>}
                {Boolean(p.autoPublish) && <span className="chip chip-auto" title="Publication automatique activée">auto</span>}
                {Boolean(p.calendarSynced) && <span title="Ajouté à votre calendrier personnel"></span>}
                <span className={`upcoming-date${overdue ? ' overdue' : ''}`}>
                  {overdue ? 'En retard — ' : ''}{fmtDate(p.scheduledAt)}
                </span>
                <button className="btn btn-sm btn-primary btn-primary-glow" disabled={publishingNowId !== null}
                        title="Publie réellement sur la plateforme via vos comptes connectés"
                        onClick={() => handlePublishNow(p)}>
                  {publishingNowId === p.id ? 'Publication…' : 'Publier maintenant'}
                </button>
                <button className="btn btn-sm btn-ghost" title="Marque le post comme publié sans rien envoyer"
                        onClick={() => handlePublish(p)}>Marquer publié</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Séries récurrentes : la machine à contenu qui tourne toute seule */}
      {recurringSeries.length > 0 && (
        <div className="upcoming-strip recur-strip">
          <div className="upcoming-title">Séries récurrentes</div>
          {recurringSeries.map(({ post: p, publishedCount }) => (
            <div key={p.id} className="upcoming-item">
              <span className="upcoming-name" onClick={() => setEditing(p)}>{p.title || platformLabel(p.platform)}</span>
              <span className="chip chip-recur">{RECURRENCE_LABELS[p.recurrence]}</span>
              {p.recurrenceBrief && <span className="chip chip-recur" title={`Régénérée par l'IA : ${p.recurrenceBrief}`}>IA</span>}
              {Boolean(p.recurrenceUseNews) && <span className="chip chip-recur" title="S'appuie sur les actualités du web">actus</span>}
              {!p.recurrenceUseKnowledge && <span className="chip chip-recur" title="Base de connaissances désactivée pour cette série">off</span>}
              {Boolean(p.recurrenceUpdateKb) && <span className="chip chip-recur" title="Archive les actus utilisées dans la fiche Veille">veille</span>}
              {Boolean(p.autoPublish) && <span className="chip chip-auto" title="Publication automatique activée">auto</span>}
              {publishedCount > 0 && <span className="form-hint-inline">{publishedCount} publiée{publishedCount > 1 ? 's' : ''}</span>}
              <span className="upcoming-date">
                {p.status === 'scheduled' ? `prochaine : ${fmtDate(p.scheduledAt)}` : 'brouillon'}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Gérer</button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="hub-tabs" data-tour="hub-tabs">
        <button className={`hub-tab${tab === 'posts' ? ' active' : ''}`} onClick={() => setTab('posts')}>Posts</button>
        <button className={`hub-tab${tab === 'decks' ? ' active' : ''}`} onClick={() => setTab('decks')}>Slides</button>
      </div>

      {tab === 'decks' ? (
        <DecksPanel />
      ) : tab === 'posts' ? (
        <>
          {/* Filtres */}
          <div className="kanban-toolbar" data-tour="hub-filters">
            <input className="kanban-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un post…" />
            <select className="kanban-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tous les statuts</option>
              <option value="idea">Idées</option>
              <option value="draft">Brouillons</option>
              <option value="scheduled">Programmés</option>
              <option value="published">Publiés</option>
            </select>
            <select className="kanban-select" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="all">Toutes plateformes</option>
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select className="kanban-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="createdAt">Trier par création</option>
              <option value="scheduledAt">Trier par programmation</option>
              <option value="publishedAt">Trier par publication</option>
            </select>
            <button className="btn btn-ghost btn-icon-sm" title={sortDir === 'desc' ? 'Du plus récent au plus ancien' : 'Du plus ancien au plus récent'}
                    onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
              <ArrowUpDown size={15} />
              {sortDir === 'desc' ? '↓' : '↑'}
            </button>
            <div className="view-toggle">
              <button className={`view-toggle-btn${viewMode === 'cards' ? ' active' : ''}`} title="Vue cartes" onClick={() => setViewMode('cards')}><LayoutGrid size={16} /></button>
              <button className={`view-toggle-btn${viewMode === 'table' ? ' active' : ''}`} title="Vue tableau" onClick={() => setViewMode('table')}><Table2 size={16} /></button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="plan-empty">
              <span className="plan-empty-icon"><Megaphone size={40} /></span>
              <h2>{posts.length === 0 ? 'Aucun post pour l\'instant' : 'Aucun post ne correspond aux filtres'}</h2>
              <p>Créez votre premier post — l'assistant IA le rédige à partir de votre base de connaissances — ou importez un post déjà publié pour en suivre les performances.</p>
              {!readOnly && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button className="btn btn-primary btn-lg" style={{ display: 'inline-flex' }} onClick={() => setEditing('new')}>
                    ＋ Créer un post
                  </button>
                  <button className="btn btn-ghost btn-lg" style={{ display: 'inline-flex' }} onClick={() => setShowImport(true)}>
                    <Download size={16} /> Importer un post
                  </button>
                </div>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <div className="post-table-wrap">
              <table className="post-table">
                <colgroup>
                  <col className="col-platform" />
                  <col className="col-title" />
                  <col className="col-status" />
                  <col className="col-date" />
                  <col className="col-date" />
                  <col className="col-date" />
                  <col className="col-recur" />
                  <col className="col-auto" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-engage" />
                  <col className="col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Plateforme</th>
                    <th>Titre</th>
                    <th>Statut</th>
                    <th>Créé</th>
                    <th>Programmé</th>
                    <th>Publié</th>
                    <th>Récurrence</th>
                    <th>Auto</th>
                    <th>Imp.</th>
                    <th>Likes</th>
                    <th>Com.</th>
                    <th>Part.</th>
                    <th>Clics</th>
                    <th>Engage.</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const rate = engagementRate(p);
                    return (
                      <tr key={p.id} className={`post-table-row${p.publishError ? ' post-table-row-error' : ''}`}
                          title={p.publishError ? `Échec de publication : ${p.publishError}` : undefined}
                          onClick={() => setEditing(p)}>
                        <td className="post-table-platform" data-label="Plateforme">
                          <span className="post-platform">{platformLabel(p.platform)}</span>
                          {p.crossPostId && <span className="chip chip-recur" title="Multi-plateformes">multi</span>}
                        </td>
                        <td className="post-table-title" data-label="Titre">{p.title || <em>(sans titre)</em>}</td>
                        <td data-label="Statut"><span className={`post-status ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span></td>
                        <td className="post-table-date" data-label="Créé">{fmtDateShort(p.createdAt)}</td>
                        <td className="post-table-date" data-label="Programmé">{fmtDateShort(p.scheduledAt)}</td>
                        <td className="post-table-date" data-label="Publié">{fmtDateShort(p.publishedAt)}</td>
                        <td data-label="Récurrence">
                          {p.recurrence !== 'none' ? (
                            <span className="chip chip-recur" title={p.recurrenceBrief ?? undefined}>
                              {RECURRENCE_LABELS[p.recurrence]}{p.recurrenceBrief ? ' IA' : ''}
                            </span>
                          ) : <span className="post-table-muted">—</span>}
                        </td>
                        <td data-label="Auto">{Boolean(p.autoPublish) ? <span className="chip chip-auto">auto</span> : <span className="post-table-muted">—</span>}</td>
                        <td className="post-table-num" data-label="Impressions">{fmtNum(p.impressions)}</td>
                        <td className="post-table-num" data-label="Likes">{fmtNum(p.likes)}</td>
                        <td className="post-table-num" data-label="Commentaires">{fmtNum(p.comments)}</td>
                        <td className="post-table-num" data-label="Partages">{fmtNum(p.shares)}</td>
                        <td className="post-table-num" data-label="Clics">{fmtNum(p.clicks)}</td>
                        <td className="post-table-num" data-label="Engagement">{rate !== null ? `${rate.toFixed(1)} %` : <span className="post-table-muted">—</span>}</td>
                        <td data-label="Actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn-table-menu"
                            title="Actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionMenu((cur) => (cur?.post.id === p.id ? null : { post: p, x: e.clientX, y: e.clientY }));
                            }}
                          >⋯</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {actionMenu && createPortal(
                <div className="table-action-layer" onClick={() => setActionMenu(null)} onContextMenu={() => setActionMenu(null)}>
                  <div
                    className="table-action-dropdown"
                    style={{ top: actionMenu.y + 4, left: actionMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button className="table-action-item" onClick={() => { setEditing(actionMenu.post); setActionMenu(null); }}>
                      Modifier
                    </button>
                    {actionMenu.post.status === 'scheduled' && (
                      <button className="table-action-item" disabled={publishingNowId !== null}
                              onClick={() => { handlePublishNow(actionMenu.post); setActionMenu(null); }}>
                        {publishingNowId === actionMenu.post.id ? 'Publication…' : 'Publier maintenant'}
                      </button>
                    )}
                    {actionMenu.post.status === 'scheduled' && (
                      <button className="table-action-item" onClick={() => { handlePublish(actionMenu.post); setActionMenu(null); }}>
                        Marquer publié
                      </button>
                    )}
                    {actionMenu.post.status === 'published' && actionMenu.post.externalUrl && /^https?:/i.test(actionMenu.post.externalUrl) && (
                      <a className="table-action-item" href={actionMenu.post.externalUrl} target="_blank" rel="noopener noreferrer"
                         onClick={() => setActionMenu(null)}>
                        Voir le post ↗
                      </a>
                    )}
                    <button className="table-action-item table-action-danger"
                            onClick={() => { handleDelete(actionMenu.post); setActionMenu(null); }}>
                      Supprimer
                    </button>
                  </div>
                </div>,
                document.body,
              )}
            </div>
          ) : (
            <div className="post-grid">
              {!readOnly && (
                <button type="button" className="post-card post-card-import" onClick={() => setShowImport(true)}
                        title="Importer un post déjà publié par son URL">
                  <span className="post-card-import-icon"><Download size={22} /></span>
                  <span className="post-card-import-title">Importer un post</span>
                  <span className="post-card-import-hint">
                    Collez le lien d'un post publié — likes & commentaires récupérés automatiquement
                  </span>
                  <span className="btn btn-ghost btn-sm post-card-import-btn">Importer</span>
                </button>
              )}
              {filtered.map((p) => {
                const rate = engagementRate(p);
                return (
                  <div key={p.id} className="post-card" onClick={() => setEditing(p)}>
                    <div className="post-card-top">
                      <span className="post-platform">{platformLabel(p.platform)}</span>
                      <span className={`post-status ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span>
                      <button className="kanban-delete" title="Supprimer" onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>×</button>
                    </div>
                    <div className="post-card-title">{p.title || '(sans titre)'}</div>
                    {p.content && <div className="post-card-excerpt">{p.content.slice(0, 140)}{p.content.length > 140 ? '…' : ''}</div>}
                    <div className="post-card-footer">
                      {p.crossPostId && <span className="chip chip-recur" title="Même contenu décliné sur plusieurs plateformes — performances comparées dans la vue Performances">multi</span>}
                      {p.recurrence !== 'none' && <span className="chip chip-recur">{RECURRENCE_LABELS[p.recurrence]}</span>}
                      {p.recurrence !== 'none' && p.recurrenceBrief && (
                        <span className="chip chip-recur" title="Chaque occurrence est régénérée par l'IA à partir de votre instruction">IA</span>
                      )}
                      {Boolean(p.autoPublish) && p.status === 'scheduled' && (
                        <span className="chip chip-auto" title="Sera publié automatiquement à l'heure programmée">auto</span>
                      )}
                      {p.publishError && (
                        <span className="chip chip-error" title={p.publishError}>échec auto</span>
                      )}
                      {p.status === 'published' && p.externalUrl && /^https?:/i.test(p.externalUrl) && (
                        <a className="post-card-link" href={p.externalUrl} target="_blank" rel="noopener noreferrer"
                           onClick={(e) => e.stopPropagation()} title="Ouvrir le post publié sur la plateforme">
                          Voir le post ↗
                        </a>
                      )}
                      {p.status === 'published' && (
                        <span className="post-card-metrics">
                          {fmtNum(p.impressions)} · {fmtNum(p.likes)}{rate !== null && ` · ${rate.toFixed(1)} %`}
                        </span>
                      )}
                      {p.status === 'scheduled' && (
                        <div className="post-card-actions">
                          <button className="btn btn-xs btn-primary" disabled={publishingNowId !== null}
                                  title="Publie réellement sur la plateforme via vos comptes connectés"
                                  onClick={(e) => { e.stopPropagation(); handlePublishNow(p); }}>
                            {publishingNowId === p.id ? 'Publication…' : 'Publier maintenant'}
                          </button>
                          <button className="btn btn-xs btn-ghost" title="Marque le post comme publié sans rien envoyer"
                                  onClick={(e) => { e.stopPropagation(); handlePublish(p); }}>
                            ✓ Marquer publié
                          </button>
                        </div>
                      )}
                      <span className="post-card-date">{cardDateLabel(p)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {editing !== null && (
        editing !== 'new' && editing.status === 'published' ? (
          <PublishedPostView
            post={editing}
            readOnly={readOnly}
            onClose={() => setEditing(null)}
            onSaved={handlePublishedUpdate}
          />
        ) : (
          <PostEditor
            post={editing === 'new' ? null : editing}
            readOnly={readOnly}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
            onCrossposted={load}
          />
        )
      )}
      {!showAssistant && !readOnly && (
        <button
          className="assistant-fab"
          onClick={() => setShowAssistant(true)}
          title="Assistant de création de posts"
        ><MessageSquare size={22} /></button>
      )}
      <PostAssistant
        open={showAssistant}
        onClose={() => setShowAssistant(false)}
        onPostsSaved={() => { load(); setFeedback('L\'assistant a enregistré un post — il est dans la liste ci-dessous.'); }}
      />
      {showImport && (
        <ImportPostModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
      {showCalendar && (
        <CalendarModal
          onClose={() => setShowCalendar(false)}
          onGenerated={(created) => {
            setShowCalendar(false);
            setAllPosts((prev) => [...created, ...prev]);
            setTab('posts');
            setFeedback(`${created.length} posts rédigés et programmés — relisez-les dans la liste ci-dessous avant publication.`);
          }}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Onglet Slides — présentations Marp générées par l'IA (thème : Configuration)
// ─────────────────────────────────────────────────────────────────────────────

function DecksPanel() {
  const [decks,   setDecks]   = useState<DeckSummary[]>([]);
  const [brief,   setBrief]   = useState('');
  const [slides,  setSlides]  = useState(8);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDecks().then((res) => {
      if (res.success && res.data) setDecks(res.data);
      setLoading(false);
    });
  }, []);

  const handleCreate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError('');
    const res = await createDeck(brief.trim(), slides);
    setBusy(false);
    if (res.success && res.data) {
      setDecks((prev) => [res.data!, ...prev]);
      setBrief('');
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Génération échouée.');
    }
  };

  const handleDelete = async (id: string) => {
    const res = await deleteDeck(id);
    if (res.success) setDecks((prev) => prev.filter((d) => d.id !== id));
  };

  // Rendu GIF/MP4 : médias stockés sur le serveur (purge à 90 jours)
  const [rendering, setRendering] = useState<string | null>(null);
  const [renders, setRenders] = useState<Record<string, { url: string; publicUrl: string | null }>>({});

  const handleRender = async (id: string, format: 'gif' | 'mp4') => {
    setRendering(`${id}:${format}`);
    setError('');
    const res = await renderDeckMedia(id, format);
    setRendering(null);
    if (res.success && res.data) {
      // Aperçu inline sous la carte (pas de nouvel onglet : souvent bloqué)
      setRenders((prev) => ({ ...prev, [`${id}:${format}`]: res.data! }));
    } else {
      setError(res.error || 'Rendu échoué.');
    }
  };

  return (
    <div className="animate-fadeIn">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Nouvelle présentation</div>
        <p className="form-hint" style={{ marginBottom: 10 }}>
          Pitch deck, carrousel LinkedIn, slides produit — rédigée par l'IA avec votre
          thème (réglable dans <Link to="/config">Configuration</Link>). Mode Présenter
          plein écran avec transitions ; export PDF via Ctrl+P depuis la présentation.
        </p>
        <form onSubmit={handleCreate} className="ai-assist-row">
          <input
            className="form-input"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="ex. « Pitch deck investisseurs : problème, solution, marché, traction »"
            disabled={busy}
          />
          <select className="form-input" style={{ maxWidth: 130 }} value={slides} onChange={(e) => setSlides(Number(e.target.value))} disabled={busy}>
            {[5, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n} slides</option>)}
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy || !brief.trim()}>
            {busy ? '⏳ Génération…' : 'Générer'}
          </button>
        </form>
        {error && <div className="chat-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {loading ? (
        <Loader text="Chargement…" variant="inline" />
      ) : decks.length === 0 ? (
        <div className="posts-empty">
          <span style={{ fontSize: '2rem' }}></span>
          <p>Aucune présentation pour ce projet — décrivez la première ci-dessus,
          ou demandez à l'assistant : « fais-moi un pitch deck de 8 slides ».</p>
        </div>
      ) : (
        <div className="posts-list">
          {decks.map((d) => (
            <div key={d.id} className="post-card">
              <div className="post-card-main">
                <div className="post-card-title">{d.title}</div>
                <div className="post-card-footer">
                  <span className="form-hint-inline">
                    créé le {new Date(d.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              <div className="post-card-actions">
                <a className="btn btn-primary btn-sm" href={deckHtmlUrl(d.id)} target="_blank" rel="noopener noreferrer">
                  ▶ Présenter
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleRender(d.id, 'gif')}
                  disabled={rendering !== null}
                  title="GIF animé avec fondus — hébergé publiquement, attachable à un post (Instagram inclus)"
                >
                  {rendering === `${d.id}:gif` ? '⏳ Rendu…' : 'GIF'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleRender(d.id, 'mp4')}
                  disabled={rendering !== null}
                  title="Vidéo MP4 (meilleure qualité — nécessite ffmpeg sur le serveur)"
                >
                  {rendering === `${d.id}:mp4` ? '⏳ Rendu…' : 'MP4'}
                </button>
                <a className="btn btn-ghost btn-sm" href={deckMarkdownUrl(d.id)} title="Source Marp (réutilisable avec Marp CLI pour un export PPTX)">
                  .md
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(d.id)} title="Supprimer">✕</button>
              </div>
              {(renders[`${d.id}:gif`] || renders[`${d.id}:mp4`]) && (
                <div className="deck-render-preview">
                  {renders[`${d.id}:gif`] && (
                    <div className="deck-render-item">
                      <img src={renders[`${d.id}:gif`].url} alt="GIF du deck" />
                      <div className="deck-render-links">
                        <a href={renders[`${d.id}:gif`].url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Télécharger</a>
                        {renders[`${d.id}:gif`].publicUrl && (
                          <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => navigator.clipboard.writeText(renders[`${d.id}:gif`].publicUrl!)}
                            title="URL publique — collable dans le champ Image d'un post">
                            Copier l'URL publique
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {renders[`${d.id}:mp4`] && (
                    <div className="deck-render-item">
                      <video src={renders[`${d.id}:mp4`].url} controls loop muted playsInline />
                      <div className="deck-render-links">
                        <a href={renders[`${d.id}:mp4`].url} download className="btn btn-ghost btn-sm">Télécharger le MP4</a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


