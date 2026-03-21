import React, { useState, useEffect, useContext } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Eye,
  Package,
  Tag,
  Hash,
  DollarSign,
  AlertTriangle,
  X,
  Calendar,
  ShoppingCart,
  History,
  Edit2,
  Check
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  updateDoc,
  increment,
  getDocs,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { sanitizeData, handleFirestoreError, OperationType } from '../lib/firestore-utils';

interface Product {
  id: string;
  name: string;
  category: string;
  sku: string;
  costPrice: number;
  sellingPrice: number;
  warehouse: 'main' | 'general';
  stockQuantity: number;
  description: string;
  createdAt?: string;
}

export default function Inventory() {
  const { role } = useContext(AuthContext);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [inventoryHistory, setInventoryHistory] = useState<any[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [totalSoldQuantity, setTotalSoldQuantity] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'main' | 'general'>('all');
  const [error, setError] = useState<string | null>(null);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [isNewProduct, setIsNewProduct] = useState(true);
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [newPrice, setNewPrice] = useState(0);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: 'Gọng kính',
    costPrice: 0,
    sellingPrice: 0,
    warehouse: 'general' as 'main' | 'general',
    stockQuantity: 0,
    description: ''
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.product-dropdown-container')) {
        setIsProductDropdownOpen(false);
      }
    };

    if (isProductDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProductDropdownOpen]);

  useEffect(() => {
    let q = query(collection(db, 'products'), orderBy('name', 'asc'));
    if (role === 'manager' || role === 'staff') {
      q = query(q, where('warehouse', '==', 'general'));
    }
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(productsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let q = query(collection(db, 'purchases'), where('status', '==', 'completed'));
    
    if (warehouseFilter !== 'all') {
      q = query(q, where('warehouse', '==', warehouseFilter));
    } else if (role === 'manager' || role === 'staff') {
      q = query(q, where('warehouse', '==', 'general'));
    }
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const purchasesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPurchases(purchasesData);
    });

    return () => unsubscribe();
  }, [role, warehouseFilter]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!selectedProduct) {
        setPurchaseHistory([]);
        setInventoryHistory([]);
        setSalesHistory([]);
        setTotalSoldQuantity(0);
        return;
      }

      setLoadingHistory(true);
      try {
        // Fetch purchase history
        const pq = query(
          collection(db, 'purchases'),
          where('productIds', 'array-contains', selectedProduct.id),
          orderBy('date', 'desc')
        );
        const pSnapshot = await getDocs(pq);
        const pHistory: any[] = [];
        const iHistory: any[] = [];
        pSnapshot.docs.forEach(doc => {
          const data = doc.data();
          const matchingItems = data.items.filter((i: any) => i.productId === selectedProduct.id);
          
          if (matchingItems.length > 0) {
            const productQty = matchingItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
            const productTotal = matchingItems.reduce((sum: number, item: any) => sum + ((item.quantity || 0) * (item.costPrice || 0)), 0);
            const totalOrderQty = data.items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
            
            const entry = {
              id: doc.id,
              date: data.date,
              supplierName: data.supplierName,
              quantity: productQty,
              costPrice: productQty > 0 ? Math.round(productTotal / productQty) : 0,
              totalOrderQty,
              totalAmount: data.totalAmount || 0
            };
            
            if (data.supplierName === 'Tồn kho cũ') {
              iHistory.push(entry);
            } else {
              pHistory.push(entry);
            }
          }
        });
        setPurchaseHistory(pHistory);
        setInventoryHistory(iHistory);

        // Fetch sales history
        const sq = query(
          collection(db, 'sales'),
          where('status', '==', 'completed'),
          orderBy('date', 'desc')
        );
        const sSnapshot = await getDocs(sq);
        const sHistory: any[] = [];
        let totalSold = 0;
        
        sSnapshot.docs.forEach(doc => {
          const data = doc.data();
          const matchingItems = data.items.filter((i: any) => i.productId === selectedProduct.id);
          
          matchingItems.forEach((item: any) => {
            totalSold += (item?.quantity || 0);
            sHistory.push({
              id: doc.id,
              date: data.date,
              customerName: data.customerName,
              quantity: item?.quantity || 0,
              price: item?.price || 0
            });
          });
        });
        
        setSalesHistory(sHistory);
        setTotalSoldQuantity(totalSold);
      } catch (err) {
        console.error('Error fetching history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [selectedProduct]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const sanitizedData = sanitizeData(formData);
      
      // Check if product with same name and warehouse already exists
      const q = query(
        collection(db, 'products'), 
        where('name', '==', sanitizedData.name),
        where('warehouse', '==', sanitizedData.warehouse)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        if (role === 'staff') {
          return setError('Nhân viên không có quyền chỉnh sửa sản phẩm đã có trong kho.');
        }
        
        const existingDoc = snapshot.docs[0];
        
        await runTransaction(db, async (transaction) => {
          // Re-fetch product inside transaction for consistency
          const productRef = doc(db, 'products', existingDoc.id);
          const productSnap = await transaction.get(productRef);
          if (!productSnap.exists()) throw new Error('Sản phẩm không tồn tại');
          
          const currentData = productSnap.data();
          const currentQty = currentData.stockQuantity || 0;
          const currentPrice = currentData.costPrice || 0;
          const newQty = Number(sanitizedData.stockQuantity);
          const newPrice = Number(sanitizedData.costPrice);
          
          const totalQty = currentQty + newQty;
          let newAvgPrice = currentPrice;
          
          if (totalQty > 0) {
            newAvgPrice = Math.round((currentQty * currentPrice + newQty * newPrice) / totalQty);
          } else if (newQty > 0) {
            newAvgPrice = newPrice;
          }

          transaction.update(productRef, sanitizeData({
            stockQuantity: totalQty,
            costPrice: newAvgPrice,
            sellingPrice: Number(sanitizedData.sellingPrice),
            description: sanitizedData.description || currentData.description || ''
          }));

          // Create a virtual purchase record for the added stock
          const purchaseRef = doc(collection(db, 'purchases'));
          transaction.set(purchaseRef, sanitizeData({
            date: new Date().toISOString(),
            supplierName: 'Tồn kho cũ',
            warehouse: sanitizedData.warehouse,
            status: 'completed',
            totalAmount: newQty * newPrice,
            productIds: [existingDoc.id],
            items: [{
              productId: existingDoc.id,
              productName: sanitizedData.name,
              quantity: newQty,
              remainingQuantity: newQty,
              costPrice: newPrice,
              sellingPrice: Number(sanitizedData.sellingPrice)
            }],
            createdAt: new Date().toISOString()
          }));
        });
      } else {
        // Create new product
        // Auto-generate SKU: SP + YearMonthDay + 4 random digits
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
        const autoSku = `SP-${dateStr}-${randomStr}`;

        await runTransaction(db, async (transaction) => {
          const productRef = doc(collection(db, 'products'));
          const newQty = Number(sanitizedData.stockQuantity);
          const newPrice = Number(sanitizedData.costPrice);

          transaction.set(productRef, sanitizeData({
            ...sanitizedData,
            stockQuantity: newQty,
            costPrice: newPrice,
            sellingPrice: Number(sanitizedData.sellingPrice),
            sku: autoSku,
            createdAt: new Date().toISOString()
          }));

          // Create a virtual purchase record for the new product's initial stock
          const purchaseRef = doc(collection(db, 'purchases'));
          transaction.set(purchaseRef, sanitizeData({
            date: new Date().toISOString(),
            supplierName: 'Tồn kho cũ',
            warehouse: sanitizedData.warehouse,
            status: 'completed',
            totalAmount: newQty * newPrice,
            productIds: [productRef.id],
            items: [{
              productId: productRef.id,
              productName: sanitizedData.name,
              quantity: newQty,
              remainingQuantity: newQty,
              costPrice: newPrice,
              sellingPrice: Number(sanitizedData.sellingPrice)
            }],
            createdAt: new Date().toISOString()
          }));
        });
      }
      resetForm();
    } catch (err: any) {
      console.error(err);
      setError('Có lỗi xảy ra khi lưu sản phẩm. Vui lòng kiểm tra lại quyền hạn hoặc dữ liệu.');
      if (err.message?.includes('permission')) {
        try {
          handleFirestoreError(err, OperationType.CREATE, 'products');
        } catch (e) {
          // Error already logged
        }
      }
    }
  };

  const resetForm = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
    setIsNewProduct(true);
    setIsProductDropdownOpen(false);
    setFormData({
      name: '',
      category: 'Gọng kính',
      costPrice: 0,
      sellingPrice: 0,
      warehouse: 'general',
      stockQuantity: 0,
      description: ''
    });
  };

  const handleSelectExistingProduct = (product: Product) => {
    setFormData({
      name: product.name,
      category: product.category,
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      warehouse: product.warehouse,
      stockQuantity: 0, // Reset quantity for addition
      description: product.description || ''
    });
    setIsNewProduct(false);
    setIsProductDropdownOpen(false);
  };

  const handleProductNameChange = (value: string) => {
    setFormData({ ...formData, name: value });
    setIsNewProduct(true);
    setIsProductDropdownOpen(true);
  };

  const handleUpdatePrice = async () => {
    if (!selectedProduct) return;
    try {
      const productRef = doc(db, 'products', selectedProduct.id);
      await updateDoc(productRef, {
        sellingPrice: Number(newPrice)
      });
      setSelectedProduct({ ...selectedProduct, sellingPrice: Number(newPrice) });
      setIsEditingPrice(false);
    } catch (err: any) {
      console.error('Error updating price:', err);
      setError('Không thể cập nhật giá bán.');
      handleFirestoreError(err, OperationType.UPDATE, 'products');
    }
  };

  const filteredProducts = products.filter(p => {
    // Warehouse restriction
    const isRestricted = role === 'manager' || role === 'staff';
    if (isRestricted && p.warehouse === 'main') return false;

    return (warehouseFilter === 'all' || p.warehouse === warehouseFilter) &&
      (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
       p.sku?.toLowerCase().includes(searchTerm.toLowerCase()));
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

  const statsProducts = warehouseFilter === 'all' 
    ? products 
    : products.filter(p => p.warehouse === warehouseFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kho hàng</h1>
          <p className="text-slate-500">Quản lý danh sách sản phẩm và hàng tồn kho cũ.</p>
        </div>
        <button 
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Thêm tồn kho cũ
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Tổng sản phẩm</p>
            <p className="text-2xl font-bold text-slate-900">{statsProducts.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Giá trị kho</p>
            <p className="text-2xl font-bold text-slate-900">
              {formatCurrency((() => {
                let inventoryValue = 0;
                
                statsProducts.forEach(p => {
                  let remainingInProduct = p.stockQuantity || 0;
                  let productValue = 0;
                  
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
                      productValue += count * (lot.item.costPrice || 0);
                      remainingInProduct -= count;
                    }
                  }
                  
                  // Any remaining stock (untracked) is valued at the product's average cost
                  if (remainingInProduct > 0) {
                    productValue += remainingInProduct * (p.costPrice || 0);
                  }
                  
                  inventoryValue += productValue;
                });
                
                return inventoryValue;
              })())}
            </p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Sắp hết hàng</p>
            <p className="text-2xl font-bold text-slate-900">
              {statsProducts.filter(p => (p.stockQuantity || 0) < 5).length}
            </p>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
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
            placeholder="Tìm kiếm theo tên, mã SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600">
          <Filter className="w-5 h-5" />
          Lọc
        </button>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Sản phẩm</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Phân loại</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Giá nhập bình quân</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Giá bán dự kiến</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Kho</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Số lượng trong kho</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Đang tải dữ liệu...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Không tìm thấy sản phẩm nào.</td>
                </tr>
              ) : filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-900">{product.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {product.sku}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
                      <Tag className="w-3 h-3" />
                      {product.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-600">{formatCurrency(product.costPrice)}</div>
                    <div className="text-[10px] text-slate-400 italic">Giá nhập bình quân</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-indigo-600">{formatCurrency(product.sellingPrice)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                      product.warehouse === 'main' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                    )}>
                      {product.warehouse === 'main' ? 'Kho tặng' : 'Kho bán hàng'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className={cn(
                      "text-sm font-bold",
                      (product.stockQuantity || 0) < 5 ? "text-rose-600" : "text-slate-900"
                    )}>
                      {product.stockQuantity || 0}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setSelectedProduct(product)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="Xem chi tiết"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Thêm tồn kho cũ</h2>
              <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 relative product-dropdown-container">
                  <label className="text-sm font-bold text-slate-700">Tên sản phẩm</label>
                  <div className="relative">
                    <input 
                      required
                      value={formData.name}
                      onChange={(e) => handleProductNameChange(e.target.value)}
                      onFocus={() => setIsProductDropdownOpen(true)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Tìm hoặc nhập tên sản phẩm..."
                    />
                    {isProductDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-auto">
                        {products
                          .filter(p => p.name.toLowerCase().includes(formData.name.toLowerCase()))
                          .map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectExistingProduct(p)}
                              className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm transition-colors border-b border-slate-50 last:border-0"
                            >
                              <div className="font-bold text-slate-900">{p.name}</div>
                              <div className="text-[10px] text-slate-500">SKU: {p.sku} | Kho: {p.warehouse === 'main' ? 'Tặng' : 'Bán hàng'}</div>
                            </button>
                          ))}
                        {formData.name && !products.some(p => p.name.toLowerCase() === formData.name.toLowerCase()) && (
                          <button
                            type="button"
                            onClick={() => setIsProductDropdownOpen(false)}
                            className="w-full text-left px-4 py-2 hover:bg-emerald-50 text-sm text-emerald-600 font-bold border-t border-slate-100 flex items-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Thêm mới: "{formData.name}"
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {!isNewProduct && (
                    <p className="text-[10px] text-amber-600 font-medium italic">* Đang chọn sản phẩm có sẵn. Số lượng sẽ được cộng thêm vào kho.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Phân loại</label>
                  <select 
                    disabled={!isNewProduct}
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    className={cn(
                      "w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none",
                      !isNewProduct && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <option>Gọng kính</option>
                    <option>Tròng kính</option>
                    <option>Kính râm</option>
                    <option>Phụ kiện</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Giá nhập bình quân</label>
                  <input 
                    type="number"
                    required
                    value={formData.costPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setFormData({...formData, costPrice: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Giá bán dự kiến</label>
                  <input 
                    type="number"
                    required
                    value={formData.sellingPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setFormData({...formData, sellingPrice: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Kho lưu trữ</label>
                  <select 
                    disabled={!isNewProduct || role === 'manager' || role === 'staff'}
                    value={formData.warehouse}
                    onChange={(e) => setFormData({...formData, warehouse: e.target.value as 'main' | 'general'})}
                    className={cn(
                      "w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none",
                      (!isNewProduct || role === 'manager' || role === 'staff') && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {role !== 'manager' && role !== 'staff' && <option value="main">Kho tặng</option>}
                    <option value="general">Kho bán hàng</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Số lượng trong kho</label>
                  <input 
                    type="number"
                    required
                    value={formData.stockQuantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setFormData({...formData, stockQuantity: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mô tả</label>
                <textarea 
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                  placeholder="Thông tin chi tiết về sản phẩm..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={resetForm}
                  className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="px-8 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
                >
                  Thêm vào kho
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {selectedProduct && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedProduct(null);
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Chi tiết sản phẩm</h2>
              <button onClick={() => setSelectedProduct(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border border-indigo-200 text-indigo-600 shadow-sm">
                  <Package className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">{selectedProduct.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                    <p className="text-xs text-slate-500">SKU: {selectedProduct.sku}</p>
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <p className="text-xs font-bold text-indigo-600">
                        Hàng trong kho: {selectedProduct.stockQuantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <p className="text-xs font-bold text-emerald-600">
                        Giá nhập TB: {formatCurrency(selectedProduct.costPrice)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border border-slate-100 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Phân loại</p>
                  <p className="text-sm font-bold text-slate-700">{selectedProduct.category}</p>
                </div>
                <div className="p-3 border border-slate-100 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Kho hàng</p>
                  <p className="text-sm font-bold text-slate-700">{selectedProduct.warehouse === 'main' ? 'Kho tặng' : 'Kho bán hàng'}</p>
                </div>
                <div className="p-3 border border-slate-100 rounded-xl relative group/price">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Giá bán dự kiến</p>
                  {isEditingPrice ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input 
                        type="number"
                        value={newPrice}
                        onChange={(e) => setNewPrice(Number(e.target.value))}
                        className="w-full px-2 py-1 text-sm font-bold text-indigo-600 bg-slate-50 border border-indigo-200 rounded outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdatePrice();
                          if (e.key === 'Escape') setIsEditingPrice(false);
                        }}
                      />
                      <button 
                        onClick={handleUpdatePrice}
                        className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setIsEditingPrice(false)}
                        className="p-1 text-slate-400 hover:bg-slate-50 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-indigo-600">{formatCurrency(selectedProduct.sellingPrice)}</p>
                      <button 
                        onClick={() => {
                          setNewPrice(selectedProduct.sellingPrice);
                          setIsEditingPrice(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all opacity-0 group-hover/price:opacity-100"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-3 border border-slate-100 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Số lượng bán</p>
                  <p className="text-sm font-bold text-rose-600">{totalSoldQuantity}</p>
                </div>
              </div>

              {selectedProduct.description && (
                <div className="p-3 border border-slate-100 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Mô tả</p>
                  <p className="text-sm text-slate-600">{selectedProduct.description}</p>
                </div>
              )}

              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
                {inventoryHistory.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <History className="w-5 h-5 text-amber-600" />
                      Lịch sử tồn kho
                    </h3>
                    <div className="border border-slate-100 rounded-xl overflow-hidden">
                      <div className="max-h-[200px] overflow-y-auto">
                        <table className="w-full text-left border-collapse text-sm">
                          <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                            <tr>
                              <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">Ngày</th>
                              <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">Nội dung</th>
                              <th className="px-4 py-2 font-bold text-slate-600 text-center bg-slate-50">SL SP</th>
                              <th className="px-4 py-2 font-bold text-slate-600 text-right bg-slate-50">Giá vốn TB</th>
                              <th className="px-4 py-2 font-bold text-slate-600 text-right bg-slate-50">Tổng đơn</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {inventoryHistory.map((h, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3 text-slate-600">{formatDate(h.date)}</td>
                                <td className="px-4 py-3 font-medium text-slate-700">{h.supplierName}</td>
                                <td className="px-4 py-3 text-center text-slate-600">{h.quantity}</td>
                                <td className="px-4 py-3 text-right font-bold text-amber-600">{formatCurrency(h.costPrice)}</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(h.totalAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    Lịch sử nhập hàng
                  </h3>
                  <div className="border border-slate-100 rounded-xl overflow-hidden">
                    <div className="max-h-[200px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">Ngày</th>
                            <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">NCC</th>
                            <th className="px-4 py-2 font-bold text-slate-600 text-center bg-slate-50">SL SP</th>
                            <th className="px-4 py-2 font-bold text-slate-600 text-right bg-slate-50">Giá nhập TB</th>
                            <th className="px-4 py-2 font-bold text-slate-600 text-right bg-slate-50">Tổng đơn</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {loadingHistory ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-4 text-center text-slate-400 italic">Đang tải...</td>
                            </tr>
                          ) : purchaseHistory.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-4 text-center text-slate-400 italic">Chưa có lịch sử nhập hàng</td>
                            </tr>
                          ) : purchaseHistory.map((h, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-slate-600">{formatDate(h.date)}</td>
                              <td className="px-4 py-3 font-medium text-slate-700 truncate max-w-[100px]">{h.supplierName}</td>
                              <td className="px-4 py-3 text-center text-slate-600">
                                {h.quantity}
                                <div className="text-[10px] text-slate-400">Tổng: {h.totalOrderQty}</div>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-emerald-600">{formatCurrency(h.costPrice)}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(h.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-rose-600" />
                    Lịch sử bán hàng
                  </h3>
                  <div className="border border-slate-100 rounded-xl overflow-hidden">
                    <div className="max-h-[200px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">Ngày</th>
                            <th className="px-4 py-2 font-bold text-slate-600 bg-slate-50">Khách hàng</th>
                            <th className="px-4 py-2 font-bold text-slate-600 text-center bg-slate-50">SL</th>
                            <th className="px-4 py-2 font-bold text-slate-600 text-right bg-slate-50">Giá bán</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {loadingHistory ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-4 text-center text-slate-400 italic">Đang tải...</td>
                            </tr>
                          ) : salesHistory.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-4 text-center text-slate-400 italic">Chưa có lịch sử bán hàng</td>
                            </tr>
                          ) : salesHistory.map((h, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-slate-600">{formatDate(h.date)}</td>
                              <td className="px-4 py-3 font-medium text-slate-700 truncate max-w-[100px]">{h.customerName}</td>
                              <td className="px-4 py-3 text-center text-slate-600">{h.quantity}</td>
                              <td className="px-4 py-3 text-right font-bold text-indigo-600">{formatCurrency(h.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button 
                  onClick={() => setSelectedProduct(null)}
                  className="px-6 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-6 right-6 z-[70] bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right duration-300">
          <AlertTriangle className="w-5 h-5" />
          <span className="font-medium">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
