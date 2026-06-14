import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Entrée du menu des tutoriels (le détail des pas vit dans Layout) */
export interface TutorialMeta {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
}

interface Props {
  tutorials: TutorialMeta[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export default function TutorialMenu({ tutorials, onPick, onClose }: Props) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box tutorial-menu" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Tutoriels</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="tutorial-menu-sub">
          Choisissez ce que vous voulez apprendre — chaque tutoriel vous accompagne
          pas à pas, directement dans l'interface.
        </p>
        <div className="tutorial-list">
          {tutorials.map((t) => (
            <button key={t.id} type="button" className="tutorial-item" onClick={() => onPick(t.id)}>
              <span className="tutorial-item-icon">{t.icon}</span>
              <span className="tutorial-item-text">
                <span className="tutorial-item-title">{t.title}</span>
                <span className="tutorial-item-desc">{t.description}</span>
              </span>
              <span className="tutorial-item-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
