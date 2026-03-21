import React, { useState } from 'react';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { Glasses, Lock, Mail, AlertCircle, Chrome } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate('/');
    } catch (err: any) {
      console.error('Google Login Error:', err);
      setError('Đã xảy ra lỗi khi đăng nhập bằng Google: ' + (err.message || 'Vui lòng thử lại sau.'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Map "admin" to the primary admin email
      const adminEmail = 'bshieumat@gmail.com';
      const normalizedUsername = username.toLowerCase().trim();
      const emailToUse = normalizedUsername === 'admin' ? adminEmail : (username.includes('@') ? username : `${username}@admin.com`);
      
      await signInWithEmailAndPassword(auth, emailToUse, password);
      navigate('/');
    } catch (err: any) {
      console.error('Login Error:', err);
      if (err.code === 'auth/operation-not-allowed') {
        setError('Đăng nhập bằng Email/Mật khẩu chưa được bật trong Firebase Console. Vui lòng sử dụng Google Login hoặc liên hệ quản trị viên.');
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        let msg = 'Tên đăng nhập hoặc mật khẩu không chính xác. Nếu bạn vừa thiết lập hệ thống, vui lòng sử dụng Google Login.';
        if (username === 'admin') {
          msg = 'Tài khoản admin chưa được thiết lập hoặc mật khẩu sai. Vui lòng sử dụng Google Login để truy cập lần đầu.';
        }
        setError(msg);
      } else if (err.code === 'auth/too-many-requests') {
        setError('Tài khoản đã bị tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau hoặc đặt lại mật khẩu.');
      } else {
        setError('Đã xảy ra lỗi: ' + (err.message || 'Vui lòng thử lại sau.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
            <Glasses className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">OptiManager</h1>
          <p className="text-slate-500 mt-1">Hệ thống quản lý cửa hàng kính mắt</p>
        </div>

        <div className="space-y-6">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold py-3 px-4 border border-slate-200 rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            <Chrome className="w-5 h-5 text-indigo-600" />
            {loading ? 'Đang xử lý...' : 'Đăng nhập với Google'}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-400">Hoặc đăng nhập bằng tài khoản</span>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm border border-red-100 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Tên đăng nhập</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Mật khẩu</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-sm text-slate-500 italic">
            Liên hệ quản trị viên để cấp tài khoản mới.
          </p>
        </div>
      </div>
    </div>
  );
}
