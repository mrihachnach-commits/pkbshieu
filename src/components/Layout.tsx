import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useContext, useState } from 'react';
import { AuthContext } from '../App';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Users as UsersIcon, 
  FileText, 
  LogOut, 
  Menu, 
  X, 
  Glasses,
  Truck,
  Settings,
  History
} from 'lucide-react';
import { cn } from '../lib/utils';
import { logActivity } from '../lib/firestore-utils';

const navigation = [
  { name: 'Tổng quan', href: '/', icon: LayoutDashboard },
  { name: 'Bán hàng', href: '/sales', icon: ShoppingCart },
  { name: 'Nhập hàng', href: '/purchases', icon: Truck },
  { name: 'Kho hàng', href: '/inventory', icon: Package },
  { name: 'Khách hàng', href: '/customers', icon: UsersIcon },
  { name: 'Thành viên', href: '/users', icon: Settings, roles: ['admin', 'super_admin'] },
  { name: 'Lịch sử thao tác', href: '/activity-logs', icon: History, roles: ['admin', 'super_admin'] },
  { name: 'Báo cáo', href: '/reports', icon: FileText },
];

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  super_admin: 'Quản trị viên chính',
  manager: 'Quản trị viên',
  staff: 'Nhân viên'
};

export default function Layout() {
  const { role, user } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    if (user) {
      logActivity(
        'logout',
        'user',
        user.uid,
        `Đăng xuất thành công: ${user.email}`
      );
    }
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar for desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200">
        <div className="p-6 flex items-center gap-2">
          <Glasses className="w-8 h-8 text-indigo-600" />
          <span className="text-xl font-bold text-slate-900">OptiManager - BS Hiệu</span>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {navigation.map((item) => {
            if (item.roles && !item.roles.includes(role || '')) return null;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-indigo-50 text-indigo-700" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
              {user?.displayName?.[0] || user?.email?.[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user?.displayName || 'User'}</p>
              <p className="text-xs text-slate-500 truncate">{role ? roleLabels[role] : ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-2">
          <Glasses className="w-6 h-6 text-indigo-600" />
          <span className="font-bold text-slate-900">OptiManager - BS Hiệu</span>
        </div>
        <button onClick={() => setSidebarOpen(true)} className="p-2 text-slate-600">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Glasses className="w-6 h-6 text-indigo-600" />
                <span className="font-bold text-slate-900">OptiManager - BS Hiệu</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-2 text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex-1 px-4 space-y-1">
              {navigation.map((item) => {
                if (item.roles && !item.roles.includes(role || '')) return null;
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-indigo-50 text-indigo-700" 
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-100">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:ml-0 pt-16 lg:pt-0 overflow-auto">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
