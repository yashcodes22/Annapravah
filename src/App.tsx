import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import DealerDashboard from './pages/DealerDashboard';
import ConsumerPortal from './pages/ConsumerPortal';
import ReceiveStock from './pages/ReceiveStock';
import DistributeRation from './pages/DistributeRation';
import ManageStock from './pages/ManageStock';
import Analytics from './pages/Analytics';
import FraudAlerts from './pages/FraudAlerts';
import ManageUsers from './pages/ManageUsers';
import { Layout } from './components/Layout';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center font-mono text-[10px] font-bold uppercase tracking-[0.3em]">System_Initializing...</div>;
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) return <Navigate to="/" />;

  return <>{children}</>;
}

function RoleHome() {
  const { profile } = useAuth();
  if (!profile) return <Navigate to="/login" />;
  if (profile.role === 'admin') return <Navigate to="/admin/analytics" />;
  if (profile.role === 'dealer') return <Navigate to="/dealer" />;
  return <Navigate to="/consumer" />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<RoleHome />} />
            
            {/* Admin Routes */}
            <Route path="admin" element={<Navigate to="/admin/analytics" />} />
            <Route path="admin/analytics" element={<ProtectedRoute allowedRoles={['admin']}><Analytics /></ProtectedRoute>} />
            <Route path="admin/stock" element={<ProtectedRoute allowedRoles={['admin']}><ManageStock /></ProtectedRoute>} />
            <Route path="admin/fraud" element={<ProtectedRoute allowedRoles={['admin']}><FraudAlerts /></ProtectedRoute>} />
            <Route path="admin/users" element={<ProtectedRoute allowedRoles={['admin']}><ManageUsers /></ProtectedRoute>} />
            
            {/* Dealer Routes */}
            <Route path="dealer" element={<ProtectedRoute allowedRoles={['dealer']}><DealerDashboard /></ProtectedRoute>} />
            <Route path="dealer/receive" element={<ProtectedRoute allowedRoles={['dealer']}><ReceiveStock /></ProtectedRoute>} />
            <Route path="dealer/distribute" element={<ProtectedRoute allowedRoles={['dealer']}><DistributeRation /></ProtectedRoute>} />
            
            {/* Consumer Routes */}
            <Route path="consumer" element={<ProtectedRoute allowedRoles={['beneficiary']}><ConsumerPortal /></ProtectedRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
