import React, { useState, useEffect, useContext } from 'react';
import { 
  Plus, 
  Search, 
  User, 
  Shield, 
  Mail, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  CheckCircle2, 
  XCircle,
  X
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  updateDoc,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { cn } from '../lib/utils';
import { sanitizeData } from '../lib/firestore-utils';
import { AlertTriangle, RefreshCw, Key } from 'lucide-react';

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'super_admin' | 'manager' | 'staff';
  status: 'active' | 'inactive';
}

export default function Users() {
  const { role: currentUserRole } = useContext(AuthContext);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [changePasswordUser, setChangePasswordUser] = useState<UserData | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserData | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    password: '',
    role: 'staff' as 'admin' | 'super_admin' | 'manager' | 'staff',
    status: 'active' as 'active' | 'inactive'
  });

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({
        ...doc.data()
      })) as UserData[];
      setUsers(usersData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUserRole !== 'admin') return alert('Chỉ Admin mới có quyền thực hiện thao tác này');
    
    try {
      const { password, ...restData } = formData;
      
      // Auto-append @admin.com if no domain is provided
      const emailToUse = restData.email.includes('@') ? restData.email : `${restData.email}@admin.com`;
      const finalData = { ...restData, email: emailToUse };
      
      const sanitizedData = sanitizeData(finalData);
      
      if (editingUser) {
        await updateDoc(doc(db, 'users', editingUser.uid), sanitizedData);
      } else {
        if (!password || password.length < 6) {
          return alert('Mật khẩu phải có nhất 6 ký tự');
        }

        // Create user in Firebase Auth using a secondary app instance
        const secondaryApp = getApps().find(app => app.name === 'Secondary') || initializeApp(firebaseConfig, 'Secondary');
        const secondaryAuth = getAuth(secondaryApp);
        
        try {
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, emailToUse, password);
          const newUser = userCredential.user;
          
          const newUserData = {
            ...sanitizedData,
            uid: newUser.uid,
            createdAt: new Date().toISOString()
          };
          
          await setDoc(doc(db, 'users', newUser.uid), newUserData);
          
          // Sign out from secondary app to clean up
          await signOut(secondaryAuth);
        } catch (authError: any) {
          console.error('Auth Error:', authError);
          if (authError.code === 'auth/email-already-in-use') {
            alert('Email này đã được sử dụng cho một tài khoản khác');
          } else if (authError.code === 'auth/invalid-email') {
            alert('Email không hợp lệ. Vui lòng kiểm tra lại.');
          } else {
            alert('Lỗi tạo tài khoản: ' + authError.message);
          }
          return;
        }
      }
      resetForm();
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi cập nhật người dùng');
    }
  };

  const resetForm = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setDeletingUser(null);
    setFormData({
      displayName: '',
      email: '',
      password: '',
      role: 'staff',
      status: 'active'
    });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changePasswordUser || !newPassword) return;
    if (currentUserRole !== 'admin') return alert('Chỉ Admin mới có quyền thực hiện thao tác này');
    if (newPassword.length < 6) return alert('Mật khẩu phải có ít nhất 6 ký tự');

    setChangePasswordLoading(true);
    try {
      const { auth } = await import('../firebase');
      const adminToken = await auth.currentUser?.getIdToken();

      const response = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: changePasswordUser.uid,
          newPassword,
          adminToken,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        alert('Đổi mật khẩu thành công');
        setIsChangePasswordModalOpen(false);
        setNewPassword('');
        setChangePasswordUser(null);
      } else {
        alert('Lỗi: ' + (result.error || 'Không thể đổi mật khẩu'));
      }
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert('Có lỗi xảy ra khi đổi mật khẩu: ' + error.message);
    } finally {
      setChangePasswordLoading(false);
    }
  };
  const handleDelete = async () => {
    if (!deletingUser) return;
    if (currentUserRole !== 'admin') return alert('Chỉ quản trị viên mới có quyền thực hiện thao tác này');

    try {
      await deleteDoc(doc(db, 'users', deletingUser.uid));
      setDeletingUser(null);
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi xóa người dùng');
    }
  };

  const handleResetDatabase = async () => {
    if (currentUserRole !== 'admin') return;
    
    setResetLoading(true);
    try {
      const collectionsToReset = ['products', 'sales', 'purchases', 'customers', 'suppliers', 'prescriptions'];
      
      for (const collectionName of collectionsToReset) {
        console.log(`Resetting collection: ${collectionName}`);
        const snapshot = await getDocs(collection(db, collectionName));
        
        if (snapshot.empty) {
          console.log(`Collection ${collectionName} is already empty.`);
          continue;
        }

        // Firestore batches are limited to 500 operations
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach((doc) => {
            batch.delete(doc.ref);
          });
          await batch.commit();
        }
        console.log(`Successfully reset collection: ${collectionName}`);
      }
      
      alert('Đã xóa toàn bộ dữ liệu kinh doanh thành công.');
      setIsResetModalOpen(false);
    } catch (error: any) {
      console.error('Error resetting database:', error);
      let errorMessage = 'Có lỗi xảy ra khi xóa dữ liệu';
      if (error.code === 'permission-denied') {
        errorMessage = 'Bạn không có quyền xóa dữ liệu. Vui lòng kiểm tra lại quyền quản trị.';
      } else if (error.message) {
        errorMessage += ': ' + error.message;
      }
      alert(errorMessage);
    } finally {
      setResetLoading(false);
    }
  };

  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-slate-500">
        Bạn không có quyền truy cập trang này.
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    admin: 'Admin',
    super_admin: 'Quản trị viên chính',
    manager: 'Quản trị viên',
    staff: 'Nhân viên'
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Thành viên & Phân quyền</h1>
          <p className="text-slate-500">Quản lý tài khoản nhân viên và quyền truy cập hệ thống.</p>
        </div>
        <button 
          onClick={() => {
            if (currentUserRole !== 'admin') return alert('Chỉ Admin mới có quyền thêm thành viên');
            setIsModalOpen(true);
          }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100",
            currentUserRole === 'admin' ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          )}
        >
          <Plus className="w-5 h-5" />
          Thêm thành viên
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thành viên</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vai trò</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">Đang tải dữ liệu...</td>
                </tr>
              ) : users.map((user) => (
                <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
                        {user.displayName[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{user.displayName}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email.endsWith('@admin.com') ? user.email.split('@')[0] : user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
                      user.role === 'admin' ? "bg-amber-50 text-amber-700" : 
                      user.role === 'super_admin' ? "bg-purple-50 text-purple-700" :
                      user.role === 'manager' ? "bg-blue-50 text-blue-700" :
                      "bg-slate-50 text-slate-700"
                    )}>
                      <Shield className="w-3 h-3" />
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
                      user.status === 'active' ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"
                    )}>
                      {user.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {user.status === 'active' ? 'Hoạt động' : 'Tạm khóa'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {currentUserRole === 'admin' && (
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setChangePasswordUser(user);
                            setIsChangePasswordModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                          title="Đổi mật khẩu"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setFormData({
                              displayName: user.displayName || '',
                              email: user.email || '',
                              role: user.role || 'staff',
                              status: user.status || 'active'
                            });
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          title="Chỉnh sửa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeletingUser(user)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Danger Zone */}
      {currentUserRole === 'admin' && (
        <div className="mt-12 pt-8 border-t border-slate-200">
          <div className="bg-red-50 rounded-2xl border border-red-100 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-900">Vùng nguy hiểm</h3>
                <p className="text-sm text-red-700 mb-4">
                  Thao tác này sẽ xóa toàn bộ dữ liệu kinh doanh bao gồm: Sản phẩm, Đơn hàng, Nhập hàng, Khách hàng và Đơn thuốc. 
                  Dữ liệu người dùng và cài đặt hệ thống sẽ được giữ lại. Thao tác này không thể hoàn tác.
                </p>
                <button 
                  onClick={() => setIsResetModalOpen(true)}
                  className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-100"
                >
                  <RefreshCw className="w-4 h-4" />
                  Xóa toàn bộ dữ liệu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {editingUser ? 'Chỉnh sửa thành viên' : 'Thêm thành viên mới'}
              </h2>
              <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Tên hiển thị</label>
                <input 
                  required
                  value={formData.displayName}
                  onChange={(e) => setFormData({...formData, displayName: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Nguyễn Văn A"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Tên đăng nhập / Email</label>
                <input 
                  required
                  type="text"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Ví dụ: nhanvien1"
                  disabled={!!editingUser}
                />
              </div>
              {!editingUser && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Mật khẩu</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      required
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Ít nhất 6 ký tự"
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Vai trò</label>
                  <select 
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value as any})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="staff">Nhân viên</option>
                    <option value="manager">Quản trị viên</option>
                    <option value="super_admin">Quản trị viên chính</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Trạng thái</label>
                  <select 
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="active">Hoạt động</option>
                    <option value="inactive">Tạm khóa</option>
                  </select>
                </div>
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
                  {editingUser ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Change Password Modal */}
      {isChangePasswordModalOpen && changePasswordUser && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsChangePasswordModalOpen(false);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Đổi mật khẩu</h2>
              <button onClick={() => setIsChangePasswordModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="p-6 space-y-6">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
                <p className="text-sm text-slate-600">Đang đổi mật khẩu cho:</p>
                <p className="font-bold text-slate-900">{changePasswordUser.displayName} ({changePasswordUser.email})</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mật khẩu mới</label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    required
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Ít nhất 6 ký tự"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setIsChangePasswordModalOpen(false)}
                  disabled={changePasswordLoading}
                  className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  disabled={changePasswordLoading}
                  className="px-8 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-amber-100 disabled:opacity-50"
                >
                  {changePasswordLoading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isResetModalOpen && currentUserRole === 'admin' && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsResetModalOpen(false);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8" />
              <h3 className="text-xl font-bold">Xác nhận xóa dữ liệu</h3>
            </div>
            <p className="text-slate-600 mb-6">
              Bạn có chắc chắn muốn xóa <strong>TOÀN BỘ</strong> dữ liệu kinh doanh? 
              Tất cả sản phẩm, đơn hàng, khách hàng và đơn thuốc sẽ bị xóa vĩnh viễn. 
              Hành động này không thể khôi phục.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsResetModalOpen(false)}
                disabled={resetLoading}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-all disabled:opacity-50"
              >
                Hủy
              </button>
              <button 
                onClick={handleResetDatabase}
                disabled={resetLoading}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-100 disabled:opacity-50"
              >
                {resetLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Đang xóa...
                  </>
                ) : (
                  'Tôi hiểu, hãy xóa dữ liệu'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deletingUser && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingUser(null);
          }}
        >
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Xác nhận xóa</h3>
              <p className="text-slate-500">
                Bạn có chắc chắn muốn xóa thành viên <span className="font-bold text-slate-900">{deletingUser.displayName}</span>? 
                Thao tác này không thể hoàn tác.
              </p>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={() => setDeletingUser(null)}
                className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                Xóa ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
