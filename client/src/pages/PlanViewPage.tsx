import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPlan, LaunchPlan } from '../api/client';

export default function PlanViewPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await getPlan(id);
      if (res.success && res.data) {
        setPlan(res.data);
      } else {
        setError(res.error || 'Plan not found');
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="loading">Loading plan...</div>;

  if (error || !plan) {
    return (
      <div>
        <div className="error-banner">{error || 'Plan not found'}</div>
        <Link to="/" className="btn btn-ghost">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="plan-detail">
      <Link to="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
        &larr; Back
      </Link>

      <h1>{plan.input.productName}</h1>
      <div className="plan-meta">
        {plan.input.niche} &middot; Generated {new Date(plan.createdAt).toLocaleDateString()} &middot;
        Target: {plan.input.targetAudience} &middot; Pricing: {plan.input.pricing}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{plan.input.description}</p>
        <div style={{ marginTop: 8 }}>
          {plan.input.goals.map((goal, i) => (
            <span key={i} className="tag tag-primary">{goal}</span>
          ))}
        </div>
      </div>

      <PlanSection title="Weekly Plan" id="weekly">
        {plan.weekly_plan.map((week) => (
          <div key={week.week} style={{ marginBottom: 20 }}>
            <h3>Week {week.week}: {week.theme}</h3>
            <ul>{week.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>KPIs: </strong>
              {week.kpis.map((k, i) => (
                <span key={i} className="chip">{k}</span>
              ))}
            </div>
          </div>
        ))}
      </PlanSection>

      <PlanSection title="Community Targets" id="community">
        {plan.community_targets.map((ct, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <h3>{ct.platform}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {ct.approach}
            </p>
            <span className="chip">{ct.frequency}</span>
          </div>
        ))}
      </PlanSection>

      <PlanSection title="Content Angles" id="content">
        <ul>
          {plan.content_angles.map((ca, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              <strong>{ca.title}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {ca.format} &middot; Platforms: {ca.platforms.join(', ')}
              </div>
            </li>
          ))}
        </ul>
      </PlanSection>

      <PlanSection title="Outreach Strategy" id="outreach">
        {plan.outreach_strategy.map((os, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <h3>{os.phase}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Target: {os.target}
            </p>
            <ul>{os.tactics.map((t, j) => <li key={j}>{t}</li>)}</ul>
          </div>
        ))}
      </PlanSection>

      <PlanSection title="Launch Sequencing" id="sequencing">
        {plan.launch_sequencing.map((ls, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <h3>
              {ls.phase}
              <span className="chip" style={{ marginLeft: 8 }}>{ls.timeline}</span>
            </h3>
            <ul>{ls.activities.map((a, j) => <li key={j}>{a}</li>)}</ul>
          </div>
        ))}
      </PlanSection>

      <PlanSection title="Validation Checklist" id="validation">
        {plan.validation_checklist.map((vc, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 0',
              borderBottom: i < plan.validation_checklist.length - 1 ? '1px solid var(--color-border)' : 'none',
            }}
          >
            <span style={{ color: vc.status === 'done' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {vc.status === 'done' ? '✓' : '○'}
            </span>
            <div>
              <div style={{ fontSize: '0.9rem' }}>{vc.item}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{vc.details}</div>
            </div>
          </div>
        ))}
      </PlanSection>

      <PlanSection title="First Users Tactics" id="tactics">
        {plan.first_users_tactics.map((t, i) => (
          <div
            key={i}
            className={`effort-${t.effort}`}
            style={{
              padding: '10px 16px',
              marginBottom: 8,
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div style={{ fontSize: '0.9rem', marginBottom: 2 }}>{t.tactic}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Effort: <span className={`badge badge-${t.effort === 'low' ? 'success' : t.effort === 'medium' ? 'warning' : 'warning'}`}>{t.effort}</span>
              &middot; {t.expectedResult}
            </div>
          </div>
        ))}
      </PlanSection>
    </div>
  );
}

function PlanSection({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <div className="plan-section" id={id}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
