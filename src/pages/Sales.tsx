import React, { useState, useEffect, useContext } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Eye, 
  Download,
  CheckCircle2,
  Clock,
  CreditCard,
  Banknote,
  UserPlus,
  History,
  X,
  Package,
  ShoppingCart,
  Calendar
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocs,
  where,
  deleteDoc,
  increment,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatCurrency, formatDate, cn, toLocalISOString } from '../lib/utils';
import { sanitizeData } from '../lib/firestore-utils';

interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  consumedPurchases?: { purchaseId: string, quantity: number, costPrice?: number }[];
}

interface Sale {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod: 'cash' | 'transfer';
  date: any;
  createdBy: string;
  createdByName: string;
  updatedBy?: string;
  history?: any[];
  status: 'completed' | 'cancelled';
}

export default function Sales() {
  const { user, role } = useContext(AuthContext);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'main' | 'general'>('all');
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedItems, setSelectedItems] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [saleDate, setSaleDate] = useState(toLocalISOString());
  const [products, setProducts] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<'main' | 'general'>('general');

  useEffect(() => {
    let q = query(collection(db, 'sales'), orderBy('date', 'desc'));
    if (role === 'manager' || role === 'staff') {
      q = query(q, where('warehouse', '==', 'general'));
    }
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sale[];
      setSales(salesData);
      setLoading(false);
    });

    // Fetch products for selection
    let productsQuery = query(collection(db, 'products'));
    if (role === 'manager' || role === 'staff') {
      productsQuery = query(productsQuery, where('warehouse', '==', 'general'));
    }
    getDocs(productsQuery).then(snapshot => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubscribe();
  }, []);

  const handleCreateSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.length === 0) return alert('Vui lòng chọn ít nhất 1 sản phẩm');

    const totalAmount = selectedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    try {
      // 1. Pre-process customer OUTSIDE transaction
      const customerQuery = query(collection(db, 'customers'), where('phone', '==', customerPhone));
      const customerSnap = await getDocs(customerQuery);
      let customerRef = null;
      let isNewCustomer = false;
      let existingCustomerId = null;

      if (customerSnap.empty) {
        customerRef = doc(collection(db, 'customers'));
        isNewCustomer = true;
      } else {
        existingCustomerId = customerSnap.docs[0].id;
      }

      const saleData: any = {
        customerName,
        customerPhone,
        items: selectedItems,
        totalAmount,
        paymentMethod,
        warehouse: selectedWarehouse,
        date: new Date(saleDate).toISOString(),
        createdBy: user?.uid,
        createdByName: user?.displayName || user?.email,
        status: 'completed',
        history: [{
          action: 'create',
          timestamp: new Date().toISOString(),
          user: user?.email
        }]
      };

      // 2. Run Transaction
      await runTransaction(db, async (transaction) => {
        // Collect all unique product IDs involved
        const allProductIds = new Set<string>([
          ...selectedItems.map(i => i.productId),
          ...(editingSale?.items.map(i => i.productId) || [])
        ]);

        // Fetch all relevant purchases for FIFO calculation
        // We fetch all completed purchases and filter in memory to handle legacy data 
        // that might be missing the 'warehouse' field or have other inconsistencies.
        const purchaseSnapshots = new Map<string, any>();
        const q = query(
          collection(db, 'purchases'),
          where('status', '==', 'completed')
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          const data = d.data();
          // Only add if it contains any of our products
          if (data.items.some((i: any) => allProductIds.has(i.productId))) {
            purchaseSnapshots.set(d.id, { id: d.id, ...data });
          }
        });

        // Also add purchases from the editing sale that might not be in the current query (e.g. if they were moved/changed)
        if (editingSale) {
          for (const oldItem of editingSale.items) {
            for (const cp of oldItem.consumedPurchases || []) {
              if (!purchaseSnapshots.has(cp.purchaseId) && cp.purchaseId !== 'untracked-stock') {
                const pSnap = await transaction.get(doc(db, 'purchases', cp.purchaseId));
                if (pSnap.exists()) {
                  purchaseSnapshots.set(pSnap.id, { id: pSnap.id, ...pSnap.data() });
                }
              }
            }
          }
        }

        // 1. PERFORM ALL READS FIRST
        const productSnapshots = new Map<string, any>();
        for (const pid of allProductIds) {
          const pSnap = await transaction.get(doc(db, 'products', pid));
          if (pSnap.exists()) {
            productSnapshots.set(pid, pSnap.data());
          }
        }

        // 2. RESTORE OLD QUANTITIES (if editing)
        if (editingSale) {
          const isRestricted = role === 'manager' || role === 'staff';
          if (isRestricted && editingSale.warehouse === 'main') {
            throw new Error('Bạn không có quyền chỉnh sửa đơn hàng từ kho này');
          }
          if (role === 'staff') {
            throw new Error('Nhân viên không có quyền chỉnh sửa đơn hàng');
          }

          for (const oldItem of editingSale.items) {
            // Restore product aggregate stock
            const productData = productSnapshots.get(oldItem.productId);
            if (productData) {
              productData.stockQuantity = (productData.stockQuantity || 0) + Number(oldItem.quantity);
            }

            // Restore individual purchases
            for (const cp of oldItem.consumedPurchases || []) {
              const pData = purchaseSnapshots.get(cp.purchaseId);
              if (pData) {
                pData.items = pData.items.map((pi: any) => {
                  if (pi.productId === oldItem.productId) {
                    const currentRemaining = pi.remainingQuantity !== undefined ? pi.remainingQuantity : pi.quantity;
                    return { ...pi, remainingQuantity: currentRemaining + cp.quantity };
                  }
                  return pi;
                });
              }
            }
          }
        }

        // 1. CALCULATE NEW FIFO AND CONSUME
        const itemsWithFIFO = [];
        for (const item of selectedItems) {
          let remainingToConsume = Number(item.quantity);
          const consumedPurchases: { purchaseId: string, quantity: number, costPrice: number }[] = [];

          // Get available purchases for this product from our snapshots
          const lots: any[] = [];
          Array.from(purchaseSnapshots.values())
            .filter(p => {
              const isCompleted = p.status === 'completed';
              // Handle legacy data: if warehouse is missing, assume it's 'general'
              const pWarehouse = p.warehouse || 'general';
              const warehouseMatch = pWarehouse === selectedWarehouse;
              return isCompleted && warehouseMatch;
            })
            .forEach(p => {
              p.items.forEach((pItem: any) => {
                if (pItem.productId === item.productId) {
                  lots.push({
                    id: p.id,
                    costPrice: Number(pItem.costPrice || 0),
                    date: p.date || p.createdAt || '1970-01-01T00:00:00.000Z',
                    available: pItem.remainingQuantity !== undefined ? pItem.remainingQuantity : pItem.quantity || 0,
                    isLot: true,
                    ref: pItem
                  });
                }
              });
            });

          // Add untracked stock as a virtual lot
          const productData = productSnapshots.get(item.productId);
          const trackedInLots = lots.reduce((sum, l) => sum + l.available, 0);
          const untrackedQty = Math.max(0, (productData?.stockQuantity || 0) - trackedInLots);
          
          if (untrackedQty > 0) {
            lots.push({
              id: 'untracked-stock',
              costPrice: Number(productData?.costPrice || 0),
              date: '1970-01-01T00:00:00.000Z', // Oldest possible
              available: untrackedQty,
              isLot: false,
              ref: productData
            });
          }

          // Sort lots: Highest cost price first, then oldest date
          lots.sort((a, b) => {
            if (a.costPrice !== b.costPrice) return b.costPrice - a.costPrice;
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (isNaN(dateA)) return 1;
            if (isNaN(dateB)) return -1;
            return dateA - dateB;
          });

          for (const lot of lots) {
            if (remainingToConsume <= 0) break;
            if (lot.available <= 0) continue;

            const consume = Math.min(lot.available, remainingToConsume);
            consumedPurchases.push({ 
              purchaseId: lot.id, 
              quantity: consume,
              costPrice: lot.costPrice // Store costPrice at time of sale
            });
            
            // Update local snapshot
            if (lot.isLot) {
              lot.ref.remainingQuantity = lot.available - consume;
            } else {
              // Untracked stock is already part of productData.stockQuantity
              // We don't need to do anything extra here as productData.stockQuantity 
              // is updated for the whole item later at line 301
            }
            remainingToConsume -= consume;
          }

          // Check if we have enough stock
          if (remainingToConsume > 0) {
            throw new Error(`Không đủ hàng trong kho cho sản phẩm ${item.productName}. Còn thiếu ${remainingToConsume} sản phẩm.`);
          }

          itemsWithFIFO.push({
            ...item,
            consumedPurchases
          });

          // Update product aggregate stock in snapshot
          if (productData) {
            productData.stockQuantity = (productData.stockQuantity || 0) - Number(item.quantity);
          }
        }

        // 4. PERFORM ALL WRITES
        // Update Products
        for (const [pid, data] of productSnapshots.entries()) {
          transaction.update(doc(db, 'products', pid), { stockQuantity: data.stockQuantity });
        }

        // Update Purchases
        for (const [paid, data] of purchaseSnapshots.entries()) {
          const { id, ...updateData } = data;
          transaction.update(doc(db, 'purchases', paid), sanitizeData(updateData));
        }

        // Update/Set Sale
        const finalSaleData = { ...saleData, items: itemsWithFIFO };
        if (editingSale) {
          const history = [...(editingSale.history || []), {
            action: 'update',
            timestamp: new Date().toISOString(),
            user: user?.email
          }];
          transaction.update(doc(db, 'sales', editingSale.id), sanitizeData({ ...finalSaleData, history, updatedBy: user?.uid }));
        } else {
          const saleRef = doc(collection(db, 'sales'));
          transaction.set(saleRef, sanitizeData(finalSaleData));
        }

        // Update customer total spent
        if (isNewCustomer && customerRef) {
          transaction.set(customerRef, sanitizeData({
            name: customerName,
            phone: customerPhone,
            totalSpent: totalAmount,
            lastVisit: new Date().toISOString()
          }));
        } else if (existingCustomerId) {
          transaction.update(doc(db, 'customers', existingCustomerId), {
            totalSpent: increment(totalAmount),
            lastVisit: new Date().toISOString()
          });
        }
      });
      
      resetForm();
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi lưu đơn hàng: ' + (error instanceof Error ? error.message : 'Lỗi không xác định'));
    }
  };

  const resetForm = () => {
    setIsModalOpen(false);
    setEditingSale(null);
    setCustomerName('');
    setCustomerPhone('');
    setSelectedItems([]);
    setPaymentMethod('cash');
    setSaleDate(toLocalISOString());
  };

  const handleDeleteSale = async () => {
    if (!deletingSale) return;
    
    const isRestricted = role === 'manager' || role === 'staff';
    if (isRestricted && deletingSale.warehouse === 'main') {
      setDeletingSale(null);
      return alert('Bạn không có quyền xóa đơn hàng từ kho này');
    }
    
    if (role === 'staff') {
      setDeletingSale(null);
      return alert('Nhân viên không có quyền xóa đơn hàng');
    }

    try {
      await runTransaction(db, async (transaction) => {
        // Collect all unique product IDs and purchase IDs involved
        const allProductIds = new Set<string>(deletingSale.items.map(i => i.productId));
        const allPurchaseIds = new Set<string>();
        for (const item of deletingSale.items) {
          for (const cp of item.consumedPurchases || []) {
            allPurchaseIds.add(cp.purchaseId);
          }
        }

        // 1. PERFORM ALL READS FIRST
        const productSnapshots = new Map<string, any>();
        for (const pid of allProductIds) {
          const snap = await transaction.get(doc(db, 'products', pid));
          if (snap.exists()) {
            productSnapshots.set(pid, snap.data());
          }
        }

        const purchaseSnapshots = new Map<string, any>();
        for (const paid of allPurchaseIds) {
          const snap = await transaction.get(doc(db, 'purchases', paid));
          if (snap.exists()) {
            purchaseSnapshots.set(paid, snap.data());
          }
        }

        // 2. PERFORM ALL WRITES SECOND
        // Return stock to warehouse and restore FIFO remaining quantities
        for (const item of deletingSale.items) {
          // Update product aggregate stock
          transaction.update(doc(db, 'products', item.productId), {
            stockQuantity: increment(Number(item.quantity))
          });

          // Restore individual purchases
          for (const cp of item.consumedPurchases || []) {
            const pRef = doc(db, 'purchases', cp.purchaseId);
            const pData = purchaseSnapshots.get(cp.purchaseId);
            if (pData) {
              const newItems = pData.items.map((pi: any) => {
                if (pi.productId === item.productId) {
                  const currentRemaining = pi.remainingQuantity !== undefined ? pi.remainingQuantity : pi.quantity;
                  return { ...pi, remainingQuantity: currentRemaining + cp.quantity };
                }
                return pi;
              });
              transaction.update(pRef, sanitizeData({ items: newItems }));
              // Update local snapshot
              pData.items = newItems;
            }
          }
        }

        // Update customer total spent
        const customerQuery = query(collection(db, 'customers'), where('phone', '==', deletingSale.customerPhone));
        const customerSnap = await getDocs(customerQuery);
        if (!customerSnap.empty) {
          transaction.update(doc(db, 'customers', customerSnap.docs[0].id), {
            totalSpent: increment(-deletingSale.totalAmount)
          });
        }

        // Delete the document
        transaction.delete(doc(db, 'sales', deletingSale.id));
      });
      
      setDeletingSale(null);
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi xóa đơn hàng: ' + (error instanceof Error ? error.message : 'Lỗi không xác định'));
    }
  };

  const addItem = (product: any) => {
    const existing = selectedItems.find(item => item.productId === product.id);
    if (existing) {
      setSelectedItems(selectedItems.map(item => 
        item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
      ));
    } else {
      setSelectedItems([...selectedItems, {
        productId: product.id,
        productName: product.name,
        category: product.category,
        quantity: 1,
        price: product.sellingPrice
      }]);
    }
  };

  const filteredSales = sales.filter(s => {
    // Warehouse restriction
    const isRestricted = role === 'manager' || role === 'staff';
    if (isRestricted && s.warehouse === 'main') return false;

    const matchesWarehouse = warehouseFilter === 'all' ? true : 
                            (s.warehouse === warehouseFilter || (warehouseFilter === 'general' && !s.warehouse));
    const matchesSearch = s.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         s.customerPhone.includes(searchTerm);
    
    return matchesWarehouse && matchesSearch;
  });

  const warehouseOptions = [
    { id: 'all', name: 'Tất cả kho' },
    { id: 'general', name: 'Kho bán hàng' },
    { id: 'main', name: 'Kho tặng' },
  ].filter(w => {
    if ((role === 'manager' || role === 'staff') && w.id === 'main') return false;
    if ((role === 'manager' || role === 'staff') && w.id === 'all') return false;
    return true;
  });

  // Set default warehouse filter for restricted roles
  useEffect(() => {
    if ((role === 'manager' || role === 'staff') && warehouseFilter !== 'general') {
      setWarehouseFilter('general');
    }
  }, [role]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quản lý bán hàng</h1>
          <p className="text-slate-500">Theo dõi và tạo đơn hàng mới cho khách hàng.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Tạo đơn hàng
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl">
          {warehouseOptions.map((w) => (
            <button
              key={w.id}
              onClick={() => setWarehouseFilter(w.id as any)}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                warehouseFilter === w.id 
                  ? "bg-white text-indigo-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {w.name}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Tìm kiếm theo tên khách hàng, số điện thoại..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600">
            <Filter className="w-5 h-5" />
            Lọc
          </button>
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600">
            <Download className="w-5 h-5" />
            Xuất Excel
          </button>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày bán</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Khách hàng</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Sản phẩm</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng tiền</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thanh toán</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Đang tải dữ liệu...</td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Không tìm thấy đơn hàng nào.</td>
                </tr>
              ) : filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-900">{formatDate(sale.date)}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {sale.createdByName}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-900">{sale.customerName}</div>
                    <div className="text-xs text-slate-500">{sale.customerPhone}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-600">
                      {sale.items.length} sản phẩm
                    </div>
                    <div className="text-xs text-slate-400 truncate max-w-[200px]">
                      {sale.items.map(i => i.productName).join(', ')}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-indigo-600">{formatCurrency(sale.totalAmount)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
                      sale.paymentMethod === 'cash' ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                    )}>
                      {sale.paymentMethod === 'cash' ? <Banknote className="w-3 h-3" /> : <CreditCard className="w-3 h-3" />}
                      {sale.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setSelectedSale(sale)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="Chi tiết"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {role !== 'staff' && (
                        <>
                          <button 
                            onClick={() => {
                              setEditingSale(sale);
                              setCustomerName(sale.customerName);
                              setCustomerPhone(sale.customerPhone);
                              // Deep copy items to prevent modifying editingSale.items in real-time
                              setSelectedItems(sale.items.map(item => ({ ...item })));
                              setPaymentMethod(sale.paymentMethod);
                              setSaleDate(toLocalISOString(sale.date));
                              setIsModalOpen(true);
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setDeletingSale(sale)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedSale(null);
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Chi tiết đơn hàng</h2>
                <p className="text-xs text-slate-500 mt-1">ID: {selectedSale.id}</p>
              </div>
              <button onClick={() => setSelectedSale(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Khách hàng</p>
                  <p className="text-sm font-bold text-slate-900">{selectedSale.customerName}</p>
                  <p className="text-sm text-slate-500">{selectedSale.customerPhone}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Ngày bán</p>
                  <p className="text-sm text-slate-900">{formatDate(selectedSale.date)}</p>
                  <p className="text-xs text-slate-500">Người tạo: {selectedSale.createdByName}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Thanh toán</p>
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
                    selectedSale.paymentMethod === 'cash' ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                  )}>
                    {selectedSale.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Kho xuất</p>
                  <span className="text-sm font-medium text-slate-700">
                    {selectedSale.warehouse === 'main' ? 'Kho tặng' : 'Kho bán hàng'}
                  </span>
                </div>
              </div>

              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 font-bold text-slate-600">Sản phẩm</th>
                      <th className="px-4 py-2 font-bold text-slate-600 text-center">SL</th>
                      <th className="px-4 py-2 font-bold text-slate-600 text-right">Đơn giá</th>
                      <th className="px-4 py-2 font-bold text-slate-600 text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selectedSale.items.map((item, idx) => {
                      const itemCost = (item.consumedPurchases || []).reduce((sum: number, cp: any) => sum + (cp.quantity * (cp.costPrice || 0)), 0);
                      const itemProfit = (item.price * item.quantity) - itemCost;
                      const showProfit = role === 'admin' || role === 'super_admin';

                      return (
                        <tr key={idx}>
                          <td className="px-4 py-3">
                            <div className="text-slate-900 font-medium">{item.productName}</div>
                            {showProfit && item.consumedPurchases && item.consumedPurchases.length > 0 && (
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Giá vốn: {formatCurrency(itemCost / item.quantity)}/cái
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-slate-600">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            <div>{formatCurrency(item.price)}</div>
                            {showProfit && (
                              <div className="text-[10px] text-emerald-600 mt-0.5">
                                Lãi: {formatCurrency(itemProfit / item.quantity)}/cái
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-bold text-slate-900">{formatCurrency(item.price * item.quantity)}</div>
                            {showProfit && (
                              <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
                                Tổng lãi: {formatCurrency(itemProfit)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-right text-slate-600 uppercase text-xs">Tổng cộng</td>
                      <td className="px-4 py-3 text-right text-indigo-600 text-lg">{formatCurrency(selectedSale.totalAmount)}</td>
                    </tr>
                    {(role === 'admin' || role === 'super_admin') && (
                      <tr className="border-t border-slate-200">
                        <td colSpan={3} className="px-4 py-3 text-right text-slate-600 uppercase text-xs">Tổng lợi nhuận</td>
                        <td className="px-4 py-3 text-right text-emerald-600">
                          {formatCurrency(selectedSale.items.reduce((sum, item) => {
                            const itemCost = (item.consumedPurchases || []).reduce((cSum: number, cp: any) => cSum + (cp.quantity * (cp.costPrice || 0)), 0);
                            return sum + ((item.price * item.quantity) - itemCost);
                          }, 0))}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {selectedSale.history && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    Lịch sử đơn hàng
                  </p>
                  <div className="space-y-3">
                    {selectedSale.history.map((h, i) => (
                      <div key={i} className="flex items-start gap-3 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5" />
                        <div>
                          <p className="text-slate-700">
                            <span className="font-bold">{h.user}</span> {h.action === 'create' ? 'đã tạo đơn hàng' : 'đã cập nhật đơn hàng'}
                          </p>
                          <p className="text-slate-400">{formatDate(h.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setSelectedSale(null)}
                className="px-6 py-2 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <h2 className="text-xl font-bold text-slate-900">
                  {editingSale ? 'Chỉnh sửa đơn hàng' : 'Tạo đơn hàng mới'}
                </h2>
                <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <input 
                    type="datetime-local"
                    required
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="bg-transparent text-sm font-medium text-slate-600 outline-none"
                  />
                </div>
              </div>
              <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreateSale} className="flex-1 overflow-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Tên khách hàng</label>
                  <input 
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Nguyễn Văn A"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Số điện thoại</label>
                  <input 
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="0901234567"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Kho xuất hàng</label>
                  <select 
                    value={selectedWarehouse}
                    onChange={(e) => {
                      setSelectedWarehouse(e.target.value as 'main' | 'general');
                      setSelectedItems([]); // Clear cart when warehouse changes to avoid mixed stock
                    }}
                    className={cn(
                      "w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none",
                      (role === 'manager' || role === 'staff') && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={role === 'manager' || role === 'staff'}
                  >
                    <option value="general">Kho bán hàng</option>
                    {role !== 'manager' && role !== 'staff' && <option value="main">Kho tặng</option>}
                  </select>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-8">
                {/* Product Selection */}
                <div className="lg:w-[40%] space-y-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Package className="w-5 h-5 text-indigo-600" />
                    Chọn sản phẩm
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Tìm sản phẩm..."
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
                    />
                  </div>
                  <div className="space-y-2 max-h-[300px] overflow-auto pr-2">
                    {products
                      .filter(p => p.warehouse === selectedWarehouse)
                      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku?.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addItem(p)}
                          className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-left"
                        >
                        <div>
                          <p className="text-sm font-bold text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            {p.warehouse === 'main' ? 'Kho tặng' : 'Kho bán hàng'} - SL trong kho: {p.stockQuantity} | {formatCurrency(p.sellingPrice)}
                          </p>
                        </div>
                        <Plus className="w-4 h-4 text-indigo-600" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selected Items */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-indigo-600" />
                      Giỏ hàng
                      <span className="ml-1 px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[10px] rounded-full">
                        {selectedItems.reduce((sum, i) => sum + i.quantity, 0)} món
                      </span>
                    </h3>
                    {selectedItems.length > 0 && (
                      <button 
                        type="button"
                        onClick={() => setSelectedItems([])}
                        className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
                      >
                        Xóa tất cả
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-auto space-y-3 pr-2 min-h-[200px]">
                    {selectedItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-white/50 rounded-xl border-2 border-dashed border-slate-200">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                          <ShoppingCart className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm font-medium text-slate-400">Giỏ hàng đang trống</p>
                        <p className="text-xs text-slate-300 mt-1">Chọn sản phẩm từ danh sách bên trái</p>
                      </div>
                    ) : selectedItems.map((item, idx) => (
                      <div key={idx} className="group relative bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all">
                        <div className="flex justify-between gap-4 mb-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                              {item.productName}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {item.category || 'Sản phẩm'}
                            </p>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setSelectedItems(selectedItems.filter((_, i) => i !== idx))}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-end justify-between">
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Số lượng</span>
                            <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200 p-0.5 w-fit">
                              <button 
                                type="button"
                                onClick={() => {
                                  const newItems = [...selectedItems];
                                  if (newItems[idx].quantity > 1) {
                                    newItems[idx].quantity--;
                                    setSelectedItems(newItems);
                                  }
                                }}
                                className="w-7 h-7 flex items-center justify-center hover:bg-white hover:text-indigo-600 rounded-md transition-all text-slate-400"
                              >-</button>
                              <input 
                                type="number"
                                value={item.quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const newItems = [...selectedItems];
                                  newItems[idx].quantity = Number(e.target.value);
                                  setSelectedItems(newItems);
                                }}
                                className="w-10 text-xs font-bold text-center outline-none bg-transparent"
                              />
                              <button 
                                type="button"
                                onClick={() => {
                                  const newItems = [...selectedItems];
                                  newItems[idx].quantity++;
                                  setSelectedItems(newItems);
                                }}
                                className="w-7 h-7 flex items-center justify-center hover:bg-white hover:text-indigo-600 rounded-md transition-all text-slate-400"
                              >+</button>
                            </div>
                          </div>

                          <div className="text-right space-y-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Giá bán & Thành tiền</span>
                            <div className="flex flex-col items-end">
                              <input 
                                type="number"
                                value={item.price}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const newItems = [...selectedItems];
                                  newItems[idx].price = Number(e.target.value);
                                  setSelectedItems(newItems);
                                }}
                                className="w-28 py-1 text-sm font-bold text-indigo-600 text-right outline-none bg-slate-50 rounded-lg border border-transparent focus:border-indigo-200 focus:bg-white transition-all px-2 mb-1"
                              />
                              <p className="text-xs font-bold text-slate-900">
                                {formatCurrency(item.price * item.quantity)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-600">Thanh toán:</span>
                      </div>
                      <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('cash')}
                          className={cn(
                            "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                            paymentMethod === 'cash' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          )}
                        >Tiền mặt</button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('transfer')}
                          className={cn(
                            "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                            paymentMethod === 'transfer' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          )}
                        >Chuyển khoản</button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2">
                      <div className="space-y-0.5">
                        <span className="text-sm font-bold text-slate-900">Tổng cộng</span>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Thanh toán cuối cùng</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-indigo-600">
                          {formatCurrency(selectedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button 
                type="button"
                onClick={resetForm}
                className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-xl transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={handleCreateSale}
                className="px-8 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
              >
                {editingSale ? 'Cập nhật đơn hàng' : 'Hoàn tất đơn hàng'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deletingSale && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingSale(null);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Xác nhận xóa đơn hàng</h3>
            <p className="text-slate-600 mb-6">
              Bạn có chắc chắn muốn xóa vĩnh viễn đơn hàng này? Số lượng sản phẩm sẽ được hoàn trả vào kho.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setDeletingSale(null)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={handleDeleteSale}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-100"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
