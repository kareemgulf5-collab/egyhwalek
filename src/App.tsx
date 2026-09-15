import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import { bootstrapFirstAdmin } from '@/lib/userAdmin';
import Layout from '@/components/Layout';
import { LoadingState, Button } from '@/components/ui';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Items from '@/pages/Items';
import Warehouses from '@/pages/Warehouses';
import MaterialIssues from '@/pages/MaterialIssues';
import ScrapReceipts from '@/pages/ScrapReceipts';
import ScrapSales from '@/pages/ScrapSales';
import ScrapBalancePage from '@/pages/ScrapBalance';
import Reports from '@/pages/Reports';
import Users from '@/pages/Users';

function ProtectedShell() {
  const { firebaseUser, appUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingState message="جاري تحميل النظام..." />
      </div>
    );
  }

  if (!firebaseUser) return <Navigate to="/login" replace />;

  if (!appUser) {
    return <BootstrapOrPending />;
  }

  return <Layout />;
}

/**
 * يظهر لأي مستخدم مسجّل دخول في Firebase Auth لكن ليس له مستند في users/{uid}.
 * لو كان هذا أول مستخدم على الإطلاق في النظام، يسمح له بجعل نفسه Admin
 * عبر Cloud Function (bootstrapAdmin) التي ترفض العمل إن كان يوجد مستخدمون بالفعل.
 * راجع README قسم "طريقة إنشاء أول Admin".
 */
function BootstrapOrPending() {
  const { showToast } = useToast();
  const { firebaseUser } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);

  const handleBootstrap = async () => {
    setLoading(true);
    try {
      await bootstrapFirstAdmin(firebaseUser!.uid, firebaseUser!.email || '', name);
      showToast('success', 'تم تفعيل حسابك كمدير للنظام — أعد تحميل الصفحة');
      window.location.reload();
    } catch (e: any) {
      setTried(true);
      showToast('error', e.message || 'تعذّر التفعيل');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <h2 className="font-bold text-lg text-gray-900 mb-2">حسابك غير مفعّل بعد</h2>
        <p className="text-sm text-gray-500 mb-4">
          إذا كنت أول من يسجّل دخول على هذا النظام، يمكنك تفعيل نفسك كمدير للنظام الآن.
          خلاف ذلك، تواصل مع مدير النظام لتفعيل صلاحياتك.
        </p>
        {!tried && (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm"
              placeholder="اسمك الكامل"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button onClick={handleBootstrap} disabled={loading} className="w-full justify-center">
              {loading ? 'جاري التفعيل...' : 'تفعيلي كمدير للنظام (أول مستخدم فقط)'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/material-issues" element={<MaterialIssues />} />
          <Route path="/scrap-receipts" element={<ScrapReceipts />} />
          <Route path="/scrap-sales" element={<ScrapSales />} />
          <Route path="/scrap-balance" element={<ScrapBalancePage />} />
          <Route path="/items" element={<Items />} />
          <Route path="/warehouses" element={<Warehouses />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/users" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
