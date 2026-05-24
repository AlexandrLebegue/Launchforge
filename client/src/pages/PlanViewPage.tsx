import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPlan, LaunchPlan, KanbanState, KanbanCard } from '../api/client';
import KanbanBoard from '../components/KanbanBoard';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

// ── Types ────────────────────────────────────────────────────
const tabs = [
  { key: 'overview',   label: '📋 Overview'    },
  { key: 'weekly',     label: '📅 Weekly Plan' },
  { key: 'community',  label: '🎯 Community'   },
  { key: 'content',    label: '📝 Content'     },
  { key: 'kanban',     label: '📊 Kanban'      },
] as const;

type TabKey = typeof tabs[number]['key'];

// ── Kanban helpers ────────────────────────────────────────────
function buildKanbanFromPlan(plan: LaunchPlan): KanbanState {
  const cards: KanbanCard[] = [];
  let order = 0;

  (plan.weekly_plan || []).forEach((w) =>
    (w.actions || []).forEach((a) => {
      cards.push({ id: `w${w.week}-${order}`, title: a, description: `Week ${w.week}: ${w.theme}`, category: 'Marketing', effort: 'medium', column: 'todo', week: w.week, order: order++, createdAt: plan.createdAt });
    })
  );
  (plan.community_targets || []).forEach((c) =>
    cards.push({ id: `comm-${order}`, title: `Engage on ${c.platform}`, description: c.approach, category: 'Community', effort: 'low', column: 'todo', order: order++, createdAt: plan.createdAt })
  );
  (plan.content_angles || []).forEach((c) =>
    cards.push({ id: `content-${order}`, title: c.title, description: `Format: ${c.format}`, category: 'Content', effort: 'medium', column: 'todo', order: order++, createdAt: plan.createdAt })
  );
  (plan.outreach_strategy || []).forEach((o) =>
    cards.push({ id: `out-${order}`, title: `Outreach: ${o.phase}`, description: `Target: ${o.target}`, category: 'Outreach', effort: 'medium', column: 'todo', order: order++, createdAt: plan.createdAt })
  );
  (plan.launch_sequencing || []).forEach((l) =>
    cards.push({ id: `ls-${order}`, title: l.phase, description: `${l.timeline}: ${l.activities[0] || ''}`, category: 'Launch', effort: 'high', column: 'todo', order: order++, createdAt: plan.createdAt })
  );
  (plan.validation_checklist || []).forEach((v) =>
    cards.push({ id: `val-${order}`, title: v.item, description: v.details, category: 'Validation', effort: 'low', column: v.status === 'done' ? 'done' : 'todo', order: order++, createdAt: plan.createdAt })
  );
  (plan.first_users_tactics || []).forEach((t) =>
    cards.push({ id: `tac-${order}`, title: t.tactic.slice(0, 80), description: t.expectedResult, category: 'Growth', effort: t.effort, column: 'todo', order: order++, createdAt: plan.createdAt })
  );

  return { columns: { backlog: [], todo: cards, in_progress: [], review: [], done: [] } };
}

function isValidKanbanState(state: any): state is KanbanState {
  return state?.columns &&
    Array.isArray(state.columns.backlog)   &&
    Array.isArray(state.columns.todo)      &&
    Array.isArray(state.columns.in_progress) &&
    Array.isArray(state.columns.done);
}

function ensureKanbanState(plan: LaunchPlan): KanbanState {
  const raw = plan.kanbanState;
  const base = isValidKanbanState(raw) ? raw : buildKanbanFromPlan(plan);
  return {
    columns: {
      backlog:     base.columns.backlog     || [],
      todo:        base.columns.todo        || [],
      in_progress: base.columns.in_progress || [],
      review:      base.columns.review      || [],
      done:        base.columns.done        || [],
    },
  };
}

// ── Component ────────────────────────────────────────────────
export default function PlanViewPage() {
  const { id }   = useParams<{ id: string }>();
  const [plan,   setPlan]   = useState<LaunchPlan | null>(null);
  const [kanban, setKanban] = useState<KanbanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Reveal animations for tab content with .reveal class
  useIntersectionObserver();

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await getPlan(id);
      if (res.success && res.data) {
        setPlan(res.data);
        setKanban(ensureKanbanState(res.data));
      } else {
        setError(res.error || 'Plan not found');
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="loading">⏳ Loading plan…</div>;

  if (error || !plan || !kanban) {
    return (
      <div>
        <div className="error-banner">{error || 'Plan not found'}</div>
        <Link to="/" className="btn btn-ghost">&larr; Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      {/* Back */}
      <Link to="/" className="plan-back-btn">
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="plan-detail-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1>{plan.input.productName}</h1>
            <div className="plan-meta">
              <span className="niche-badge">{plan.input.niche}</span>
              <span className="plan-meta-dot" />
              <span>{plan.input.targetAudience}</span>
              <span className="plan-meta-dot" />
              <span>{plan.input.pricing}</span>
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', paddingTop: 4 }}>
            Created {new Date(plan.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="plan-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`plan-tab-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="plan-tab-content">
          <div className="plan-overview-grid">
            {[
              { label: 'Product',        value: plan.input.productName    },
              { label: 'Niche',          value: plan.input.niche          },
              { label: 'Target Audience',value: plan.input.targetAudience },
              { label: 'Pricing',        value: plan.input.pricing        },
            ].map((item, i) => (
              <div key={i} className={`plan-overview-card animate-fadeInUp stagger-${i + 1}`}>
                <div className="plan-overview-label">{item.label}</div>
                <div className="plan-overview-value">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Goals */}
          {plan.input.goals?.length > 0 && (
            <div className="plan-section card animate-fadeInUp stagger-3">
              <div className="card-header">🎯 Goals</div>
              <ul className="weekly-actions-list">
                {plan.input.goals.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}

          {/* Description */}
          {plan.input.description && (
            <div className="card animate-fadeInUp stagger-4">
              <div className="card-header">📖 Description</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                {plan.input.description}
              </p>
            </div>
          )}

          {/* Launch sequencing summary */}
          {(plan.launch_sequencing || []).length > 0 && (
            <div className="card animate-fadeInUp stagger-5">
              <div className="card-header">🚀 Launch Phases</div>
              {plan.launch_sequencing.map((ls, i) => (
                <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < plan.launch_sequencing.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div className="weekly-week-num" style={{ width: 28, height: 28, fontSize: '0.72rem' }}>{i + 1}</div>
                    <strong style={{ fontSize: '0.9rem' }}>{ls.phase}</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{ls.timeline}</span>
                  </div>
                  <ul className="weekly-actions-list">
                    {(ls.activities || []).slice(0, 3).map((a, j) => <li key={j}>{a}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Weekly Plan Tab ── */}
      {activeTab === 'weekly' && (
        <div className="plan-tab-content">
          {(plan.weekly_plan || []).length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No weekly plan available.</p>
          ) : (
            (plan.weekly_plan || []).map((w, i) => (
              <div key={i} className={`weekly-week-card reveal stagger-${Math.min(i + 1, 6)}`}>
                <div className="weekly-week-header">
                  <div className="weekly-week-num">{w.week}</div>
                  <div className="weekly-week-theme">{w.theme}</div>
                </div>
                <ul className="weekly-actions-list">
                  {(w.actions || []).map((a, j) => <li key={j}>{a}</li>)}
                </ul>
                {(w.kpis || []).length > 0 && (
                  <div className="weekly-kpis">
                    <strong style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary)', marginRight: 6 }}>KPIs:</strong>
                    {w.kpis.join(' · ')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Community Tab ── */}
      {activeTab === 'community' && (
        <div className="plan-tab-content">
          {(plan.community_targets || []).length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No community targets available.</p>
          ) : (
            (plan.community_targets || []).map((c, i) => (
              <div key={i} className={`card reveal stagger-${Math.min(i + 1, 6)}`}>
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.3rem' }}>
                    {c.platform?.toLowerCase().includes('reddit')   ? '🔴'
                    : c.platform?.toLowerCase().includes('twitter')  ? '🐦'
                    : c.platform?.toLowerCase().includes('discord')  ? '💬'
                    : c.platform?.toLowerCase().includes('linkedin') ? '💼'
                    : '🌐'}
                  </span>
                  {c.platform}
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                  {c.approach}
                </p>
                {c.frequency && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                    📅 Frequency: <strong style={{ color: 'var(--color-text)' }}>{c.frequency}</strong>
                  </div>
                )}
                <div>
                  {(c.communities || []).map((name, j) => (
                    <span key={j} className="chip">{name}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Content Tab ── */}
      {activeTab === 'content' && (
        <div className="plan-tab-content">
          {(plan.content_angles || []).length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No content strategy available.</p>
          ) : (
            (plan.content_angles || []).map((c, i) => (
              <div key={i} className={`card reveal stagger-${Math.min(i + 1, 6)}`}>
                <div className="card-header">{c.title}</div>
                {c.description && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                    {c.description}
                  </p>
                )}
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 8 }}>Format:</span>
                  <span className="tag">{c.format}</span>
                </div>
                <div>
                  {(c.platforms || []).map((p, j) => (
                    <span key={j} className="tag tag-primary">{p}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Kanban Tab ── */}
      {activeTab === 'kanban' && kanban && (
        <div className="plan-tab-content">
          <KanbanBoard planId={plan.id} initialKanban={kanban} />
        </div>
      )}
    </div>
  );
}
