import { useState, useEffect, useMemo, useRef, FormEvent, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Loader from './Loader';
import Markdown from './Markdown';
import { Users, ArrowUpDown, Target, Sparkles } from 'lucide-react';
import {
  getContacts, createContact, updateContact, deleteContact,
  analyzeLeads, scanInbox, scanPost, getPosts, draftContactEmail, sendContactEmail,
  importHubSpot, previewHubSpot, getConfigStatus, getContactEmails, syncContactEmails, getCompanies, scoreContact,
  streamContactNextAction, enrichContactApollo,
  Contact, ContactType, DealStage, DEAL_STAGES, STAGE_LABELS, LeadCandidate, Post, ContactEmail, CompanyWithStats, EmailSyncDebug, HubSpotCandidate,
} from '../api/client';
import { platformLabel } from '../pages/ContentHubPage';
import CompanyPanel from './CompanyPanel';

/** Compteur animé 0 → valeur, pour l'apparition du score d'intérêt. */
function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic pour une décélération naturelle en fin de course
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Copilote « prochaine action » — chat en tiroir, contextualisé au contact
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; text: string; }

function NextActionChat({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const runTurn = async (history: ChatMsg[]) => {
    setSending(true);
    setError(null);
    setStreamText('');
    await streamContactNextAction(
      contact.id,
      history,
      {
        onDelta: (t) => setStreamText((prev) => prev + t),
        onAction: () => { /* pas d'outils ici */ },
        onDone: (reply) => {
          setSending(false);
          setStreamText('');
          setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
        },
        onError: (err) => {
          setSending(false);
          setStreamText('');
          setError(err === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).' : err);
          setMessages((prev) => prev.slice(0, -1)); // retire le message user resté sans réponse
        },
      },
    );
  };

  // Au montage : demande d'emblée une recommandation de prochaine action.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const kickoff: ChatMsg = {
      role: 'user',
      text: `Quelle est la meilleure prochaine action à mener avec ${contact.name}${contact.company ? ` (${contact.company})` : ''} pour faire avancer la vente ? Propose-moi un plan concret et, si utile, ébauche le message.`,
    };
    setMessages([kickoff]);
    runTurn([kickoff]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText]);

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const next: ChatMsg[] = [...messages, { role: 'user', text }];
    setMessages(next);
    await runTurn(next);
  };

  // Rendu dans un portail (hors de la modale contact) : sinon les clics
  // remontent à l'overlay de la modale (qui la fermerait) et le z-index du
  // tiroir passe sous celui de la modale.
  return createPortal(
    <>
      <div className="assistant-overlay" style={{ zIndex: 1200 }} onClick={onClose} />
      <aside className="assistant-drawer" style={{ zIndex: 1201 }}>
        <div className="assistant-header">
          <span className="assistant-title">🎯 Prochaine action — {contact.name}</span>
          <span className="form-hint-inline">copilote de vente contextualisé</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="assistant-messages">
          {/* Le tout premier message user est un déclencheur — on ne l'affiche pas */}
          {messages.map((msg, i) => (
            (i === 0 && msg.role === 'user') ? null : (
              <Fragment key={i}>
                <div className={`chat-msg chat-msg-${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                  <div className="chat-avatar">{msg.role === 'assistant' ? '🎯' : ''}</div>
                  <div className={`chat-bubble ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                    <Markdown text={msg.text} />
                  </div>
                </div>
              </Fragment>
            )
          ))}
          {sending && (
            <div className="chat-msg chat-msg-bot">
              <div className="chat-avatar">🎯</div>
              {streamText
                ? <div className="chat-bubble bot"><Markdown text={streamText} /><span className="chat-cursor">▋</span></div>
                : <div className="chat-bubble-thinking"><span /><span /><span /></div>}
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {error && <div className="chat-error" style={{ margin: '0 0 8px' }}>{error}</div>}

        <form className="na-chat-input" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pose une question, affine le plan…"
            disabled={sending}
            autoFocus
          />
          <button type="submit" className="na-chat-send" disabled={sending || !input.trim()} title="Envoyer">
            {sending ? '⏳' : '➤'}
          </button>
        </form>
      </aside>
    </>,
    document.body,
  );
}

const TYPE_META: Record<ContactType, { label: string; icon: string; cls: string }> = {
  prospect: { label: 'Prospect',   icon: '', cls: 'contact-type-prospect' },
  client:   { label: 'Client',     icon: '', cls: 'contact-type-client' },
  partner:  { label: 'Partenaire', icon: '', cls: 'contact-type-partner' },
};

function scoreColor(score: number): string {
  if (score >= 70) return '#34d399';
  if (score >= 40) return '#fbbf24';
  return '#97a0b5';
}

const fmtAmount = (n: number | null): string =>
  n != null && Number.isFinite(n) ? `${Math.round(n).toLocaleString('fr-FR')} €` : '';

const STAGE_COLORS: Record<DealStage, string> = {
  new: '#97a0b5', qualified: '#60a5fa', discussion: '#a78bfa',
  proposal: '#fbbf24', won: '#34d399', lost: '#f87171',
};

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';

/** Échéance dépassée (comparaison de dates yyyy-mm-dd). */
const isOverdue = (iso: string | null): boolean =>
  iso != null && iso < new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Onglet Emails d'un contact — timeline envoyés (←/→) + reçus, synchro par adresse
// ─────────────────────────────────────────────────────────────────────────────

function EmailsTab({ contactId, contactEmail, onCompose }: {
  contactId: string;
  contactEmail: string | null;
  onCompose: () => void;
}) {
  const [emails, setEmails] = useState<ContactEmail[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [debug, setDebug] = useState<EmailSyncDebug | null>(null);

  useEffect(() => {
    getContactEmails(contactId).then((res) => setEmails(res.success && res.data ? res.data : []));
  }, [contactId]);

  const sync = async () => {
    setSyncing(true);
    setMsg('');
    setDebug(null);
    const res = await syncContactEmails(contactId);
    setSyncing(false);
    if (res.success && res.data) {
      setEmails(res.data.emails);
      setDebug(res.data.debug ?? null);
      setMsg(`✓ ${res.data.added} email(s) synchronisé(s).${res.data.debug?.warning ? ' — ⚠️ ' + res.data.debug.warning : ''}`);
    } else {
      setMsg(res.error === 'COMPOSIO_NOT_CONFIGURED' ? 'Boîte mail non connectée (Composio).' : res.error || 'Synchro impossible.');
    }
  };

  return (
    <div className="post-editor">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="btn btn-secondary btn-sm" onClick={sync} disabled={syncing || !contactEmail}
          title={contactEmail ? `Chercher les emails échangés avec ${contactEmail}` : 'Ajoutez d\'abord une adresse email'}>
          {syncing ? '⏳ Synchro…' : '↻ Synchroniser'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={onCompose} disabled={!contactEmail}>✉ Rédiger</button>
      </div>
      {msg && <div className="kb-status-msg" style={{ marginBottom: 8 }}>{msg}</div>}
      {debug && (
        <details style={{ marginBottom: 10, fontSize: '0.78rem' }} open>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }}>Détails techniques (débogage)</summary>
          <pre style={{ background: 'var(--color-surface)', borderRadius: 8, padding: 10, marginTop: 6, whiteSpace: 'pre-wrap', fontSize: '0.72rem', overflowX: 'auto' }}>
{`source : ${debug.source ?? '?'}
adresse : ${debug.address}
appels OK : ${debug.okCalls}   ·   échoués : ${debug.failedCalls}
messages renvoyés : ${debug.parsedEmails}${debug.parseError ? `\nerreur de parsing : ${debug.parseError}` : ''}${debug.warning ? `\n⚠️  ${debug.warning}` : ''}

réponse brute :
${debug.replyPreview}`}
          </pre>
        </details>
      )}
      {emails === null ? (
        <Loader text="Chargement…" variant="inline" />
      ) : emails.length === 0 ? (
        <div className="form-hint-inline">
          Aucun email pour l'instant.{contactEmail ? ` « Synchroniser » cherche les échanges avec ${contactEmail} dans votre boîte.` : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {emails.map((e) => {
            const received = e.direction === 'received';
            return (
              <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ color: received ? '#60a5fa' : '#34d399', fontWeight: 700, flexShrink: 0 }}>{received ? '←' : '→'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{e.subject || '(sans objet)'}</div>
                  {e.snippet && <div style={{ fontSize: '0.79rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{e.snippet}</div>}
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {received ? 'Reçu' : 'Envoyé'} · {new Date(e.sentAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — fiche contact (création / édition)
// ─────────────────────────────────────────────────────────────────────────────

function ContactEditor({ contact, onClose, onSaved, onScored, onCompose, readOnly = false, apolloConfigured = false }: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
  onScored: (c: Contact) => void;
  onCompose: () => void;
  readOnly?: boolean;
  apolloConfigured?: boolean;
}) {
  const [tab, setTab] = useState<'apercu' | 'emails' | 'entreprise'>('apercu');
  const [score, setScore] = useState<number | null>(contact?.interestScore ?? null);
  const [summary, setSummary] = useState<string>(contact?.interestSummary ?? '');
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState('');
  // Enrichissement Apollo : état local pour rafraîchir l'aperçu sans fermer la modale
  const [person, setPerson] = useState({ title: contact?.title ?? null, linkedinUrl: contact?.linkedinUrl ?? null, phone: contact?.phone ?? null });
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const [enrichError, setEnrichError] = useState('');
  const [form, setForm] = useState({
    name:    contact?.name ?? '',
    email:   contact?.email ?? '',
    company: contact?.company ?? '',
    title:       contact?.title ?? '',
    linkedinUrl: contact?.linkedinUrl ?? '',
    phone:       contact?.phone ?? '',
    type:    (contact?.type ?? 'prospect') as ContactType,
    stage:   (contact?.stage ?? 'new') as DealStage,
    amount:  contact?.amount != null ? String(contact.amount) : '',
    expectedCloseDate: contact?.expectedCloseDate ?? '',
    nextAction:        contact?.nextAction ?? '',
    nextActionAt:      contact?.nextActionAt ?? '',
    source:  contact?.source ?? '',
    notes:   contact?.notes ?? '',
    lastInteraction: contact?.lastInteraction ?? '',
    manualLog: contact?.manualLog ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [chatOpen,   setChatOpen]   = useState(false);
  const [editScore,  setEditScore]  = useState(false);
  const [scoreDraft, setScoreDraft] = useState('');

  // Logo de l'entreprise : favicon déduit du domaine de l'email (approximation).
  const companyFavicon = contact?.email && contact.email.includes('@')
    ? `https://www.google.com/s2/favicons?domain=${contact.email.split('@')[1]}&sz=64`
    : null;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) { setError('Le nom est requis.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      name: form.name, email: form.email || null, company: form.company || null,
      title: form.title || null, linkedinUrl: form.linkedinUrl || null, phone: form.phone || null,
      type: form.type, stage: form.stage,
      amount: form.amount.trim() ? Number(form.amount) : null,
      expectedCloseDate: form.expectedCloseDate || null,
      nextAction: form.nextAction || null,
      nextActionAt: form.nextActionAt || null,
      source: form.source || null, notes: form.notes || null,
      manualLog: form.manualLog || null,
    };
    const res = contact
      ? await updateContact(contact.id, payload)
      : await createContact(payload as Partial<Contact> & { name: string });
    setSaving(false);
    if (res.success && res.data) onSaved(res.data);
    else setError(res.error || 'Enregistrement impossible.');
  };

  const reScore = async () => {
    if (!contact) return;
    setScoring(true);
    setScoreError('');
    const res = await scoreContact(contact.id);
    setScoring(false);
    if (res.success && res.data) { setScore(res.data.interestScore); setSummary(res.data.interestSummary ?? ''); onScored(res.data); }
    else setScoreError(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur.' : res.error || 'Analyse impossible.');
  };

  // Enrichissement Apollo.io (clé personnelle) : complète poste, LinkedIn,
  // email pro et fiche entreprise sans écraser ce qui est déjà renseigné.
  const enrichApollo = async () => {
    if (!contact) return;
    if (!apolloConfigured) {
      setEnrichError('Ajoutez d\'abord votre clé API Apollo dans Configuration › Comptes connectés.');
      return;
    }
    setEnriching(true);
    setEnrichError('');
    setEnrichMsg('');
    const res = await enrichContactApollo(contact.id);
    setEnriching(false);
    if (res.success && res.data) {
      const { contact: c, enrichment, organization, warnings } = res.data;
      setPerson({ title: c.title, linkedinUrl: c.linkedinUrl, phone: c.phone });
      setForm((f) => ({
        ...f,
        title: c.title ?? f.title,
        linkedinUrl: c.linkedinUrl ?? f.linkedinUrl,
        phone: c.phone ?? f.phone,
        email: c.email ?? f.email,
        company: c.company ?? f.company,
      }));
      const found = [
        c.title && 'poste', c.linkedinUrl && 'LinkedIn', enrichment?.email && 'email',
        c.phone && 'téléphone', organization && 'entreprise (onglet Entreprise)',
      ].filter(Boolean);
      const parts = [
        found.length > 0 ? `Trouvé : ${found.join(', ')}.` : 'Rien de nouveau.',
        // Le téléphone personnel arrive en différé (webhook Apollo)
        enrichment && !c.phone ? 'Le téléphone arrive en différé s\'il est disponible (rouvrez la fiche dans ~1 min).' : '',
        ...(warnings ?? []),
      ].filter(Boolean);
      setEnrichMsg(parts.join(' '));
      onScored(c); // met à jour la liste sans fermer la modale
    } else {
      setEnrichError(res.error === 'APOLLO_NOT_CONFIGURED'
        ? 'Ajoutez d\'abord votre clé API Apollo dans Configuration › Comptes connectés.'
        : res.error || 'Enrichissement impossible.');
    }
  };

  // Correction manuelle du score d'intérêt (persistée immédiatement).
  const saveManualScore = async () => {
    if (!contact) return;
    if (scoreDraft.trim() === '') { setEditScore(false); return; }
    const n = Math.max(0, Math.min(100, Math.round(Number(scoreDraft))));
    if (!Number.isFinite(n)) { setEditScore(false); return; }
    setEditScore(false);
    setScore(n);
    const res = await updateContact(contact.id, { interestScore: n });
    if (res.success && res.data) onScored(res.data);
    else setScoreError(res.error || 'Enregistrement du score impossible.');
  };

  // Champs d'édition — réutilisés tels quels à la création et repliés en édition.
  const editFields = (
    <>
      <div className="post-editor-row">
        <label className="form-label-block">Nom
          <input className="form-input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus={!contact} />
        </label>
        <label className="form-label-block">Type
          <select className="form-input" value={form.type} onChange={(e) => set('type', e.target.value as ContactType)}>
            <option value="prospect">Prospect</option>
            <option value="client">Client</option>
            <option value="partner">Partenaire</option>
          </select>
        </label>
      </div>
      <div className="post-editor-row">
        <label className="form-label-block">Email
          <input className="form-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="prenom@entreprise.fr" />
        </label>
        <label className="form-label-block">Entreprise
          <input className="form-input" value={form.company} onChange={(e) => set('company', e.target.value)} />
        </label>
      </div>
      <div className="post-editor-row">
        <label className="form-label-block">Poste
          <input className="form-input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="ex. Head of Sales" />
        </label>
        <label className="form-label-block">Téléphone
          <input className="form-input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+33 6 12 34 56 78" />
        </label>
      </div>
      <label className="form-label-block">Profil LinkedIn
        <input className="form-input" type="url" value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/…" />
      </label>
      <div className="post-editor-row">
        <label className="form-label-block">Étape du pipeline
          <select className="form-input" value={form.stage} onChange={(e) => set('stage', e.target.value as DealStage)}>
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="form-label-block">Montant du deal (€)
          <input className="form-input" type="number" min="0" step="any" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="ex. 1500" />
        </label>
      </div>
      <div className="post-editor-row">
        <label className="form-label-block">Clôture estimée
          <input className="form-input" type="date" value={form.expectedCloseDate} onChange={(e) => set('expectedCloseDate', e.target.value)} />
        </label>
        <label className="form-label-block">Échéance prochaine action
          <input className="form-input" type="date" value={form.nextActionAt} onChange={(e) => set('nextActionAt', e.target.value)} />
        </label>
      </div>
      <label className="form-label-block">Prochaine action
        <input className="form-input" value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} placeholder="ex. Relancer par email, envoyer le devis…" />
      </label>
      <label className="form-label-block">Source
        <input className="form-input" value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="ex. commentaire LinkedIn, salon, boîte mail…" />
      </label>
      <label className="form-label-block">Échanges manuels (appels, réunions…)
        <textarea className="form-input" rows={5} value={form.manualLog} onChange={(e) => set('manualLog', e.target.value)} placeholder="Notez ici vos échanges hors email : appels, réunions, messages collés…" />
        <span className="form-hint-inline">Les emails reçus alimentent automatiquement le score et le copilote (onglet Emails › Synchroniser) — pas besoin de les recopier ici.</span>
      </label>
      <label className="form-label-block">Notes
        <textarea className="form-input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{contact ? contact.name : 'Nouveau contact'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {contact && (
          <div className="hub-tabs" style={{ margin: '0 0 6px', gap: 4 }}>
            <button className={`hub-tab${tab === 'apercu' ? ' active' : ''}`} onClick={() => setTab('apercu')}>Aperçu</button>
            <button className={`hub-tab${tab === 'emails' ? ' active' : ''}`} onClick={() => setTab('emails')}>Emails</button>
            <button className={`hub-tab${tab === 'entreprise' ? ' active' : ''}`} onClick={() => setTab('entreprise')}>Entreprise</button>
          </div>
        )}
        {(!contact || tab === 'apercu') && (
        <div className="post-editor">
          {contact && (
            <>
              {/* En-tête : identité à gauche, entreprise (logo) à droite */}
              <div className="contact-ov-head">
                <div style={{ minWidth: 0 }}>
                  <div className="contact-ov-name">{contact.name}</div>
                  {(person.title || person.linkedinUrl || person.phone) && (
                    <div className="form-hint-inline" style={{ marginTop: 2 }}>
                      {[
                        person.title,
                        person.phone && <a key="tel" href={`tel:${person.phone}`}>{person.phone}</a>,
                        person.linkedinUrl && <a key="li" href={person.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>,
                      ].filter(Boolean).map((el, i) => <Fragment key={i}>{i > 0 && ' · '}{el}</Fragment>)}
                    </div>
                  )}
                  <div className="contact-ov-chips">
                    <span className={`contact-type ${TYPE_META[contact.type].cls}`}>{TYPE_META[contact.type].label}</span>
                    <span className="contact-type" style={{ background: 'transparent', border: `1px solid ${STAGE_COLORS[contact.stage]}`, color: STAGE_COLORS[contact.stage] }}>{STAGE_LABELS[contact.stage]}</span>
                    {contact.amount != null && <span className="contact-company" style={{ color: '#34d399', fontWeight: 600 }}>{fmtAmount(contact.amount)}</span>}
                  </div>
                </div>
                <div className="contact-ov-company">
                  {companyFavicon
                    ? <img src={companyFavicon} alt="" width={36} height={36} style={{ borderRadius: 8, flexShrink: 0 }} />
                    : <div className="contact-ov-logo-fallback">{(contact.company || contact.name).slice(0, 1).toUpperCase()}</div>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{contact.company || '—'}</div>
                    {contact.email && <div className="form-hint-inline" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.email}</div>}
                  </div>
                </div>
              </div>

              {/* Grille : emails à gauche, score + prochaine action à droite */}
              <div className="contact-ov-grid">
                <div className="contact-ov-emails">
                  <div className="card-header" style={{ fontSize: '0.85rem', marginBottom: 6 }}>📨 Emails échangés</div>
                  <EmailsTab contactId={contact.id} contactEmail={contact.email} onCompose={onCompose} />
                </div>

                <div className="contact-ov-side">
                  <div className="score-dial">
                    <div className="score-dial-num" style={{ color: score !== null ? scoreColor(score) : 'var(--color-text-muted)' }}>
                      {score !== null ? <AnimatedScore value={score} /> : '—'}
                      <span className="score-dial-max">/100</span>
                    </div>
                    <div className="score-dial-label">Score d'intérêt</div>
                    {score !== null && (
                      <div className="score-dial-bar"><div style={{ width: `${score}%`, background: scoreColor(score) }} /></div>
                    )}
                    {summary && <div className="score-dial-summary">{summary}</div>}
                    {!readOnly && (
                      <div className="score-dial-actions">
                        {editScore ? (
                          <>
                            <input type="number" min={0} max={100} className="form-input" style={{ width: 72 }}
                                   value={scoreDraft} onChange={(e) => setScoreDraft(e.target.value)} autoFocus
                                   onKeyDown={(e) => { if (e.key === 'Enter') saveManualScore(); }} />
                            <button type="button" className="btn btn-primary btn-sm" onClick={saveManualScore}>OK</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditScore(false)}>✕</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={reScore} disabled={scoring}>
                              {scoring ? '⏳…' : (score !== null ? '↻ Ré-analyser' : '🔍 Analyser')}
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setScoreDraft(score !== null ? String(score) : ''); setEditScore(true); }}>
                              Ajuster
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {scoreError && <div className="chat-error" style={{ marginTop: 6 }}>{scoreError}</div>}
                  </div>

                  <button type="button" className="btn-next-action" onClick={() => setChatOpen(true)}>
                    <Target size={18} />
                    <span className="btn-next-action-main">Prochaine action</span>
                    <span className="btn-next-action-sub">L'IA analyse et vous guide</span>
                  </button>

                  {!readOnly && (
                    <>
                      <button
                        type="button" className="btn-next-action apollo"
                        onClick={enrichApollo} disabled={enriching}
                        title="Complète poste, LinkedIn, email pro, téléphone et fiche entreprise via votre compte Apollo.io (vos crédits Apollo)"
                      >
                        <Sparkles size={18} />
                        <span className="btn-next-action-main">{enriching ? 'Enrichissement…' : 'Enrichir via Apollo'}</span>
                        <span className="btn-next-action-sub">Poste, LinkedIn, téléphone, entreprise</span>
                      </button>
                      {enrichMsg && <span className="form-hint-inline">{enrichMsg}</span>}
                      {enrichError && <div className="chat-error">{enrichError}</div>}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Édition : repliée pour un contact existant, ouverte à la création */}
          <form onSubmit={save}>
            {contact ? (
              <details className="contact-edit-details">
                <summary>✎ Détails &amp; édition du deal</summary>
                <div style={{ marginTop: 10 }}>{editFields}</div>
              </details>
            ) : editFields}
            {error && <div className="chat-error">{error}</div>}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳…' : 'Enregistrer'}</button>
            </div>
          </form>

          {chatOpen && contact && <NextActionChat contact={contact} onClose={() => setChatOpen(false)} />}
        </div>
        )}
        {contact && tab === 'emails' && (
          <EmailsTab contactId={contact.id} contactEmail={contact.email} onCompose={onCompose} />
        )}
        {contact && tab === 'entreprise' && (
          <div className="post-editor">
            <CompanyPanel companyId={contact.companyId} companyName={contact.company} readOnly={readOnly} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — analyse IA (texte collé ou scan boîte mail)
// ─────────────────────────────────────────────────────────────────────────────

type AnalyzeMode = 'paste' | 'inbox' | 'post';

const MODAL_TITLES: Record<AnalyzeMode, string> = {
  paste: 'Analyser des messages',
  inbox: 'Scan de la boîte mail',
  post:  'Réactions d\'un post',
};

function AnalyzeModal({ mode, onClose, onImported }: {
  mode: AnalyzeMode;
  onClose: () => void;
  onImported: (contacts: Contact[]) => void;
}) {
  const [text,       setText]       = useState('');
  const [source,     setSource]     = useState('commentaires LinkedIn');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');
  const [candidates, setCandidates] = useState<LeadCandidate[] | null>(null);
  const [inboxSummary, setInboxSummary] = useState('');
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [importing,  setImporting]  = useState(false);
  // mode 'post' : sélection du post publié à scanner
  const [posts,        setPosts]        = useState<Post[] | null>(null);
  const [scannedPost,  setScannedPost]  = useState<Post | null>(null);
  // mode 'inbox' : options du scan
  const [maxEmails,   setMaxEmails]   = useState('50');
  const [daysBack,    setDaysBack]    = useState('30');
  const [discoverNew, setDiscoverNew] = useState(true);

  const handleCandidates = (res: { success: boolean; data?: LeadCandidate[]; error?: string }, notConfiguredMsg: string) => {
    setBusy(false);
    if (res.success && res.data) {
      setCandidates(res.data);
      setSelected(new Set(res.data.map((_, i) => i)));
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED' ? notConfiguredMsg : res.error || 'Le scan a échoué.');
    }
  };

  const runInboxScan = async () => {
    setBusy(true);
    setError('');
    const res = await scanInbox({ maxEmails: Number(maxEmails) || 50, daysBack: Number(daysBack) || 30, discoverNew });
    setBusy(false);
    if (res.success && res.data) {
      setCandidates(res.data.candidates);
      setSelected(new Set(res.data.candidates.map((_, i) => i)));
      setInboxSummary(`✓ ${res.data.updated.length} client(s) mis à jour · ${res.data.scanned} email(s) scannés · ${res.data.candidates.length} nouveau(x) prospect(s) proposé(s).`);
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Boîte mail non connectée (connectez Gmail dans Configuration).'
        : res.error || 'Le scan a échoué.');
    }
  };

  useEffect(() => {
    if (mode === 'post') {
      getPosts().then((res) => {
        if (res.success && res.data) {
          setPosts(res.data.filter((p) => p.status === 'published' && p.externalUrl));
        } else {
          setPosts([]);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const scanSelectedPost = async (post: Post) => {
    setScannedPost(post);
    setBusy(true);
    setError('');
    const res = await scanPost(post.id);
    handleCandidates(
      res,
      `Plateforme non connectée : configurez COMPOSIO_MCP_URL et connectez ${platformLabel(post.platform)} sur dashboard.composio.dev.`,
    );
  };

  const analyze = async () => {
    if (!text.trim()) { setError('Collez des messages à analyser.'); return; }
    setBusy(true);
    setError('');
    const res = await analyzeLeads(text, source);
    setBusy(false);
    if (res.success && res.data) {
      setCandidates(res.data);
      setSelected(new Set(res.data.map((_, i) => i)));
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED'
        ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).'
        : res.error || "L'analyse a échoué.");
    }
  };

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const importSelected = async () => {
    if (!candidates) return;
    setImporting(true);
    const created: Contact[] = [];
    for (const i of selected) {
      const c = candidates[i];
      const res = await createContact({
        name: c.name,
        email: c.email,
        company: c.company,
        type: c.suggestedType,
        source: mode === 'inbox'
          ? 'boîte mail'
          : mode === 'post'
            // L'id court du post permet l'attribution post → leads dans l'Analyse
            ? `réactions post [${scannedPost ? scannedPost.id.slice(0, 8) : '?'}] ${scannedPost ? platformLabel(scannedPost.platform) : ''}`.trim()
            : source,
        interestScore: c.score,
        interestSummary: c.summary,
        lastInteraction: c.excerpt || null,
      });
      if (res.success && res.data) created.push(res.data);
    }
    setImporting(false);
    onImported(created);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{MODAL_TITLES[mode]}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {candidates === null ? (
          mode === 'post' ? (
            <div className="post-editor">
              {busy ? (
                <Loader variant="inline" text={`Lecture des likes et commentaires de « ${scannedPost?.title || 'post'} » via Composio…`} />
              ) : posts === null ? (
                <Loader text="Chargement de vos posts…" variant="inline" />
              ) : posts.length === 0 ? (
                <>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    Aucun post publié avec une URL renseignée. Ouvrez un post publié dans le
                    Hub de contenu et ajoutez son URL (section métriques) pour pouvoir scanner ses réactions.
                  </p>
                  <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                    Choisissez le post dont vous voulez analyser les likes et commentaires :
                  </p>
                  <div className="candidate-list">
                    {posts.map((p) => (
                      <button key={p.id} type="button" className="candidate-row post-pick" onClick={() => scanSelectedPost(p)}>
                                                <span className="candidate-main">
                          <span className="candidate-name">{p.title || '(sans titre)'}</span>
                          <span className="candidate-summary">
                            {platformLabel(p.platform)} · publié le {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('fr-FR') : '—'}
                            {' · '}{p.likes} likes · {p.comments} commentaires
                          </span>
                        </span>
                        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>Scanner →</span>
                      </button>
                    ))}
                  </div>
                  {error && <div className="chat-error">{error}</div>}
                  <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
                </>
              )}
              {busy && error && <div className="chat-error">{error}</div>}
            </div>
          ) : mode === 'paste' ? (
            <div className="post-editor">
              <label className="form-label-block">Source
                <input className="form-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="ex. commentaires LinkedIn, DMs Instagram, emails…" />
              </label>
              <label className="form-label-block">Messages reçus
                <textarea
                  className="form-input post-content-area" rows={10}
                  value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={'Collez ici les commentaires de vos posts, vos DMs ou des emails…\n\nex.\nMarie Dupont : Super outil ! Vous avez une offre équipe ? On est 12 chez Acme.\nPaul Martin : \nJulie (julie@start.io) : Possible d\'avoir une démo cette semaine ?'}
                />
              </label>
              {error && <div className="chat-error">{error}</div>}
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                <button className="btn btn-primary" onClick={analyze} disabled={busy}>
                  {busy ? '⏳ Analyse en cours…' : 'Détecter les leads'}
                </button>
              </div>
            </div>
          ) : (
            <div className="post-editor">
              {busy ? (
                <Loader text="Scan de votre boîte de réception…" variant="inline" />
              ) : (
                <>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
                    Lit votre boîte, met à jour les <strong>clients existants</strong> (échanges + score) et — en option — <strong>propose de nouveaux prospects</strong>.
                  </p>
                  <div className="post-editor-row">
                    <label className="form-label-block">Emails à analyser (max)
                      <select className="form-input" value={maxEmails} onChange={(e) => setMaxEmails(e.target.value)}>
                        <option value="10">10 emails</option>
                        <option value="25">25 emails</option>
                        <option value="50">50 emails</option>
                        <option value="100">100 emails</option>
                        <option value="200">200 emails</option>
                      </select>
                    </label>
                    <label className="form-label-block">Ancienneté max
                      <select className="form-input" value={daysBack} onChange={(e) => setDaysBack(e.target.value)}>
                        <option value="7">7 derniers jours</option>
                        <option value="14">14 derniers jours</option>
                        <option value="30">30 derniers jours</option>
                        <option value="90">3 derniers mois</option>
                        <option value="180">6 derniers mois</option>
                        <option value="365">12 derniers mois</option>
                      </select>
                    </label>
                  </div>
                  <label className="form-label-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={discoverNew} onChange={(e) => setDiscoverNew(e.target.checked)} style={{ width: 'auto' }} />
                    <span>Découvrir de nouveaux clients potentiels <span className="form-hint-inline">(1 appel IA de plus)</span></span>
                  </label>
                  {error && <div className="chat-error">{error}</div>}
                  <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button className="btn btn-primary" onClick={runInboxScan}>Lancer le scan</button>
                  </div>
                </>
              )}
            </div>
          )
        ) : (
          <div className="post-editor">
            {inboxSummary && <div className="kb-status-msg" style={{ marginBottom: 8 }}>{inboxSummary}</div>}
            {candidates.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                Aucune personne suffisamment intéressée détectée dans ces messages.
              </p>
            ) : (
              <div className="candidate-list">
                {candidates.map((c, i) => (
                  <label key={i} className={`candidate-row${selected.has(i) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    <span className="candidate-score" style={{ color: scoreColor(c.score) }}>{c.score}</span>
                    <span className="candidate-main">
                      <span className="candidate-name">
                        {TYPE_META[c.suggestedType].icon} {c.name}
                        {c.company && <span className="candidate-company"> · {c.company}</span>}
                        {c.email && <span className="candidate-email"> · {c.email}</span>}
                      </span>
                      <span className="candidate-summary">{c.summary}</span>
                      {c.excerpt && <span className="candidate-excerpt">« {c.excerpt} »</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {error && <div className="chat-error">{error}</div>}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
              {candidates.length > 0 && (
                <button className="btn btn-primary" onClick={importSelected} disabled={importing || selected.size === 0}>
                  {importing ? '⏳ Import…' : `＋ Importer ${selected.size} contact${selected.size > 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — import HubSpot (préversion : l'utilisateur choisit deals & contacts)
// ─────────────────────────────────────────────────────────────────────────────

function HubSpotImportModal({ onClose, onImported }: {
  onClose: () => void;
  /** Message de résultat — le parent rafraîchit la liste et ferme la modale */
  onImported: (msg: string) => void;
}) {
  const [candidates, setCandidates] = useState<HubSpotCandidate[] | null>(null);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [importing,  setImporting]  = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    previewHubSpot().then((res) => {
      if (res.success && res.data) {
        setCandidates(res.data);
        // Tout coché par défaut : un clic sur « Importer » = comportement historique
        setSelected(new Set(res.data.map((c) => c.externalId)));
      } else {
        setCandidates([]);
        setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
          ? 'HubSpot non configuré côté serveur.'
          : res.error || 'Lecture HubSpot impossible.');
      }
    });
  }, []);

  const deals  = (candidates ?? []).filter((c) => c.externalId.startsWith('hs-deal:'));
  const people = (candidates ?? []).filter((c) => c.externalId.startsWith('hs-contact:'));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (group: HubSpotCandidate[]) => {
    const ids = group.map((c) => c.externalId);
    const all = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const runImport = async () => {
    setImporting(true);
    setError('');
    const res = await importHubSpot([...selected]);
    setImporting(false);
    if (res.success && res.data) {
      const { imported, updated } = res.data;
      onImported(`✓ HubSpot : ${imported} importé${imported > 1 ? 's' : ''}, ${updated} mis à jour.`);
    } else {
      setError(res.error || 'Import HubSpot impossible.');
    }
  };

  const section = (title: string, group: HubSpotCandidate[]) => group.length > 0 && (
    <div key={title}>
      <label className="form-label-block" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
        <input
          type="checkbox"
          checked={group.every((c) => selected.has(c.externalId))}
          onChange={() => toggleGroup(group)}
          style={{ width: 'auto' }}
        />
        <strong>{title} ({group.length})</strong>
      </label>
      <div className="candidate-list">
        {group.map((c) => (
          <label key={c.externalId} className={`candidate-row${selected.has(c.externalId) ? ' selected' : ''}`}>
            <input type="checkbox" checked={selected.has(c.externalId)} onChange={() => toggle(c.externalId)} />
            <span className="candidate-main">
              <span className="candidate-name">
                {c.name}
                {c.company && <span className="candidate-company"> · {c.company}</span>}
                {c.email && <span className="candidate-email"> · {c.email}</span>}
              </span>
              <span className="candidate-summary">
                {STAGE_LABELS[c.stage]}
                {c.amount != null ? ` · ${fmtAmount(c.amount)}` : ''}
                {c.expectedCloseDate ? ` · closing ${new Date(c.expectedCloseDate).toLocaleDateString('fr-FR')}` : ''}
                {c.existing ? ' · déjà importé → mise à jour' : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importer depuis HubSpot</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="post-editor">
          {candidates === null ? (
            <Loader variant="inline" text="Lecture de votre CRM HubSpot (deals + contacts)…" />
          ) : candidates.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              Aucun deal ni contact lisible dans le compte HubSpot connecté.
            </p>
          ) : (
            <>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginTop: 0 }}>
                Choisissez ce que vous ramenez dans votre pipeline : les deals arrivent avec leur
                étape et leur montant, les contacts avec leur email pour la relance. Les fiches déjà
                importées sont mises à jour (étape/montant) sans écraser vos notes.
              </p>
              {section('💼 Deals', deals)}
              {section('👤 Contacts', people)}
            </>
          )}
          {error && <div className="chat-error">{error}</div>}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            {(candidates?.length ?? 0) > 0 && (
              <button className="btn btn-primary" onClick={runImport} disabled={importing || selected.size === 0}>
                {importing ? '⏳ Import…' : `⤓ Importer ${selected.size} élément${selected.size > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — email (brouillon IA + envoi via Composio)
// ─────────────────────────────────────────────────────────────────────────────

function EmailModal({ contact, onClose, onSent }: {
  contact: Contact;
  onClose: () => void;
  onSent: (c: Contact) => void;
}) {
  const [goal,     setGoal]     = useState('');
  const [subject,  setSubject]  = useState('');
  const [body,     setBody]     = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending,  setSending]  = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error,    setError]    = useState('');

  const draft = async () => {
    if (!goal.trim()) { setError("Décrivez l'objectif de l'email."); return; }
    setDrafting(true);
    setError('');
    const res = await draftContactEmail(contact.id, goal.trim());
    setDrafting(false);
    if (res.success && res.data) {
      setSubject(res.data.subject);
      setBody(res.data.body);
    } else {
      setError(res.error === 'AI_NOT_CONFIGURED'
        ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).'
        : res.error || 'La génération a échoué.');
    }
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) { setError('Objet et corps requis.'); return; }
    setSending(true);
    setError('');
    const res = await sendContactEmail(contact.id, subject.trim(), body.trim());
    setSending(false);
    if (res.success && res.data) {
      setFeedback(`Email envoyé à ${contact.email} — ${res.data.result}`);
      onSent(res.data.contact);
    } else {
      setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Boîte mail non connectée : configurez COMPOSIO_MCP_URL et connectez Gmail/Outlook sur dashboard.composio.dev. Vous pouvez copier le texte et l\'envoyer vous-même.'
        : res.error || "L'envoi a échoué.");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Email à {contact.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="post-editor">
          {!contact.email && (
            <div className="alert-warning">Ce contact n'a pas d'adresse email — ajoutez-la d'abord sur sa fiche.</div>
          )}

          <div className="ai-assist-box">
            <div className="ai-assist-header">Brouillon par l'IA <span className="form-hint-inline">— personnalisé avec sa fiche, vos connaissances et vos échanges</span></div>
            <div className="ai-assist-row">
              <input
                className="form-input"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={'Objectif… ex. « Proposer une démo de 20 min cette semaine »'}
                disabled={drafting}
              />
              <button type="button" className="btn btn-primary" onClick={draft} disabled={drafting}>
                {drafting ? '⏳…' : 'Rédiger'}
              </button>
            </div>
          </div>

          <label className="form-label-block">Objet
            <input className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="form-label-block">Message
            <textarea className="form-input post-content-area" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>

          {feedback && <div className="approval-feedback" style={{ marginBottom: 0 }}>{feedback}</div>}
          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            <button
              className="btn btn-primary"
              onClick={send}
              disabled={sending || !contact.email || !subject.trim() || !body.trim()}
            >
              {sending ? '⏳ Envoi…' : `Envoyer depuis ma boîte mail`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panneau principal
// ─────────────────────────────────────────────────────────────────────────────

export default function ContactsPanel({ autoScanInbox = false, readOnly = false }: { autoScanInbox?: boolean; readOnly?: boolean } = {}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | ContactType>('all');
  const [stageFilter, setStageFilter] = useState<'all' | DealStage>('all');
  const [search,   setSearch]   = useState('');
  const [sortBy,   setSortBy]   = useState<'score' | 'amount' | 'closeDate' | 'nextAction'>('score');
  const [sortDir,  setSortDir]  = useState<'desc' | 'asc'>('desc');
  const [editing,  setEditing]  = useState<Contact | null | 'new'>(null);
  // autoScanInbox (deep-link depuis l'onboarding) : ouvre directement le scan
  // de la boîte mail au montage.
  const [analyzing, setAnalyzing] = useState<AnalyzeMode | null>(autoScanInbox ? 'inbox' : null);
  const [emailing, setEmailing] = useState<Contact | null>(null);
  const [view, setView] = useState<'list' | 'companies'>('list');
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [apolloConfigured, setApolloConfigured] = useState(false);
  const [hubspotImport, setHubspotImport] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [companies, setCompanies] = useState<CompanyWithStats[] | null>(null);
  const [viewingCompany, setViewingCompany] = useState<string | null>(null);

  useEffect(() => {
    getContacts().then((res) => {
      if (res.success && res.data) setContacts(res.data);
      setLoading(false);
    });
    // HubSpot connecté ? → on propose l'import du CRM. Clé Apollo ? → enrichissement.
    getConfigStatus().then((res) => {
      if (res.success && res.data) {
        setHubspotConnected(res.data.composio.toolkits.some((t) => t.slug === 'hubspot' && t.connected));
        setApolloConfigured(res.data.apollo?.configured ?? false);
      }
    });
  }, []);

  // Charge les comptes à l'entrée dans la vue Entreprises (rafraîchi à chaque bascule).
  useEffect(() => {
    if (view === 'companies') getCompanies().then((res) => setCompanies(res.success && res.data ? res.data : []));
  }, [view]);

  const upsert = (saved: Contact) =>
    setContacts((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      return exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev];
    });

  const handleDelete = async (contact: Contact) => {
    if (!window.confirm(`Supprimer « ${contact.name} » ?`)) return;
    const res = await deleteContact(contact.id);
    if (res.success) setContacts((prev) => prev.filter((c) => c.id !== contact.id));
  };

  // Import terminé depuis la modale : message de résultat + rafraîchissement.
  const onHubSpotImported = async (msg: string) => {
    setHubspotImport(false);
    setImportMsg(msg);
    const fresh = await getContacts();
    if (fresh.success && fresh.data) setContacts(fresh.data);
  };

  const filtered = useMemo(() => {
    // Valeur triable selon le critère choisi (les champs vides tombent en fin de liste).
    const sortVal = (c: Contact): number => {
      switch (sortBy) {
        case 'score':      return c.interestScore ?? -1;
        case 'amount':     return c.amount ?? -1;
        case 'closeDate':  return c.expectedCloseDate ? new Date(c.expectedCloseDate).getTime() : 0;
        case 'nextAction': return c.nextActionAt ? new Date(c.nextActionAt).getTime() : 0;
      }
    };
    const result = contacts.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${c.name} ${c.email ?? ''} ${c.company ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    result.sort((a, b) => {
      const av = sortVal(a), bv = sortVal(b);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return result;
  }, [contacts, typeFilter, stageFilter, search, sortBy, sortDir]);

  const hot = contacts.filter((c) => (c.interestScore ?? 0) >= 70).length;
  const wonRevenue = contacts.filter((c) => c.stage === 'won').reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const openPipeline = contacts
    .filter((c) => c.stage === 'qualified' || c.stage === 'discussion' || c.stage === 'proposal')
    .reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const wonCount = contacts.filter((c) => c.stage === 'won').length;
  const lostCount = contacts.filter((c) => c.stage === 'lost').length;
  const closedCount = wonCount + lostCount;
  const conversion = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : null;
  const avgTicket = wonCount > 0 ? wonRevenue / wonCount : null;

  if (loading) return <Loader text="Chargement des contacts…" />;

  return (
    <div>
      {/* Actions */}
      <div className="contacts-toolbar">
        {!readOnly && (<>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Contact</button>
        <button className="btn btn-ghost" onClick={() => setAnalyzing('inbox')} title="Lit votre boîte de réception via Composio et détecte les leads">
          Scanner ma boîte mail
        </button>
        {hubspotConnected && (
          <button className="btn btn-ghost" onClick={() => setHubspotImport(true)}
            title="Liste vos deals et contacts HubSpot — vous choisissez ce qui rejoint le pipeline (déterministe, sans coût IA)">
            ⤓ Importer depuis HubSpot
          </button>
        )}
        </>)}
        <span className="contacts-hot">{hot > 0 ? `${hot} lead${hot > 1 ? 's' : ''} chaud${hot > 1 ? 's' : ''}` : ''}</span>
        <div className="hub-tabs" style={{ gap: 4 }}>
          <button className={`hub-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>Liste</button>
          <button className={`hub-tab${view === 'companies' ? ' active' : ''}`} onClick={() => setView('companies')}>Entreprises</button>
        </div>
        <select className="kanban-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ marginLeft: 'auto' }}>
          <option value="all">Tous les types</option>
          <option value="prospect">Prospects</option>
          <option value="client">Clients</option>
          <option value="partner">Partenaires</option>
        </select>
        <select className="kanban-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)}>
          <option value="all">Toutes les étapes</option>
          {DEAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select className="kanban-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="score">Trier par score</option>
          <option value="amount">Trier par montant</option>
          <option value="closeDate">Trier par clôture</option>
          <option value="nextAction">Trier par échéance</option>
        </select>
        <button className="btn btn-ghost btn-icon-sm" title={sortDir === 'desc' ? 'Décroissant' : 'Croissant'}
                onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
          <ArrowUpDown size={15} />
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
        <input
          className="kanban-search" style={{ flex: '0 1 200px' }}
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
        />
      </div>

      {importMsg && <div className="kb-status-msg" style={{ margin: '0 0 10px' }}>{importMsg}</div>}

      {(wonRevenue > 0 || openPipeline > 0) && (
        <div style={{ display: 'flex', gap: 14, margin: '0 0 14px', flexWrap: 'wrap' }}>
          <div className="stat-card" style={{ flex: '1 1 150px' }}>
            <div className="stat-card-value" style={{ color: '#34d399' }}>{fmtAmount(wonRevenue)}</div>
            <div className="stat-card-label">CA gagné</div>
          </div>
          <div className="stat-card" style={{ flex: '1 1 150px' }}>
            <div className="stat-card-value">{fmtAmount(openPipeline)}</div>
            <div className="stat-card-label">Pipeline ouvert</div>
          </div>
          {conversion !== null && (
            <div className="stat-card" style={{ flex: '1 1 150px' }}>
              <div className="stat-card-value">{conversion} %</div>
              <div className="stat-card-label">Taux de conversion</div>
            </div>
          )}
          {avgTicket !== null && (
            <div className="stat-card" style={{ flex: '1 1 150px' }}>
              <div className="stat-card-value">{fmtAmount(avgTicket)}</div>
              <div className="stat-card-label">Ticket moyen</div>
            </div>
          )}
        </div>
      )}

      {view === 'companies' ? (
        companies === null ? (
          <Loader text="Chargement des entreprises…" variant="inline" />
        ) : companies.length === 0 ? (
          <div className="plan-empty"><h2>Aucune entreprise</h2><p>Les entreprises apparaissent dès qu'un contact en a une renseignée.</p></div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {companies.map((co) => (
              <div key={co.id} onClick={() => setViewingCompany(co.id)}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}>
                {co.domain
                  ? <img src={`https://www.google.com/s2/favicons?domain=${co.domain}&sz=64`} alt="" width={32} height={32} style={{ borderRadius: 6, flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--color-surface)', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{co.name.slice(0, 1).toUpperCase()}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{co.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{[co.sector, co.domain].filter(Boolean).join(' · ') || 'à analyser'}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.8rem', flexShrink: 0 }}>
                  <div>{co.contactCount} contact{co.contactCount > 1 ? 's' : ''}</div>
                  {(co.openValue > 0 || co.wonValue > 0) && <div style={{ color: 'var(--color-text-muted)' }}>{fmtAmount(co.openValue + co.wonValue)}</div>}
                </div>
              </div>
            ))}
          </div>
        )
      ) : contacts.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon"><Users size={40} /></span>
          <h2>Aucun contact pour l'instant</h2>
          <p>
            Collez des messages, scannez vos posts ou votre boîte mail{hubspotConnected ? ', ou importez votre CRM HubSpot' : ''} :
            l'IA détecte et score vos prospects, et le pipeline suit vos deals.
          </p>
          {!readOnly && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setAnalyzing('inbox')}>Scanner ma boîte mail</button>
            {hubspotConnected && <button className="btn btn-ghost" onClick={() => setHubspotImport(true)}>Importer depuis HubSpot</button>}
          </div>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="plan-empty"><h2>Aucun contact ne correspond</h2></div>
      ) : (
        <div className="contact-list">
          {filtered.map((c) => {
            const meta = TYPE_META[c.type];
            return (
              <div key={c.id} className="contact-card" onClick={readOnly ? undefined : () => setEditing(c)}>
                <div className="contact-score-wrap">
                  {c.interestScore !== null ? (
                    <>
                      <div className="contact-score" style={{ color: scoreColor(c.interestScore) }}>{c.interestScore}</div>
                      <div className="contact-score-bar">
                        <div style={{ width: `${c.interestScore}%`, background: scoreColor(c.interestScore) }} />
                      </div>
                    </>
                  ) : (
                    <div className="contact-score muted">—</div>
                  )}
                </div>
                <div className="contact-main">
                  <div className="contact-name-row">
                    <span className="contact-name">{c.name}</span>
                    <span className={`contact-type ${meta.cls}`}>{meta.icon} {meta.label}</span>
                    <span className="contact-type" style={{ background: 'transparent', border: `1px solid ${STAGE_COLORS[c.stage]}`, color: STAGE_COLORS[c.stage] }}>{STAGE_LABELS[c.stage]}</span>
                    {c.company && <span className="contact-company">{c.company}</span>}
                    {c.amount != null && <span className="contact-company" style={{ color: '#34d399', fontWeight: 600 }}>{fmtAmount(c.amount)}</span>}
                  </div>
                  <div className="contact-meta">
                    {c.email && <span>{c.email}</span>}
                    {c.source && <span>{c.source}</span>}
                    {c.expectedCloseDate && <span>Clôture : {fmtDate(c.expectedCloseDate)}</span>}
                  </div>
                  {c.nextAction && (
                    <div className="contact-summary" style={{ color: isOverdue(c.nextActionAt) ? '#f87171' : undefined }}>
                      {isOverdue(c.nextActionAt) ? '⚠️ ' : '→ '}{c.nextAction}{c.nextActionAt ? ` · ${fmtDate(c.nextActionAt)}` : ''}
                    </div>
                  )}
                  {c.interestSummary && <div className="contact-summary">{c.interestSummary}</div>}
                </div>
                {!readOnly && (
                <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setEmailing(c)}
                    disabled={!c.email}
                    title={c.email ? `Écrire à ${c.email}` : 'Pas d\'email — complétez la fiche'}
                  >Email</button>
                  <button className="kanban-delete" title="Supprimer" onClick={() => handleDelete(c)}>×</button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <ContactEditor
          contact={editing === 'new' ? null : editing}
          readOnly={readOnly}
          apolloConfigured={apolloConfigured}
          onClose={() => setEditing(null)}
          onSaved={(c) => { setEditing(null); upsert(c); }}
          onScored={(c) => upsert(c)}
          onCompose={() => { if (editing && editing !== 'new') { const c = editing; setEditing(null); setEmailing(c); } }}
        />
      )}
      {analyzing !== null && (
        <AnalyzeModal
          mode={analyzing}
          onClose={() => setAnalyzing(null)}
          onImported={(created) => {
            setAnalyzing(null);
            setContacts((prev) => [...created, ...prev]);
          }}
        />
      )}
      {emailing !== null && (
        <EmailModal
          contact={emailing}
          onClose={() => setEmailing(null)}
          onSent={upsert}
        />
      )}
      {hubspotImport && (
        <HubSpotImportModal
          onClose={() => setHubspotImport(false)}
          onImported={onHubSpotImported}
        />
      )}
      {viewingCompany && (
        <div className="modal-overlay" onClick={() => setViewingCompany(null)}>
          <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Fiche entreprise</h2>
              <button className="modal-close" onClick={() => setViewingCompany(null)}>✕</button>
            </div>
            <div className="post-editor">
              <CompanyPanel
                companyId={viewingCompany}
                readOnly={readOnly}
                onOpenContact={(c) => { setViewingCompany(null); setEditing(c); }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
