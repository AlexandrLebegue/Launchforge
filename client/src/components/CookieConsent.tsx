/**
 * Bandeau cookies / stockage local (RGPD + directive ePrivacy).
 *
 * LaunchForge n'utilise QUE du stockage strictement nécessaire : un jeton de
 * session dans le localStorage pour vous garder connecté — aucun cookie
 * publicitaire ni traceur. Le stockage essentiel n'exige pas de consentement,
 * mais la transparence l'exige : ce bandeau informe et garde une trace du choix.
 *
 * Le choix est mémorisé dans le localStorage (`launchforge_cookie_consent`) pour
 * ne pas se réafficher. On ne dépose RIEN d'autre tant que rien n'est accepté.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';

const CONSENT_KEY = 'launchforge_cookie_consent';

export default function CookieConsent() {
  // Affiché uniquement si aucun choix n'a encore été enregistré. Lecture
  // paresseuse pour éviter un flash au montage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      // localStorage indisponible (mode privé strict) : on n'affiche rien.
    }
  }, []);

  const acknowledge = () => {
    try {
      localStorage.setItem(CONSENT_KEY, new Date().toISOString());
    } catch { /* best-effort */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="cookie-consent" role="dialog" aria-live="polite" aria-label="Information sur les cookies">
      <div className="cookie-consent-icon"><Cookie size={20} /></div>
      <div className="cookie-consent-text">
        <strong>Cookies &amp; données</strong>
        <span>
          LaunchForge n'utilise que le strict nécessaire : un jeton de session pour vous garder
          connecté. <strong>Aucun cookie publicitaire ni traceur.</strong>{' '}
          <Link to="/privacy">En savoir plus</Link>.
        </span>
      </div>
      <button type="button" className="btn btn-primary btn-sm cookie-consent-btn" onClick={acknowledge}>
        J'ai compris
      </button>
    </div>
  );
}
