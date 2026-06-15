import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, RefreshCw, CheckCircle2, Settings } from 'lucide-react';
import {
  getKnowledge, createKnowledge, updateKnowledge, deleteKnowledge, getOverview,
  getKnowledgeSources, runKnowledgeSync, getConfigStatus,
  KnowledgeEntry, KnowledgeCategory, KnowledgeSource,
} from '../api/client';
import ContactsPanel from '../components/ContactsPanel';

const CATEGORIES: { value: KnowledgeCategory; label: string; icon: string; hint: string }[] = [
  { value: 'company',  label: 'Entreprise',       icon: '', hint: 'Histoire, mission, valeurs, équipe…' },
  { value: 'product',  label: 'Produit / Service', icon: '', hint: 'Fonctionnalités, bénéfices, différenciateurs…' },
  { value: 'audience', label: 'Audience',          icon: '', hint: 'Personas, problèmes, objections fréquentes…' },
  { value: 'tone',     label: 'Ton & style',       icon: '', hint: 'Voix de marque, mots à utiliser/éviter…' },
  { value: 'offers',   label: 'Offres & tarifs',   icon: '', hint: 'Plans, promos, garanties…' },
  { value: 'learnings',label: 'Enseignements',     icon: '', hint: 'Tirés de vos résultats — alimentés par l\'analyse IA' },
  { value: 'news',     label: 'Veille & actus',    icon: '', hint: 'Actus archivées par les séries récurrentes (opt-in) — éditables' },
  { value: 'other',    label: 'Divers',            icon: '', hint: 'Tout le reste' },
];

const catMeta = (c: KnowledgeCategory) => CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[CATEGORIES.length - 1];

/** Cadence de mise à jour automatique en clair (cf. Configuration) */
const syncFreqLabel = (m: number): string =>
  ({ 1440: 'tous les jours', 4320: 'tous les 3 jours', 10080: 'toutes les semaines' } as Record<number, string>)[m]
  ?? `tous les ${Math.max(1, Math.round(m / 1440))} jours`;

const fmtSyncDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'jamais';

interface EditorProps {
  entry: KnowledgeEntry | null;
  defaultCategory: KnowledgeCategory;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (entry: KnowledgeEntry) => void;
}

function EntryEditor({ entry, defaultCategory, readOnly = false, onClose, onSaved }: EditorProps) {
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
          <h2>{readOnly ? 'Fiche' : entry ? 'Modifier la fiche' : 'Nouvelle fiche'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="post-editor">
          <label className="form-label-block">
            Catégorie
            <select
              className="form-input"
              value={form.category}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as KnowledgeCategory }))}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <span className="form-hint-inline">{catMeta(form.category).hint}</span>
          </label>

          <label className="form-label-block">
            Titre
            <input
              className="form-input"
              value={form.title}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ex. Notre proposition de valeur"
              autoFocus={!entry && !readOnly}
            />
          </label>

          <label className="form-label-block">
            Contenu
            <textarea
              className="form-input post-content-area"
              value={form.content}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={8}
              placeholder="Écrivez comme si vous briefiez un nouveau collaborateur — l'IA s'en servira mot pour mot."
            />
          </label>

          {error && <div className="chat-error">{error}</div>}

          <div className="modal-footer">
            {readOnly ? (
              <>
                <span className="form-hint-inline" style={{ marginRight: 'auto' }}>👁️ Lecture seule — vous êtes Lecteur sur ce projet.</span>
                <button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '⏳…' : 'Enregistrer'}
                </button>
              </>
            )}
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
  const [readOnly, setReadOnly] = useState(false);
  // Sources de la base (configurées dans Configuration) + mise à jour « maintenant »
  const [sources,       setSources]       = useState<KnowledgeSource[]>([]);
  const [kbSyncMinutes, setKbSyncMinutes] = useState(0);
  const [syncing,       setSyncing]       = useState(false);
  const [syncMsg,       setSyncMsg]       = useState('');

  useEffect(() => {
    getKnowledge().then((res) => {
      if (res.success && res.data) setEntries(res.data);
      setLoading(false);
    });
    // Rôle Lecteur : on masque les actions d'écriture (cohérent avec Hub/Calendrier)
    getOverview().then((res) => {
      if (res.success && res.data) setReadOnly(res.data.project?.role === 'viewer');
    });
    // État de la configuration : sources déclarées + fréquence de mise à jour auto
    getKnowledgeSources().then((res) => { if (res.success && res.data) setSources(res.data); });
    getConfigStatus().then((res) => { if (res.success && res.data) setKbSyncMinutes(res.data.knowledgeSync.intervalMinutes); });
  }, []);

  const handleSaved = (saved: KnowledgeEntry) => {
    setEditing(null);
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === saved.id);
      return exists ? prev.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...prev];
    });
  };

  const handleApplied = (applied: KnowledgeEntry[]) => {
    const appliedIds = new Set(applied.map((e) => e.id));
    setEntries((prev) => [...applied, ...prev.filter((e) => !appliedIds.has(e.id))]);
  };

  const handleRunSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    const res = await runKnowledgeSync();
    setSyncing(false);
    if (res.success && res.data) {
      handleApplied(res.data.applied);
      const list = await getKnowledgeSources();
      if (list.success && list.data) setSources(list.data);
      const n = res.data.applied.length;
      const failed = res.data.errors?.length ?? 0;
      setSyncMsg(
        n > 0 ? `✓ ${n} fiche${n > 1 ? 's' : ''} mise${n > 1 ? 's' : ''} à jour.`
        : failed ? 'Sources illisibles pour le moment — réessayez plus tard.'
        : 'Aucune nouveauté détectée dans vos sources.'
      );
    } else {
      setSyncMsg(res.error || 'Mise à jour impossible.');
    }
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

  // Dernière mise à jour : source synchronisée la plus récente
  const lastSync = sources.reduce<string | null>(
    (acc, s) => (s.lastSyncedAt && (!acc || s.lastSyncedAt > acc) ? s.lastSyncedAt : acc),
    null,
  );

  if (loading) return <div className="loading">⏳ Chargement de la base de connaissances…</div>;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>Base de connaissances</h1>
          <p>
            {tab === 'knowledge'
              ? 'Tout ce que l\'IA doit savoir sur votre entreprise. Chaque fiche est injectée dans l\'assistant de contenu et les agents — écrivez une fois, réutilisé partout.'
              : 'Vos prospects, clients et partenaires — détectés et scorés par l\'IA depuis vos commentaires et votre boîte mail.'}
          </p>
        </div>
        {tab === 'knowledge' && !readOnly && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sources.length > 0 && (
              <button className="btn btn-ghost" data-tour="kb-sync" onClick={handleRunSync} disabled={syncing}>
                <RefreshCw size={15} /> {syncing ? 'Mise à jour…' : 'Mettre à jour maintenant'}
              </button>
            )}
            <button className="btn btn-primary" data-tour="kb-new" onClick={() => setEditing('new')}>＋ Nouvelle fiche</button>
          </div>
        )}
        {tab === 'knowledge' && readOnly && (
          <span className="chip chip-warning">👁️ Lecture seule</span>
        )}
      </div>

      {/* Onglets */}
      <div className="hub-tabs" data-tour="kb-tabs" style={{ marginTop: 4 }}>
        <button className={`hub-tab${tab === 'knowledge' ? ' active' : ''}`} onClick={() => setTab('knowledge')}>Fiches</button>
        <button className={`hub-tab${tab === 'contacts' ? ' active' : ''}`} onClick={() => setTab('contacts')}>Contacts</button>
      </div>

      {tab === 'contacts' ? (
        <ContactsPanel />
      ) : (
      <>
      {/* État de la mise à jour automatique depuis les sources (réglée dans Configuration) */}
      {sources.length > 0 ? (
        <div className="kb-status-box" data-tour="kb-sync-status">
          <CheckCircle2 size={18} className="kb-status-icon" />
          <div className="kb-status-main">
            <div className="kb-status-title">
              {sources.length} source{sources.length > 1 ? 's' : ''} connectée{sources.length > 1 ? 's' : ''} — base enrichie automatiquement
            </div>
            <div className="kb-status-meta">
              Dernière mise à jour : <strong>{fmtSyncDate(lastSync)}</strong>
              {kbSyncMinutes > 0
                ? <> · automatique {syncFreqLabel(kbSyncMinutes)}</>
                : <> · <span className="kb-status-warn">mise à jour automatique désactivée</span></>}
            </div>
            {syncMsg && <div className="kb-status-msg">{syncMsg}</div>}
          </div>
          <Link to="/config" className="btn btn-ghost btn-sm kb-status-action">
            <Settings size={14} /> Configurer
          </Link>
        </div>
      ) : (
        <div className="kb-status-box kb-status-box-muted" data-tour="kb-sync-status">
          <Settings size={18} className="kb-status-icon" />
          <div className="kb-status-main">
            <div className="kb-status-title">Enrichissez votre base automatiquement</div>
            <div className="kb-status-meta">
              Connectez un dépôt GitHub ou votre site web dans Configuration : l'IA en extrait
              des fiches et les tient à jour toute seule.
            </div>
          </div>
          <Link to="/config" className="btn btn-primary btn-sm kb-status-action">
            <Settings size={14} /> Configurer
          </Link>
        </div>
      )}

      {/* Filtres par catégorie */}
      <div className="knowledge-cats" data-tour="kb-cats">
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
              {c.label}{count > 0 && <span className="knowledge-cat-count">{count}</span>}
            </button>
          );
        })}
        <input
          className="kanban-search"
          style={{ marginLeft: 'auto', flex: '0 1 220px' }}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon"><BookOpen size={40} /></span>
          <h2>{entries.length === 0 ? 'Votre base est vide' : 'Aucune fiche ne correspond'}</h2>
          <p>
            Commencez par 3 fiches : votre proposition de valeur (Produit), votre client idéal (Audience)
            et votre ton de marque (Ton & style). L'IA générera ensuite du contenu vraiment personnalisé.
          </p>
          {!readOnly && (
            <button className="btn btn-primary btn-lg" style={{ display: 'inline-flex' }} onClick={() => setEditing('new')}>
              ＋ Créer ma première fiche
            </button>
          )}
        </div>
      ) : (
        <div className="knowledge-grid">
          {filtered.map((entry) => {
            const meta = catMeta(entry.category);
            return (
              <div key={entry.id} className="knowledge-card" onClick={() => setEditing(entry)}>
                <div className="knowledge-card-top">
                  <span className="knowledge-badge">{meta.icon} {meta.label}</span>
                  {!readOnly && (
                    <button
                      className="kanban-delete"
                      title="Supprimer"
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                    >×</button>
                  )}
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
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      </>
      )}
    </div>
  );
}
