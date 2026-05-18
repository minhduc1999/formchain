import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Navbar from './components/layout/Navbar';
import Dashboard from './pages/Dashboard';
import FormBuilder from './pages/FormBuilder';
import SurveyPage from './pages/SurveyPage';
import LandingPage from './pages/LandingPage';
import './index.css';

// All hooks + routing live inside BrowserRouter so useLocation etc. work
function AppRoutes() {
  const account = useCurrentAccount();

  return (
    <div className="app">
      <Navbar />
      <div className="page-content">
        <Routes>
          {/* Public survey page — no wallet needed */}
          <Route path="/survey/:id" element={<SurveyPage />} />

          {/* Root: landing if not connected, dashboard if connected */}
          <Route
            path="/"
            element={account ? <Navigate to="/dashboard" replace /> : <LandingPage />}
          />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={account ? <Dashboard /> : <Navigate to="/" replace />}
          />
          <Route
            path="/create"
            element={account ? <FormBuilder /> : <Navigate to="/" replace />}
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}