import { useState, useEffect, useContext } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  Package,
  Calendar,
  ShieldAlert,
  Hash,
  X,
  Eye,
  FileText
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area
} from 'recharts';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, format, isSameMonth, subDays } from 'date-fns';

const data = [
  { name: 'Tháng 1', current: 4000, previous: 2400 },
  { name: 'Tháng 2', current: 3000, previous: 1398 },
  { name: 'Tháng 3', current: 2000, previous: 9800 },
  { name: 'Tháng 4', current: 2780, previous: 3908 },
  { name: 'Tháng 5', current: 1890, previous: 4800 },
  { name: 'Tháng 6', current: 2390, previous: 3800 },
  { name: 'Tháng 7', current: 3490, previous: 4300 },
];

export default function Dashboard() {
  const { role } = useContext(AuthContext);
  const [period, setPeriod] = useState<'day' | 'month' | 'year' | 'custom'>('month');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'main' | 'general'>(
    (role === 'manager' || role === 'staff') ? 'general' : 'all'
  );
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [stats, setStats] = useState({
    revenue: 0,
    revenueChange: 0,
    orders: 0,
    ordersChange: 0,
    customers: 0,
    customersChange: 0,
    products: 0,
    inventoryValue: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [revenueCategoryData, setRevenueCategoryData] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [staffRanking, setStaffRanking] = useState<any[]>([]);
  const [inventoryBreakdown, setInventoryBreakdown] = useState<any[]>([]);
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

  const canView = role && ['admin', 'super_admin', 'manager', 'staff'].includes(role);

  useEffect(() => {
    if (!canView) return;
    const fetchData = async () => {
      try {
        let start: Date;
        let end: Date;

        if (period === 'day') {
          start = startOfDay(new Date());
          end = endOfDay(new Date());
        } else if (period === 'month') {
          start = startOfMonth(new Date());
          end = endOfMonth(new Date());
        } else if (period === 'year') {
          start = new Date(new Date().getFullYear(), 0, 1);
          end = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);
        } else {
          start = startOfDay(new Date(dateRange.start));
          end = endOfDay(new Date(dateRange.end));
        }

        // Fetch Sales
        let salesQuery = query(
          collection(db, 'sales'),
          where('date', '>=', start.toISOString()),
          where('date', '<=', end.toISOString())
        );
        
        if (warehouseFilter !== 'all') {
          salesQuery = query(salesQuery, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          salesQuery = query(salesQuery, where('warehouse', '==', 'general'));
        }

        const salesSnap = await getDocs(salesQuery);
        const sales = salesSnap.docs.map(doc => doc.data());

        // Fetch Previous Period for change calculation
        const prevStart = subDays(start, end.getTime() - start.getTime() > 0 ? (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) : 30);
        const prevEnd = subDays(end, end.getTime() - start.getTime() > 0 ? (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) : 30);
        
        let prevSalesQuery = query(
          collection(db, 'sales'),
          where('date', '>=', prevStart.toISOString()),
          where('date', '<=', prevEnd.toISOString())
        );

        if (warehouseFilter !== 'all') {
          prevSalesQuery = query(prevSalesQuery, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          prevSalesQuery = query(prevSalesQuery, where('warehouse', '==', 'general'));
        }
        const prevSalesSnap = await getDocs(prevSalesQuery);
        const prevSales = prevSalesSnap.docs.map(doc => doc.data());

        // Fetch Products for total count
        let productsQuery = query(collection(db, 'products'));
        if (warehouseFilter !== 'all') {
          productsQuery = query(productsQuery, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          productsQuery = query(productsQuery, where('warehouse', '==', 'general'));
        }
        const productsSnap = await getDocs(productsQuery);
        const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

        // Fetch Customers for new customers count
        const customersQuery = query(
          collection(db, 'customers'),
          where('lastVisit', '>=', start.toISOString()),
          where('lastVisit', '<=', end.toISOString())
        );
        const customersSnap = await getDocs(customersQuery);
        
        const revenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
        const prevRevenue = prevSales.reduce((sum, s) => sum + s.totalAmount, 0);
        const revenueChange = prevRevenue === 0 ? 100 : ((revenue - prevRevenue) / prevRevenue) * 100;

        const orders = sales.length;
        const prevOrders = prevSales.length;
        const ordersChange = prevOrders === 0 ? 100 : ((orders - prevOrders) / prevOrders) * 100;

        const customers = customersSnap.size;

        // Fetch Purchases for inventory value calculation (FIFO/Lot-based)
        let purchasesQuery = query(
          collection(db, 'purchases'),
          where('status', '==', 'completed')
        );
        if (warehouseFilter !== 'all') {
          purchasesQuery = query(purchasesQuery, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          purchasesQuery = query(purchasesQuery, where('warehouse', '==', 'general'));
        }
        const purchasesSnap = await getDocs(purchasesQuery);
        const purchases = purchasesSnap.docs.map(doc => doc.data());

        // Calculate inventory value based on remaining quantities in each purchase lot
        let inventoryValue = 0;
        const breakdown: any[] = [];

        products.forEach(p => {
          let remainingInProduct = p.stockQuantity || 0;
          let productTrackedValue = 0;
          let trackedQty = 0;
          
          // Get all lots for this product
          const productLots: any[] = [];
          purchases.forEach((purchase: any) => {
            const matchingItems = purchase.items.filter((item: any) => item.productId === p.id);
            matchingItems.forEach((item: any) => {
              const remaining = item.remainingQuantity !== undefined ? item.remainingQuantity : item.quantity;
              if (remaining > 0) {
                productLots.push({
                  purchase,
                  item,
                  remaining
                });
              }
            });
          });
          
          // Sort lots by date desc (newest first) - remaining stock is assumed to be the newest
          productLots.sort((a, b) => new Date(b.purchase.date || 0).getTime() - new Date(a.purchase.date || 0).getTime());
          
          for (const lot of productLots) {
            if (remainingInProduct <= 0) break;
            const count = Math.min(lot.remaining, remainingInProduct);
            if (count > 0) {
              productTrackedValue += count * (lot.item.costPrice || 0);
              trackedQty += count;
              remainingInProduct -= count;
            }
          }
          
          // Any remaining stock (untracked) is valued at the product's average cost
          const untrackedQty = remainingInProduct;
          const untrackedValue = untrackedQty * (p.costPrice || 0);
          const totalValue = productTrackedValue + untrackedValue;
          
          if (p.stockQuantity > 0) {
            breakdown.push({
              id: p.id,
              name: p.name,
              sku: p.sku,
              warehouse: p.warehouse,
              totalQty: p.stockQuantity,
              trackedQty: trackedQty,
              untrackedQty: untrackedQty,
              trackedValue: productTrackedValue,
              untrackedValue: untrackedValue,
              totalValue: totalValue
            });
          }

          inventoryValue += totalValue;
        });
        
        setInventoryBreakdown(breakdown.sort((a, b) => b.totalValue - a.totalValue));
        
        setStats({
          revenue,
          revenueChange: Number(revenueChange.toFixed(1)),
          orders,
          ordersChange: Number(ordersChange.toFixed(1)),
          customers,
          customersChange: 0, // Simplified
          products: products.reduce((sum, p) => sum + (p.stockQuantity || 0), 0),
          inventoryValue
        });

        // Prepare Chart Data (Daily breakdown)
        const dailyData: { [key: string]: any } = {};
        sales.forEach(s => {
          const day = format(new Date(s.date), 'dd/MM');
          dailyData[day] = (dailyData[day] || 0) + s.totalAmount;
        });
        
        const formattedChartData = Object.keys(dailyData).map(day => ({
          name: day,
          current: dailyData[day],
          previous: 0 // Simplified
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        setChartData(formattedChartData.length > 0 ? formattedChartData : [{ name: 'N/A', current: 0, previous: 0 }]);

        // Category Data
        const catMap: { [key: string]: number } = {};
        const revCatMap: { [key: string]: number } = {};
        const productCategoryMap: { [key: string]: string } = {};
        
        products.forEach((p: any) => {
          productCategoryMap[p.id] = p.category;
        });

        sales.forEach(s => {
          s.items.forEach((item: any) => {
            const cat = item.category || productCategoryMap[item.productId] || 'Chưa phân loại';
            catMap[cat] = (catMap[cat] || 0) + item.quantity;
            revCatMap[cat] = (revCatMap[cat] || 0) + (item.price * item.quantity);
          });
        });
        
        setCategoryData(Object.keys(catMap).map(cat => ({ name: cat, value: catMap[cat] })));
        setRevenueCategoryData(Object.keys(revCatMap).map(cat => ({ name: cat, value: revCatMap[cat] })));

        // Staff Ranking
        const staffMap: { [key: string]: { name: string, revenue: number, orders: number } } = {};
        sales.forEach(s => {
          const staffId = s.createdBy || 'unknown';
          const staffName = s.createdByName || 'Ẩn danh';
          
          if (!staffMap[staffId]) {
            staffMap[staffId] = { name: staffName, revenue: 0, orders: 0 };
          }
          staffMap[staffId].revenue += s.totalAmount;
          staffMap[staffId].orders += 1;
        });

        const sortedStaff = Object.values(staffMap).sort((a, b) => b.revenue - a.revenue);
        setStaffRanking(sortedStaff);

        // Recent Orders
        const sortedSales = [...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setRecentOrders(sortedSales.slice(0, 5));
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      }
    };

    fetchData();
  }, [period, dateRange, canView, warehouseFilter]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
        <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-6">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Truy cập bị từ chối</h1>
        <p className="text-slate-500 max-w-md">
          Bạn không có quyền xem bảng điều khiển hệ thống. Vui lòng liên hệ quản trị viên để biết thêm chi tiết.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tổng quan</h1>
          <p className="text-slate-500">Chào mừng trở lại! Đây là tình hình kinh doanh của bạn.</p>
        </div>
        <div className="flex flex-col md:flex-row items-end md:items-center gap-4">
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm self-start">
            {[
              { id: 'all', name: 'Tất cả', roles: ['admin', 'super_admin'] },
              { id: 'general', name: 'Kho bán hàng', roles: ['admin', 'super_admin', 'manager', 'staff'] },
              { id: 'main', name: 'Kho tặng', roles: ['admin', 'super_admin'] },
            ].filter(w => !w.roles || w.roles.includes(role || '')).map((w) => (
              <button
                key={w.id}
                onClick={() => setWarehouseFilter(w.id as any)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all",
                  warehouseFilter === w.id 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" 
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                {w.name}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
              <input 
                type="date" 
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="px-2 py-1 text-xs outline-none"
              />
              <span className="text-slate-400">-</span>
              <input 
                type="date" 
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="px-2 py-1 text-xs outline-none"
              />
            </div>
          )}
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm self-start">
            {(['day', 'month', 'year', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all",
                  period === p 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" 
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                {p === 'day' ? 'Ngày' : p === 'month' ? 'Tháng' : p === 'year' ? 'Năm' : 'Tùy chỉnh'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Doanh thu" 
          value={formatCurrency(stats.revenue)} 
          change={stats.revenueChange} 
          icon={DollarSign}
          color="indigo"
        />
        <StatCard 
          title="Đơn hàng" 
          value={stats.orders.toString()} 
          change={stats.ordersChange} 
          icon={ShoppingCart}
          color="emerald"
        />
        <StatCard 
          title="Giá trị kho" 
          value={formatCurrency(stats.inventoryValue)} 
          icon={Package}
          color="amber"
          valueClassName="text-emerald-600 font-extrabold"
          action={
            <button 
              onClick={() => setIsBreakdownOpen(true)}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 mt-1"
            >
              <Eye className="w-3 h-3" />
              Xem chi tiết
            </button>
          }
        />
        <StatCard 
          title="Tổng sản phẩm" 
          value={stats.products.toString()} 
          icon={Hash}
          color="rose"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Số lượng đơn theo danh mục</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData.length > 0 ? categoryData : [{ name: 'N/A', value: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="value" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Doanh thu theo danh mục</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueCategoryData.length > 0 ? revenueCategoryData : [{ name: 'N/A', value: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(value) => `${value/1000}k`} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Orders */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">Đơn hàng gần đây</h3>
            <ShoppingCart className="w-5 h-5 text-slate-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="pb-3">Khách hàng</th>
                  <th className="pb-3">Ngày</th>
                  <th className="pb-3">Tổng cộng</th>
                  <th className="pb-3 text-right">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentOrders.map((order, idx) => (
                  <tr key={idx} className="text-sm">
                    <td className="py-4">
                      <p className="font-bold text-slate-900">{order.customerName}</p>
                      <p className="text-xs text-slate-500">{order.customerPhone}</p>
                    </td>
                    <td className="py-4 text-slate-500">
                      {formatDate(order.date)}
                    </td>
                    <td className="py-4 font-bold text-indigo-600">
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td className="py-4 text-right">
                      <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase">
                        Hoàn tất
                      </span>
                    </td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400 italic">Không có đơn hàng nào</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Staff Ranking */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">Xếp hạng nhân viên</h3>
            <Users className="w-5 h-5 text-slate-400" />
          </div>
          <div className="space-y-6">
            {staffRanking.map((staff, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                    idx === 0 ? "bg-amber-100 text-amber-600" : 
                    idx === 1 ? "bg-slate-100 text-slate-600" :
                    idx === 2 ? "bg-orange-100 text-orange-600" : "bg-slate-50 text-slate-400"
                  )}>
                    {idx + 1}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{staff.name}</p>
                    <p className="text-xs text-slate-500">{staff.orders} đơn hàng</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-indigo-600">{formatCurrency(staff.revenue)}</p>
              </div>
            ))}
            {staffRanking.length === 0 && (
              <p className="py-8 text-center text-slate-400 italic text-sm">Chưa có dữ liệu nhân viên</p>
            )}
          </div>
        </div>
      </div>
      {/* Inventory Breakdown Modal */}
      {isBreakdownOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Chi tiết giá trị tồn kho</h2>
                <p className="text-sm text-slate-500">Báo cáo chi tiết số lượng và giá trị theo từng sản phẩm</p>
              </div>
              <button onClick={() => setIsBreakdownOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b-2 border-slate-200">
                    <th className="py-3 font-bold text-slate-700 text-sm">Sản phẩm</th>
                    <th className="py-3 font-bold text-slate-700 text-sm text-center">Kho</th>
                    <th className="py-3 font-bold text-slate-700 text-sm text-right">Số lượng</th>
                    <th className="py-3 font-bold text-slate-700 text-sm text-right">Giá trị lô</th>
                    <th className="py-3 font-bold text-slate-700 text-sm text-right">Giá trị tồn cũ</th>
                    <th className="py-3 font-bold text-slate-700 text-sm text-right">Tổng giá trị</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventoryBreakdown.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4">
                        <div className="text-sm font-bold text-slate-900">{item.name}</div>
                        <div className="text-[10px] text-slate-400">{item.sku}</div>
                      </td>
                      <td className="py-4 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          item.warehouse === 'main' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        )}>
                          {item.warehouse === 'main' ? 'Kho tặng' : 'Kho bán'}
                        </span>
                      </td>
                      <td className="py-4 text-sm font-bold text-slate-900 text-right">{item.totalQty}</td>
                      <td className="py-4 text-sm text-slate-600 text-right">{formatCurrency(item.trackedValue)}</td>
                      <td className="py-4 text-sm text-slate-400 italic text-right">{formatCurrency(item.untrackedValue)}</td>
                      <td className="py-4 text-sm font-bold text-indigo-600 text-right">{formatCurrency(item.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-50 font-bold">
                  <tr className="border-t-2 border-slate-200">
                    <td colSpan={2} className="py-4 text-slate-900 px-2">TỔNG CỘNG</td>
                    <td className="py-4 text-slate-900 text-right">{inventoryBreakdown.reduce((sum, i) => sum + i.totalQty, 0)}</td>
                    <td className="py-4 text-slate-900 text-right">{formatCurrency(inventoryBreakdown.reduce((sum, i) => sum + i.trackedValue, 0))}</td>
                    <td className="py-4 text-slate-500 text-right">{formatCurrency(inventoryBreakdown.reduce((sum, i) => sum + i.untrackedValue, 0))}</td>
                    <td className="py-4 text-indigo-600 text-right text-lg">{formatCurrency(inventoryBreakdown.reduce((sum, i) => sum + i.totalValue, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setIsBreakdownOpen(false)}
                className="px-6 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, change, icon: Icon, color, valueClassName, action }: any) {
  const isPositive = change > 0;
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center",
          color === 'indigo' && "bg-indigo-50 text-indigo-600",
          color === 'emerald' && "bg-emerald-50 text-emerald-600",
          color === 'amber' && "bg-amber-50 text-amber-600",
          color === 'rose' && "bg-rose-50 text-rose-600",
        )}>
          <Icon className="w-6 h-6" />
        </div>
        {change !== undefined && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold",
            isPositive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          )}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
      <h4 className={cn("text-2xl font-bold text-slate-900", valueClassName)}>{value}</h4>
      {action}
    </div>
  );
}
