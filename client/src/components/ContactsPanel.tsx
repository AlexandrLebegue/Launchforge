import { useState, useEffect, FormEvent } from 'react';
import {
  getContacts, createContact, updateContact, deleteContact,
  analyzeLeads, scanInbox, draftContactEmail, sendContactEmail,
  Contact, ContactType, LeadCandidate,
} from '../api/client';

const TYPE_META: Record<ContactType, { label: string; icon: string; cls: string }> = {
  prospect: { label: 'Prospect',   icon: '🎯', cls: 'contact-type-prospect' },
  client:   { label: 'Client',     icon: '⭐', cls: 'contact-type-client' },
  partner:  { label: 'Partenaire', icon: '🤝', cls: 'contact-type-partner' },
};

function scoreColor(score: number): string {
  if (score >= 70) return '#34d399';
  if (score >= 40) return '#fbbf24';
  return '#97a0b5';
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — fiche contact (création / édition)
// ─────────────────────────────────────────────────────────────────────────────

function ContactEditor({ contact, onClose, onSaved }: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
}) {
  const [form, setForm] = useState({
    name:    contact?.name ?? '',
    email:   contact?.email ?? '',
    company: contact?.company ?? '',
    type:    (contact?.type ?? 'prospect') as ContactType,
    source:  contact?.source ?? '',
    notes:   contact?.notes ?? '',
    lastInteraction: contact?.lastInteraction ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) { setError('Le nom est requis.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      name: form.name, email: form.email || null, company: form.company || null,
      type: form.type, source: form.source || null, notes: form.notes || null,
      lastInteraction: form.lastInteraction || null,
    };
    const res = contact
      ? await updateContact(contact.id, payload)
      : await createContact(payload as Partial<Contact> & { name: string });
    setSaving(false);
    if (res.success && res.data) onSaved(res.data);
    else setError(res.error || 'Enregistrement impossible.');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{contact ? 'Modifier le contact' : 'Nouveau contact'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save} className="post-editor">
          <div className="post-editor-row">
            <label className="form-label-block">Nom
              <input className="form-input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus={!contact} />
            </label>
            <label className="form-label-block">Type
              <select className="form-input" value={form.type} onChange={(e) => set('type', e.target.value as ContactType)}>
                <option value="prospect">🎯 Prospect</option>
                <option value="client">⭐ Client</option>
                <option value="partner">🤝 Partenaire</option>
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
          <label className="form-label-block">Source
            <input className="form-input" value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="ex. commentaire LinkedIn, salon, boîte mail…" />
          </label>
          <label className="form-label-block">Derniers échanges
            <textarea className="form-input" rows={3} value={form.lastInteraction} onChange={(e) => set('lastInteraction', e.target.value)} placeholder="Collez ici ses messages/commentaires — utilisés par l'IA pour personnaliser les emails" />
          </label>
          <label className="form-label-block">Notes
            <textarea className="form-input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {error && <div className="chat-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳…' : '💾 Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — analyse IA (texte collé ou scan boîte mail)
// ─────────────────────────────────────────────────────────────────────────────

function AnalyzeModal({ mode, onClose, onImported }: {
  mode: 'paste' | 'inbox';
  onClose: () => void;
  onImported: (contacts: Contact[]) => void;
}) {
  const [text,       setText]       = useState('');
  const [source,     setSource]     = useState('commentaires LinkedIn');
  const [busy,       setBusy]       = useState(mode === 'inbox');
  const [error,      setError]      = useState('');
  const [candidates, setCandidates] = useState<LeadCandidate[] | null>(null);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [importing,  setImporting]  = useState(false);

  useEffect(() => {
    if (mode === 'inbox') {
      scanInbox().then((res) => {
        setBusy(false);
        if (res.success && res.data) {
          setCandidates(res.data);
          setSelected(new Set(res.data.map((_, i) => i)));
        } else {
          setError(res.error === 'COMPOSIO_NOT_CONFIGURED'
            ? 'Boîte mail non connectée : configurez COMPOSIO_MCP_URL côté serveur et connectez Gmail/Outlook sur dashboard.composio.dev.'
            : res.error || 'Le scan a échoué.');
        }
      });
    }
  }, [mode]);

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
        source: mode === 'inbox' ? 'boîte mail' : source,
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
          <h2>{mode === 'inbox' ? '📥 Scan de la boîte mail' : '🧠 Analyser des messages'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {candidates === null ? (
          mode === 'paste' ? (
            <div className="post-editor">
              <label className="form-label-block">Source
                <input className="form-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="ex. commentaires LinkedIn, DMs Instagram, emails…" />
              </label>
              <label className="form-label-block">Messages reçus
                <textarea
                  className="form-input post-content-area" rows={10}
                  value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={'Collez ici les commentaires de vos posts, vos DMs ou des emails…\n\nex.\nMarie Dupont : Super outil ! Vous avez une offre équipe ? On est 12 chez Acme.\nPaul Martin : 👍\nJulie (julie@start.io) : Possible d\'avoir une démo cette semaine ?'}
                />
              </label>
              {error && <div className="chat-error">{error}</div>}
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                <button className="btn btn-primary" onClick={analyze} disabled={busy}>
                  {busy ? '⏳ Analyse en cours…' : '🧠 Détecter les leads'}
                </button>
              </div>
            </div>
          ) : (
            <div className="post-editor">
              {busy && <div className="loading">⏳ Lecture de votre boîte de réception via Composio…</div>}
              {error && <div className="chat-error">{error}</div>}
              {!busy && error && (
                <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
              )}
            </div>
          )
        ) : (
          <div className="post-editor">
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
      setFeedback(`✅ Email envoyé à ${contact.email} — ${res.data.result}`);
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
          <h2>✉️ Email à {contact.name}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="post-editor">
          {!contact.email && (
            <div className="alert-warning">Ce contact n'a pas d'adresse email — ajoutez-la d'abord sur sa fiche.</div>
          )}

          <div className="ai-assist-box">
            <div className="ai-assist-header">✨ Brouillon par l'IA <span className="form-hint-inline">— personnalisé avec sa fiche, vos connaissances et vos échanges</span></div>
            <div className="ai-assist-row">
              <input
                className="form-input"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={'Objectif… ex. « Proposer une démo de 20 min cette semaine »'}
                disabled={drafting}
              />
              <button type="button" className="btn btn-primary" onClick={draft} disabled={drafting}>
                {drafting ? '⏳…' : '✨ Rédiger'}
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
              {sending ? '⏳ Envoi…' : `📤 Envoyer depuis ma boîte mail`}
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

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | ContactType>('all');
  const [search,   setSearch]   = useState('');
  const [editing,  setEditing]  = useState<Contact | null | 'new'>(null);
  const [analyzing, setAnalyzing] = useState<'paste' | 'inbox' | null>(null);
  const [emailing, setEmailing] = useState<Contact | null>(null);

  useEffect(() => {
    getContacts().then((res) => {
      if (res.success && res.data) setContacts(res.data);
      setLoading(false);
    });
  }, []);

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

  const filtered = contacts.filter((c) => {
    if (typeFilter !== 'all' && c.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${c.name} ${c.email ?? ''} ${c.company ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hot = contacts.filter((c) => (c.interestScore ?? 0) >= 70).length;

  if (loading) return <div className="loading">⏳ Chargement des contacts…</div>;

  return (
    <div>
      {/* Actions */}
      <div className="contacts-toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Contact</button>
        <button className="btn btn-ghost" onClick={() => setAnalyzing('paste')} title="Collez des commentaires/messages — l'IA détecte et score les leads">
          🧠 Analyser des messages
        </button>
        <button className="btn btn-ghost" onClick={() => setAnalyzing('inbox')} title="Lit votre boîte de réception via Composio et détecte les leads">
          📥 Scanner ma boîte mail
        </button>
        <span className="contacts-hot">{hot > 0 ? `🔥 ${hot} lead${hot > 1 ? 's' : ''} chaud${hot > 1 ? 's' : ''}` : ''}</span>
        <select className="kanban-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ marginLeft: 'auto' }}>
          <option value="all">Tous les types</option>
          <option value="prospect">🎯 Prospects</option>
          <option value="client">⭐ Clients</option>
          <option value="partner">🤝 Partenaires</option>
        </select>
        <input
          className="kanban-search" style={{ flex: '0 1 200px' }}
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Rechercher…"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">🤝</span>
          <h2>{contacts.length === 0 ? 'Aucun contact pour l\'instant' : 'Aucun contact ne correspond'}</h2>
          <p>
            Collez les commentaires de vos posts ou scannez votre boîte mail : l'IA détecte
            les personnes les plus intéressées et les score de 0 à 100.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => setAnalyzing('paste')}>🧠 Analyser des messages</button>
            <button className="btn btn-ghost" onClick={() => setAnalyzing('inbox')}>📥 Scanner ma boîte mail</button>
          </div>
        </div>
      ) : (
        <div className="contact-list">
          {filtered.map((c) => {
            const meta = TYPE_META[c.type];
            return (
              <div key={c.id} className="contact-card" onClick={() => setEditing(c)}>
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
                    {c.company && <span className="contact-company">{c.company}</span>}
                  </div>
                  <div className="contact-meta">
                    {c.email && <span>✉️ {c.email}</span>}
                    {c.source && <span>📍 {c.source}</span>}
                  </div>
                  {c.interestSummary && <div className="contact-summary">{c.interestSummary}</div>}
                </div>
                <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setEmailing(c)}
                    disabled={!c.email}
                    title={c.email ? `Écrire à ${c.email}` : 'Pas d\'email — complétez la fiche'}
                  >✉️ Email</button>
                  <button className="kanban-delete" title="Supprimer" onClick={() => handleDelete(c)}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <ContactEditor
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => { setEditing(null); upsert(c); }}
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
    </div>
  );
}
