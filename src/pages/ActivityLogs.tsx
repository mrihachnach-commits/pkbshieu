import React, { useState, useEffect, useContext } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  User as UserIcon, 
  Clock, 
  Tag, 
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  where,
  startAfter,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatDate, cn } from '../lib/utils';

interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'logout';
  entityType: string;
  entityId: string;
  details: string;
  timestamp: string;
  metadata?: any;
}

export default function ActivityLogs() {
  const { role } = useContext(AuthContext);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');

  useEffect(() => {
    if (role !== 'admin' && role !== 'super_admin') return;

    let q = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(100));

    // Note: Firestore doesn't support multiple where clauses with inequality on different fields,
    // but here we use equality which is fine.
    // However, if we filter by action AND entity, we might need a composite index.
    // For now, let's keep it simple.
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLog[];
      setLogs(logsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [role]);

  if (role !== 'admin' && role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-slate-500">
        Bạn không có quyền truy cập trang này.
      </div>
    );
  }

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.userName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entityType === entityFilter;

    return matchesSearch && matchesAction && matchesEntity;
  });

  const getActionColor = (action: string) => {
    switch (action) {
      case 'create': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'update': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'delete': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'login': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'logout': return 'bg-slate-100 text-slate-700 border-slate-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case 'purchase': return 'Nhập hàng';
      case 'sale': return 'Bán hàng';
      case 'product': return 'Sản phẩm';
      case 'user': return 'Người dùng';
      case 'customer': return 'Khách hàng';
      case 'supplier': return 'Nhà cung cấp';
      case 'prescription': return 'Đơn kính';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lịch sử thao tác</h1>
          <p className="text-slate-500">Theo dõi mọi hoạt động của người dùng trên hệ thống.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text"
            placeholder="Tìm kiếm theo tên, email hoặc nội dung..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none text-sm font-medium text-slate-600"
            >
              <option value="all">Tất cả thao tác</option>
              <option value="create">Tạo mới</option>
              <option value="update">Cập nhật</option>
              <option value="delete">Xóa</option>
              <option value="login">Đăng nhập</option>
              <option value="logout">Đăng xuất</option>
            </select>
          </div>
          <div className="relative">
            <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none text-sm font-medium text-slate-600"
            >
              <option value="all">Tất cả đối tượng</option>
              <option value="purchase">Nhập hàng</option>
              <option value="sale">Bán hàng</option>
              <option value="product">Sản phẩm</option>
              <option value="user">Người dùng</option>
              <option value="customer">Khách hàng</option>
              <option value="supplier">Nhà cung cấp</option>
              <option value="prescription">Đơn kính</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thời gian</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Người thực hiện</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thao tác</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đối tượng</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nội dung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <p>Đang tải lịch sử...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Chưa có lịch sử thao tác nào.
                  </td>
                </tr>
              ) : filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm">{formatDate(log.timestamp)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-900">{log.userName}</span>
                      <span className="text-xs text-slate-500">{log.userEmail}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border",
                      getActionColor(log.action)
                    )}>
                      {log.action === 'create' ? 'Tạo mới' : 
                       log.action === 'update' ? 'Cập nhật' : 
                       log.action === 'delete' ? 'Xóa' : 
                       log.action === 'login' ? 'Đăng nhập' : 
                       log.action === 'logout' ? 'Đăng xuất' : log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Tag className="w-4 h-4" />
                      <span className="text-sm">{getEntityTypeLabel(log.entityType)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-slate-700 max-w-md truncate" title={log.details}>
                      {log.details}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
