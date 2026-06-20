import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send } from 'lucide-react';

/**
 * Overlay plein écran affiché pendant qu'un post part en publication.
 * Métaphore forge : une volée de braises monte de la base pendant que le post
 * « chauffe » et s'envoie. Purement décoratif (aria-live pour l'accessibilité).
 */
export default function PublishingOverlay({
  message = 'Publication en cours…',
  sub = 'Envoi vers vos comptes connectés — merci de ne pas actualiser.',
}: {
  message?: string;
  sub?: string;
}) {
  // Paramètres aléatoires stables pour la durée de la publication
  const embers = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        left: 2 + Math.random() * 96,
        size: 3 + Math.round(Math.random() * 5),
        dur: 2 + Math.random() * 2.4,
        delay: Math.random() * 2.2,
        drift: -50 + Math.random() * 100,
      })),
    [],
  );

  return createPortal(
    <div className="publishing-overlay" role="status" aria-live="assertive">
      <div className="publishing-coals" aria-hidden="true" />
      <div className="publishing-embers" aria-hidden="true">
        {embers.map((e) => (
          <span
            key={e.id}
            className="publishing-ember"
            style={{
              left: `${e.left}%`,
              width: e.size,
              height: e.size,
              animationDuration: `${e.dur}s`,
              animationDelay: `${e.delay}s`,
              ['--drift' as string]: `${e.drift}px`,
            }}
          />
        ))}
      </div>
      <div className="publishing-core">
        <span className="publishing-flame">
          <Send size={34} />
        </span>
        <div className="publishing-title">{message}</div>
        <div className="publishing-sub">{sub}</div>
      </div>
    </div>,
    document.body,
  );
}
