import React, { useState, useEffect, useContext } from 'react';
import { 
  Search, 
  Plus,
  Phone, 
  MapPin, 
  Calendar,
  ChevronRight,
  User,
  FileText,
  X,
  History,
  Edit2
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  addDoc,
  updateDoc,
  doc,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { formatDate, cn } from '../lib/utils';
import { sanitizeData } from '../lib/firestore-utils';

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  totalSpent: number;
  lastVisit: string;
}

interface Prescription {
  id: string;
  customerId: string;
  date: string;
  od_sph: string;
  od_cyl: string;
  od_axis: string;
  od_add: string;
  os_sph: string;
  os_cyl: string;
  os_axis: string;
  os_add: string;
  pd: string;
  notes: string;
}

export default function Customers() {
  const { role } = useContext(AuthContext);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  
  // Modals
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingPrescription, setEditingPrescription] = useState<Prescription | null>(null);
  
  // Form states
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: ''
  });
  
  const [prescriptionForm, setPrescriptionForm] = useState({
    od_sph: '', od_cyl: '', od_axis: '', od_add: '',
    os_sph: '', os_cyl: '', os_axis: '', os_add: '',
    pd: '',
    notes: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'customers'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Customer[];
      setCustomers(customersData);
      if (!selectedCustomer && customersData.length > 0) {
        setSelectedCustomer(customersData[0]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setPrescriptions([]);
      return;
    }

    const q = query(
      collection(db, 'prescriptions'), 
      where('customerId', '==', selectedCustomer.id),
      orderBy('date', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPrescriptions(snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Prescription[]);
    });

    return () => unsubscribe();
  }, [selectedCustomer]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), sanitizeData(customerForm));
        setSelectedCustomer({ ...selectedCustomer!, ...customerForm });
      } else {
        const docRef = await addDoc(collection(db, 'customers'), sanitizeData({
          ...customerForm,
          totalSpent: 0,
          createdAt: new Date().toISOString()
        }));
        setSelectedCustomer({ id: docRef.id, ...customerForm, totalSpent: 0, lastVisit: '' });
      }
      setIsCustomerModalOpen(false);
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', email: '', address: '' });
    } catch (error) {
      console.error(error);
      alert('Lỗi khi lưu khách hàng');
    }
  };

  const openEditCustomer = () => {
    if (!selectedCustomer) return;
    setEditingCustomer(selectedCustomer);
    setCustomerForm({
      name: selectedCustomer.name,
      phone: selectedCustomer.phone,
      email: selectedCustomer.email || '',
      address: selectedCustomer.address || ''
    });
    setIsCustomerModalOpen(true);
  };

  const handleAddPrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    
    try {
      if (editingPrescription) {
        await updateDoc(doc(db, 'prescriptions', editingPrescription.id), sanitizeData(prescriptionForm));
      } else {
        await addDoc(collection(db, 'prescriptions'), sanitizeData({
          ...prescriptionForm,
          customerId: selectedCustomer.id,
          date: new Date().toISOString()
        }));
      }
      setIsPrescriptionModalOpen(false);
      setEditingPrescription(null);
      setPrescriptionForm({
        od_sph: '', od_cyl: '', od_axis: '', od_add: '',
        os_sph: '', os_cyl: '', os_axis: '', os_add: '',
        pd: '',
        notes: ''
      });
    } catch (error) {
      console.error(error);
      alert('Lỗi khi lưu đơn thuốc');
    }
  };

  const openEditPrescription = (p: Prescription) => {
    setEditingPrescription(p);
    setPrescriptionForm({
      od_sph: p.od_sph || '',
      od_cyl: p.od_cyl || '',
      od_axis: p.od_axis || '',
      od_add: p.od_add || '',
      os_sph: p.os_sph || '',
      os_cyl: p.os_cyl || '',
      os_axis: p.os_axis || '',
      os_add: p.os_add || '',
      pd: p.pd || '',
      notes: p.notes || ''
    });
    setIsPrescriptionModalOpen(true);
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Khách hàng</h1>
          <p className="text-slate-500">Quản lý thông tin khách hàng và đơn thuốc.</p>
        </div>
        <button 
          onClick={() => {
            setEditingCustomer(null);
            setCustomerForm({ name: '', phone: '', email: '', address: '' });
            setIsCustomerModalOpen(true);
          }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Thêm khách hàng
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Tìm kiếm theo tên hoặc số điện thoại..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Left Column: Customer List */}
        <div className="w-80 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Danh sách</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">Không tìm thấy khách hàng</div>
            ) : filteredCustomers.map(customer => (
              <button
                key={customer.id}
                onClick={() => setSelectedCustomer(customer)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 text-left border-b border-slate-50 transition-all hover:bg-slate-50",
                  selectedCustomer?.id === customer.id ? "bg-indigo-600 text-white hover:bg-indigo-600" : "text-slate-600"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0",
                  selectedCustomer?.id === customer.id ? "bg-white/20" : "bg-indigo-50 text-indigo-600"
                )}>
                  <User className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("font-bold truncate", selectedCustomer?.id === customer.id ? "text-white" : "text-slate-900")}>
                    {customer.name}
                  </p>
                  <p className={cn("text-xs truncate", selectedCustomer?.id === customer.id ? "text-white/70" : "text-slate-400")}>
                    {customer.phone}
                  </p>
                </div>
                <ChevronRight className={cn("w-4 h-4 shrink-0", selectedCustomer?.id === customer.id ? "text-white/50" : "text-slate-300")} />
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Customer Details & Prescriptions */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {selectedCustomer ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="p-8 border-b border-slate-100 flex items-start justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <h2 className="text-3xl font-bold text-slate-900">{selectedCustomer.name}</h2>
                    {role !== 'staff' && (
                      <button 
                        onClick={openEditCustomer}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Phone className="w-4 h-4 text-indigo-600" />
                      <span className="text-sm">{selectedCustomer.phone}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <MapPin className="w-4 h-4 text-indigo-600" />
                      <span className="text-sm">{selectedCustomer.address || 'Chưa cập nhật địa chỉ'}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsPrescriptionModalOpen(true)}
                  className="flex items-center gap-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-4 py-2 rounded-xl font-bold transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Đơn thuốc mới
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-5 h-5 text-indigo-600" />
                    Lịch sử đơn thuốc
                  </h3>
                  
                  {prescriptions.length === 0 ? (
                    <div className="py-20 border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                      <FileText className="w-12 h-12 mb-4 opacity-20" />
                      <p>Chưa có dữ liệu đơn thuốc</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {prescriptions.map(p => (
                        <div key={p.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                              <Calendar className="w-4 h-4 text-indigo-600" />
                              {formatDate(p.date)}
                            </div>
                            {role !== 'staff' && (
                              <button 
                                onClick={() => openEditPrescription(p)}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                title="Chỉnh sửa đơn thuốc"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-8">
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mắt Phải (OD)</p>
                              <div className="grid grid-cols-4 gap-2">
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">SPH</p>
                                  <p className="font-bold text-sm">{p.od_sph || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">CYL</p>
                                  <p className="font-bold text-sm">{p.od_cyl || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">AXIS</p>
                                  <p className="font-bold text-sm">{p.od_axis || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">ADD</p>
                                  <p className="font-bold text-sm">{p.od_add || '-'}</p>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mắt Trái (OS)</p>
                              <div className="grid grid-cols-4 gap-2">
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">SPH</p>
                                  <p className="font-bold text-sm">{p.os_sph || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">CYL</p>
                                  <p className="font-bold text-sm">{p.os_cyl || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">AXIS</p>
                                  <p className="font-bold text-sm">{p.os_axis || '-'}</p>
                                </div>
                                <div className="p-2 bg-white rounded-lg border border-slate-200 text-center">
                                  <p className="text-[10px] text-slate-400">ADD</p>
                                  <p className="font-bold text-sm">{p.os_add || '-'}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-8 pt-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-400 uppercase">Khoảng cách đồng tử (PD):</span>
                              <span className="font-bold text-indigo-600">{p.pd || '-'} mm</span>
                            </div>
                            {p.notes && (
                              <div className="flex-1 flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Ghi chú:</span>
                                <span className="text-sm text-slate-600 italic">{p.notes}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <User className="w-16 h-16 mb-4 opacity-10" />
              <p>Chọn một khách hàng để xem chi tiết</p>
            </div>
          )}
        </div>
      </div>

      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsCustomerModalOpen(false);
              setEditingCustomer(null);
            }
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {editingCustomer ? 'Chỉnh sửa khách hàng' : 'Thêm khách hàng mới'}
              </h2>
              <button 
                onClick={() => {
                  setIsCustomerModalOpen(false);
                  setEditingCustomer(null);
                }} 
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddCustomer} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Họ và tên</label>
                <input 
                  required
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({...customerForm, name: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Nhập tên khách hàng..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Số điện thoại</label>
                <input 
                  required
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({...customerForm, phone: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Nhập số điện thoại..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Email (nếu có)</label>
                <input 
                  type="email"
                  value={customerForm.email}
                  onChange={(e) => setCustomerForm({...customerForm, email: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="example@mail.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Địa chỉ</label>
                <textarea 
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({...customerForm, address: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  placeholder="Nhập địa chỉ khách hàng..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
                >
                  Lưu khách hàng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prescription Modal */}
      {isPrescriptionModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsPrescriptionModalOpen(false);
              setEditingPrescription(null);
              setPrescriptionForm({
                od_sph: '', od_cyl: '', od_axis: '', od_add: '',
                os_sph: '', os_cyl: '', os_axis: '', os_add: '',
                pd: '',
                notes: ''
              });
            }
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {editingPrescription ? 'Chỉnh sửa đơn thuốc' : 'Đơn thuốc mới'}
              </h2>
              <button 
                onClick={() => {
                  setIsPrescriptionModalOpen(false);
                  setEditingPrescription(null);
                  setPrescriptionForm({
                    od_sph: '', od_cyl: '', od_axis: '', od_add: '',
                    os_sph: '', os_cyl: '', os_axis: '', os_add: '',
                    pd: '',
                    notes: ''
                  });
                }} 
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddPrescription} className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-8">
                {/* Right Eye */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">Mắt Phải (OD)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">SPH</label>
                      <input 
                        value={prescriptionForm.od_sph}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, od_sph: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">CYL</label>
                      <input 
                        value={prescriptionForm.od_cyl}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, od_cyl: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">AXIS</label>
                      <input 
                        value={prescriptionForm.od_axis}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, od_axis: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">ADD</label>
                      <input 
                        value={prescriptionForm.od_add}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, od_add: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Left Eye */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider border-b border-indigo-100 pb-2">Mắt Trái (OS)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">SPH</label>
                      <input 
                        value={prescriptionForm.os_sph}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, os_sph: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">CYL</label>
                      <input 
                        value={prescriptionForm.os_cyl}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, os_cyl: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">AXIS</label>
                      <input 
                        value={prescriptionForm.os_axis}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, os_axis: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500">ADD</label>
                      <input 
                        value={prescriptionForm.os_add}
                        onChange={(e) => setPrescriptionForm({...prescriptionForm, os_add: e.target.value})}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">PD (mm)</label>
                  <input 
                    value={prescriptionForm.pd}
                    onChange={(e) => setPrescriptionForm({...prescriptionForm, pd: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ví dụ: 62"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-bold text-slate-500">Ghi chú</label>
                  <input 
                    value={prescriptionForm.notes}
                    onChange={(e) => setPrescriptionForm({...prescriptionForm, notes: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ghi chú thêm..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setIsPrescriptionModalOpen(false);
                    setEditingPrescription(null);
                    setPrescriptionForm({
                      od_sph: '', od_cyl: '', od_axis: '', od_add: '',
                      os_sph: '', os_cyl: '', os_axis: '', os_add: '',
                      pd: '',
                      notes: ''
                    });
                  }}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
                >
                  {editingPrescription ? 'Cập nhật đơn thuốc' : 'Lưu đơn thuốc'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
