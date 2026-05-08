import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPlan, LaunchPlan, KanbanState, KanbanCard } from '../api/client';
import KanbanBoard from '../components/KanbanBoard';

function buildKanbanFromPlan(plan: LaunchPlan): KanbanState {
  const cards: KanbanCard[] = [];
  let order = 0;

  (plan.weekly_plan || []).forEach((w) => {
    (w.actions || []).forEach((a) => {
      cards.push({ id: `w${w.week}-${order}`, title: a, description: `Week ${w.week}: ${w.theme}`, category: 'Marketing', effort: 'medium', column: 'todo', week: w.week, order: order++, createdAt: plan.createdAt });
    });
  });
  (plan.community_targets || []).forEach((c) => {
    cards.push({ id: `comm-${order}`, title: `Engage on ${c.platform}`, description: c.approach, category: 'Community', effort: 'low', column: 'todo', order: order++, createdAt: plan.createdAt });
  });
  (plan.content_angles || []).forEach((c) => {
    cards.push({ id: `content-${order}`, title: c.title, description: `Format: ${c.format}`, category: 'Content', effort: 'medium', column: 'todo', order: order++, createdAt: plan.createdAt });
  });
  (plan.outreach_strategy || []).forEach((o) => {
    cards.push({ id: `out-${order}`, title: `Outreach: ${o.phase}`, description: `Target: ${o.target}`, category: 'Outreach', effort: 'medium', column: 'todo', order: order++, createdAt: plan.createdAt });
  });
  (plan.launch_sequencing || []).forEach((l) => {
    cards.push({ id: `ls-${order}`, title: l.phase, description: `${l.timeline}: ${l.activities[0] || ''}`, category: 'Launch', effort: 'high', column: 'todo', order: order++, createdAt: plan.createdAt });
  });
  (plan.validation_checklist || []).forEach((v) => {
    cards.push({ id: `val-${order}`, title: v.item, description: v.details, category: 'Validation', effort: 'low', column: v.status === 'done' ? 'done' : 'todo', order: order++, createdAt: plan.createdAt });
  });
  (plan.first_users_tactics || []).forEach((t) => {
    cards.push({ id: `tac-${order}`, title: t.tactic.slice(0, 80), description: t.expectedResult, category: 'Growth', effort: t.effort, column: 'todo', order: order++, createdAt: plan.createdAt });
  });

  return {
    columns: { backlog: [], todo: cards, in_progress: [], done: [] },
  };
}

function isValidKanbanState(state: any): state is KanbanState {
  return state && typeof state === 'object' && state.columns &&
    Array.isArray(state.columns.backlog) &&
    Array.isArray(state.columns.todo) &&
    Array.isArray(state.columns.in_progress) &&
    Array.isArray(state.columns.done);
}

export default function PlanViewPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kanban, setKanban] = useState<KanbanState | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await getPlan(id);
      if (res.success && res.data) {
        setPlan(res.data);
        setKanban(isValidKanbanState(res.data.kanbanState) ? res.data.kanbanState : buildKanbanFromPlan(res.data));
      } else {
        setError(res.error || 'Plan not found');
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="loading">Loading plan...</div>;

  if (error || !plan || !kanban) {
    return (
      <div>
        <div className="error-banner">{error || 'Plan not found'}</div>
        <Link to="/" className="btn btn-ghost">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>&larr; Back</Link>
      <div className="plan-detail-header">
        <div>
          <h1>{plan.input.productName}</h1>
          <p className="plan-meta">{plan.input.niche} &middot; {plan.input.targetAudience} &middot; {plan.input.pricing}</p>
        </div>
      </div>
      <KanbanBoard planId={plan.id} initialKanban={kanban} />
    </div>
  );
}
