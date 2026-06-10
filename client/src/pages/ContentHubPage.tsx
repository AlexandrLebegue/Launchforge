import { useState, useEffect, useMemo, useCallback, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  getPosts, createPost, updatePost, deletePost, publishPost, generateContent, syncPostMetrics,
  generateCalendar, syncAllToCalendar,
  Post, PostStatus, Recurrence,
} from '../api/client';

export const PLATFORMS: { value: string; label: string; icon: string }[] = [
  { value: 'linkedin',     label: 'LinkedIn',      icon: '💼' },
  { value: 'twitter',      label: 'X / Twitter',   icon: '🐦' },
  { value: 'instagram',    label: 'Instagram',     icon: '📸' },
  { value: 'facebook',     label: 'Facebook',      icon: '📘' },
  { value: 'tiktok',       label: 'TikTok',        icon: '🎬' },
  { value: 'youtube',      label: 'YouTube',       icon: '▶️' },
  { value: 'reddit',       label: 'Reddit',        icon: '🟠' },
  { value: 'blog',         label: 'Blog / SEO',    icon: '📝' },
  { value: 'newsletter',   label: 'Newsletter',    icon: '✉️' },
  { value: 'producthunt',  label: 'Product Hunt',  icon: '🐱' },
  { value: 'hackernews',   label: 'Hacker News',   icon: '🟧' },
  { value: 'indiehackers', label: 'Indie Hackers', icon: '🔨' },
];

export const platformIcon  = (p: string) => PLATFORMS.find((x) => x.value === p)?.icon ?? '📣';
export const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

const STATUS_META: Record<PostStatus, { label: string; cls: string }> = {
  idea:      { label: '💡 Idée',       cls: 'post-status-idea' },
  draft:     { label: '✏️ Brouillon',  cls: 'post-status-draft' },
  scheduled: { label: '🗓️ Programmé', cls: 'post-status-scheduled' },
  published: { label: '✅ Publié',     cls: 'post-status-published' },
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

const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n));

// ─────────────────────────────────────────────────────────────────────────────
// Éditeur de post (modal) avec assistant IA
// ─────────────────────────────────────────────────────────────────────────────

interface EditorProps {
  post: Post | null;            // null = création
  onClose: () => void;
  onSaved: (post: Post) => void;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostEditor({ post, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState({
    platform:    post?.platform ?? 'linkedin',
    title:       post?.title ?? '',
    content:     post?.content ?? '',
    status:      (post?.status ?? 'draft') as PostStatus,
    scheduledAt: toLocalInput(post?.scheduledAt ?? null),
    externalUrl: post?.externalUrl ?? '',
    imageUrl:    post?.imageUrl ?? '',
    recurrence:  (post?.recurrence ?? 'none') as Recurrence,
    autoPublish: Boolean(post?.autoPublish),
    impressions: post?.impressions ?? 0,
    likes:       post?.likes ?? 0,
    comments:    post?.comments ?? 0,
    shares:      post?.shares ?? 0,
    clicks:      post?.clicks ?? 0,
  });
  const [brief,      setBrief]      = useState('');
  const [useNews,    setUseNews]    = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncNote,   setSyncNote]   = useState('');
  const [error,      setError]      = useState('');

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
      setSyncNote(`✅ Métriques synchronisées${res.data.note ? ` — ${res.data.note}` : ''}`);
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Composio non configuré (COMPOSIO_MCP_URL) — connectez vos comptes sur dashboard.composio.dev et renseignez l\'URL MCP côté serveur.'
        : res.error || 'La synchronisation a échoué.');
    }
  };

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setError('');
    const payload: Partial<Post> = {
      platform:    form.platform,
      title:       form.title,
      content:     form.content,
      status:      form.status,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      externalUrl: form.externalUrl.trim() || null,
      imageUrl:    form.imageUrl.trim() || null,
      recurrence:  form.recurrence,
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
    setSaving(false);
    if (res.success && res.data) onSaved(res.data);
    else setError(res.error || 'Enregistrement impossible.');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{post ? 'Modifier le post' : 'Nouveau post'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="post-editor">
          <div className="post-editor-row">
            <label className="form-label-block">
              Plateforme
              <select value={form.platform} onChange={(e) => set('platform', e.target.value)} className="form-input">
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
              </select>
            </label>
            <label className="form-label-block">
              Statut
              <select value={form.status} onChange={(e) => set('status', e.target.value as PostStatus)} className="form-input">
                <option value="idea">💡 Idée</option>
                <option value="draft">✏️ Brouillon</option>
                <option value="scheduled">🗓️ Programmé</option>
                <option value="published">✅ Publié</option>
              </select>
            </label>
          </div>

          <label className="form-label-block">
            Titre <span className="form-hint-inline">(usage interne)</span>
            <input className="form-input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="ex. Annonce nouvelle fonctionnalité" />
          </label>

          {/* Assistant IA */}
          <div className="ai-assist-box">
            <div className="ai-assist-header">✨ Assistant IA <span className="form-hint-inline">— s'appuie sur votre <Link to="/knowledge">base de connaissances</Link></span></div>
            <div className="ai-assist-row">
              <input
                className="form-input"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Brief : sujet, angle, objectif… ex. « Annoncer la v2 avec un avant/après client »"
                disabled={generating}
              />
              <button type="button" className="btn btn-primary" onClick={() => handleGenerate(false)} disabled={generating}>
                {generating ? '⏳…' : '✨ Générer'}
              </button>
              {form.content.trim() && (
                <button type="button" className="btn btn-ghost" onClick={() => handleGenerate(true)} disabled={generating}>
                  🪄 Améliorer
                </button>
              )}
            </div>
            <label className="ai-news-toggle">
              <input type="checkbox" checked={useNews} onChange={(e) => setUseNews(e.target.checked)} />
              📰 S'appuyer sur les actus du web (recherche en direct sur le sujet)
            </label>
          </div>

          <label className="form-label-block">
            Contenu
            <textarea
              className="form-input post-content-area"
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              rows={10}
              placeholder="Le contenu du post — ou laissez l'assistant IA le rédiger…"
            />
            <span className="form-hint-inline">{form.content.length} caractères</span>
          </label>

          <label className="form-label-block">
            🖼️ Image du post <span className="form-hint-inline">(URL d'un visuel hébergé — jointe à la publication)</span>
            <input
              className="form-input"
              value={form.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
              placeholder="https://…/visuel.png"
            />
            {form.imageUrl.trim() && (
              <img src={form.imageUrl.trim()} alt="aperçu" className="post-image-preview"
                   onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
          </label>

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
                <span className="form-hint-inline">À chaque publication, la prochaine occurrence est créée automatiquement.</span>
              )}
            </label>
          </div>

          {/* Publication automatique (worker + Composio) */}
          {form.status === 'scheduled' && (
            <label className={`autopublish-toggle${form.autoPublish ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={form.autoPublish}
                onChange={(e) => set('autoPublish', e.target.checked)}
              />
              <span className="autopublish-text">
                <span className="autopublish-title">⚡ Publication automatique</span>
                <span className="form-hint-inline">
                  Le worker publie ce post tout seul à l'heure programmée via vos comptes Composio —
                  vérifiez le contenu avant d'activer. Sans cette option, vous publiez manuellement.
                </span>
              </span>
            </label>
          )}
          {post?.publishError && (
            <div className="chat-error">
              ⚠️ La publication automatique a échoué : {post.publishError} — corrigez puis réactivez l'option, ou publiez manuellement.
            </div>
          )}

          {/* Métriques (posts publiés) */}
          {form.status === 'published' && (
            <div className="metrics-section">
              <label className="form-label-block">
                🔗 URL du post publié
                <div className="ai-assist-row">
                  <input
                    className="form-input"
                    value={form.externalUrl}
                    onChange={(e) => set('externalUrl', e.target.value)}
                    placeholder="ex. https://x.com/vous/status/12345…"
                  />
                  {post && (
                    <button type="button" className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
                      {syncing ? '⏳ Synchro…' : '🔄 Synchroniser via Composio'}
                    </button>
                  )}
                </div>
                <span className="form-hint-inline">
                  La synchro lit les métriques réelles via vos comptes connectés sur Composio. Sinon, saisie manuelle ci-dessous.
                </span>
              </label>
              {syncNote && <div className="approval-feedback" style={{ marginBottom: 0 }}>{syncNote}</div>}
              <div className="metrics-grid">
                {([
                  ['impressions', '👁️ Impressions'], ['likes', '❤️ Likes'], ['comments', '💬 Commentaires'],
                  ['shares', '🔁 Partages'], ['clicks', '🔗 Clics'],
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
            </div>
          )}

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🗓️ Générer mon calendrier</h2>
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
                  {platformIcon(p)} {platformLabel(p)}
                </button>
              ))}
            </div>
          </label>

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={generate} disabled={busy}>
              {busy ? '⏳ Rédaction de vos posts… (≈ 1 min)' : `✨ Générer ${Math.min(weeks * postsPerWeek, 20)} posts`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'posts' | 'timeline' | 'analytics';

export default function ContentHubPage() {
  const [posts,    setPosts]    = useState<Post[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<Tab>('posts');
  const [editing,  setEditing]  = useState<Post | null | 'new'>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [feedback,     setFeedback]     = useState('');
  const [syncingCal,   setSyncingCal]   = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Arrivée depuis la génération du plan : accueil + brouillons à valider
  useEffect(() => {
    const drafts = searchParams.get('drafts');
    if (drafts !== null) {
      setFeedback(Number(drafts) > 0
        ? `🎉 Votre plan est prêt — et ${drafts} idées de posts ont été rédigées et datées par l'IA (statut Brouillon). Relisez-les, ajustez, puis programmez-les.`
        : '🎉 Votre plan est prêt ! Générez votre calendrier de contenu avec le bouton ci-dessus.');
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncCalendar = async () => {
    setSyncingCal(true);
    const res = await syncAllToCalendar();
    setSyncingCal(false);
    if (res.success && res.data) {
      setFeedback(res.data.synced > 0
        ? `🗓️ ${res.data.synced} post(s) ajoutés à votre calendrier personnel.`
        : `🗓️ ${res.data.message || 'Tout est déjà synchronisé.'}`);
      load();
    } else {
      setFeedback(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? '⚠️ Connectez Google Calendar sur Composio (vue Configuration) pour synchroniser votre agenda.'
        : `⚠️ ${res.error || 'La synchronisation a échoué.'}`);
    }
  };
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [search,   setSearch]   = useState('');

  const load = useCallback(async () => {
    const res = await getPosts();
    if (res.success && res.data) setPosts(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved: Post) => {
    setEditing(null);
    setPosts((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
    });
  };

  const handleDelete = async (post: Post) => {
    if (!window.confirm(`Supprimer « ${post.title || platformLabel(post.platform)} » ?`)) return;
    const res = await deletePost(post.id);
    if (res.success) setPosts((prev) => prev.filter((p) => p.id !== post.id));
  };

  const handlePublish = async (post: Post) => {
    const res = await publishPost(post.id);
    if (res.success && res.data) {
      const { post: updated, next } = res.data;
      setPosts((prev) => {
        const out = prev.map((p) => (p.id === updated.id ? updated : p));
        return next ? [next, ...out] : out;
      });
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

  const filtered = posts.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (platformFilter !== 'all' && p.platform !== platformFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Analyse ──
  const byPlatform = useMemo(() => {
    const map = new Map<string, { posts: number; impressions: number; interactions: number }>();
    for (const p of published) {
      const cur = map.get(p.platform) ?? { posts: 0, impressions: 0, interactions: 0 };
      cur.posts += 1;
      cur.impressions += p.impressions;
      cur.interactions += p.likes + p.comments + p.shares;
      map.set(p.platform, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].impressions - a[1].impressions);
  }, [published]);

  const bestPost = useMemo(() => {
    const rated = published.filter((p) => engagementRate(p) !== null);
    if (rated.length === 0) return null;
    return rated.reduce((best, p) => (engagementRate(p)! > engagementRate(best)! ? p : best));
  }, [published]);

  if (loading) return <div className="loading">⏳ Chargement du hub de contenu…</div>;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>📣 Hub de contenu</h1>
          <p>Planifiez, rédigez avec l'IA, publiez et suivez les performances de vos posts.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setShowCalendar(true)} title="L'IA rédige et programme plusieurs semaines de posts d'après votre plan et vos connaissances">
            🗓️ Générer mon calendrier
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Nouveau post</button>
        </div>
      </div>

      {feedback && (
        <div className="approval-feedback" onClick={() => setFeedback('')}>{feedback}</div>
      )}

      {/* Stats */}
      <div className="dashboard-stats">
        <div className="stat-card"><span className="stat-card-icon">🗓️</span><div className="stat-card-value">{totals.scheduled}</div><div className="stat-card-label">Programmés</div></div>
        <div className="stat-card"><span className="stat-card-icon">✅</span><div className="stat-card-value">{totals.published}</div><div className="stat-card-label">Publiés</div></div>
        <div className="stat-card"><span className="stat-card-icon">👁️</span><div className="stat-card-value">{fmtNum(totals.impressions)}</div><div className="stat-card-label">Impressions</div></div>
        <div className="stat-card"><span className="stat-card-icon">📈</span><div className="stat-card-value">{totals.engagement !== null ? `${totals.engagement.toFixed(1)} %` : '—'}</div><div className="stat-card-label">Engagement moyen</div></div>
      </div>

      {/* À publier prochainement */}
      {upcoming.length > 0 && (
        <div className="upcoming-strip">
          <div className="upcoming-title">⏭️ Prochaines publications</div>
          {upcoming.map((p) => {
            const overdue = new Date(p.scheduledAt!).getTime() < now;
            return (
              <div key={p.id} className={`upcoming-item${overdue ? ' overdue' : ''}`}>
                <span className="upcoming-icon">{platformIcon(p.platform)}</span>
                <span className="upcoming-name" onClick={() => setEditing(p)}>{p.title || platformLabel(p.platform)}</span>
                {p.recurrence !== 'none' && <span className="chip chip-recur">🔁 {RECURRENCE_LABELS[p.recurrence]}</span>}
                {Boolean(p.autoPublish) && <span className="chip chip-auto" title="Publication automatique activée">⚡ auto</span>}
                {Boolean(p.calendarSynced) && <span title="Ajouté à votre calendrier personnel">🗓️</span>}
                <span className={`upcoming-date${overdue ? ' overdue' : ''}`}>
                  {overdue ? '⚠️ En retard — ' : ''}{fmtDate(p.scheduledAt)}
                </span>
                <button className="btn btn-sm btn-primary" onClick={() => handlePublish(p)}>✅ Marquer publié</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="hub-tabs">
        <button className={`hub-tab${tab === 'posts' ? ' active' : ''}`} onClick={() => setTab('posts')}>📝 Posts</button>
        <button className={`hub-tab${tab === 'timeline' ? ' active' : ''}`} onClick={() => setTab('timeline')}>🕒 Frise</button>
        <button className={`hub-tab${tab === 'analytics' ? ' active' : ''}`} onClick={() => setTab('analytics')}>📊 Analyse</button>
      </div>

      {tab === 'timeline' ? (
        <TimelineView
          posts={posts}
          onOpen={(p) => setEditing(p)}
          onSync={handleSyncCalendar}
          syncing={syncingCal}
        />
      ) : tab === 'posts' ? (
        <>
          {/* Filtres */}
          <div className="kanban-toolbar">
            <input className="kanban-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔎 Rechercher un post…" />
            <select className="kanban-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tous les statuts</option>
              <option value="idea">💡 Idées</option>
              <option value="draft">✏️ Brouillons</option>
              <option value="scheduled">🗓️ Programmés</option>
              <option value="published">✅ Publiés</option>
            </select>
            <select className="kanban-select" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="all">Toutes plateformes</option>
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="plan-empty">
              <span className="plan-empty-icon">📣</span>
              <h2>{posts.length === 0 ? 'Aucun post pour l\'instant' : 'Aucun post ne correspond aux filtres'}</h2>
              <p>Créez votre premier post — l'assistant IA le rédige à partir de votre base de connaissances.</p>
              <button className="btn btn-primary btn-lg" style={{ display: 'inline-flex' }} onClick={() => setEditing('new')}>
                ＋ Créer un post
              </button>
            </div>
          ) : (
            <div className="post-grid">
              {filtered.map((p) => {
                const rate = engagementRate(p);
                return (
                  <div key={p.id} className="post-card" onClick={() => setEditing(p)}>
                    <div className="post-card-top">
                      <span className="post-platform">{platformIcon(p.platform)} {platformLabel(p.platform)}</span>
                      <span className={`post-status ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span>
                      <button className="kanban-delete" title="Supprimer" onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>×</button>
                    </div>
                    <div className="post-card-title">{p.title || '(sans titre)'}</div>
                    {p.content && <div className="post-card-excerpt">{p.content.slice(0, 140)}{p.content.length > 140 ? '…' : ''}</div>}
                    <div className="post-card-footer">
                      {p.recurrence !== 'none' && <span className="chip chip-recur">🔁 {RECURRENCE_LABELS[p.recurrence]}</span>}
                      {Boolean(p.autoPublish) && p.status === 'scheduled' && (
                        <span className="chip chip-auto" title="Sera publié automatiquement à l'heure programmée">⚡ auto</span>
                      )}
                      {p.publishError && (
                        <span className="chip chip-error" title={p.publishError}>⚠️ échec auto</span>
                      )}
                      {p.status === 'scheduled' && <span className="post-card-date">🗓️ {fmtDate(p.scheduledAt)}</span>}
                      {p.status === 'published' && (
                        <span className="post-card-metrics">
                          👁️ {fmtNum(p.impressions)} · ❤️ {fmtNum(p.likes)}{rate !== null && ` · 📈 ${rate.toFixed(1)} %`}
                        </span>
                      )}
                      {p.status === 'scheduled' && (
                        <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); handlePublish(p); }}>
                          ✓ Marquer publié
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ── Analyse ── */
        published.length === 0 ? (
          <div className="plan-empty">
            <span className="plan-empty-icon">📊</span>
            <h2>Pas encore de données</h2>
            <p>Publiez des posts puis renseignez leurs métriques (impressions, likes…) pour voir l'analyse ici.</p>
          </div>
        ) : (
          <div className="analytics-wrap">
            {bestPost && (
              <div className="best-post-card" onClick={() => setEditing(bestPost)}>
                <span className="best-post-label">🏆 Meilleur post</span>
                <span className="best-post-title">{platformIcon(bestPost.platform)} {bestPost.title || '(sans titre)'}</span>
                <span className="best-post-rate">📈 {engagementRate(bestPost)!.toFixed(1)} % d'engagement</span>
              </div>
            )}

            {/* Par plateforme */}
            <div className="card">
              <div className="card-header">Performance par plateforme</div>
              {byPlatform.map(([platform, s]) => {
                const rate = s.impressions > 0 ? (s.interactions / s.impressions) * 100 : 0;
                const maxImpressions = byPlatform[0][1].impressions || 1;
                return (
                  <div key={platform} className="platform-row">
                    <span className="platform-row-name">{platformIcon(platform)} {platformLabel(platform)}</span>
                    <div className="platform-row-bar">
                      <div className="platform-row-fill" style={{ width: `${Math.max(4, (s.impressions / maxImpressions) * 100)}%` }} />
                    </div>
                    <span className="platform-row-stats">
                      {s.posts} post{s.posts > 1 ? 's' : ''} · 👁️ {fmtNum(s.impressions)} · 📈 {rate.toFixed(1)} %
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Tableau détaillé */}
            <div className="card">
              <div className="card-header">Détail des posts publiés</div>
              <div className="analytics-table">
                <div className="analytics-row analytics-head">
                  <span>Post</span><span>👁️</span><span>❤️</span><span>💬</span><span>🔁</span><span>🔗</span><span>📈</span>
                </div>
                {[...published]
                  .sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1))
                  .map((p) => {
                    const rate = engagementRate(p);
                    return (
                      <div key={p.id} className="analytics-row" onClick={() => setEditing(p)}>
                        <span className="analytics-post">{platformIcon(p.platform)} {p.title || '(sans titre)'}</span>
                        <span>{fmtNum(p.impressions)}</span>
                        <span>{fmtNum(p.likes)}</span>
                        <span>{fmtNum(p.comments)}</span>
                        <span>{fmtNum(p.shares)}</span>
                        <span>{fmtNum(p.clicks)}</span>
                        <span className={rate !== null && rate >= 3 ? 'rate-good' : undefined}>
                          {rate !== null ? `${rate.toFixed(1)} %` : '—'}
                        </span>
                      </div>
                    );
                  })}
              </div>
              <p className="form-hint" style={{ marginTop: 10 }}>
                💡 Renseignez les métriques en ouvrant un post publié. Un taux d'engagement ≥ 3 % est considéré comme bon sur la plupart des plateformes.
              </p>
            </div>
          </div>
        )
      )}

      {editing !== null && (
        <PostEditor
          post={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {showCalendar && (
        <CalendarModal
          onClose={() => setShowCalendar(false)}
          onGenerated={(created) => {
            setShowCalendar(false);
            setPosts((prev) => [...created, ...prev]);
            setTab('posts');
            setFeedback(`✅ ${created.length} posts rédigés et programmés — relisez-les dans la liste ci-dessous avant publication.`);
          }}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Vue Frise chronologique — les posts dans le temps, avec la date courante
// ─────────────────────────────────────────────────────────────────────────────

function TimelineView({ posts, onOpen, onSync, syncing }: {
  posts: Post[];
  onOpen: (p: Post) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const now = new Date();
  const todayKey = now.toDateString();

  // Posts datés : programmés + brouillons datés (à valider), passés récents inclus
  const dated = posts
    .filter((p) => p.scheduledAt && (p.status === 'scheduled' || p.status === 'draft'))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

  if (dated.length === 0) {
    return (
      <div className="plan-empty">
        <span className="plan-empty-icon">🕒</span>
        <h2>Aucun post daté</h2>
        <p>Programmez des posts (ou générez votre calendrier) pour les voir apparaître sur la frise.</p>
      </div>
    );
  }

  // Groupement par jour
  const groups: { key: string; date: Date; items: Post[] }[] = [];
  for (const p of dated) {
    const d = new Date(p.scheduledAt!);
    const key = d.toDateString();
    const existing = groups.find((g) => g.key === key);
    if (existing) existing.items.push(p);
    else groups.push({ key, date: d, items: [p] });
  }

  // Position du marqueur « Aujourd'hui »
  const todayIndex = groups.findIndex((g) => g.date.getTime() >= new Date(todayKey).getTime());

  return (
    <div className="timeline-wrap">
      <div className="timeline-toolbar">
        <span className="form-hint-inline">
          {dated.filter((p) => new Date(p.scheduledAt!) >= now).length} publication(s) à venir
          {' · '}les brouillons datés apparaissent en pointillés (à valider)
        </span>
        <button className="btn btn-ghost" onClick={onSync} disabled={syncing} style={{ marginLeft: 'auto' }}>
          {syncing ? '⏳ Synchronisation…' : '🗓️ Synchroniser Google Calendar'}
        </button>
      </div>

      <div className="timeline">
        {groups.map((g, gi) => {
          const isPast = g.date < new Date(todayKey);
          const isToday = g.key === todayKey;
          return (
            <div key={g.key}>
              {gi === (todayIndex === -1 ? groups.length : todayIndex) && !isToday && (
                <div className="timeline-today"><span>Aujourd\'hui — {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
              )}
              <div className={`timeline-day${isPast ? ' past' : ''}${isToday ? ' today' : ''}`}>
                <div className="timeline-date">
                  <span className="timeline-dot" />
                  {isToday ? '📍 Aujourd\'hui — ' : ''}
                  {g.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div className="timeline-items">
                  {g.items.map((p) => (
                    <button key={p.id} className={`timeline-item${p.status === 'draft' ? ' draft' : ''}`} onClick={() => onOpen(p)}>
                      <span className="timeline-time">
                        {new Date(p.scheduledAt!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="timeline-platform">{platformIcon(p.platform)}</span>
                      <span className="timeline-title">{p.title || '(sans titre)'}</span>
                      {p.status === 'draft' && <span className="post-status post-status-draft">✏️ à valider</span>}
                      {Boolean(p.autoPublish) && p.status === 'scheduled' && <span className="chip chip-auto">⚡ auto</span>}
                      {Boolean(p.calendarSynced) && <span title="Dans votre agenda">🗓️</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {todayIndex === -1 && (
          <div className="timeline-today"><span>Aujourd\'hui — tout est passé, programmez la suite !</span></div>
        )}
      </div>
    </div>
  );
}
