/**
 * Gestion des données du compte (RGPD) — réutilisée par la page Profil et par
 * l'onglet « Vos données » de la Configuration :
 *  • portabilité (art. 20) : téléchargement de toutes ses données en JSON ;
 *  • effacement (art. 17) : suppression définitive du compte, confirmée par une
 *    simple pop-up oui/non, avec déconnexion et retour à l'accueil.
 *
 * Le composant rend le contenu fonctionnel (`settings-body`) ; l'appelant fournit
 * son propre titre / cadre.
 */

import { useState } from 'react';
import { exportMyData, deleteAccount, setToken } from '../api/client';

export default function AccountDataSection() {
  const [exporting,   setExporting]   = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    const blob = await exportMyData();
    setExporting(false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'launchforge-mes-donnees.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Voulez-vous vraiment supprimer définitivement votre compte et toutes vos données ? Cette action est irréversible.')) return;
    setDeleting(true);
    setDeleteError('');
    const res = await deleteAccount();
    setDeleting(false);
    if (res.success) {
      setToken(null);
      window.location.href = '/';
    } else {
      setDeleteError(res.error || 'Suppression impossible.');
    }
  };

  return (
    <div className="settings-body">
      <button className="btn btn-ghost" onClick={handleExport} disabled={exporting} style={{ alignSelf: 'flex-start' }}>
        {exporting ? '⏳ Préparation…' : 'Télécharger toutes mes données (JSON)'}
      </button>

      <div className="danger-zone">
        <div className="danger-zone-title">Zone dangereuse</div>
        <p className="form-hint" style={{ marginBottom: 8 }}>
          Suppression <strong>définitive et immédiate</strong> : compte, projets, posts,
          contacts, base de connaissances, médias hébergés, liaisons Telegram et comptes
          connectés Composio. Aucune récupération possible.
        </p>
        <button className="btn btn-ghost btn-danger" onClick={handleDeleteAccount} disabled={deleting}>
          {deleting ? '⏳ Suppression…' : 'Supprimer mon compte et toutes mes données'}
        </button>
        {deleteError && <div className="chat-error" style={{ marginTop: 8 }}>{deleteError}</div>}
      </div>
    </div>
  );
}
