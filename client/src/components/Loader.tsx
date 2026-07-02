import { Loader2 } from 'lucide-react';

/**
 * Indicateur de chargement unifié : un spinner qui tourne + un texte dont un
 * reflet clair balaie les lettres en boucle (animation de surlignage).
 *
 * Remplace l'ancien pattern `<div className="loading">⏳ …</div>` disséminé dans
 * l'appli. Deux variantes :
 *   • 'block'  (défaut) : centré + padding, pour un écran ou un panneau entier ;
 *   • 'inline' : compact, pour une ligne, un bouton ou un encart.
 */
export default function Loader({
  text = 'Chargement…',
  variant = 'block',
  className = '',
}: {
  text?: string;
  variant?: 'block' | 'inline';
  className?: string;
}) {
  return (
    <div
      className={`lf-loader lf-loader--${variant}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="lf-loader-spinner"
        size={variant === 'inline' ? 16 : 22}
        aria-hidden
      />
      <span className="lf-loader-text">{text}</span>
    </div>
  );
}
