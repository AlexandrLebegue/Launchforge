import { useState, useEffect, useCallback } from 'react';
import { getPosts, syncAllToCalendar, getOverview, Post } from '../api/client';
import { PostEditor, STATUS_META, platformIcon, platformLabel } from './ContentHubPage';

// ─────────────────────────────────────────────────────────────────────────────
// Vue Calendrier — grille mensuelle façon Outlook (page dédiée)
// ─────────────────────────────────────────────────────────────────────────────

function CalendarView({ posts, onOpen, onCreate, onSync, syncing }: {
  posts: Post[];
  onOpen: (p: Post) => void;
  onCreate: (dateIso: string) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Posts datés : programmés, brouillons datés, et publiés (historique visible)
  const dated = posts.filter((p) => p.scheduledAt || p.publishedAt);
  const byDay = new Map<string, Post[]>();
  for (const p of dated) {
    const key = new Date((p.status === 'published' ? p.publishedAt : p.scheduledAt) ?? p.scheduledAt!).toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => new Date(a.scheduledAt ?? a.publishedAt!).getTime() - new Date(b.scheduledAt ?? b.publishedAt!).getTime());
  }

  // Grille : semaines complètes (lundi → dimanche) couvrant le mois
  const firstDay = new Date(month);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  // 5 ou 6 semaines selon le mois
  const weeks = cells[35].getMonth() === month.getMonth() ? cells : cells.slice(0, 35);

  const todayKey = new Date().toDateString();
  const monthLabel = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const shift = (delta: number) => {
    setExpandedDay(null);
    setMonth((m2) => new Date(m2.getFullYear(), m2.getMonth() + delta, 1));
  };

  const statusClass = (p: Post) =>
    p.status === 'published' ? 'published' : p.status === 'draft' ? 'draft' : 'scheduled';

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>‹</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setExpandedDay(null); }}>
            Aujourd'hui
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(1)}>›</button>
          <span className="cal-month">{monthLabel}</span>
        </div>
        <div className="cal-legend">
          <span><i className="cal-dot scheduled" /> programmé</span>
          <span><i className="cal-dot draft" /> brouillon</span>
          <span><i className="cal-dot published" /> publié</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onSync} disabled={syncing} style={{ marginLeft: 'auto' }}>
          {syncing ? '⏳ Synchronisation…' : '🗓️ Synchroniser Google Calendar'}
        </button>
      </div>

      <div className="cal-grid cal-head">
        {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => <div key={d} className="cal-dayname">{d}</div>)}
      </div>
      <div className="cal-grid">
        {weeks.map((day) => {
          const key = day.toDateString();
          const inMonth = day.getMonth() === month.getMonth();
          const items = byDay.get(key) ?? [];
          const expanded = expandedDay === key;
          const visible = expanded ? items : items.slice(0, 3);
          return (
            <div
              key={key}
              className={`cal-cell${inMonth ? '' : ' out'}${key === todayKey ? ' today' : ''}`}
              onClick={(e) => {
                // Clic sur le fond de la case (pas sur un chip) → nouveau post pré-daté à 9 h
                if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('cal-daynum')) {
                  const d = new Date(day);
                  d.setHours(9, 0, 0, 0);
                  onCreate(d.toISOString());
                }
              }}
              title="Cliquer pour créer un post ce jour-là"
            >
              <span className="cal-daynum">{day.getDate()}</span>
              {visible.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`cal-chip ${statusClass(p)}`}
                  onClick={(e) => { e.stopPropagation(); onOpen(p); }}
                  title={`${p.title || platformLabel(p.platform)} — ${STATUS_META[p.status].label}`}
                >
                  <span className="cal-chip-time">
                    {new Date(p.scheduledAt ?? p.publishedAt!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {platformIcon(p.platform)} {p.title || platformLabel(p.platform)}
                </button>
              ))}
              {items.length > 3 && !expanded && (
                <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); setExpandedDay(key); }}>
                  +{items.length - 3} autres
                </button>
              )}
              {expanded && items.length > 3 && (
                <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); setExpandedDay(null); }}>
                  réduire
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="form-hint" style={{ marginTop: 8 }}>
        💡 Cliquez sur un jour vide pour créer un post pré-daté, sur un chip pour l'ouvrir.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Calendrier — planning éditorial du projet actif
// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Post | null | 'new'>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [postsRes, overviewRes] = await Promise.all([getPosts(), getOverview()]);
    if (postsRes.success && postsRes.data) setPosts(postsRes.data);
    if (overviewRes.success && overviewRes.data?.project) {
      setActiveProject(overviewRes.data.project.productName);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved: Post) => {
    setEditing(null);
    setCreateDate(null);
    setPosts((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    const res = await syncAllToCalendar();
    setSyncing(false);
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

  if (loading) return <div className="loading">⏳ Chargement du calendrier…</div>;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>🗓️ Calendrier</h1>
          <p>
            {activeProject && <span className="chip chip-project">🎯 Projet : {activeProject}</span>}
            {' '}Votre planning éditorial — programmé, brouillons et publications passées.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setCreateDate(null); setEditing('new'); }}>
          ＋ Nouveau post
        </button>
      </div>

      {feedback && (
        <div className="approval-feedback" onClick={() => setFeedback('')}>{feedback}</div>
      )}

      <CalendarView
        posts={posts}
        onOpen={(p) => setEditing(p)}
        onCreate={(dateIso) => { setCreateDate(dateIso); setEditing('new'); }}
        onSync={handleSync}
        syncing={syncing}
      />

      {editing !== null && (
        <PostEditor
          post={editing === 'new' ? null : editing}
          initialScheduledAt={editing === 'new' ? createDate : null}
          onClose={() => { setEditing(null); setCreateDate(null); }}
          onSaved={handleSaved}
          onCrossposted={load}
        />
      )}
    </div>
  );
}
