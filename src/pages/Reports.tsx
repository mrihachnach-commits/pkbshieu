import { useState, useEffect, useContext } from 'react';
import { 
  FileText, 
  Download, 
  Calendar, 
  TrendingUp, 
  DollarSign, 
  PieChart as PieChartIcon,
  Filter,
  Printer,
  ShieldAlert
} from 'lucide-react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { startOfMonth, endOfMonth, format, subMonths, startOfDay, endOfDay } from 'date-fns';

export default function Reports() {
  const { role } = useContext(AuthContext);
  const [reportType, setReportType] = useState<'sales' | 'inventory' | 'tax'>('sales');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'main' | 'general'>(
    (role === 'manager' || role === 'staff') ? 'general' : 'all'
  );
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any[]>([]);

  const canView = role && ['admin', 'super_admin', 'manager', 'staff'].includes(role);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
        <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-6">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Truy cập bị từ chối</h1>
        <p className="text-slate-500 max-w-md">
          Bạn không có quyền xem báo cáo hệ thống. Vui lòng liên hệ quản trị viên để biết thêm chi tiết.
        </p>
      </div>
    );
  }

  const generateReport = async () => {
    setLoading(true);
    try {
      const start = startOfDay(new Date(dateRange.start));
      const end = endOfDay(new Date(dateRange.end));

      if (reportType === 'sales' || reportType === 'tax') {
        let q = query(
          collection(db, 'sales'),
          where('date', '>=', start.toISOString()),
          where('date', '<=', end.toISOString()),
          orderBy('date', 'asc')
        );
        
        if (warehouseFilter !== 'all') {
          q = query(q, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          q = query(q, where('warehouse', '==', 'general'));
        }

        const snap = await getDocs(q);
        const data = snap.docs.map(doc => {
          const d = doc.data();
          const totalCost = (d.items || []).reduce((sum: number, item: any) => {
            const itemCost = (item.consumedPurchases || []).reduce((cSum: number, cp: any) => cSum + (cp.quantity * (cp.costPrice || 0)), 0);
            return sum + itemCost;
          }, 0);
          
          return {
            id: doc.id,
            date: d.date,
            description: `Đơn hàng từ ${d.customerName} (${(d.items || []).length} SP)`,
            amount: d.totalAmount,
            cost: totalCost,
            profit: d.totalAmount - totalCost,
            profitMargin: d.totalAmount > 0 ? ((d.totalAmount - totalCost) / d.totalAmount) * 100 : 0,
            tax: d.totalAmount * 0.1,
            warehouse: d.warehouse || 'general',
            type: 'sale'
          };
        });
        setReportData(data);
      } else if (reportType === 'inventory') {
        let q = query(collection(db, 'products'));
        if (warehouseFilter !== 'all') {
          q = query(q, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          q = query(q, where('warehouse', '==', 'general'));
        }
        const snap = await getDocs(q);
        const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch all completed purchases to calculate lot-based value
        let pq = query(collection(db, 'purchases'), where('status', '==', 'completed'));
        if (warehouseFilter !== 'all') {
          pq = query(pq, where('warehouse', '==', warehouseFilter));
        } else if (role === 'manager' || role === 'staff') {
          pq = query(pq, where('warehouse', '==', 'general'));
        }
        const pSnap = await getDocs(pq);
        const purchases = pSnap.docs.map(doc => doc.data());

        const data: any[] = [];
        products.forEach((p: any) => {
          let remainingInProduct = p.stockQuantity || 0;
          
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
              data.push({
                id: `${p.id}-${lot.purchase.id || Math.random()}`,
                date: lot.purchase.date || lot.purchase.createdAt || new Date().toISOString(),
                productName: p.name,
                sku: p.sku,
                warehouse: lot.purchase.warehouse || 'general',
                description: `Lô nhập: ${p.name}`,
                quantity: count,
                costPrice: lot.item.costPrice || 0,
                amount: count * (lot.item.costPrice || 0),
                type: 'lot'
              });
              remainingInProduct -= count;
            }
          }

          // Account for untracked stock (added before FIFO fix)
          if (remainingInProduct > 0) {
            data.push({
              id: `${p.id}-untracked`,
              date: p.createdAt || new Date().toISOString(),
              productName: p.name,
              sku: p.sku,
              warehouse: p.warehouse || 'general',
              description: `Tồn kho cũ: ${p.name}`,
              quantity: remainingInProduct,
              costPrice: p.costPrice || 0,
              amount: remainingInProduct * (p.costPrice || 0),
              type: 'untracked'
            });
          }
        });
        setReportData(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      }
    } catch (error) {
      console.error("Error generating report:", error);
      if (error instanceof Error && error.message.includes('permission')) {
        alert('Bạn không có quyền truy cập dữ liệu cần thiết để tạo báo cáo này.');
      } else {
        alert('Lỗi khi tạo báo cáo: ' + (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Báo cáo & Thống kê</h1>
          <p className="text-slate-500">Tạo báo cáo doanh thu, tồn kho và thuế.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600">
            <Printer className="w-5 h-5" />
            In báo cáo
          </button>
          <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100">
            <Download className="w-5 h-5" />
            Xuất Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Filters */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Loại báo cáo</label>
              <div className="space-y-1">
                {[
                  { id: 'sales', name: 'Báo cáo doanh thu', icon: TrendingUp },
                  { id: 'inventory', name: 'Báo cáo kho hàng', icon: FileText },
                  { id: 'tax', name: 'Báo cáo thuế', icon: DollarSign },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setReportType(type.id as any);
                      setReportData([]);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      reportType === type.id 
                        ? "bg-indigo-50 text-indigo-700" 
                        : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <type.icon className="w-4 h-4" />
                    {type.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Kho hàng</label>
              <select 
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value as any)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
              >
                {role !== 'manager' && role !== 'staff' && <option value="all">Tất cả kho</option>}
                <option value="general">Kho bán hàng</option>
                {role !== 'manager' && role !== 'staff' && <option value="main">Kho tặng</option>}
              </select>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Từ ngày</label>
                <input 
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Đến ngày</label>
                <input 
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
                />
              </div>
            </div>

            <button 
              onClick={generateReport}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo báo cáo'}
            </button>
          </div>
        </div>

        {/* Report Content */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm min-h-[600px]">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold text-slate-900 uppercase">
                {reportType === 'sales' ? 'Báo cáo doanh thu' : reportType === 'inventory' ? 'Báo cáo tồn kho' : 'Báo cáo thuế giá trị gia tăng'}
              </h2>
              <p className="text-slate-500 mt-1">
                Thời gian: {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
              </p>
            </div>

            {reportData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                <FileText className="w-16 h-16 mb-4 opacity-20" />
                <p>Vui lòng chọn các tiêu chí và nhấn "Tạo báo cáo"</p>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-900">
                        <th className="py-4 font-bold text-slate-900">Ngày</th>
                        <th className="py-4 font-bold text-slate-900">Sản phẩm</th>
                        <th className="py-4 font-bold text-slate-900">Kho</th>
                        <th className="py-4 font-bold text-slate-900">Loại</th>
                        {reportType === 'inventory' && <th className="py-4 font-bold text-slate-900 text-right">Số lượng</th>}
                        {reportType === 'inventory' && <th className="py-4 font-bold text-slate-900 text-right">Giá nhập</th>}
                        <th className="py-4 font-bold text-slate-900 text-right">
                          {reportType === 'sales' ? 'Doanh thu' : 'Thành tiền'}
                        </th>
                        {reportType === 'sales' && <th className="py-4 font-bold text-slate-900 text-right">Lợi nhuận</th>}
                        {reportType === 'tax' && <th className="py-4 font-bold text-slate-900 text-right">Thuế (10%)</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.map((item) => (
                        <tr key={item.id} className={cn(item.type === 'untracked' && "bg-amber-50/50")}>
                          <td className="py-4 text-sm text-slate-600">{formatDate(item.date)}</td>
                          <td className="py-4">
                            <div className="text-sm text-slate-900 font-bold">{item.productName || item.description}</div>
                            <div className="text-[10px] text-slate-400">{item.sku}</div>
                          </td>
                          <td className="py-4 text-sm text-slate-600">
                            {item.warehouse === 'general' ? 'Kho bán hàng' : 'Kho tặng'}
                          </td>
                          <td className="py-4">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              item.type === 'lot' ? "bg-blue-100 text-blue-700" : 
                              item.type === 'sale' ? "bg-emerald-100 text-emerald-700" :
                              "bg-amber-100 text-amber-700"
                            )}>
                              {item.type === 'lot' ? 'Lô nhập' : 
                               item.type === 'sale' ? 'Bán hàng' :
                               'Tồn cũ'}
                            </span>
                          </td>
                          {reportType === 'inventory' && <td className="py-4 text-sm text-slate-900 font-bold text-right">{item.quantity}</td>}
                          {reportType === 'inventory' && <td className="py-4 text-sm text-slate-600 text-right">{formatCurrency(item.costPrice || 0)}</td>}
                          <td className="py-4 text-sm text-indigo-600 font-bold text-right">
                            {formatCurrency(item.amount)}
                          </td>
                          {reportType === 'sales' && (
                            <td className="py-4 text-sm text-emerald-600 font-bold text-right">
                              {formatCurrency(item.profit)}
                            </td>
                          )}
                          {reportType === 'tax' && <td className="py-4 text-sm text-rose-600 font-bold text-right">{formatCurrency(item.tax)}</td>}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-900 bg-slate-50">
                        <td colSpan={3} className="py-4 font-bold text-slate-900 px-2">TỔNG CỘNG</td>
                        {reportType === 'inventory' && <td className="py-4 font-bold text-slate-900 text-right">{reportData.reduce((sum, i) => sum + (i.quantity || 0), 0)}</td>}
                        {reportType === 'inventory' && <td className="py-4"></td>}
                        <td className="py-4 font-bold text-indigo-600 text-right text-lg">
                          {formatCurrency(reportData.reduce((sum, i) => sum + i.amount, 0))}
                        </td>
                        {reportType === 'sales' && (
                          <td className="py-4 font-bold text-emerald-600 text-right text-lg">
                            {formatCurrency(reportData.reduce((sum, i) => sum + (i.profit || 0), 0))}
                          </td>
                        )}
                        {reportType === 'tax' && (
                          <td className="py-4 font-bold text-rose-600 text-right">
                            {formatCurrency(reportData.reduce((sum, i) => sum + (i.tax || 0), 0))}
                          </td>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="grid grid-cols-2 gap-8 pt-12">
                  <div className="text-center">
                    <p className="font-bold text-slate-900">Người lập biểu</p>
                    <p className="text-xs text-slate-500 mt-1">(Ký, họ tên)</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-900">Quản trị viên</p>
                    <p className="text-xs text-slate-500 mt-1">(Ký, họ tên, đóng dấu)</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
