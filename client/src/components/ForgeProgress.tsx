import { AlertTriangle } from 'lucide-react';

/**
 * Barre de chargement indéterminée pour les actions IA longues (rédaction,
 * amélioration, génération d'image). Affiche un avertissement « ne pas
 * actualiser » pour que l'attente soit évidente — ces appels durent plusieurs
 * secondes et perdre la page annulerait le travail.
 */
export default function ForgeProgress({ label, warn = true }: { label: string; warn?: boolean }) {
  return (
    <div className="forge-progress" role="status" aria-live="polite">
      <div className="forge-progress-track">
        <span className="forge-progress-fill" />
      </div>
      <div className="forge-progress-meta">
        <span className="forge-progress-label">{label}</span>
        {warn && (
          <span className="forge-progress-warn">
            <AlertTriangle size={13} /> Merci de ne pas actualiser la page
          </span>
        )}
      </div>
    </div>
  );
}
