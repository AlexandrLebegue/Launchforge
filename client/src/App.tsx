import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { getMe, User, setToken } from './api/client';
import Layout from './components/Layout';
import ProfilePage from './pages/ProfilePage';
import CookieConsent from './components/CookieConsent';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import { LegalNoticePage, PrivacyPage } from './pages/LegalPages';
import JoinPage from './pages/JoinPage';
import DashboardPage from './pages/DashboardPage';
import AssistantPage from './pages/AssistantPage';
import PerformancePage from './pages/PerformancePage';
import CreatePlanPage from './pages/CreatePlanPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ConfigPage from './pages/ConfigPage';
import ContentHubPage from './pages/ContentHubPage';
import CalendarPage from './pages/CalendarPage';
import KnowledgePage from './pages/KnowledgePage';
import TeamsPage from './pages/TeamsPage';
import BillingPage from './pages/BillingPage';
import AdminPage from './pages/AdminPage';
import { isAdminEmail } from './utils/admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem('launchforge_token');
    if (!token) {
      setLoading(false);
      return;
    }
    const res = await getMe();
    if (res.success && res.data) {
      setUser(res.data);
    } else {
      setToken(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
  };

  // Le tutoriel d'accueil vient d'être consommé : on le reflète dans l'état App
  // (le serveur est déjà mis à jour via markTutorialSeen) pour qu'il ne se
  // redéclenche pas si Layout se remonte dans la même session. useCallback :
  // référence stable, sinon l'effet de Layout se réexécuterait à chaque rendu.
  const handleTutorialSeen = useCallback(() => {
    setUser((u) => (u ? { ...u, tutorialPending: false } : u));
  }, []);

  // Profil mis à jour (page Profil) : reflète le nouvel utilisateur et, si l'email
  // a changé, restocke le jeton réémis (ses claims portent l'email). Stable.
  const handleUserUpdate = useCallback((updated: User, token?: string) => {
    if (token) setToken(token);
    setUser(updated);
  }, []);

  if (loading) {
    return <div className="loading">Chargement…</div>;
  }

  return (
    <>
    <Routes>
      <Route
        path="/"
        element={user ? <Layout user={user} onLogout={handleLogout} onTutorialSeen={handleTutorialSeen} onUserUpdate={handleUserUpdate} /> : <LandingPage />}
      >
        {user && (
          <>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="new" element={<CreatePlanPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="content" element={<ContentHubPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="performance" element={<PerformancePage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="billing" element={<BillingPage />} />
            {isAdminEmail(user.email) && (
              <Route path="admin" element={<AdminPage />} />
            )}
          </>
        )}
      </Route>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={(u) => setUser(u)} />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <RegisterPage onRegister={(u) => setUser(u)} />}
      />
      <Route path="/join" element={<JoinPage user={user} onAuthed={(u) => setUser(u)} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage onLogin={(u) => setUser(u)} />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage onLogin={(u) => setUser(u)} />} />
      <Route path="/legal" element={<LegalNoticePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <CookieConsent />
    </>
  );
}
