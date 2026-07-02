import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Play, Pause, Pencil, History, Clock, Zap, Gem } from 'lucide-react';
import Loader from '../components/Loader';
import {
  getCronJobs, createCronJob, updateCronJob, deleteCronJob, runCronJob, getCronRuns,
  getBillingStatus,
  CronJob, CronRun, CronFrequency, CronJobInput,
  CRON_FREQUENCY_LABELS, WEEKDAY_LABELS, isIntradayFrequency, describeCronSchedule, BillingStatus,
} from '../api/client';

const FREQUENCIES: CronFrequency[] = ['hourly', 'every_3h', 'every_6h', 'daily', 'weekly', 'monthly'];

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// Quelques exemples pour amorcer la réflexion de l'utilisateur.
const EXAMPLES = [
  'Chaque lundi matin, cherche une actualité marquante de mon secteur et rédige un post LinkedIn prêt à publier dessus (brouillon dans le Hub).',
  'Tous les jours, vérifie mes leads chauds (score ≥ 70) et prépare un email de relance personnalisé pour chacun (brouillon, sans envoyer).',
  'Chaque semaine, fais le bilan des performances de mes posts et résume-moi ce qui marche et quoi refaire.',
  'Toutes les 6 heures, surveille les nouveautés de mes concurrents sur le web et préviens-moi s\'il se passe quelque chose d\'important.',
];

// ── Éditeur (création / modification) ────────────────────────────────────────
interface EditorProps {
  job: CronJob | null;
  onClose: () => void;
  onSaved: (job: CronJob) => void;
}

function JobEditor({ job, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState<CronJobInput>({
    title: job?.title ?? '',
    objective: job?.objective ?? '',
    frequency: job?.frequency ?? 'daily',
    timeOfDay: job?.timeOfDay ?? '09:00',
    weekday: job?.weekday ?? 1,
    dayOfMonth: job?.dayOfMonth ?? 1,
    enabled: job ? job.enabled === 1 : true,
  });
  const intraday = isIntradayFrequency(form.frequency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim() || !form.objective.trim()) {
      setError('Un titre et un objectif sont requis.');
      return;
    }
    setSaving(true);
    setError('');
    const res = job
      ? await updateCronJob(job.id, form)
      : await createCronJob(form);
    setSaving(false);
    if (res.success && res.data) onSaved(res.data);
    else setError(res.error || 'Enregistrement impossible.');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{job ? 'Modifier l\'automatisation' : 'Nouvelle automatisation'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="post-editor">
          <label className="form-label-block">
            Titre
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ex. Veille secteur du lundi"
              autoFocus={!job}
            />
          </label>

          <label className="form-label-block">
            Objectif — que doit faire l'IA à chaque exécution ?
            <textarea
              className="form-input post-content-area"
              value={form.objective}
              onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
              rows={6}
              placeholder="Décris précisément la tâche, comme si tu briefais un assistant. Ex. « Cherche une actu de mon secteur et rédige un post LinkedIn en brouillon dans le Hub. »"
            />
            <span className="form-hint-inline">
              L'IA agit de façon autonome (personne ne confirme au moment de l'exécution) et utilise tous
              ses outils : web, base de connaissances, métriques, rédaction/programmation de posts, emails,
              agenda. Sois explicite sur les actions à mener (rédiger, programmer, envoyer, prévenir…).
            </span>
          </label>

          {!job && (
            <div className="form-label-block">
              Exemples — cliquez pour partir de l'un d'eux
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: '8px 10px' }}
                    onClick={() => setForm((f) => ({ ...f, objective: ex }))}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Périodicité PUIS heure de la journée (daily/weekly/monthly) */}
          <div className="cron-schedule-row">
            <label className="form-label-block" style={{ flex: 1, minWidth: 160 }}>
              Périodicité
              <select
                className="form-input"
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as CronFrequency }))}
              >
                {FREQUENCIES.map((f) => <option key={f} value={f}>{CRON_FREQUENCY_LABELS[f]}</option>)}
              </select>
            </label>

            {!intraday && (
              <label className="form-label-block" style={{ width: 130 }}>
                Heure
                <input
                  type="time"
                  className="form-input"
                  value={form.timeOfDay ?? '09:00'}
                  onChange={(e) => setForm((f) => ({ ...f, timeOfDay: e.target.value }))}
                />
              </label>
            )}

            {form.frequency === 'weekly' && (
              <label className="form-label-block" style={{ width: 150 }}>
                Jour
                <select
                  className="form-input"
                  value={form.weekday ?? 1}
                  onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}
                >
                  {WEEKDAY_LABELS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </label>
            )}

            {form.frequency === 'monthly' && (
              <label className="form-label-block" style={{ width: 120 }}>
                Jour du mois
                <input
                  type="number"
                  min={1}
                  max={28}
                  className="form-input"
                  value={form.dayOfMonth ?? 1}
                  onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) }))}
                />
              </label>
            )}
          </div>
          <span className="form-hint-inline" style={{ marginTop: -6 }}>
            {intraday
              ? 'Se relance à intervalle régulier dans la journée (pas d\'heure fixe).'
              : `Se déclenchera : ${describeCronSchedule({ frequency: form.frequency, timeOfDay: form.timeOfDay ?? '09:00', weekday: form.weekday ?? 1, dayOfMonth: form.dayOfMonth ?? 1 }).toLowerCase()} (heure de Paris).`}
          </span>

          <label className="form-check-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.enabled ?? true}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Active (décochez pour créer en pause)
          </label>

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '⏳…' : job ? 'Enregistrer' : 'Créer l\'automatisation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Historique des exécutions ────────────────────────────────────────────────
function RunsModal({ job, onClose }: { job: CronJob; onClose: () => void }) {
  const [runs, setRuns] = useState<CronRun[] | null>(null);

  useEffect(() => {
    getCronRuns(job.id).then((res) => setRuns(res.success && res.data ? res.data : []));
  }, [job.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Historique — « {job.title} »</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="post-editor" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {runs === null ? (
            <Loader text="Chargement de l'historique…" />
          ) : runs.length === 0 ? (
            <p className="form-hint-inline">Aucune exécution pour l'instant. La première aura lieu le {fmtDate(job.nextRunAt)}.</p>
          ) : (
            runs.map((r) => (
              <div key={r.id} className="cron-run-item">
                <div className="cron-run-head">
                  <span className={`chip ${r.status === 'ok' ? 'chip-success' : r.status === 'error' ? 'chip-warning' : ''}`}>
                    {r.status === 'ok' ? '✅ Réussie' : r.status === 'error' ? '⚠️ Échec' : '⏳ En cours'}
                  </span>
                  <span className="form-hint-inline">{fmtDate(r.completedAt ?? r.startedAt)}</span>
                </div>
                {r.actions && parseActions(r.actions).length > 0 && (
                  <div className="cron-run-actions">
                    {parseActions(r.actions).map((a, i) => <span key={i} className="cron-action-chip">{a}</span>)}
                  </div>
                )}
                {r.result && <div className="cron-run-result">{r.result}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function parseActions(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

// ── Résultat d'une exécution immédiate ───────────────────────────────────────
function ResultModal({ run, title, onClose }: { run: CronRun; title: string; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{run.status === 'ok' ? '✅' : '⚠️'} « {title} »</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="post-editor" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {run.actions && parseActions(run.actions).length > 0 && (
            <div className="cron-run-actions">
              {parseActions(run.actions).map((a, i) => <span key={i} className="cron-action-chip">{a}</span>)}
            </div>
          )}
          <div className="cron-run-result">{run.result || 'Aucun compte rendu produit.'}</div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AutomationsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CronJob | null | 'new'>(null);
  const [viewingRuns, setViewingRuns] = useState<CronJob | null>(null);
  const [runResult, setRunResult] = useState<{ run: CronRun; title: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  const load = () => {
    getCronJobs().then((res) => {
      if (res.success && res.data) setJobs(res.data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    getBillingStatus().then((res) => { if (res.success && res.data) setBilling(res.data); });
  }, []);

  const locked = Boolean(billing && billing.enforcement && billing.tier === 'braise');

  const handleSaved = (saved: CronJob) => {
    setEditing(null);
    setJobs((prev) => {
      const exists = prev.some((j) => j.id === saved.id);
      return exists ? prev.map((j) => (j.id === saved.id ? saved : j)) : [saved, ...prev];
    });
  };

  const handleToggle = async (job: CronJob) => {
    const res = await updateCronJob(job.id, { enabled: job.enabled !== 1 } as Partial<CronJobInput>);
    if (res.success && res.data) handleSaved(res.data);
  };

  const handleRun = async (job: CronJob) => {
    setBusyId(job.id);
    const res = await runCronJob(job.id);
    setBusyId(null);
    if (res.success && res.data) {
      setRunResult({ run: res.data, title: job.title });
      load();
    } else {
      window.alert(res.error || 'Exécution impossible.');
    }
  };

  const handleDelete = async (job: CronJob) => {
    if (!window.confirm(`Supprimer l'automatisation « ${job.title} » et son historique ?`)) return;
    const res = await deleteCronJob(job.id);
    if (res.success) setJobs((prev) => prev.filter((j) => j.id !== job.id));
  };

  if (loading) return <Loader text="Chargement des automatisations…" />;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>Automatisations</h1>
          <p>
            Des tâches IA récurrentes (cron jobs) : donnez un objectif, choisissez une cadence,
            et l'IA l'exécute toute seule à intervalle régulier — en utilisant tous ses outils
            (web, connaissances, posts, emails, agenda…) — puis vous envoie son compte rendu.
          </p>
        </div>
        {!locked && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Nouvelle automatisation</button>
        )}
      </div>

      {locked ? (
        <div className="kb-status-box kb-status-box-muted">
          <Gem size={18} className="kb-status-icon" />
          <div className="kb-status-main">
            <div className="kb-status-title">Les automatisations sont réservées à l'offre Brasier</div>
            <div className="kb-status-meta">
              Programmez des tâches IA récurrentes (veille, relances, posts, rapports…) qui tournent
              toutes seules. Passez à Brasier pour en profiter.
            </div>
          </div>
          <Link to="/billing" className="btn btn-primary btn-sm kb-status-action">
            <Gem size={14} /> Passer à Brasier
          </Link>
        </div>
      ) : (
        <div className="kb-status-box">
          <Zap size={18} className="kb-status-icon" />
          <div className="kb-status-main">
            <div className="kb-status-title">Comment ça marche</div>
            <div className="kb-status-meta">
              Chaque automatisation agit de façon <strong>autonome</strong> : elle n'attend aucune
              confirmation. Restez précis sur ce qu'elle doit faire — et testez-la avec « Exécuter
              maintenant » avant de la laisser tourner. Vous pouvez aussi en créer une en demandant
              simplement à l'<Link to="/assistant">assistant</Link>.
            </div>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        !locked && (
          <div className="plan-empty">
            <span className="plan-empty-icon"><Bot size={40} /></span>
            <h2>Aucune automatisation pour l'instant</h2>
            <p>
              Créez votre première tâche IA récurrente : une veille du lundi, une relance quotidienne
              de vos leads chauds, un rapport hebdo de performances… L'IA s'en occupe, en boucle.
            </p>
            <button className="btn btn-primary btn-lg" style={{ display: 'inline-flex' }} onClick={() => setEditing('new')}>
              ＋ Créer ma première automatisation
            </button>
          </div>
        )
      ) : (
        <div className="contact-list">
          {jobs.map((job) => (
            <div key={job.id} className={`contact-card cron-row${job.enabled ? '' : ' cron-row-paused'}`}>
              <div className="cron-row-state" title={job.enabled ? 'Active' : 'En pause'}>
                <span className={`cron-dot${job.enabled ? ' on' : ''}`} />
              </div>

              <div className="contact-main">
                <div className="contact-name-row">
                  <span className="contact-name">{job.title}</span>
                  <span className="contact-type" style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    <Clock size={11} style={{ verticalAlign: '-1px' }} /> {describeCronSchedule(job)}
                  </span>
                  {!job.enabled && <span className="contact-type" style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-subtle)' }}>⏸️ En pause</span>}
                </div>
                <div className="contact-meta">
                  {job.enabled && <span>Prochaine : {fmtDate(job.nextRunAt)}</span>}
                  {job.lastRunAt && <span>Dernière : {job.lastStatus === 'ok' ? '✅' : '⚠️'} {fmtDate(job.lastRunAt)}</span>}
                </div>
                <div className="contact-summary cron-row-objective" title={job.objective}>
                  {job.objective.slice(0, 180)}{job.objective.length > 180 ? '…' : ''}
                </div>
                {job.lastResult && (
                  <div className="contact-summary cron-row-result" title={job.lastResult}>
                    ↳ {job.lastResult.slice(0, 140).replace(/\n+/g, ' ')}{job.lastResult.length > 140 ? '…' : ''}
                  </div>
                )}
              </div>

              <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-sm btn-primary" onClick={() => handleRun(job)} disabled={busyId === job.id} title="Exécuter maintenant">
                  {busyId === job.id ? '⏳' : <Play size={14} />}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => handleToggle(job)} title={job.enabled ? 'Mettre en pause' : 'Reprendre'}>
                  {job.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setViewingRuns(job)} title="Historique">
                  <History size={14} />
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(job)} title="Modifier">
                  <Pencil size={14} />
                </button>
                <button className="kanban-delete" title="Supprimer" onClick={() => handleDelete(job)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <JobEditor
          job={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {viewingRuns && <RunsModal job={viewingRuns} onClose={() => setViewingRuns(null)} />}
      {runResult && <ResultModal run={runResult.run} title={runResult.title} onClose={() => setRunResult(null)} />}
    </div>
  );
}
