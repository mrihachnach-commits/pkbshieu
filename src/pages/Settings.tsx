import React, { useState, useEffect, useContext } from 'react';
import { 
  Save, 
  Key, 
  Shield, 
  Zap, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { AuthContext } from '../App';
import { cn } from '../lib/utils';
import { logActivity } from '../lib/firestore-utils';
import { GoogleGenAI } from "@google/genai";

export default function Settings() {
  const { role } = useContext(AuthContext);
  const [geminiKey, setGeminiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'gemini');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setGeminiKey(docSnap.data().apiKey || '');
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'admin' && role !== 'super_admin') return;

    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'gemini'), {
        apiKey: geminiKey,
        updatedAt: new Date().toISOString()
      });
      
      logActivity(
        'update',
        'user',
        'settings',
        'Cập nhật Gemini API Key'
      );
      
      alert('Đã lưu cài đặt thành công');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Lỗi khi lưu cài đặt');
    } finally {
      setSaving(false);
    }
  };

  const testGeminiKey = async () => {
    if (!geminiKey) return;
    setTesting(true);
    setTestResult(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Hi",
      });
      
      if (response.text) {
        setTestResult({ success: true, message: 'Kết nối thành công! API Key hoạt động bình thường.' });
      } else {
        throw new Error('Không nhận được phản hồi từ AI');
      }
    } catch (error: any) {
      console.error('Gemini test error:', error);
      setTestResult({ 
        success: false, 
        message: `Lỗi kết nối: ${error.message || 'Vui lòng kiểm tra lại API Key'}` 
      });
    } finally {
      setTesting(false);
    }
  };

  if (role !== 'admin' && role !== 'super_admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8">
        <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-6">
          <Shield className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Truy cập bị từ chối</h1>
        <p className="text-slate-500 max-w-md">
          Bạn không có quyền truy cập trang cài đặt hệ thống.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Cài đặt hệ thống</h1>
        <p className="text-slate-500">Quản lý cấu hình và các tích hợp của ứng dụng.</p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Gemini API Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Cấu hình Gemini AI</h2>
                <p className="text-sm text-slate-500">Thiết lập API Key để sử dụng các tính năng thông minh.</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800">
                Nếu không nhập API Key ở đây, hệ thống sẽ sử dụng khóa mặc định. 
                Việc tự cung cấp API Key giúp bạn tránh bị giới hạn lượt dùng (Rate Limit) khi hệ thống có nhiều người truy cập.
              </p>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Gemini API Key
                </label>
                <div className="flex gap-2">
                  <input 
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Nhập API Key của bạn..."
                    className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <button 
                    type="button"
                    onClick={testGeminiKey}
                    disabled={testing || !geminiKey}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Kiểm tra
                  </button>
                </div>
              </div>

              {testResult && (
                <div className={cn(
                  "p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200",
                  testResult.success ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-rose-50 text-rose-800 border border-rose-100"
                )}>
                  {testResult.success ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  <p className="text-sm font-medium">{testResult.message}</p>
                </div>
              )}

              <div className="pt-4 flex justify-end">
                <button 
                  type="submit"
                  disabled={saving || loading}
                  className="flex items-center gap-2 px-8 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Lưu cài đặt
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Other Settings Placeholder */}
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-400 font-medium">Các cài đặt khác sẽ được cập nhật trong tương lai.</p>
        </div>
      </div>
    </div>
  );
}
