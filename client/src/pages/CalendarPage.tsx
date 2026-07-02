import { useState, useEffect, useCallback } from 'react';
import Loader from '../components/Loader';
import { getPosts, syncAllToCalendar, getOverview, updatePost, Post } from '../api/client';
import { PostEditor, STATUS_META, platformLabel } from './ContentHubPage';

// ─────────────────────────────────────────────────────────────────────────────
// Vue Calendrier — grille mensuelle façon Outlook (page dédiée)
// ─────────────────────────────────────────────────────────────────────────────

/** Un post est déplaçable (drag) tant qu'il n'est pas déjà publié : on ne
 *  réécrit pas l'historique, seuls programmés et brouillons datés bougent. */
const canMove = (p: Post) => p.status !== 'published' && !!p.scheduledAt;

function CalendarView({ posts, onOpen, onCreate, onMove, onSync, syncing, canEdit }: {
  posts: Post[];
  onOpen: (p: Post) => void;
  onCreate: (dateIso: string) => void;
  onMove: (p: Post, newIso: string) => void;
  onSync: () => void;
  syncing: boolean;
  canEdit: boolean;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Dépose un post glissé sur un jour : on conserve l'heure d'origine et on
  // ne change que la date. Glissé sur son propre jour → aucun changement.
  const handleDrop = (key: string, day: Date) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!id) return;
    const post = posts.find((p) => p.id === id);
    if (!post || !canMove(post)) return;
    const orig = new Date(post.scheduledAt!);
    if (orig.toDateString() === key) return;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), orig.getHours(), orig.getMinutes(), 0, 0);
    onMove(post, next.toISOString());
  };

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
        <button type="button" className="btn btn-ghost" data-tour="cal-sync" onClick={onSync} disabled={syncing} style={{ marginLeft: 'auto' }}>
          {syncing ? '⏳ Synchronisation…' : 'Synchroniser Google Calendar'}
        </button>
      </div>

      <div className="cal-grid cal-head">
        {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => <div key={d} className="cal-dayname">{d}</div>)}
      </div>
      <div className="cal-grid" data-tour="cal-grid">
        {weeks.map((day) => {
          const key = day.toDateString();
          const inMonth = day.getMonth() === month.getMonth();
          const items = byDay.get(key) ?? [];
          const expanded = expandedDay === key;
          const visible = expanded ? items : items.slice(0, 3);
          return (
            <div
              key={key}
              className={`cal-cell${inMonth ? '' : ' out'}${key === todayKey ? ' today' : ''}${draggingId && dragOverKey === key ? ' drag-over' : ''}`}
              onClick={(e) => {
                // Clic sur le fond de la case (pas sur un chip) → nouveau post pré-daté à 9 h
                if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('cal-daynum')) {
                  const d = new Date(day);
                  d.setHours(9, 0, 0, 0);
                  onCreate(d.toISOString());
                }
              }}
              onDragOver={draggingId ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverKey !== key) setDragOverKey(key);
              } : undefined}
              onDrop={draggingId ? (e) => { e.preventDefault(); handleDrop(key, day); } : undefined}
              title="Cliquer pour créer un post ce jour-là"
            >
              <span className="cal-daynum">{day.getDate()}</span>
              {visible.map((p) => {
                const movable = canEdit && canMove(p);
                return (
                <button
                  key={p.id}
                  type="button"
                  className={`cal-chip ${statusClass(p)}${movable ? ' movable' : ''}${draggingId === p.id ? ' dragging' : ''}`}
                  draggable={movable}
                  onDragStart={movable ? (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', p.id);
                    setDraggingId(p.id);
                  } : undefined}
                  onDragEnd={() => { setDraggingId(null); setDragOverKey(null); }}
                  onClick={(e) => { e.stopPropagation(); onOpen(p); }}
                  title={`${p.title || platformLabel(p.platform)} — ${STATUS_META[p.status].label}${movable ? ' · glissez pour déplacer' : ''}`}
                >
                  <span className="cal-chip-time">
                    {new Date(p.scheduledAt ?? p.publishedAt!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {p.title || platformLabel(p.platform)}
                </button>
                );
              })}
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
        Cliquez sur un jour vide pour créer un post pré-daté, sur un chip pour l'ouvrir{canEdit ? ', ou glissez un post d\'un jour à l\'autre pour le reprogrammer' : ''}.
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
  const [role, setRole] = useState<string | undefined>(undefined);
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
      setRole(overviewRes.data.project.role);
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

  // Déplacement drag-and-drop d'un post vers un autre jour : MAJ optimiste
  // immédiate, persistance via PATCH, rollback + message si l'API échoue.
  const handleMove = async (post: Post, newIso: string) => {
    if (role === 'viewer') return;
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, scheduledAt: newIso, calendarSynced: 0 } : p)));
    const res = await updatePost(post.id, { scheduledAt: newIso });
    if (res.success && res.data) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? res.data! : p)));
    } else {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      setFeedback(res.error || 'Le déplacement du post a échoué.');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const res = await syncAllToCalendar();
    setSyncing(false);
    if (res.success && res.data) {
      setFeedback(res.data.synced > 0
        ? `${res.data.synced} post(s) ajoutés à votre calendrier personnel.`
        : `${res.data.message || 'Tout est déjà synchronisé.'}`);
      load();
    } else {
      setFeedback(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Connectez Google Calendar sur Composio (vue Configuration) pour synchroniser votre agenda.'
        : `${res.error || 'La synchronisation a échoué.'}`);
    }
  };

  if (loading) return <Loader text="Chargement du calendrier…" />;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>Calendrier</h1>
          <p>
            {activeProject && <span className="chip chip-project">Projet : {activeProject}</span>}
            {' '}Votre planning éditorial — programmé, brouillons et publications passées.
          </p>
        </div>
        {role !== 'viewer' && (
          <button className="btn btn-primary" data-tour="cal-new" onClick={() => { setCreateDate(null); setEditing('new'); }}>
            ＋ Nouveau post
          </button>
        )}
      </div>

      {feedback && (
        <div className="approval-feedback" onClick={() => setFeedback('')}>{feedback}</div>
      )}

      <CalendarView
        posts={posts}
        onOpen={(p) => setEditing(p)}
        onCreate={(dateIso) => { if (role === 'viewer') return; setCreateDate(dateIso); setEditing('new'); }}
        onMove={handleMove}
        onSync={handleSync}
        syncing={syncing}
        canEdit={role !== 'viewer'}
      />

      {editing !== null && (
        <PostEditor
          post={editing === 'new' ? null : editing}
          initialScheduledAt={editing === 'new' ? createDate : null}
          readOnly={role === 'viewer'}
          onClose={() => { setEditing(null); setCreateDate(null); }}
          onSaved={handleSaved}
          onCrossposted={load}
        />
      )}
    </div>
  );
}
