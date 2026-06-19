import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  getImportHistoryOptions, getConfigStatus, importHistory,
  HistoryCapability,
} from '../api/client';

/**
 * Modale d'import EN MASSE de l'historique : l'utilisateur choisit une plateforme
 * connectée, et LaunchForge rapatrie tous ses anciens posts (dédupliqués) en
 * statut « Publié ». 100 % déterministe (aucune génération IA).
 */

interface ImportResult {
  found: number;
  imported: number;
  skipped: number;
  failed: number;
  note: string;
}

export default function ImportHistoryModal({ onClose, onDone }: {
  onClose: () => void;
  onDone: (imported: number) => void;
}) {
  const [caps, setCaps] = useState<HistoryCapability[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  // Statut de connexion rafraîchi (fresh) — utilisé au montage et au retour
  // d'onglet (l'utilisateur peut connecter un compte dans /config puis revenir).
  const refreshConnected = useCallback(async () => {
    const cfg = await getConfigStatus(true);
    if (cfg.success && cfg.data) {
      setConnected(new Set(cfg.data.composio.toolkits.filter((t) => t.connected).map((t) => t.slug)));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [opt, cfg] = await Promise.all([getImportHistoryOptions(), getConfigStatus()]);
      const importable = opt.success && opt.data ? opt.data.platforms.filter((p) => p.importable) : [];
      setCaps(importable);
      const conn = new Set<string>(
        cfg.success && cfg.data ? cfg.data.composio.toolkits.filter((t) => t.connected).map((t) => t.slug) : [],
      );
      setConnected(conn);
      // Sélection par défaut : première plateforme importable ET connectée, sinon la première
      const firstConnected = importable.find((p) => conn.has(p.platform));
      setPlatform((firstConnected ?? importable[0])?.platform ?? '');
      setLoading(false);
    })();
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshConnected(); };
    window.addEventListener('focus', refreshConnected);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refreshConnected);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshConnected]);

  const cap = useMemo(() => caps.find((c) => c.platform === platform), [caps, platform]);
  const isConnected = platform ? connected.has(platform) : false;
  const handleRequired = Boolean(cap?.handleField?.required);
  const canSubmit = Boolean(platform) && !busy && (!handleRequired || handle.trim().length > 0);

  const submit = async () => {
    if (!platform) return;
    setBusy(true);
    setError('');
    setResult(null);
    const res = await importHistory(platform, cap?.handleField ? handle.trim() || undefined : undefined);
    setBusy(false);
    if (res.success && res.data) {
      setResult({ found: res.data.found, imported: res.data.imported, skipped: res.data.skipped, failed: res.data.failed, note: res.data.note });
      onDone(res.data.imported);
    } else {
      setError(res.error || 'Import échoué — réessayez.');
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importer mes anciens posts</h2>
          <button className="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        {loading ? (
          <div className="loading">⏳ Chargement…</div>
        ) : result ? (
          <div className="post-editor">
            <div className="import-result-banner">
              <CheckCircle2 size={20} />
              <div>
                <strong>{result.imported} post{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 's' : ''}</strong>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{result.note}</div>
              </div>
            </div>
            <ul className="import-result-stats">
              <li><strong>{result.found}</strong> trouvé{result.found > 1 ? 's' : ''} chez la plateforme</li>
              <li><strong>{result.imported}</strong> ajouté{result.imported > 1 ? 's' : ''} au Hub</li>
              <li><strong>{result.skipped}</strong> déjà présent{result.skipped > 1 ? 's' : ''} (ignoré{result.skipped > 1 ? 's' : ''})</li>
              {result.failed > 0 && <li className="import-result-fail"><strong>{result.failed}</strong> en échec</li>}
            </ul>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={onClose}>Terminé</button>
            </div>
          </div>
        ) : (
          <div className="post-editor">
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Rapatriez les posts déjà publiés sur vos comptes connectés : ils rejoignent le Hub
              en statut <strong>Publié</strong>, avec leurs métriques. Les posts déjà présents sont
              automatiquement ignorés (pas de doublon).
            </p>

            <label className="form-label-block">
              Plateforme
              <select className="form-input" value={platform} onChange={(e) => { setPlatform(e.target.value); setHandle(''); setError(''); }} disabled={busy}>
                {caps.map((c) => (
                  <option key={c.platform} value={c.platform}>
                    {c.label}{connected.has(c.platform) ? ' ✓ connecté' : ' — non connecté'}
                  </option>
                ))}
              </select>
            </label>

            {cap && <p className="form-hint-inline">{cap.note}</p>}

            {!isConnected && (
              <div className="import-warn">
                <AlertTriangle size={15} />
                <span>
                  Ce compte n'est pas encore connecté. <a href="/config" target="_blank" rel="noopener noreferrer">
                    Connectez-le dans Configuration <ExternalLink size={12} />
                  </a> puis revenez ici.
                </span>
              </div>
            )}

            {cap?.handleField && (
              <label className="form-label-block">
                {cap.handleField.label}
                <input
                  className="form-input"
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder={cap.handleField.placeholder}
                  disabled={busy}
                />
              </label>
            )}

            {error && <div className="chat-error">{error}</div>}

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
                {busy ? '⏳ Import en cours…' : <><Download size={15} /> Importer l'historique</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
