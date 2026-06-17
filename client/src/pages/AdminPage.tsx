import { useState, useEffect, useCallback } from 'react';
import {
  Users, Activity, BarChart3, Search, ChevronRight,
  UserCheck, FileText, Zap, TrendingUp, Clock, RefreshCw,
  Shield, X, BookOpen,
} from 'lucide-react';
import {
  getAdminStats, getAdminUsers, getAdminActivity, getAdminUserActivity,
  AdminStats, AdminUserSummary, AdminEvent,
} from '../api/client';

// ─── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ACTION_META: Record<string, { label: string; color: string }> = {
  'user.register':    { label: 'Inscription',     color: '#34d399' },
  'user.login':       { label: 'Connexion',        color: '#ff9d4d' },
  'user.delete':      { label: 'Suppression',      color: '#f87171' },
  'plan.created':     { label: 'Projet créé',      color: '#ff6b35' },
  'plan.deleted':     { label: 'Projet supprimé',  color: '#f87171' },
  'post.published':   { label: 'Post publié',      color: '#34d399' },
  'post.scheduled':   { label: 'Post programmé',   color: '#fbbf24' },
  'post.imported':    { label: 'Post importé',     color: '#22d3ee' },
  'agent.run':        { label: 'Agent exécuté',    color: '#fbbf24' },
  'knowledge.created':{ label: 'Fiche créée',      color: '#ff9d4d' },
  'team.created':     { label: 'Équipe créée',     color: '#ff6b35' },
  'team.joined':      { label: 'Équipe rejointe',  color: '#34d399' },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'var(--color-text-muted)' };
  return (
    <span
      className="admin-action-badge"
      style={{ '--badge': meta.color } as React.CSSProperties}
    >
      {meta.label}
    </span>
  );
}

function ActivityStatus({ lastActivityAt }: { lastActivityAt: string | null }) {
  if (!lastActivityAt) return <span className="admin-activity-status idle">Inactif</span>;
  const days = (Date.now() - new Date(lastActivityAt).getTime()) / (1000 * 3600 * 24);
  const cls = days < 7 ? 'live' : days < 30 ? 'warm' : 'idle';
  return <span className={`admin-activity-status ${cls}`}>● {relativeTime(lastActivityAt)}</span>;
}

// ─── User drawer ──────────────────────────────────────────────────────────────

function UserDrawer({ user, onClose }: { user: AdminUserSummary; onClose: () => void }) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminUserActivity(user.id, 50).then((r) => {
      if (r.success && r.data) setEvents(r.data);
      setLoading(false);
    });
  }, [user.id]);

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="admin-drawer-header">
          <div className="admin-drawer-id">
            <div className="admin-avatar lg">{(user.name || user.email).charAt(0).toUpperCase()}</div>
            <div>
              <div className="admin-drawer-name">{user.name || '—'}</div>
              <div className="admin-drawer-email">{user.email}</div>
            </div>
          </div>
          <button className="admin-icon-btn" onClick={onClose}><X size={17} /></button>
        </div>

        <div className="admin-drawer-stats">
          <div><strong>{user.planCount}</strong><span>projets</span></div>
          <div><strong>{user.postCount}</strong><span>posts</span></div>
          <div><strong>{user.publishedPosts}</strong><span>publiés</span></div>
        </div>
        <div className="admin-drawer-meta">Inscrit le {formatDate(user.createdAt)}</div>

        <div className="admin-section-label">Activité récente</div>

        {loading ? (
          <div className="admin-loading">Chargement…</div>
        ) : events.length === 0 ? (
          <div className="admin-empty">Aucune activité enregistrée</div>
        ) : (
          <div className="admin-event-list">
            {events.map((ev) => (
              <div key={ev.id} className="admin-event-row">
                <div className="admin-event-left">
                  <ActionBadge action={ev.action} />
                  {(ev.metadata as any)?.productName || (ev.metadata as any)?.title ? (
                    <span className="admin-event-target">
                      {(ev.metadata as any).productName || (ev.metadata as any).title}
                    </span>
                  ) : null}
                </div>
                <span className="admin-event-time" title={ev.createdAt}>{relativeTime(ev.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'users' | 'activity';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [activityBefore, setActivityBefore] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  const PAGE = 50;

  const loadStats = useCallback(() => {
    setLoadingStats(true);
    getAdminStats().then((r) => {
      if (r.success && r.data) setStats(r.data);
      setLoadingStats(false);
    });
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const loadUsers = useCallback(() => {
    setLoadingUsers(true);
    getAdminUsers().then((r) => {
      if (r.success && r.data) setUsers(r.data);
      setLoadingUsers(false);
    });
  }, []);

  useEffect(() => {
    if (tab === 'users' && users.length === 0) loadUsers();
  }, [tab, users.length, loadUsers]);

  const loadActivity = useCallback((reset = false) => {
    setLoadingActivity(true);
    const before = reset ? undefined : activityBefore;
    getAdminActivity(PAGE, before).then((r) => {
      if (r.success && r.data) {
        setEvents((prev) => reset ? r.data! : [...prev, ...r.data!]);
        if (r.data!.length < PAGE) setHasMore(false);
        else setActivityBefore(r.data![r.data!.length - 1].createdAt);
      }
      setLoadingActivity(false);
    });
  }, [activityBefore]);

  useEffect(() => {
    if (tab === 'activity' && events.length === 0) loadActivity(true);
  }, [tab, events.length, loadActivity]);

  const filteredUsers = users.filter(
    (u) =>
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase()),
  );

  const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

  return (
    <div className="animate-fadeIn">
      {/* En-tête */}
      <div className="page-header">
        <div>
          <h1 className="page-title admin-title"><Shield size={22} /> Administration</h1>
          <div className="page-subtitle">Vue fondateur — activité et utilisateurs de la plateforme</div>
        </div>
        <div className="admin-tabs">
          {([
            ['overview', 'Vue d\'ensemble', <BarChart3 size={14} />],
            ['users',    'Utilisateurs',    <Users size={14} />],
            ['activity', 'Activité',         <Activity size={14} />],
          ] as [Tab, string, React.ReactNode][]).map(([id, label, icon]) => (
            <button
              key={id}
              className={`admin-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <>
          {loadingStats && !stats ? (
            <div className="admin-loading">Chargement…</div>
          ) : stats ? (
            <>
              <div className="dashboard-stats">
                <div className="stat-card animate-fadeInUp stagger-1">
                  <span className="stat-card-icon"><Users size={20} /></span>
                  <div className="stat-card-value">{stats.totalUsers}</div>
                  <div className="stat-card-label">Utilisateurs</div>
                  <div className="stat-card-sub admin-up">+{stats.newUsersLast7d} cette semaine</div>
                </div>
                <div className="stat-card animate-fadeInUp stagger-2">
                  <span className="stat-card-icon"><UserCheck size={20} /></span>
                  <div className="stat-card-value">{stats.activeUsersLast7d}</div>
                  <div className="stat-card-label">Actifs 7 jours</div>
                  <div className="stat-card-sub">{stats.activeUsersLast30d} sur 30 j</div>
                </div>
                <div className="stat-card animate-fadeInUp stagger-3">
                  <span className="stat-card-icon"><FileText size={20} /></span>
                  <div className="stat-card-value">{stats.totalPosts}</div>
                  <div className="stat-card-label">Posts</div>
                  <div className="stat-card-sub">{stats.postsLast7d} créés cette semaine</div>
                </div>
                <div className="stat-card animate-fadeInUp stagger-4">
                  <span className="stat-card-icon"><TrendingUp size={20} /></span>
                  <div className="stat-card-value">{stats.publishedPostsLast7d}</div>
                  <div className="stat-card-label">Publications 7 j</div>
                </div>
                <div className="stat-card animate-fadeInUp stagger-5">
                  <span className="stat-card-icon"><Zap size={20} /></span>
                  <div className="stat-card-value">{stats.totalPlans}</div>
                  <div className="stat-card-label">Projets</div>
                </div>
                <div className="stat-card animate-fadeInUp stagger-6">
                  <span className="stat-card-icon"><BookOpen size={20} /></span>
                  <div className="stat-card-value">{stats.totalKnowledgeEntries}</div>
                  <div className="stat-card-label">Connaissances</div>
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card-header">
                  <span>Adoption & rétention</span>
                  <button className="admin-icon-btn sm" onClick={loadStats} title="Rafraîchir">
                    <RefreshCw size={14} className={loadingStats ? 'admin-spin' : ''} />
                  </button>
                </div>
                <div className="admin-bars">
                  {[
                    { label: 'Rétention 7 jours',  value: pct(stats.activeUsersLast7d, stats.totalUsers),  suffix: '%' },
                    { label: 'Rétention 30 jours', value: pct(stats.activeUsersLast30d, stats.totalUsers), suffix: '%' },
                  ].map((b) => (
                    <div key={b.label} className="admin-bar-row">
                      <span className="admin-bar-label">{b.label}</span>
                      <div className="admin-bar-track">
                        <div className="admin-bar-fill" style={{ width: `${b.value}%` }} />
                      </div>
                      <span className="admin-bar-value">{b.value}{b.suffix}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="admin-empty">Impossible de charger les statistiques.</div>
          )}
        </>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <span>{loadingUsers && users.length === 0 ? 'Chargement…' : `${users.length} utilisateur${users.length !== 1 ? 's' : ''}`}</span>
            <div className="admin-card-actions">
              <div className="admin-search">
                <Search size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" />
                {search && <button onClick={() => setSearch('')}><X size={12} /></button>}
              </div>
              <button className="admin-icon-btn sm" onClick={loadUsers} title="Rafraîchir">
                <RefreshCw size={14} className={loadingUsers ? 'admin-spin' : ''} />
              </button>
            </div>
          </div>

          {loadingUsers && users.length === 0 ? (
            <div className="admin-loading">Chargement…</div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Utilisateur</th><th>Inscrit le</th><th>Projets</th>
                    <th>Posts</th><th>Publiés</th><th>Dernière activité</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="admin-row" onClick={() => setSelectedUser(u)}>
                      <td>
                        <div className="admin-user-cell">
                          <div className="admin-avatar">{(u.name || u.email).charAt(0).toUpperCase()}</div>
                          <div>
                            <div className="admin-user-name">{u.name || '—'}</div>
                            <div className="admin-user-email">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="admin-muted">{formatDate(u.createdAt)}</span></td>
                      <td><span className="admin-num">{u.planCount}</span></td>
                      <td><span className="admin-num">{u.postCount}</span></td>
                      <td><span className="admin-num">{u.publishedPosts}</span></td>
                      <td><ActivityStatus lastActivityAt={u.lastActivityAt} /></td>
                      <td><ChevronRight size={15} className="admin-chevron" /></td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={7}><div className="admin-empty">Aucun utilisateur trouvé</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVITY ── */}
      {tab === 'activity' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <span>Journal d'activité global</span>
            <button
              className="admin-icon-btn sm"
              onClick={() => { setEvents([]); setActivityBefore(undefined); setHasMore(true); loadActivity(true); }}
              title="Rafraîchir"
            >
              <RefreshCw size={14} className={loadingActivity ? 'admin-spin' : ''} />
            </button>
          </div>

          {loadingActivity && events.length === 0 ? (
            <div className="admin-loading">Chargement…</div>
          ) : events.length === 0 ? (
            <div className="admin-empty">Aucune activité enregistrée. Les événements apparaîtront dès la première connexion d'un utilisateur.</div>
          ) : (
            <>
              <div className="admin-event-list">
                {events.map((ev) => (
                  <div key={ev.id} className="admin-event-row">
                    <div className="admin-event-left">
                      <div className="admin-event-user" onClick={() => {
                        const u = users.find((u) => u.id === ev.userId);
                        if (u) setSelectedUser(u);
                      }}>
                        <div className="admin-avatar sm">{(ev.userName || ev.userEmail).charAt(0).toUpperCase()}</div>
                        <span className="admin-event-username">{ev.userName || ev.userEmail.split('@')[0]}</span>
                      </div>
                      <ActionBadge action={ev.action} />
                      {(ev.metadata as any)?.productName && <span className="admin-event-target">{(ev.metadata as any).productName}</span>}
                      {(ev.metadata as any)?.title && <span className="admin-event-target">{(ev.metadata as any).title}</span>}
                    </div>
                    <span className="admin-event-time" title={ev.createdAt}><Clock size={11} /> {relativeTime(ev.createdAt)}</span>
                  </div>
                ))}
              </div>
              {hasMore && (
                <button className="admin-load-more" onClick={() => loadActivity(false)} disabled={loadingActivity}>
                  {loadingActivity ? 'Chargement…' : 'Charger plus'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {selectedUser && <UserDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}
