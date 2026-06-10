import { useState, useEffect, FormEvent } from 'react';
import {
  getKnowledge, createKnowledge, updateKnowledge, deleteKnowledge,
  KnowledgeEntry, KnowledgeCategory,
} from '../api/client';
import ContactsPanel from '../components/ContactsPanel';

const CATEGORIES: { value: KnowledgeCategory; label: string; icon: string; hint: string }[] = [
  { value: 'company',  label: 'Entreprise',       icon: '🏢', hint: 'Histoire, mission, valeurs, équipe…' },
  { value: 'product',  label: 'Produit / Service', icon: '📦', hint: 'Fonctionnalités, bénéfices, différenciateurs…' },
  { value: 'audience', label: 'Audience',          icon: '🎯', hint: 'Personas, problèmes, objections fréquentes…' },
  { value: 'tone',     label: 'Ton & style',       icon: '🎨', hint: 'Voix de marque, mots à utiliser/éviter…' },
  { value: 'offers',   label: 'Offres & tarifs',   icon: '💰', hint: 'Plans, promos, garanties…' },
  { value: 'other',    label: 'Divers',            icon: '📌', hint: 'Tout le reste' },
];

const catMeta = (c: KnowledgeCategory) => CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[5];

interface EditorProps {
  entry: KnowledgeEntry | null;
  defaultCategory: KnowledgeCategory;
  onClose: () => void;
  onSaved: (entry: KnowledgeEntry) => void;
}

function EntryEditor({ entry, defaultCategory, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState({
    category: entry?.category ?? defaultCategory,
    title:    entry?.title ?? '',
    content:  entry?.content ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      setError('Titre et contenu sont requis.');
      return;
    }
    setSaving(true);
    setError('');
    const res = entry
      ? await updateKnowledge(entry.id, form)
      : await createKnowledge(form);
    setSaving(false);
    if (res.success && res.data) onSaved(res.data);
    else setError(res.error || 'Enregistrement impossible.');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{entry ? 'Modifier la fiche' : 'Nouvelle fiche'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="post-editor">
          <label className="form-label-block">
            Catégorie
            <select
              className="form-input"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as KnowledgeCategory }))}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
            <span className="form-hint-inline">{catMeta(form.category).hint}</span>
          </label>

          <label className="form-label-block">
            Titre
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ex. Notre proposition de valeur"
              autoFocus={!entry}
            />
          </label>

          <label className="form-label-block">
            Contenu
            <textarea
              className="form-input post-content-area"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={8}
              placeholder="Écrivez comme si vous briefiez un nouveau collaborateur — l'IA s'en servira mot pour mot."
            />
          </label>

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '⏳…' : '💾 Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const [tab,      setTab]      = useState<'knowledge' | 'contacts'>('knowledge');
  const [entries,  setEntries]  = useState<KnowledgeEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<KnowledgeEntry | null | 'new'>(null);
  const [catFilter, setCatFilter] = useState<'all' | KnowledgeCategory>('all');
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    getKnowledge().then((res) => {
      if (res.success && res.data) setEntries(res.data);
      setLoading(false);
    });
  }, []);

  const handleSaved = (saved: KnowledgeEntry) => {
    setEditing(null);
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === saved.id);
      return exists ? prev.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...prev];
    });
  };

  const handleDelete = async (entry: KnowledgeEntry) => {
    if (!window.confirm(`Supprimer la fiche « ${entry.title} » ?`)) return;
    const res = await deleteKnowledge(entry.id);
    if (res.success) setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  };

  const filtered = entries.filter((e) => {
    if (catFilter !== 'all' && e.category !== catFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!e.title.toLowerCase().includes(q) && !e.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (loading) return <div className="loading">⏳ Chargement de la base de connaissances…</div>;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>📚 Base de connaissances</h1>
          <p>
            {tab === 'knowledge'
              ? 'Tout ce que l\'IA doit savoir sur votre entreprise. Chaque fiche est injectée dans l\'assistant de contenu et les agents — écrivez une fois, réutilisé partout.'
              : 'Vos prospects, clients et partenaires — détectés et scorés par l\'IA depuis vos commentaires et votre boîte mail.'}
          </p>
        </div>
        {tab === 'knowledge' && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Nouvelle fiche</button>
        )}
      </div>

      {/* Onglets */}
      <div className="hub-tabs" style={{ marginTop: 4 }}>
        <button className={`hub-tab${tab === 'knowledge' ? ' active' : ''}`} onClick={() => setTab('knowledge')}>📚 Fiches</button>
        <button className={`hub-tab${tab === 'contacts' ? ' active' : ''}`} onClick={() => setTab('contacts')}>🤝 Contacts</button>
      </div>

      {tab === 'contacts' ? (
        <ContactsPanel />
      ) : (
      <>
      {/* Filtres par catégorie */}
      <div className="knowledge-cats">
        <button className={`knowledge-cat${catFilter === 'all' ? ' active' : ''}`} onClick={() => setCatFilter('all')}>
          Tout <span className="knowledge-cat-count">{entries.length}</span>
        </button>
        {CATEGORIES.map((c) => {
          const count = entries.filter((e) => e.category === c.value).length;
          return (
            <button
              key={c.value}
              className={`knowledge-cat${catFilter === c.value ? ' active' : ''}`}
              onClick={() => setCatFilter(c.value)}
            >
              {c.icon} {c.label}{count > 0 && <span className="knowledge-cat-count">{count}</span>}
            </button>
          );
        })}
        <input
          className="kanban-search"
          style={{ marginLeft: 'auto', flex: '0 1 220px' }}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Rechercher…"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">📚</span>
          <h2>{entries.length === 0 ? 'Votre base est vide' : 'Aucune fiche ne correspond'}</h2>
          <p>
            Commencez par 3 fiches : votre proposition de valeur (Produit), votre client idéal (Audience)
            et votre ton de marque (Ton & style). L'IA générera ensuite du contenu vraiment personnalisé.
          </p>
          <button className="btn btn-primary btn-lg" style={{ display: 'inline-flex' }} onClick={() => setEditing('new')}>
            ＋ Créer ma première fiche
          </button>
        </div>
      ) : (
        <div className="knowledge-grid">
          {filtered.map((entry) => {
            const meta = catMeta(entry.category);
            return (
              <div key={entry.id} className="knowledge-card" onClick={() => setEditing(entry)}>
                <div className="knowledge-card-top">
                  <span className="knowledge-badge">{meta.icon} {meta.label}</span>
                  <button
                    className="kanban-delete"
                    title="Supprimer"
                    onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                  >×</button>
                </div>
                <div className="knowledge-card-title">{entry.title}</div>
                <div className="knowledge-card-content">{entry.content.slice(0, 220)}{entry.content.length > 220 ? '…' : ''}</div>
                <div className="knowledge-card-date">
                  Modifié le {new Date(entry.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <EntryEditor
          entry={editing === 'new' ? null : editing}
          defaultCategory={catFilter === 'all' ? 'company' : catFilter}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      </>
      )}
    </div>
  );
}
