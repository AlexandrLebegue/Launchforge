import { useState, useRef, useEffect, FormEvent, ChangeEvent, KeyboardEvent, Fragment } from 'react';
import Loader from '../components/Loader';
import { useNavigate } from 'react-router-dom';
import { Flame, User, Paperclip, Send, Plug, Mail } from 'lucide-react';
import Markdown from '../components/Markdown';
import PlatformConnectTable from '../components/PlatformConnectTable';
import {
  startOnboarding,
  getOnboardingSession,
  streamOnboardingMessage,
  createPlan,
  invalidateOverview,
  recordActivePlatforms,
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


const profileLabels: { key: keyof OnboardingProfile; label: string }[] = [
  { key: 'productName',    label: 'Produit' },
  { key: 'description',    label: 'Description' },
  { key: 'targetAudience', label: 'Audience' },
  { key: 'niche',          label: 'Niche' },
  { key: 'goals',          label: 'Objectifs' },
  { key: 'pricing',        label: 'Prix' },
];

// Champs commerciaux (optionnels) — affichés seulement s'ils sont renseignés.
const OBJECTIVE_LABELS: Record<string, string> = {
  launch: 'Lancer / premiers clients',
  'grow-revenue': 'Vendre plus / CA',
  both: 'Lancer et vendre',
};
const TRACTION_LABELS: Record<string, string> = {
  'pre-revenue': 'Pré-revenu',
  'first-customers': 'Premiers clients',
  'early-revenue': 'Revenu débutant',
  scaling: "Passage à l'échelle",
};
const SALES_MOTION_LABELS: Record<string, string> = {
  'self-serve': 'Libre-service',
  'sales-led': 'Vente assistée',
  hybrid: 'Hybride',
};
const gtmLabels: { key: keyof OnboardingProfile; label: string; map?: Record<string, string> }[] = [
  { key: 'primaryObjective', label: 'Priorité',       map: OBJECTIVE_LABELS },
  { key: 'traction',         label: 'Stade',          map: TRACTION_LABELS },
  { key: 'buyer',            label: 'Acheteur' },
  { key: 'salesMotion',      label: 'Mode de vente',  map: SALES_MOTION_LABELS },
  { key: 'revenueGoal',      label: 'Objectif de CA' },
  { key: 'bottleneck',       label: 'Frein principal' },
];

const SPLASH_STEPS = [
  { at: 0,   icon: '', text: 'Analyse de votre profil et de vos objectifs…' },
  { at: 12,  icon: '', text: 'Construction du plan de croissance semaine par semaine…' },
  { at: 45,  icon: '', text: 'Sélection des communautés et angles de contenu…' },
  { at: 75,  icon: '', text: 'Rédaction de vos premières idées de posts…' },
  { at: 110, icon: '', text: 'Datation des publications dans votre calendrier…' },
  { at: 140, icon: '', text: 'Dernières touches — votre hub se remplit…' },
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
      <div className="gen-splash-forge" aria-hidden="true">
        <span className="gen-splash-ring" />
        <span className="gen-splash-ring r2" />
        <span className="gen-splash-ring r3" />
        <div className="forge-scene">
          <div className="forge-anvil" />
          <div className="forge-glow" />
          <div className="forge-hammer"><span className="forge-hammer-head" /></div>
          <div className="forge-sparks">
            <span /><span /><span /><span /><span /><span />
          </div>
        </div>
      </div>
      <h2 className="gen-splash-title">Génération de votre plan de croissance</h2>
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
  // Slugs des plateformes connectées (émis par PlatformConnectTable) — pilote
  // l'affichage du raccourci « analyser mes clients depuis ma boîte mail ».
  const [connectedSlugs, setConnectedSlugs] = useState<string[]>([]);

  const chatEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, sending, streamText, streamActions.length]);

  // Zone de saisie auto-extensible : grandit avec le texte (retours à la ligne
  // visibles), jusqu'à un plafond, puis défile. Se réinitialise une fois envoyé.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Plancher à 34px (= hauteur des boutons ronds) pour une barre nette au repos.
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 34), 160)}px`;
  }, [input]);

  useEffect(() => {
    (async () => {
      // Resume a conversation after a reload — y compris une session déjà
      // TERMINÉE : l'utilisateur retrouve son profil, l'étape de connexion des
      // plateformes et le bouton de génération (sinon il repartait de zéro et
      // perdait son onboarding s'il fermait l'onglet avant de générer le plan).
      const savedId = localStorage.getItem(SESSION_KEY);
      if (savedId) {
        const res = await getOnboardingSession(savedId);
        if (res.success && res.data && (res.data.status === 'active' || res.data.status === 'completed')) {
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
        { role: 'user', text: text || `${docs.map((d) => d.name).join(', ')}` },
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

  // `destination` permet de router ailleurs qu'au Hub après génération — le
  // raccourci « boîte mail » crée le projet puis ouvre directement le scan des
  // leads (qui exige un projet actif, inexistant avant cette étape).
  const handleGenerate = async (
    destination?: (planId: string, drafts: number) => string,
  ) => {
    if (!session?.profile) return;
    setGenerating(true);
    setError(null);
    const p = session.profile;
    const res = await createPlan({
      productName:    p.productName,
      description:    p.description,
      targetAudience: p.targetAudience,
      niche:          p.niche,
      goals:          p.goals.length > 0 ? p.goals : ['décrocher mes premiers clients'],
      pricing:        p.pricing,
      company:        p.company,
      // Contexte commercial collecté à l'onboarding — oriente le plan vers la vente.
      buyer:            p.buyer,
      primaryObjective: p.primaryObjective,
      traction:         p.traction,
      salesMotion:      p.salesMotion,
      bottleneck:       p.bottleneck,
      revenueGoal:      p.revenueGoal,
      mode:           'ai',
    });
    if (res.success && res.data) {
      // Le projet vient d'être créé et activé : on consigne dans sa base de
      // connaissances les plateformes connectées pendant l'onboarding (best-effort).
      await recordActivePlatforms().catch(() => { /* best-effort */ });
      setGenerating(false);
      // Nouveau projet actif : la vue d'ensemble en cache est obsolète
      invalidateOverview();
      // Par défaut, direction le Hub (brouillons IA en attente) ; sinon la
      // destination fournie (ex. scan de la boîte mail).
      navigate(destination
        ? destination(res.data.id, res.bootstrappedPosts ?? 0)
        : `/content?drafts=${res.bootstrappedPosts ?? 0}&plan=${res.data.id}`);
    } else {
      setGenerating(false);
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

  if (loading) return <Loader text="Chargement…" />;

  if (generating) return <GenerationSplash />;

  if (aiOffline) return <ManualFallbackForm />;

  const completed = session?.status === 'completed';
  const profile = session?.profile;
  const mailConnected = connectedSlugs.includes('gmail') || connectedSlugs.includes('outlook');

  return (
    <div className="chat-screen">
      <div className="chat-page-title">Créer mon plan de croissance</div>
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
                    <div className={`chat-avatar ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                      {msg.role === 'assistant' ? <Flame size={16} /> : <User size={16} />}
                    </div>
                    <div className={`chat-bubble ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                      <Markdown text={msg.text} />
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
                  <div className="chat-avatar bot"><Flame size={16} /></div>
                  {streamText
                    ? <div className="chat-bubble bot"><Markdown text={streamText} /><span className="chat-cursor">▋</span></div>
                    : <div className="chat-bubble-thinking"><span /><span /><span /></div>}
                </div>
              )}

              {completed && (
                <div className="onboarding-config-step">
                  <div className="chat-msg chat-msg-bot">
                    <div className="chat-avatar bot"><Flame size={16} /></div>
                    <div className="chat-bubble bot">
                      <Markdown text={"Parfait, votre profil est prêt ! 🎉\n\n**Dernière étape : sur quels réseaux voulez-vous publier ?** Connectez ceux que vous comptez utiliser — vous pourrez ensuite y publier en un clic, suivre vos métriques et même **importer vos anciens posts**. Vous pourrez toujours en ajouter d'autres plus tard."} />
                    </div>
                  </div>

                  <div className="onboarding-platforms-card card">
                    <div className="card-header"><Plug size={15} /> Connecter mes plateformes</div>
                    {/* recordOnConnect=false : le projet n'existe pas encore ;
                        la consignation en base de connaissances se fait après
                        la génération du plan (handleGenerate → recordActivePlatforms). */}
                    <PlatformConnectTable recordOnConnect={false} onChange={setConnectedSlugs} />
                    <p className="form-hint-inline" style={{ marginTop: 12 }}>
                      Cette étape est facultative — vous pouvez générer votre plan dès maintenant et connecter vos comptes plus tard depuis la Configuration.
                    </p>
                  </div>

                  <div className="chat-generate-cta">
                    <button className="btn btn-primary" onClick={() => handleGenerate()} disabled={generating}>
                      {generating ? '⏳ Génération en cours…' : 'Générer mon plan de croissance'}
                    </button>
                    {mailConnected && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleGenerate(() => '/crm?scan=inbox')}
                        disabled={generating}
                        title="Crée votre projet, puis lit votre boîte mail pour détecter et scorer vos clients et prospects"
                      >
                        <Mail size={16} /> Analyser mes clients depuis ma boîte mail
                      </button>
                    )}
                    <button className="btn" onClick={restart} disabled={generating}>
                      ↺ Recommencer
                    </button>
                  </div>
                  {mailConnected && (
                    <p className="form-hint-inline" style={{ marginTop: 8, textAlign: 'center' }}>
                      Gmail/Outlook connecté : ce raccourci crée votre projet puis ouvre directement le scan de votre boîte mail.
                    </p>
                  )}
                </div>
              )}

              <div ref={chatEnd} />
            </div>

            {error && <div className="chat-error">{error}</div>}

            {pendingDocs.length > 0 && (
              <div className="chat-attachments">
                {pendingDocs.map((d, i) => (
                  <span key={i} className="chat-attachment-chip">
                    {d.name}
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
              <form className="assistant-page-input chat-composer" onSubmit={handleSend}>
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
                  className="assistant-input-btn assistant-attach"
                  title="Joindre un document (pdf, txt, md, csv, json, html)"
                  aria-label="Joindre un document"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                >
                  <Paperclip size={18} />
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                    // Entrée envoie ; Maj+Entrée insère un retour à la ligne
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Votre réponse… (nom d'entreprise, site web, ou décrivez votre idée). Maj+Entrée pour un retour à la ligne."
                  disabled={sending}
                  autoFocus
                  style={{ height: '34px' }}
                />
                <button
                  type="submit"
                  className="assistant-input-btn assistant-send"
                  disabled={sending || (!input.trim() && pendingDocs.length === 0)}
                  title="Envoyer"
                  aria-label="Envoyer"
                >
                  <Send size={18} />
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
              {gtmLabels.map(({ key, label, map }) => {
                const raw = profile[key];
                if (!raw) return null;
                const text = Array.isArray(raw) ? raw.join(' · ') : String(raw);
                return (
                  <div key={key} className="chat-summary-field">
                    <div className="chat-summary-label">{label}</div>
                    <div className="chat-summary-value">{map ? (map[text] ?? text) : text}</div>
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
    if (res.success && res.data) {
      invalidateOverview();
      navigate('/');
    }
    else setError(res.error || 'Erreur lors de la création du plan');
  };

  return (
    <div className="manual-form-wrap">
      <div className="chat-page-title">Créer mon plan de croissance</div>
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
          {busy ? '⏳ Génération…' : 'Générer mon plan'}
        </button>
      </form>
    </div>
  );
}
