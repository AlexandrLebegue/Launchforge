/**
 * Page Profil — gestion du compte, accessible en cliquant sur la carte
 * utilisateur de la barre latérale. Réunit :
 *  • l'identité (nom, email) modifiable — RGPD art. 16 (rectification) ;
 *  • le mot de passe (changement, ou définition pour un compte Google) ;
 *  • la gestion des données (export art. 20 + suppression art. 17) via le
 *    composant partagé AccountDataSection.
 *
 * Le contexte (utilisateur courant + callback de mise à jour) est fourni par
 * Layout via l'Outlet : un changement d'email réémet un jeton, restocké ici.
 */

import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShieldCheck, UserRound, KeyRound } from 'lucide-react';
import { User, updateProfile } from '../api/client';
import AccountDataSection from '../components/AccountDataSection';

interface ProfileContext {
  user: User;
  onUserUpdate: (user: User, token?: string) => void;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export default function ProfilePage() {
  const { user, onUserUpdate } = useOutletContext<ProfileContext>();

  // ── Identité (nom + email) ──
  const [name,  setName]  = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [idPwd, setIdPwd] = useState('');           // mot de passe actuel (si email modifié)
  const [savingId, setSavingId] = useState(false);
  const [idError,  setIdError]  = useState('');
  const [idDone,   setIdDone]   = useState(false);

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  const nameChanged  = name.trim() !== user.name;
  const idDirty      = emailChanged || nameChanged;
  // Le serveur exige le mot de passe actuel pour changer d'email quand le compte
  // en possède un (les comptes Google seuls en sont dispensés).
  const needPwdForEmail = emailChanged && Boolean(user.hasPassword);

  const handleSaveIdentity = async () => {
    setIdError('');
    setIdDone(false);
    if (emailChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setIdError('Adresse email invalide.');
      return;
    }
    if (needPwdForEmail && !idPwd) {
      setIdError('Saisissez votre mot de passe actuel pour changer d\'email.');
      return;
    }
    setSavingId(true);
    const res = await updateProfile({
      name: name.trim(),
      email: email.trim(),
      ...(needPwdForEmail ? { currentPassword: idPwd } : {}),
    });
    setSavingId(false);
    if (res.success && res.data) {
      onUserUpdate(res.data.user, res.data.token);
      setName(res.data.user.name);
      setEmail(res.data.user.email);
      setIdPwd('');
      setIdDone(true);
    } else {
      setIdError(res.error || 'Mise à jour impossible.');
    }
  };

  // ── Mot de passe ──
  const [curPwd,  setCurPwd]  = useState('');
  const [newPwd,  setNewPwd]  = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdError,  setPwdError]  = useState('');
  const [pwdDone,   setPwdDone]   = useState(false);

  const handleSavePassword = async () => {
    setPwdError('');
    setPwdDone(false);
    if (newPwd.length < 6) { setPwdError('Le nouveau mot de passe doit faire au moins 6 caractères.'); return; }
    if (newPwd !== newPwd2) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (user.hasPassword && !curPwd) { setPwdError('Saisissez votre mot de passe actuel.'); return; }
    setSavingPwd(true);
    const res = await updateProfile({
      newPassword: newPwd,
      ...(user.hasPassword ? { currentPassword: curPwd } : {}),
    });
    setSavingPwd(false);
    if (res.success && res.data) {
      onUserUpdate(res.data.user, res.data.token);
      setCurPwd(''); setNewPwd(''); setNewPwd2('');
      setPwdDone(true);
    } else {
      setPwdError(res.error || 'Changement de mot de passe impossible.');
    }
  };

  const avatarLetter = (user.name || user.email).charAt(0).toUpperCase();

  return (
    <div className="animate-fadeIn settings-page profile-page">
      <div className="dashboard-header">
        <div>
          <h1>Mon profil</h1>
          <p>Vos informations de compte et la gestion de vos données personnelles.</p>
        </div>
      </div>

      {/* En-tête : avatar + identité courante */}
      <div className="profile-hero">
        <div className="profile-hero-avatar">{avatarLetter}</div>
        <div className="profile-hero-info">
          <div className="profile-hero-name">{user.name || '—'}</div>
          <div className="profile-hero-email">{user.email}</div>
          <div className="profile-hero-meta">
            <span className="profile-badge">
              {user.authProvider === 'google' ? 'Compte Google' : 'Compte email'}
            </span>
            <span>Membre depuis le {fmtDate(user.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="settings">

        {/* ── Identité ── */}
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title"><UserRound size={16} /> Identité</h2>
              <p className="settings-group-sub">Le nom affiché dans l'application et l'adresse email de connexion.</p>
            </div>
          </div>
          <div className="settings-panel">
            <div className="settings-body">
              <label className="form-label-block">
                Nom et prénom
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Votre nom"
                  autoComplete="name"
                  maxLength={120}
                />
              </label>
              <label className="form-label-block">
                Adresse email <span className="form-hint-inline">(non modifiable)</span>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  disabled
                  readOnly
                  placeholder="vous@exemple.com"
                  autoComplete="email"
                />
              </label>
              {needPwdForEmail && (
                <label className="form-label-block">
                  Mot de passe actuel <span className="form-hint-inline">(requis pour changer d'email)</span>
                  <input
                    className="form-input"
                    type="password"
                    value={idPwd}
                    onChange={(e) => setIdPwd(e.target.value)}
                    placeholder="Votre mot de passe"
                    autoComplete="current-password"
                  />
                </label>
              )}
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={handleSaveIdentity} disabled={savingId || !idDirty}>
                  {savingId ? '⏳ Enregistrement…' : 'Enregistrer'}
                </button>
                {idDone && <span className="profile-saved">✓ Modifications enregistrées</span>}
              </div>
              {idError && <div className="chat-error">{idError}</div>}
            </div>
          </div>
        </section>

        {/* ── Mot de passe ── */}
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title"><KeyRound size={16} /> Mot de passe</h2>
              <p className="settings-group-sub">
                {user.hasPassword
                  ? 'Changez le mot de passe utilisé pour vous connecter.'
                  : 'Votre compte se connecte via Google — définissez un mot de passe pour aussi vous connecter par email.'}
              </p>
            </div>
          </div>
          <div className="settings-panel">
            <div className="settings-body">
              {user.hasPassword && (
                <label className="form-label-block">
                  Mot de passe actuel
                  <input
                    className="form-input"
                    type="password"
                    value={curPwd}
                    onChange={(e) => setCurPwd(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
              )}
              <label className="form-label-block">
                Nouveau mot de passe
                <input
                  className="form-input"
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="6 caractères minimum"
                  autoComplete="new-password"
                />
              </label>
              <label className="form-label-block">
                Confirmer le nouveau mot de passe
                <input
                  className="form-input"
                  type="password"
                  value={newPwd2}
                  onChange={(e) => setNewPwd2(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <div className="profile-actions">
                <button className="btn btn-primary" onClick={handleSavePassword} disabled={savingPwd || !newPwd}>
                  {savingPwd ? '⏳ Enregistrement…' : user.hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}
                </button>
                {pwdDone && <span className="profile-saved">✓ Mot de passe mis à jour</span>}
              </div>
              {pwdError && <div className="chat-error">{pwdError}</div>}
            </div>
          </div>
        </section>

        {/* ── Vos données (RGPD) ── */}
        <section className="settings-group">
          <div className="settings-group-head">
            <div className="settings-group-head-main">
              <h2 className="settings-group-title"><ShieldCheck size={16} /> Vos données</h2>
              <p className="settings-group-sub">Portabilité et effacement (RGPD, articles 20 et 17) — en libre-service.</p>
            </div>
          </div>
          <div className="settings-panel">
            <AccountDataSection />
          </div>
        </section>

      </div>
    </div>
  );
}
