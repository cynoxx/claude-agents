import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthPage } from './components/Auth/AuthPage';
import { BillsPage } from './components/Bills/BillsPage';
import { CalendarPage } from './components/Bills/CalendarPage';
import { BudgetPage } from './components/Budget/BudgetPage';
import { DashboardPage } from './components/Dashboard/DashboardPage';
import { Layout } from './components/Layout/Layout';
import { NotificationsPage } from './components/Notifications/NotificationsPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { STANDALONE } from './services/api';
import { useAuthStore } from './store/authStore';

export function App() {
  const token = useAuthStore((s) => s.token);

  if (!token && !STANDALONE) {
    return (
      <Routes>
        <Route path="/connexion" element={<AuthPage mode="login" />} />
        <Route path="/inscription" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/connexion" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="factures" element={<BillsPage />} />
        <Route path="calendrier" element={<CalendarPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="parametres" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
