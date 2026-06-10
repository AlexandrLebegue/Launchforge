import { useState, useRef, useEffect, FormEvent, ChangeEvent, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  startOnboarding,
  getOnboardingSession,
  streamOnboardingMessage,
  createPlan,
  OnboardingSession,
  OnboardingAttachment,
  OnboardingProfile,
} from '../api/client';

const SESSION_KEY = 'launchforge_onboarding_session';
const MAX_TEXT_BYTES = 100_000;
const MAX_PDF_BYTES = 8_000_000;
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.html'];
const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf'];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Minimal markdown: **bold**, _italic_, line breaks */
function renderText(text: string) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
          return <em key={j}>{part.slice(1, -1)}</em>;
        }
        return part;
      })}
    </Fragment>
  ));
}

const profileLabels: { key: keyof OnboardingProfile; label: string }[] = [
  { key: 'productName',    label: 'Produit' },
  { key: 'description',    label: 'Description' },
  { key: 'targetAudience', label: 'Audience' },
  { key: 'niche',          label: 'Niche' },
  { key: 'goals',          label: 'Objectifs' },
  { key: 'pricing',        label: 'Prix' },
];

const SPLASH_STEPS = [
  { at: 0,   icon: '🧠', text: 'Analyse de votre profil et de vos objectifs…' },
  { at: 12,  icon: '🗺️', text: 'Construction du plan de lancement semaine par semaine…' },
  { at: 45,  icon: '🎯', text: 'Sélection des communautés et angles de contenu…' },
  { at: 75,  icon: '✍️', text: 'Rédaction de vos premières idées de posts…' },
  { at: 110, icon: '🗓️', text: 'Datation des publications dans votre calendrier…' },
  { at: 140, icon: '✨', text: 'Dernières touches — votre hub se remplit…' },
];

function GenerationSplash() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const stepIndex = SPLASH_STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const step = SPLASH_STEPS[stepIndex];
  const pct = Math.min(96, Math.round((elapsed / 170) * 100));

  return (
    <div className="gen-splash">
      <div className="gen-splash-rocket">
        <span className="gen-splash-emoji">🚀</span>
        <span className="gen-splash-ring" />
        <span className="gen-splash-ring r2" />
        <span className="gen-splash-ring r3" />
      </div>
      <h2 className="gen-splash-title">Génération de votre plan de promotion</h2>
      <div className="gen-splash-step" key={stepIndex}>{step.icon} {step.text}</div>
      <div className="gen-splash-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="gen-splash-hint">
        L'IA construit votre stratégie, rédige vos premiers posts et remplit votre base de
        connaissances — comptez 2 à 3 minutes. Ne fermez pas cette page.
      </p>
      <div className="gen-splash-elapsed">{Math.floor(elapsed / 60)} min {String(elapsed % 60).padStart(2, '0')} s</div>
    </div>
  );
}

export default function CreatePlanPage() {
  const navigate = useNavigate();

  const [session,     setSession]     = useState<OnboardingSession | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [aiOffline,   setAiOffline]   = useState(false);
  const [input,       setInput]       = useState('');
  const [pendingDocs, setPendingDocs] = useState<OnboardingAttachment[]>([]);
  const [sending,     setSending]     = useState(false);
  const [streamText,    setStreamText]    = useState('');
  const [streamActions, setStreamActions] = useState<string[]>([]);
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const chatEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, sending, streamText, streamActions.length]);

  useEffect(() => {
    (async () => {
      // Resume an in-progress conversation after a reload
      const savedId = localStorage.getItem(SESSION_KEY);
      if (savedId) {
        const res = await getOnboardingSession(savedId);
        if (res.success && res.data && res.data.status === 'active') {
          setSession(res.data);
          setLoading(false);
          return;
        }
        localStorage.removeItem(SESSION_KEY);
      }
      const res = await startOnboarding();
      if (res.success && res.data) {
        setSession(res.data);
        localStorage.setItem(SESSION_KEY, res.data.id);
      } else if (res.error === 'AI_NOT_CONFIGURED') {
        setAiOffline(true);
      } else {
        setError(res.error || 'Impossible de démarrer la conversation');
      }
      setLoading(false);
    })();
  }, []);

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const docs: OnboardingAttachment[] = [...pendingDocs];
    for (const file of files) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (ext === '.pdf') {
        if (file.size > MAX_PDF_BYTES) {
          setError(`${file.name} dépasse 8 Mo — réduisez le PDF ou copiez-collez les passages importants.`);
          continue;
        }
        docs.push({ name: file.name, content: await readAsBase64(file), type: 'pdf' });
      } else if (TEXT_EXTENSIONS.includes(ext)) {
        if (file.size > MAX_TEXT_BYTES) {
          setError(`${file.name} dépasse 100 Ko — copiez-collez les passages importants.`);
          continue;
        }
        docs.push({ name: file.name, content: await file.text(), type: 'text' });
      } else {
        setError(`Format non supporté : ${file.name}. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(', ')}.`);
      }
    }
    setPendingDocs(docs.slice(0, 3));
  };

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!session || sending) return;
    const text = input.trim();
    if (!text && pendingDocs.length === 0) return;

    setError(null);
    setSending(true);
    setInput('');
    setStreamText('');
    setStreamActions([]);
    const docs = pendingDocs;
    setPendingDocs([]);

    // Optimistic render of the user's message
    setSession({
      ...session,
      messages: [
        ...session.messages,
        { role: 'user', text: text || `📎 ${docs.map((d) => d.name).join(', ')}` },
      ],
    });

    await streamOnboardingMessage(session.id, text, docs, {
      onDelta:  (t) => setStreamText((prev) => prev + t),
      onAction: (a) => setStreamActions((prev) => [...prev, a]),
      onDone: (finalSession) => {
        setSending(false);
        setStreamText('');
        setStreamActions([]);
        setSession(finalSession);
        if (finalSession.status === 'completed') localStorage.removeItem(SESSION_KEY);
      },
      onError: (err) => {
        setSending(false);
        setStreamText('');
        setStreamActions([]);
        setError(err || "L'assistant n'a pas répondu — réessayez.");
        // Restore so the user can retry the same message
        setInput(text);
        setPendingDocs(docs);
        setSession((s) => s && { ...s, messages: s.messages.slice(0, -1) });
      },
    });
  };

  const handleGenerate = async () => {
    if (!session?.profile) return;
    setGenerating(true);
    setError(null);
    const p = session.profile;
    const res = await createPlan({
      productName:    p.productName,
      description:    p.description,
      targetAudience: p.targetAudience,
      niche:          p.niche,
      goals:          p.goals.length > 0 ? p.goals : ['launch successfully'],
      pricing:        p.pricing,
      company:        p.company,
      mode:           'ai',
    });
    setGenerating(false);
    if (res.success && res.data) {
      // Direction le Hub : les brouillons générés par l'IA y attendent
      navigate(`/content?drafts=${res.bootstrappedPosts ?? 0}&plan=${res.data.id}`);
    } else {
      setError(res.error || 'La génération du plan a échoué — réessayez.');
    }
  };

  const restart = async () => {
    localStorage.removeItem(SESSION_KEY);
    setLoading(true);
    setSession(null);
    const res = await startOnboarding();
    if (res.success && res.data) {
      setSession(res.data);
      localStorage.setItem(SESSION_KEY, res.data.id);
    }
    setLoading(false);
  };

  if (loading) return <div className="loading">Chargement…</div>;

  if (generating) return <GenerationSplash />;

  if (aiOffline) return <ManualFallbackForm />;

  const completed = session?.status === 'completed';
  const profile = session?.profile;

  return (
    <div>
      <div className="chat-page-title">🚀 Créer mon plan de promotion</div>
      <div className="chat-page-subtitle">
        L'assistant IA vous pose les bonnes questions et recherche lui-même les infos de votre entreprise
      </div>

      <div className="chat-layout">
        <div className="chat-page">
          <div className="chat-container">
            <div className="chat-messages">
              {session?.messages.map((msg, i) => (
                <Fragment key={i}>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="chat-actions">
                      {msg.actions.map((a, j) => (
                        <span key={j} className="chat-action-chip">{a}</span>
                      ))}
                    </div>
                  )}
                  <div className={`chat-msg chat-msg-${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                    <div className="chat-avatar">{msg.role === 'assistant' ? '🤖' : '👤'}</div>
                    <div className={`chat-bubble ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                      {renderText(msg.text)}
                    </div>
                  </div>
                </Fragment>
              ))}

              {sending && streamActions.length > 0 && (
                <div className="chat-actions">
                  {streamActions.map((a, j) => (
                    <span key={j} className="chat-action-chip">{a}</span>
                  ))}
                </div>
              )}

              {sending && (
                <div className="chat-msg chat-msg-bot">
                  <div className="chat-avatar">🤖</div>
                  {streamText
                    ? <div className="chat-bubble bot">{renderText(streamText)}<span className="chat-cursor">▋</span></div>
                    : <div className="chat-bubble-thinking"><span /><span /><span /></div>}
                </div>
              )}

              {completed && (
                <div className="chat-generate-cta">
                  <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
                    {generating ? '⏳ Génération en cours…' : '⚡ Générer mon plan de lancement'}
                  </button>
                  <button className="btn" onClick={restart} disabled={generating}>
                    ↺ Recommencer
                  </button>
                </div>
              )}

              <div ref={chatEnd} />
            </div>

            {error && <div className="chat-error">{error}</div>}

            {pendingDocs.length > 0 && (
              <div className="chat-attachments">
                {pendingDocs.map((d, i) => (
                  <span key={i} className="chat-attachment-chip">
                    📎 {d.name}
                    <button
                      type="button"
                      onClick={() => setPendingDocs(pendingDocs.filter((_, j) => j !== i))}
                      aria-label={`Retirer ${d.name}`}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            {!completed && (
              <form className="chat-input-bar" onSubmit={handleSend}>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS.join(',')}
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFiles}
                />
                <button
                  type="button"
                  className="btn chat-attach-btn"
                  title="Joindre un document (pdf, txt, md, csv, json, html)"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                >📎</button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Votre réponse… (nom d'entreprise, site web, ou décrivez votre idée)"
                  disabled={sending}
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sending || (!input.trim() && pendingDocs.length === 0)}
                >
                  Envoyer →
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="chat-summary-panel">
          <div className="chat-summary-title">Profil de votre entreprise</div>
          {profile ? (
            <>
              <div className="chat-summary-field">
                <div className="chat-summary-label">Entreprise</div>
                <div className="chat-summary-value">
                  {profile.company.name}
                  {profile.company.website ? ` · ${profile.company.website}` : ''}
                </div>
              </div>
              {profileLabels.map(({ key, label }) => {
                const value = profile[key];
                const display = Array.isArray(value) ? value.join(' · ') : String(value ?? '');
                return (
                  <div key={key} className="chat-summary-field">
                    <div className="chat-summary-label">{label}</div>
                    {display
                      ? <div className="chat-summary-value">{display}</div>
                      : <div className="chat-summary-empty">—</div>}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="chat-summary-empty">
              L'assistant remplit ce profil au fil de la conversation. Il apparaîtra ici une fois validé ensemble.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when no AI key is configured on the server — keeps the product usable
 * with a classic form that generates a template-based plan.
 */
function ManualFallbackForm() {
  const navigate = useNavigate();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm]   = useState({
    productName: '', description: '', targetAudience: '',
    niche: 'saas', goals: '', pricing: '',
  });

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createPlan({
      productName:    form.productName,
      description:    form.description,
      targetAudience: form.targetAudience,
      niche:          form.niche,
      goals:          form.goals.split('\n').map((g) => g.trim()).filter(Boolean),
      pricing:        form.pricing || 'Non défini',
      mode:           'template',
    });
    setBusy(false);
    if (res.success && res.data) navigate(`/plan/${res.data.id}`);
    else setError(res.error || 'Erreur lors de la création du plan');
  };

  return (
    <div className="manual-form-wrap">
      <div className="chat-page-title">🚀 Créer mon plan de promotion</div>
      <div className="alert-warning">
        L'assistant IA n'est pas configuré sur ce serveur (variable <code>OPENROUTER_API_KEY</code> manquante).
        Remplissez le formulaire pour générer un plan basé sur nos modèles.
      </div>
      <form className="manual-form" onSubmit={submit}>
        <label>Nom du produit / de l'entreprise
          <input required value={form.productName} onChange={set('productName')} placeholder="ex. TaskFlow" />
        </label>
        <label>Description
          <textarea required value={form.description} onChange={set('description')} rows={3}
            placeholder="Que fait votre produit ? Quel problème résout-il ?" />
        </label>
        <label>Audience cible
          <input required value={form.targetAudience} onChange={set('targetAudience')} placeholder="ex. Équipes dev remote de 5 à 50 personnes" />
        </label>
        <label>Niche
          <select value={form.niche} onChange={set('niche')}>
            {['saas', 'ai', 'devtool', 'nocode', 'marketplace', 'fintech', 'health', 'education', 'ecommerce', 'content', 'local-business', 'services', 'other']
              .map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Objectifs (un par ligne)
          <textarea required value={form.goals} onChange={set('goals')} rows={3}
            placeholder={'100 premiers utilisateurs\nLancement Product Hunt'} />
        </label>
        <label>Prix
          <input value={form.pricing} onChange={set('pricing')} placeholder="ex. 29 €/mois par équipe" />
        </label>
        {error && <div className="chat-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '⏳ Génération…' : '⚡ Générer mon plan'}
        </button>
      </form>
    </div>
  );
}
