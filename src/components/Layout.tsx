import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  Boxes,
  Tags,
  Warehouse,
  FileBarChart,
  Users as UsersIcon,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth, ROLE_LABELS } from '@/contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'لوحة التحكم', icon: LayoutDashboard, end: true },
  { to: '/material-issues', label: 'صرف الخامات', icon: PackageMinus },
  { to: '/scrap-receipts', label: 'تسليم الهالك', icon: PackagePlus },
  { to: '/scrap-sales', label: 'مبيعات الهالك', icon: ShoppingCart },
  { to: '/scrap-balance', label: 'رصيد الهالك', icon: Boxes },
  { to: '/items', label: 'الأصناف', icon: Tags },
  { to: '/warehouses', label: 'المخازن وصالات الإنتاج', icon: Warehouse },
  { to: '/reports', label: 'التقارير', icon: FileBarChart },
];

export default function Layout() {
  const { appUser, signOut, hasRole } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = hasRole('admin')
    ? [...NAV_ITEMS, { to: '/users', label: 'المستخدمون', icon: UsersIcon }]
    : NAV_ITEMS;

  return (
    <div className="flex h-screen bg-surface-50">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 right-0 z-40 w-64 bg-white border-l border-surface-200 flex flex-col transition-transform lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5 border-b border-surface-200">
          <div className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold">
            ه
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm leading-tight">نظام إدارة الهالك</div>
            <div className="text-xs text-gray-400">EgyGulf Foods</div>
          </div>
          <button className="mr-auto lg:hidden text-gray-400" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-surface-100 hover:text-gray-900'
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-surface-200 p-4">
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-900">{appUser?.displayName}</div>
            <div className="text-xs text-gray-400">{appUser ? ROLE_LABELS[appUser.role] : ''}</div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut size={16} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden flex items-center gap-3 bg-white border-b border-surface-200 px-4 py-3 no-print">
          <button onClick={() => setMobileOpen(true)} className="text-gray-600">
            <Menu size={22} />
          </button>
          <span className="font-bold text-gray-900">نظام إدارة الهالك</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
