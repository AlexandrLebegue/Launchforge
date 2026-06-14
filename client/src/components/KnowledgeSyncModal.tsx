import { useState, useEffect } from 'react';
import { GitBranch, Globe, RefreshCw, Sparkles, ArrowLeft } from 'lucide-react';
import {
  getKnowledgeSources, deleteKnowledgeSource,
  analyzeKnowledgeSources, applyKnowledgeSuggestions,
  KnowledgeSource, KnowledgeSuggestion, KnowledgeCategory, KnowledgeEntry,
} from '../api/client';

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  company: 'Entreprise', product: 'Produit / Service', audience: 'Audience',
  tone: 'Ton & style', offers: 'Offres & tarifs', learnings: 'Enseignements',
  news: 'Veille & actus', other: 'Divers',
};
const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as KnowledgeCategory[];

type EditableSuggestion = KnowledgeSuggestion & { _selected: boolean };

interface Props {
  onClose: () => void;
  onApplied: (entries: KnowledgeEntry[]) => void;
}

export default function KnowledgeSyncModal({ onClose, onApplied }: Props) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [github, setGithub] = useState('');
  const [website, setWebsite] = useState('');
  const [crawl, setCrawl] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [suggestions, setSuggestions] = useState<EditableSuggestion[] | null>(null);

  useEffect(() => {
    getKnowledgeSources().then((res) => {
      if (res.success && res.data) {
        setSources(res.data);
        // Pré-remplit les champs depuis les sources déjà connues
        const gh = res.data.find((s) => s.type === 'github');
        const web = res.data.find((s) => s.type === 'website');
        if (gh) setGithub(gh.url);
        if (web) setWebsite(web.url);
      }
    });
  }, []);

  const refreshSources = async () => {
    const res = await getKnowledgeSources();
    if (res.success && res.data) setSources(res.data);
  };

  const runAnalyze = async (payload: { github?: string; website?: string; sourceIds?: string[] }) => {
    setError(''); setNotice(''); setAnalyzing(true);
    const res = await analyzeKnowledgeSources({ ...payload, crawl });
    setAnalyzing(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Analyse impossible.');
      return;
    }
    await refreshSources();
    const { suggestions: sugg, errors } = res.data;
    if (errors.length) {
      setNotice(`Certaines sources n'ont pas pu être lues : ${errors.map((e) => e.url).join(', ')}`);
    }
    // Zéro proposition = on reste sur le formulaire (pas d'écran de revue vide),
    // que des sources aient échoué ou non — l'avertissement éventuel suffit.
    if (sugg.length === 0) {
      setSuggestions(null);
      if (!errors.length) setError('Aucune nouvelle connaissance détectée dans les sources fournies.');
      return;
    }
    setSuggestions(sugg.map((s) => ({ ...s, _selected: true })));
  };

  const handleAnalyzeForm = () => {
    if (!github.trim() && !website.trim()) {
      setError('Indiquez au moins un dépôt GitHub ou une URL de site.');
      return;
    }
    // Enregistre les sources saisies puis analyse
    runAnalyze({ github: github.trim() || undefined, website: website.trim() || undefined });
  };

  const handleResyncSource = (src: KnowledgeSource) => {
    runAnalyze({ sourceIds: [src.id] });
  };

  const handleDeleteSource = async (src: KnowledgeSource) => {
    const res = await deleteKnowledgeSource(src.id);
    if (res.success) {
      setSources((prev) => prev.filter((s) => s.id !== src.id));
      if (src.type === 'github' && github === src.url) setGithub('');
      if (src.type === 'website' && website === src.url) setWebsite('');
    }
  };

  const updateSuggestion = (idx: number, patch: Partial<EditableSuggestion>) => {
    setSuggestions((prev) => prev && prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const selectedCount = suggestions?.filter((s) => s._selected).length ?? 0;

  const handleApply = async () => {
    if (!suggestions) return;
    const chosen = suggestions.filter((s) => s._selected);
    if (chosen.length === 0) { setError('Sélectionnez au moins une fiche.'); return; }
    setApplying(true); setError('');
    const res = await applyKnowledgeSuggestions(
      chosen.map(({ _selected, ...s }) => s) // eslint-disable-line @typescript-eslint/no-unused-vars
    );
    setApplying(false);
    if (res.success && res.data) {
      onApplied(res.data.applied);
      onClose();
    } else {
      setError(res.error || 'Intégration impossible.');
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'jamais';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg kb-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{suggestions ? 'Propositions à intégrer' : 'Mettre à jour depuis mes sources'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="chat-error" style={{ margin: '0 0 12px' }}>{error}</div>}
        {notice && <div className="form-hint-inline" style={{ marginBottom: 12 }}>⚠️ {notice}</div>}

        {/* ─────────── Étape 1 : sources ─────────── */}
        {!suggestions && (
          <div className="kb-sync-form">
            <div className="kb-sync-scroll">
            <p className="kb-sync-intro">
              L'IA lit vos sources officielles (dépôt GitHub, site web) et en extrait des fiches
              prêtes à intégrer — vous validez avant tout enregistrement.
            </p>

            <label className="form-label-block">
              <span className="kb-sync-field-label"><GitBranch size={15} /> Dépôt GitHub</span>
              <input
                className="form-input" value={github} disabled={analyzing}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="github.com/utilisateur/depot"
              />
            </label>

            <label className="form-label-block">
              <span className="kb-sync-field-label"><Globe size={15} /> Site web ou page</span>
              <input
                className="form-input" value={website} disabled={analyzing}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://monsite.com ou https://monsite.com/produit"
              />
            </label>

            <label className="kb-sync-check">
              <input type="checkbox" checked={crawl} disabled={analyzing}
                onChange={(e) => setCrawl(e.target.checked)} />
              Explorer aussi les pages liées (à propos, tarifs, produit…)
            </label>

            {sources.length > 0 && (
              <div className="kb-sync-saved">
                <div className="kb-sync-saved-title">Sources enregistrées</div>
                {sources.map((s) => (
                  <div key={s.id} className="kb-sync-source-row">
                    <span className="kb-sync-source-icon">
                      {s.type === 'github' ? <GitBranch size={15} /> : <Globe size={15} />}
                    </span>
                    <span className="kb-sync-source-info">
                      <span className="kb-sync-source-label">{s.label || s.url}</span>
                      <span className="kb-sync-source-meta">Sync. {fmtDate(s.lastSyncedAt)}</span>
                    </span>
                    <button className="btn btn-ghost btn-sm" disabled={analyzing}
                      title="Re-synchroniser" onClick={() => handleResyncSource(s)}>
                      <RefreshCw size={14} />
                    </button>
                    <button className="kanban-delete" title="Retirer" onClick={() => handleDeleteSource(s)}>×</button>
                  </div>
                ))}
              </div>
            )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose} disabled={analyzing}>Annuler</button>
              <button className="btn btn-primary" onClick={handleAnalyzeForm} disabled={analyzing}>
                {analyzing ? '⏳ Analyse en cours…' : <><Sparkles size={15} /> Analyser</>}
              </button>
            </div>
          </div>
        )}

        {/* ─────────── Étape 2 : propositions ─────────── */}
        {suggestions && (
          <div className="kb-sync-review">
            <div className="kb-sync-review-bar">
              <span>{selectedCount} / {suggestions.length} sélectionnée(s)</span>
              <div className="kb-sync-review-actions">
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setSuggestions((p) => p && p.map((s) => ({ ...s, _selected: true })))}>
                  Tout cocher
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setSuggestions((p) => p && p.map((s) => ({ ...s, _selected: false })))}>
                  Tout décocher
                </button>
              </div>
            </div>

            <div className="kb-sync-suggestions">
              {suggestions.map((s, idx) => (
                <div key={idx} className={`kb-sync-suggestion${s._selected ? ' selected' : ''}`}>
                  <div className="kb-sync-suggestion-top">
                    <label className="kb-sync-suggestion-check">
                      <input type="checkbox" checked={s._selected}
                        onChange={(e) => updateSuggestion(idx, { _selected: e.target.checked })} />
                      <span className={`kb-sync-badge kb-sync-badge-${s.action}`}>
                        {s.action === 'update' ? 'Mise à jour' : 'Nouveau'}
                      </span>
                    </label>
                    <select className="form-input kb-sync-cat" value={s.category}
                      onChange={(e) => updateSuggestion(idx, { category: e.target.value as KnowledgeCategory })}>
                      {CATEGORY_VALUES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </div>
                  <input className="form-input kb-sync-title" value={s.title}
                    onChange={(e) => updateSuggestion(idx, { title: e.target.value })} />
                  <textarea className="form-input kb-sync-content" rows={4} value={s.content}
                    onChange={(e) => updateSuggestion(idx, { content: e.target.value })} />
                  {s.reason && <div className="kb-sync-reason">💡 {s.reason}{s.source ? ` — ${s.source}` : ''}</div>}
                </div>
              ))}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setSuggestions(null); setError(''); setNotice(''); }} disabled={applying}>
                <ArrowLeft size={15} /> Retour
              </button>
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || selectedCount === 0}>
                {applying ? '⏳ Intégration…' : `Intégrer la sélection (${selectedCount})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
