import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { getMe, User, setToken } from './api/client';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import AssistantPage from './pages/AssistantPage';
import PerformancePage from './pages/PerformancePage';
import CreatePlanPage from './pages/CreatePlanPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ConfigPage from './pages/ConfigPage';
import ContentHubPage from './pages/ContentHubPage';
import CalendarPage from './pages/CalendarPage';
import KnowledgePage from './pages/KnowledgePage';

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

  if (loading) {
    return <div className="loading">Chargement…</div>;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Layout user={user} onLogout={handleLogout} /> : <LandingPage />}
      >
        {user && (
          <>
            <Route index element={<DashboardPage />} />
            <Route path="new" element={<CreatePlanPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="content" element={<ContentHubPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="performance" element={<PerformancePage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
