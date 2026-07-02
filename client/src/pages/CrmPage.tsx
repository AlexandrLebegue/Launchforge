import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ContactsPanel from '../components/ContactsPanel';
import { getOverview } from '../api/client';

/**
 * Page CRM / Ventes — pilier « business » du produit, sortie de l'onglet
 * Contacts de la base de connaissances pour une entrée de menu dédiée.
 * Enveloppe ContactsPanel (pipeline de vente + détection/relance de leads +
 * import HubSpot) ; ouvre directement le scan boîte mail via ?scan=inbox
 * (deep-link depuis l'onboarding).
 */
export default function CrmPage() {
  const [searchParams] = useSearchParams();
  const autoScanInbox = searchParams.get('scan') === 'inbox';
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    // Rôle Lecteur sur un projet d'équipe : on masque les actions d'écriture.
    getOverview().then((res) => {
      if (res.success && res.data) setReadOnly(res.data.project?.role === 'viewer');
    });
  }, []);

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>CRM</h1>
          <p>
            Vos prospects, clients et deals — détectés et scorés par l'IA, suivis dans votre pipeline
            de vente, de la première prise de contact au chiffre d'affaires.
          </p>
        </div>
        {readOnly && <span className="chip chip-warning">👁️ Lecture seule</span>}
      </div>

      <ContactsPanel autoScanInbox={autoScanInbox} readOnly={readOnly} />
    </div>
  );
}
