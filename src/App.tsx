import React, { Suspense, lazy, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UIProvider, Spinner, EmptyState, useUI } from './components/ui';
import { Layout } from './components/Layout';
import { DesktopChrome } from './components/DesktopChrome';
import { isInstalledApp } from './lib/device';
import { canVisit } from './nav';
import { store } from './lib/store';
import {ShieldAlert} from 'lucide-react';

const Login = lazy(() => import('./pages/Login'));
const SignIn = lazy(() => import('./pages/Auth').then((m) => ({ default: m.SignIn })));
const SignUp = lazy(() => import('./pages/Auth').then((m) => ({ default: m.SignUp })));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/students/Students'));
const StudentProfile = lazy(() => import('./pages/students/StudentProfile'));
const StaffPage = lazy(() => import('./pages/Staff'));
const Classes = lazy(() => import('./pages/Classes'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Timetable = lazy(() => import('./pages/Timetable'));
const Gradebook = lazy(() => import('./pages/Gradebook'));
const ReportCards = lazy(() => import('./pages/ReportCards'));
const AceGrader = lazy(() => import('./pages/acegrader/AceGrader'));
const Finance = lazy(() => import('./pages/finance/Finance'));
const ParentFees = lazy(() => import('./pages/finance/ParentFees'));
const Announcements = lazy(() => import('./pages/Announcements'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const LibraryPage = lazy(() => import('./pages/Library'));
const Conduct = lazy(() => import('./pages/Conduct'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Setup = lazy(() => import('./pages/Setup'));
const Access = import('./pages/Access');
const DemoEnded = lazy(() => Access.then((m) => ({ default: m.DemoEnded })));
const ApplicationPending = lazy(() => Access.then((m) => ({ default: m.ApplicationPending })));
const OwnerSignIn = lazy(() => Access.then((m) => ({ default: m.OwnerSignIn })));
const OwnerConsole = lazy(() => import('./pages/Owner'));
const Pending = lazy(() => import('./pages/Auth').then((m) => ({ default: m.PendingApproval })));

const Guard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const loc = useLocation();
  if (!profile) return <Navigate to="/login" replace />;
  if (!canVisit(profile.role, loc.pathname))
    return <EmptyState icon={<ShieldAlert size={22} />} title="No access" body="Your role does not have access to this page." />;
  return <>{children}</>;
};

const ErrorBridge: React.FC = () => {
  const { toast } = useUI();
  useEffect(() => { store.onError = (m) => toast(m, 'error'); }, [toast]);
  return null;
};

const Shell: React.FC = () => {
  const { ready, profile, pending, application, locked, owner } = useAuth();
  if (!ready) return <Spinner label="Starting Musa OS…" />;
  const only = (el: React.ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;
  if (owner) return only(<OwnerConsole />);
  if (locked) return only(<DemoEnded />);
  if (application && !profile) return only(<ApplicationPending />);
  if (pending && !profile) return only(<Pending />);
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={profile ? <Navigate to="/" replace /> : isInstalledApp() ? <Navigate to="/signin" replace /> : <Login />} />
        <Route path="/signin" element={profile ? <Navigate to="/" replace /> : <SignIn />} />
        <Route path="/signup" element={profile ? <Navigate to="/" replace /> : <SignUp />} />
        <Route path="/owner" element={profile ? <Navigate to="/" replace /> : <OwnerSignIn />} />
        <Route element={<Guard><Layout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="setup" element={<Setup />} />
          <Route path="students" element={<Students />} />
          <Route path="students/:id" element={<StudentProfile />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="classes" element={<Classes />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="timetable" element={<Timetable />} />
          <Route path="gradebook" element={<Gradebook />} />
          <Route path="reports" element={<ReportCards />} />
          <Route path="acegrader/*" element={<AceGrader />} />
          <Route path="finance" element={<Finance />} />
          <Route path="fees" element={<ParentFees />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="conduct" element={<Conduct />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<EmptyState title="Page not found" />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default function App() {
  return (
    <UIProvider>
      <AuthProvider>
        <ErrorBridge />
        <HashRouter>
          <DesktopChrome />
          <Shell />
        </HashRouter>
      </AuthProvider>
    </UIProvider>
  );
}
