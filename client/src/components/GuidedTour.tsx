import { useState, useEffect, useLayoutEffect, useCallback, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Visite guidée de première utilisation — explique l'IHM en mettant « en
 * lumière » les vrais éléments de l'interface (barre latérale), sans
 * dépendance externe. Un pas sans `target` s'affiche centré (intro/conclusion).
 */
export interface TourStep {
  /** Sélecteur CSS de l'élément à éclairer ; absent = pas centré */
  target?: string;
  title: string;
  body: ReactNode;
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

const PAD = 8;     // marge autour de l'élément éclairé
const GAP = 16;    // espace entre la cible et la carte
const CARD_W = 340;

export default function GuidedTour({ steps, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;

  // Lit la position de la cible (sans déclencher de scroll — évite les boucles)
  const measure = useCallback(() => {
    const sel = steps[i]?.target;
    if (!sel) { setRect(null); return; }
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    // Hors écran (ex. barre latérale repliée) → carte centrée, pas de spotlight
    if (r.width === 0 || r.right < 0 || r.left > window.innerWidth) { setRect(null); return; }
    setRect(r);
  }, [steps, i]);

  // Au changement de pas : attend que la cible existe (navigation vers une autre
  // page, ouverture d'une modale…), l'amène à l'écran, puis mesure. Sans cible
  // ou après abandon → carte centrée.
  useLayoutEffect(() => {
    const sel = steps[i]?.target;
    // Annonce la cible : une page à onglets (ex. Configuration) peut alors révéler
    // la section qui l'héberge avant qu'on tente de l'éclairer.
    if (sel) window.dispatchEvent(new CustomEvent('tour:target', { detail: sel }));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;

    const attempt = () => {
      if (cancelled) return;
      if (!sel) { setRect(null); return; }
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        setRect(r.width === 0 || r.right < 0 || r.left > window.innerWidth ? null : r);
        return;
      }
      if (tries++ < 24) timer = setTimeout(attempt, 130); // ~3 s d'attente max
      else setRect(null);
    };
    attempt();

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, steps, i]);

  // Positionne la carte une fois sa hauteur connue (à droite de la cible, sinon dessous)
  useLayoutEffect(() => {
    if (!rect) { setCard(null); return; }
    const h = cardRef.current?.offsetHeight ?? 200;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.right + GAP;
    let below = false;
    if (left + CARD_W > vw - 12) {
      left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
      below = true;
    }
    let top = below ? rect.bottom + GAP : rect.top;
    top = Math.min(Math.max(12, top), vh - h - 12);
    setCard({ top, left });
  }, [rect, i]);

  const close = useCallback(() => onClose(), [onClose]);
  const next = useCallback(() => setI((n) => (n >= steps.length - 1 ? n : n + 1)), [steps.length]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') (isLast ? close() : next());
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, next, prev, isLast]);

  if (!step) return null;
  const centered = !rect;

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Visite guidée">
      <div className={`tour-blocker${centered ? ' dim' : ''}`} />
      {rect && (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - PAD, left: rect.left - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          }}
        />
      )}
      <div
        ref={cardRef}
        className={`tour-card${centered ? ' tour-card-centered' : ''}`}
        style={centered ? undefined : { top: card?.top ?? -9999, left: card?.left ?? -9999 }}
      >
        <div className="tour-card-step">Étape {i + 1} / {steps.length}</div>
        <h3 className="tour-card-title">{step.title}</h3>
        <div className="tour-card-body">{step.body}</div>
        <div className="tour-card-actions">
          <button type="button" className="tour-skip" onClick={close}>Passer</button>
          <div className="tour-nav">
            {!isFirst && <button type="button" className="btn btn-ghost btn-sm" onClick={prev}>Précédent</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => (isLast ? close() : next())}>
              {isLast ? 'Terminer' : 'Suivant'}
            </button>
          </div>
        </div>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, d) => <span key={d} className={`tour-dot${d === i ? ' on' : ''}`} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
