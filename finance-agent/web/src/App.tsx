import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthPage } from './components/Auth/AuthPage';
import { BillsPage } from './components/Bills/BillsPage';
import { CalendarPage } from './components/Bills/CalendarPage';
import { BudgetPage } from './components/Budget/BudgetPage';
import { DashboardPage } from './components/Dashboard/DashboardPage';
import { IncomesPage } from './components/Incomes/IncomesPage';
import { Layout } from './components/Layout/Layout';
import { NotificationsPage } from './components/Notifications/NotificationsPage';
import { PlanPage } from './components/Plan/PlanPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { AdvicePage } from './components/Simple/AdvicePage';
import { MorePage } from './components/Simple/MorePage';
import { SimpleLayout } from './components/Simple/SimpleLayout';
import { SpendingPage } from './components/Simple/SpendingPage';
import { TodayPage } from './components/Simple/TodayPage';
import { STANDALONE } from './services/api';
import { LockGate } from './standalone/LockGate';
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

  const pages = (
    <>
      <Route path="factures" element={<BillsPage />} />
      <Route path="calendrier" element={<CalendarPage />} />
      <Route path="revenus" element={<IncomesPage />} />
      <Route path="budget" element={<BudgetPage />} />
      <Route path="plan" element={<PlanPage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="parametres" element={<SettingsPage />} />
    </>
  );

  // App autonome (artefact) : version simple, solde du jour et dépenses d'abord
  if (STANDALONE)
    return (
      <LockGate>
        <Routes>
          <Route element={<SimpleLayout />}>
            <Route index element={<TodayPage />} />
            <Route path="depenses" element={<SpendingPage />} />
            <Route path="conseils" element={<AdvicePage />} />
            <Route path="plus" element={<MorePage />} />
            {pages}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </LockGate>
    );

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {pages}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
