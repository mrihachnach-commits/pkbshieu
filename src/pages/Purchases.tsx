import React, { useState, useEffect, useContext } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  Eye,
  Truck,
  Calendar,
  DollarSign,
  FileText,
  Link as LinkIcon,
  X,
  Package,
  Copy,
  User as UserIcon,
  History,
  Upload,
  ExternalLink,
  FileUp,
  Download,
  Clock,
  CheckCircle2,
  Save,
  Zap,
  Sparkles,
  FileSearch
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  getDoc,
  getDocs,
  increment,
  deleteDoc,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, uploadBytesResumable, getBytes } from 'firebase/storage';
import { AuthContext } from '../App';
import { formatCurrency, formatDate, cn, toLocalISOString } from '../lib/utils';
import { toast } from 'react-hot-toast';
import { sanitizeData, handleFirestoreError, OperationType, logActivity } from '../lib/firestore-utils';
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  costPrice: number; // This is price after tax
  sellingPrice?: number;
  priceBeforeTax?: number;
  vat?: number;
  isNew?: boolean;
  newProductData?: any;
}

interface Purchase {
  id: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  totalAmount: number;
  invoiceUrl: string;
  date: any;
  createdBy: string;
  createdByName: string;
  status?: 'completed' | 'cancelled';
  history?: any[];
}

export default function Purchases() {
  const { user, role } = useContext(AuthContext);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'main' | 'general'>('all');
  const [deletingPurchase, setDeletingPurchase] = useState<Purchase | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<string | null>(null);
  const [detailThumbnails, setDetailThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null);

  // Fetch Gemini API Key from settings
  useEffect(() => {
    const fetchGeminiKey = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'gemini'));
        if (docSnap.exists()) {
          setGeminiApiKey(docSnap.data().apiKey || null);
        }
      } catch (error) {
        console.error('Error fetching Gemini API key:', error);
      }
    };
    fetchGeminiKey();
  }, []);

  // Generate thumbnails for selected purchase
  useEffect(() => {
    if (!selectedPurchase?.invoiceUrl) {
      setDetailThumbnails([]);
      return;
    }

    const generateThumbnails = async () => {
      // Only generate if it's a PDF and not already images
      if (!selectedPurchase.invoiceUrl.toLowerCase().endsWith('.pdf') && 
          !selectedPurchase.invoiceUrl.includes('application/pdf') &&
          !selectedPurchase.invoiceUrl.includes('blob:')) {
        return;
      }

      setIsGeneratingThumbnails(true);
      try {
        // Optimization for Cloudinary: Use Cloudinary's built-in PDF-to-Image transformation
        if (selectedPurchase.invoiceUrl.includes('res.cloudinary.com')) {
          const urlParts = selectedPurchase.invoiceUrl.split('/upload/');
          if (urlParts.length === 2) {
            const baseUrl = urlParts[0] + '/upload/';
            const publicId = urlParts[1];
            const images: string[] = [];
            // Generate thumbnails for first 10 pages using Cloudinary
            for (let i = 1; i <= 10; i++) {
              // Replace extension with .jpg and add page transformation
              const thumbUrl = `${baseUrl}pg_${i},w_800,c_limit/${publicId.replace(/\.[^/.]+$/, "")}.jpg`;
              images.push(thumbUrl);
            }
            setDetailThumbnails(images);
            setIsGeneratingThumbnails(false);
            return;
          }
        }

        let arrayBuffer: ArrayBuffer;

        // If it's a Firebase Storage URL, use the SDK to get the data (handles auth automatically)
        if (selectedPurchase.invoiceUrl.includes('firebasestorage.googleapis.com')) {
          try {
            const storageRef = ref(storage, selectedPurchase.invoiceUrl);
            arrayBuffer = await getBytes(storageRef);
          } catch (storageError) {
            console.warn('Firebase Storage getBytes failed, falling back to fetch:', storageError);
            const response = await fetch(selectedPurchase.invoiceUrl);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            arrayBuffer = await response.arrayBuffer();
          }
        } else {
          const response = await fetch(selectedPurchase.invoiceUrl);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          arrayBuffer = await response.arrayBuffer();
        }
        
        if (arrayBuffer.byteLength === 0) {
          setDetailThumbnails([]);
          return;
        }

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const images: string[] = [];

        for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) { // Limit to first 5 pages for performance
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page.render({ 
              canvasContext: context, 
              viewport,
              // @ts-ignore
              canvas: canvas
            }).promise;
            images.push(canvas.toDataURL('image/jpeg', 0.7));
          }
        }
        setDetailThumbnails(images);
      } catch (error) {
        console.error('Error generating thumbnails for details:', error);
      } finally {
        setIsGeneratingThumbnails(false);
      }
    };

    generateThumbnails();
  }, [selectedPurchase]);

  // Form state
  const [supplierName, setSupplierName] = useState('');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [invoiceImages, setInvoiceImages] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedWarehouse, setSelectedWarehouse] = useState<'main' | 'general'>('general');
  const [selectedItems, setSelectedItems] = useState<PurchaseItem[]>([]);

  const [purchaseDate, setPurchaseDate] = useState(toLocalISOString());
  const [products, setProducts] = useState<any[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    category: 'Gọng kính',
    costPrice: 0,
    sellingPrice: 0,
    vat: 8
  });

  useEffect(() => {
    if (!isModalOpen) return;
    // Only clear if we are NOT editing, or if we want to force re-selection on warehouse change
    if (!editingPurchase) {
      setSelectedItems([]);
    }
  }, [selectedWarehouse]);

  useEffect(() => {
    let q = query(collection(db, 'purchases'), orderBy('date', 'desc'));
    if (role === 'manager' || role === 'staff') {
      q = query(q, where('warehouse', '==', 'general'));
    }
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const purchasesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Purchase[];
      setPurchases(purchasesData);
      setLoading(false);
    });

    let productsQuery = query(collection(db, 'products'));
    if (role === 'manager' || role === 'staff') {
      productsQuery = query(productsQuery, where('warehouse', '==', 'general'));
    }
    const unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeSuppliers = onSnapshot(collection(db, 'suppliers'), (snapshot) => {
      setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribe();
      unsubscribeProducts();
      unsubscribeSuppliers();
    };
  }, []);

  const handleCreatePurchase = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (selectedItems.length === 0) return alert('Vui lòng chọn ít nhất 1 sản phẩm');

    try {
      let finalInvoiceUrl = invoiceUrl;

      // 0. Upload file to Cloudinary or Firebase Storage if selected
      if (selectedFile) {
        setIsUploading(true);
        setUploadProgress(0);
        try {
          const cloudinaryCloudName = (import.meta as any).env.VITE_CLOUDINARY_CLOUD_NAME;
          const cloudinaryUploadPreset = (import.meta as any).env.VITE_CLOUDINARY_UPLOAD_PRESET;

          if (cloudinaryCloudName && cloudinaryUploadPreset) {
            // Use Cloudinary with XMLHttpRequest for progress tracking
            finalInvoiceUrl = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              const formData = new FormData();
              formData.append('file', selectedFile);
              formData.append('upload_preset', cloudinaryUploadPreset);
              formData.append('resource_type', 'auto');

              xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/upload`, true);

              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  const percent = Math.round((e.loaded / e.total) * 100);
                  setUploadProgress(percent);
                }
              };

              xhr.onload = () => {
                if (xhr.status === 200) {
                  const data = JSON.parse(xhr.responseText);
                  resolve(data.secure_url);
                } else {
                  try {
                    const errorData = JSON.parse(xhr.responseText);
                    const msg = errorData.error?.message || 'Lỗi khi tải lên Cloudinary';
                    
                    // If it's a configuration error, we might want to fallback or inform specifically
                    if (msg.toLowerCase().includes('unsigned uploads') || msg.toLowerCase().includes('unsigned upload')) {
                      reject(new Error('CLOUDINARY_UNSIGNED_ERROR'));
                    } else {
                      reject(new Error(msg));
                    }
                  } catch (e) {
                    reject(new Error(`Lỗi Cloudinary (Status ${xhr.status}): Vui lòng kiểm tra Cloud Name và Upload Preset.`));
                  }
                }
              };

              xhr.onerror = () => reject(new Error('Lỗi kết nối mạng khi tải lên Cloudinary. Vui lòng kiểm tra lại cấu hình hoặc kết nối.'));
              xhr.send(formData);
            });
          } else {
            const missing = [];
            if (!cloudinaryCloudName) missing.push('VITE_CLOUDINARY_CLOUD_NAME');
            if (!cloudinaryUploadPreset) missing.push('VITE_CLOUDINARY_UPLOAD_PRESET');
            throw new Error(`MISSING_CONFIG: ${missing.join(', ')}`);
          }
        } catch (storageError: any) {
          console.error('Error uploading to Cloudinary:', storageError);
          
          // Fallback to Firebase Storage if Cloudinary fails or is missing
          if (storageError.message.startsWith('MISSING_CONFIG') || storageError.message === 'CLOUDINARY_UNSIGNED_ERROR' || storageError.message.includes('Lỗi khi tải lên Cloudinary')) {
            try {
              console.log('Falling back to Firebase Storage...');
              const storageRef = ref(storage, `invoices/${Date.now()}_${selectedFile.name}`);
              const uploadTask = uploadBytesResumable(storageRef, selectedFile);
              
              finalInvoiceUrl = await new Promise((resolve, reject) => {
                uploadTask.on('state_changed', 
                  (snapshot) => {
                    const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    setUploadProgress(progress);
                  },
                  (error) => reject(error),
                  async () => {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    resolve(downloadURL);
                  }
                );
              });

              if (storageError.message.startsWith('MISSING_CONFIG')) {
                const vars = storageError.message.split(': ')[1];
                toast.error(`Thiếu cấu hình Cloudinary (${vars}). Đã tự động chuyển sang Firebase.`);
              } else if (storageError.message === 'CLOUDINARY_UNSIGNED_ERROR') {
                toast.error('Cloudinary chưa được thiết lập "Unsigned". Đã tự động chuyển sang Firebase.');
              }
            } catch (firebaseError: any) {
              console.error('Firebase fallback failed:', firebaseError);
              if (storageError.message.startsWith('MISSING_CONFIG')) {
                const vars = storageError.message.split(': ')[1];
                throw new Error(`Lỗi: Thiếu biến môi trường ${vars} trên Vercel. Vui lòng thêm vào Settings > Environment Variables.`);
              }
              if (storageError.message === 'CLOUDINARY_UNSIGNED_ERROR') {
                throw new Error('Lỗi Cloudinary: Upload Preset phải được thiết lập là "Unsigned" trong cài đặt Cloudinary.');
              }
              throw new Error('Không thể tải hóa đơn lên cả Cloudinary và Firebase. Vui lòng kiểm tra cấu hình Vercel.');
            }
          } else {
            throw storageError;
          }
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      }

      // 1. Pre-process items: Handle new products and resolve existing ones OUTSIDE transaction
      const finalItems = [];
      const newProductsToCreate: { ref: any, data: any }[] = [];
      const newProductIdsSet = new Set<string>();
      const newProductMap = new Map<string, string>();

      for (const item of selectedItems) {
        if (item.isNew) {
          // Check if we already prepared this new product in this loop
          if (newProductMap.has(item.productName)) {
            const productId = newProductMap.get(item.productName)!;
            finalItems.push({
              productId: productId,
              productName: item.productName,
              quantity: Number(item.quantity),
              remainingQuantity: Number(item.quantity),
              costPrice: Number(item.costPrice),
              sellingPrice: Number(item.sellingPrice || 0),
              priceBeforeTax: Number(item.priceBeforeTax || Math.round(item.costPrice / (1 + (item.vat || 8) / 100))),
              vat: Number(item.vat || 8)
            });
            continue;
          }

          // Check if product with same name and warehouse already exists in DB
          const existingProductQuery = query(
            collection(db, 'products'),
            where('name', '==', item.productName),
            where('warehouse', '==', selectedWarehouse)
          );
          const existingProductSnap = await getDocs(existingProductQuery);

          if (!existingProductSnap.empty) {
            // Use existing product instead of creating new
            const existingDoc = existingProductSnap.docs[0];
            const productId = existingDoc.id;
            newProductMap.set(item.productName, productId);
            
            finalItems.push({
              productId: productId,
              productName: item.productName,
              quantity: Number(item.quantity),
              remainingQuantity: Number(item.quantity),
              costPrice: Number(item.costPrice),
              sellingPrice: Number(item.sellingPrice || 0),
              priceBeforeTax: Number(item.priceBeforeTax || Math.round(item.costPrice / (1 + (item.vat || 8) / 100))),
              vat: Number(item.vat || 8)
            });
          } else {
            // Prepare new product creation
            const productRef = doc(collection(db, 'products'));
            const productId = productRef.id;
            newProductMap.set(item.productName, productId);
            
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
            const autoSku = `SP-${dateStr}-${randomStr}`;

            const productData = {
              ...item.newProductData,
              sellingPrice: Number(item.sellingPrice || 0),
              sku: autoSku,
              warehouse: selectedWarehouse,
              stockQuantity: 0,
              createdAt: new Date().toISOString()
            };

            newProductsToCreate.push({ ref: productRef, data: productData });
            newProductIdsSet.add(productId);
            
            finalItems.push({
              productId: productId,
              productName: item.productName,
              quantity: Number(item.quantity),
              remainingQuantity: Number(item.quantity),
              costPrice: Number(item.costPrice),
              sellingPrice: Number(item.sellingPrice || 0),
              priceBeforeTax: Number(item.priceBeforeTax || Math.round(item.costPrice / (1 + (item.vat || 8) / 100))),
              vat: Number(item.vat || 8)
            });
          }
        } else {
          finalItems.push({
            productId: item.productId,
            productName: item.productName,
            quantity: Number(item.quantity),
            remainingQuantity: Number(item.quantity),
            costPrice: Number(item.costPrice),
            sellingPrice: Number(item.sellingPrice || 0),
            priceBeforeTax: Number(item.priceBeforeTax || Math.round(item.costPrice / (1 + (item.vat || 8) / 100))),
            vat: Number(item.vat || 8)
          });
        }
      }

      // 2. Run Transaction for atomic updates
      await runTransaction(db, async (transaction) => {
        // Collect all unique product IDs involved
        const allProductIds = new Set([
          ...finalItems.map(i => i.productId),
          ...(editingPurchase?.items.map(i => i.productId) || [])
        ]);

        // 1. PERFORM ALL READS FIRST
        const productSnapshots = new Map<string, any>();
        for (const pid of allProductIds) {
          const productRef = doc(db, 'products', pid);
          const productSnap = await transaction.get(productRef);
          if (productSnap.exists()) {
            productSnapshots.set(pid, productSnap.data());
          }
        }

        // 2. PERFORM ALL WRITES SECOND
        // Create new products first (with 0 stock)
        for (const np of newProductsToCreate) {
          transaction.set(np.ref, sanitizeData(np.data));
        }

        const totalAmount = finalItems.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
        const productIds = finalItems.map(i => i.productId);

        const purchaseData: any = {
          supplierName,
          invoiceUrl: finalInvoiceUrl,
          warehouse: selectedWarehouse,
          items: finalItems,
          productIds,
          totalAmount,
          date: new Date(purchaseDate).toISOString(),
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email,
          status: 'completed'
        };

        // Group items by productId for WAC calculation
        const itemsByProduct = new Map<string, { quantity: number, totalCost: number, sellingPrice?: number }>();
        for (const item of finalItems) {
          const current = itemsByProduct.get(item.productId) || { quantity: 0, totalCost: 0 };
          itemsByProduct.set(item.productId, {
            quantity: current.quantity + Number(item.quantity),
            totalCost: current.totalCost + (Number(item.costPrice) * Number(item.quantity)),
            sellingPrice: item.sellingPrice
          });
        }

        if (editingPurchase) {
          const isRestricted = role === 'manager' || role === 'staff';
          if (isRestricted && editingPurchase.warehouse === 'main') {
            throw new Error('Bạn không có quyền chỉnh sửa đơn nhập hàng từ kho này');
          }
          if (role === 'staff') {
            throw new Error('Nhân viên không có quyền chỉnh sửa đơn nhập hàng');
          }

          // Group old items for subtraction
          const oldItemsByProduct = new Map<string, { quantity: number, totalCost: number, sellingPrice?: number }>();
          for (const item of editingPurchase.items) {
            const current = oldItemsByProduct.get(item.productId) || { quantity: 0, totalCost: 0 };
            oldItemsByProduct.set(item.productId, {
              quantity: current.quantity + Number(item.quantity),
              totalCost: current.totalCost + (Number(item.costPrice) * Number(item.quantity)),
              sellingPrice: item.sellingPrice
            });
          }

          // Process all products involved in the edit
          const allPids = new Set([...itemsByProduct.keys(), ...oldItemsByProduct.keys()]);

          for (const pid of allPids) {
            const productRef = doc(db, 'products', pid);
            const productData = productSnapshots.get(pid);
            const oldBatch = oldItemsByProduct.get(pid) || { quantity: 0, totalCost: 0 };
            const newBatch = itemsByProduct.get(pid) || { quantity: 0, totalCost: 0 };
            
            const currentDbQty = productData ? (productData.stockQuantity || 0) : 0;
            const currentDbPrice = productData ? (productData.costPrice || 0) : 0;
            
            // 1. "Undo" the old purchase to get the state before it
            const qtyBeforeOld = Math.max(0, currentDbQty - oldBatch.quantity);
            const valueBeforeOld = Math.max(0, (currentDbQty * currentDbPrice) - oldBatch.totalCost);
            const priceBeforeOld = qtyBeforeOld > 0 ? valueBeforeOld / qtyBeforeOld : 0;
            
            // 2. Apply the new purchase to the "before" state
            const finalQty = qtyBeforeOld + newBatch.quantity;
            let finalAvgPrice = priceBeforeOld;
            
            if (finalQty > 0) {
              finalAvgPrice = Math.round((qtyBeforeOld * priceBeforeOld + newBatch.totalCost) / finalQty);
            } else if (newBatch.quantity > 0) {
              finalAvgPrice = Math.round(newBatch.totalCost / newBatch.quantity);
            }

            transaction.update(productRef, {
              stockQuantity: finalQty,
              costPrice: finalAvgPrice,
              sellingPrice: newBatch.sellingPrice || (productData ? productData.sellingPrice : 0)
            });
          }

          purchaseData.history = [
            ...(editingPurchase.history || []),
            {
              action: 'update',
              date: new Date().toISOString(),
              userName: user?.displayName || user?.email,
              details: 'Cập nhật đơn nhập hàng (Sử dụng Giá vốn bình quân gia quyền)'
            }
          ];
          
          transaction.update(doc(db, 'purchases', editingPurchase.id), sanitizeData(purchaseData));
          
          // Log activity
          logActivity(
            'update',
            'purchase',
            editingPurchase.id,
            `Cập nhật đơn nhập hàng từ ${supplierName} - Tổng tiền: ${formatCurrency(totalAmount)}`,
            { supplierName, totalAmount, warehouse: selectedWarehouse }
          );
        } else {
          // New Purchase - Cộng số lượng mới và tính lại giá vốn bình quân
          for (const [pid, batch] of itemsByProduct.entries()) {
            const productRef = doc(db, 'products', pid);
            const productData = productSnapshots.get(pid);
            
            const currentQty = productData ? (productData.stockQuantity || 0) : 0;
            const currentPrice = productData ? (productData.costPrice || 0) : 0;
            
            const totalQty = currentQty + batch.quantity;
            let newAvgPrice = currentPrice;
            
            if (totalQty > 0) {
              newAvgPrice = Math.round((currentQty * currentPrice + batch.totalCost) / totalQty);
            } else if (batch.quantity > 0) {
              newAvgPrice = Math.round(batch.totalCost / batch.quantity);
            }

            transaction.update(productRef, {
              stockQuantity: totalQty,
              costPrice: newAvgPrice,
              sellingPrice: batch.sellingPrice || (productData ? productData.sellingPrice : 0)
            });
          }

          purchaseData.history = [{
            action: 'create',
            date: new Date().toISOString(),
            userName: user?.displayName || user?.email,
            details: 'Tạo mới đơn nhập hàng (Tính Giá vốn bình quân)'
          }];
          
          const purchaseRef = doc(collection(db, 'purchases'));
          transaction.set(purchaseRef, sanitizeData(purchaseData));
          
          // Log activity
          logActivity(
            'create',
            'purchase',
            purchaseRef.id,
            `Tạo mới đơn nhập hàng từ ${supplierName} - Tổng tiền: ${formatCurrency(totalAmount)}`,
            { supplierName, totalAmount, warehouse: selectedWarehouse }
          );
        }
      });

      resetForm();
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi lưu đơn nhập hàng: ' + (error instanceof Error ? error.message : 'Lỗi không xác định'));
    }
  };

  const handleDeletePurchase = async () => {
    if (!deletingPurchase) return;
    
    const isRestricted = role === 'manager' || role === 'staff';
    if (isRestricted && deletingPurchase.warehouse === 'main') {
      setDeletingPurchase(null);
      return alert('Bạn không có quyền xóa đơn nhập hàng từ kho này');
    }
    
    if (role === 'staff') {
      setDeletingPurchase(null);
      return alert('Nhân viên không có quyền xóa đơn nhập hàng');
    }

    try {
      await runTransaction(db, async (transaction) => {
        // Fetch current products and check if total stock is enough
        const productSnapshots: { [key: string]: any } = {};
        for (const item of deletingPurchase.items) {
          const snap = await transaction.get(doc(db, 'products', item.productId));
          if (snap.exists()) {
            const productData = snap.data();
            productSnapshots[item.productId] = productData;
            
            // Check if total stock is enough to subtract the purchase quantity
            if (productData.stockQuantity < item.quantity) {
              throw new Error(`Không thể xóa đơn nhập hàng vì tổng tồn kho của ${item.productName} (${productData.stockQuantity}) ít hơn số lượng cần xóa (${item.quantity}).`);
            }
          } else {
            throw new Error(`Sản phẩm ${item.productName} không tồn tại trong kho.`);
          }
        }

        // Subtract stock from warehouse
        for (const item of deletingPurchase.items) {
          transaction.update(doc(db, 'products', item.productId), {
            stockQuantity: increment(-Number(item.quantity))
          });
        }

        // Delete the document
        transaction.delete(doc(db, 'purchases', deletingPurchase.id));
        
        // Log activity
        logActivity(
          'delete',
          'purchase',
          deletingPurchase.id,
          `Xóa đơn nhập hàng từ ${deletingPurchase.supplierName} - Tổng tiền: ${formatCurrency(deletingPurchase.totalAmount)}`,
          { supplierName: deletingPurchase.supplierName, totalAmount: deletingPurchase.totalAmount, warehouse: deletingPurchase.warehouse }
        );
      });
      
      setDeletingPurchase(null);
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi xóa đơn nhập hàng: ' + (error instanceof Error ? error.message : 'Lỗi không xác định'));
    }
  };

  const handleCreateNewProduct = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Generate a temporary ID for the UI list
    const tempId = 'new_' + Math.random().toString(36).substr(2, 9);
    
    const newItem: PurchaseItem = {
      productId: tempId,
      productName: newProduct.name,
      quantity: 1,
      costPrice: newProduct.costPrice,
      sellingPrice: newProduct.sellingPrice,
      priceBeforeTax: Math.round(newProduct.costPrice / (1 + newProduct.vat / 100)),
      vat: newProduct.vat,
      isNew: true,
      newProductData: {
        ...newProduct,
        createdAt: new Date().toISOString()
      }
    };

    setSelectedItems([...selectedItems, newItem]);
    setIsNewProductModalOpen(false);
    setNewProduct({
      name: '',
      category: 'Gọng kính',
      costPrice: 0,
      sellingPrice: 0,
      vat: 8
    });
  };

  const handleCreateNewSupplier = async (name: string) => {
    try {
      await addDoc(collection(db, 'suppliers'), {
        name,
        createdAt: new Date().toISOString()
      });
      setSupplierName(name);
      setIsSupplierDropdownOpen(false);
    } catch (error) {
      console.error(error);
      alert('Lỗi khi thêm nhà cung cấp mới');
    }
  };

  const resetForm = () => {
    setIsModalOpen(false);
    setEditingPurchase(null);
    setSupplierName('');
    setInvoiceUrl('');
    setSelectedWarehouse('general');
    setSelectedItems([]);
    setPurchaseDate(toLocalISOString());
    setProductSearchTerm('');
    setSelectedFile(null);
    setInvoiceImages([]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Vui lòng chỉ tải lên tệp PDF');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      alert('Kích thước tệp quá lớn (tối đa 10MB). Vui lòng chọn tệp khác.');
      return;
    }

    if (file.size === 0) {
      alert('Tệp này trống (0 bytes). Vui lòng chọn tệp khác.');
      return;
    }

    setSelectedFile(file);
    setInvoiceUrl('');
    setInvoiceImages([]);

    // Convert PDF to Images
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          await page.render({ 
            canvasContext: context, 
            viewport,
            // @ts-ignore - some versions require canvas property
            canvas: canvas 
          }).promise;
          images.push(canvas.toDataURL('image/jpeg', 0.8));
        }
      }
      setInvoiceImages(images);
    } catch (error) {
      console.error('Error converting PDF to images:', error);
      alert('Không thể đọc tệp PDF. Vui lòng thử lại.');
    }
  };

  const scanInvoice = async () => {
    if (invoiceImages.length === 0) return;
    
    setIsScanning(true);
    try {
      const apiKeyToUse = geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKeyToUse) {
        throw new Error('Chưa cấu hình Gemini API Key. Vui lòng vào phần Cài đặt để thiết lập.');
      }
      const ai = new GoogleGenAI({ apiKey: apiKeyToUse });
      
      const imageParts = invoiceImages.map(img => ({
        inlineData: {
          data: img.split(',')[1],
          mimeType: 'image/jpeg'
        }
      }));

      const prompt = `Trích xuất danh sách sản phẩm từ hóa đơn này. 
      QUY TẮC GỘP:
      - Gộp các sản phẩm có cùng tên chung (ví dụ: "Gọng kính đeo mắt KAIZEN"). 
      - BỎ QUA các mã hàng (ví dụ: 17663, 18929...) hoặc mã số (ví dụ: B3243, V8266...) khi so sánh tên.
      - Nếu cùng tên nhưng KHÁC GIÁ: để riêng thành các dòng khác nhau.
      - Nếu cùng tên và CÙNG GIÁ: gộp chung và cộng dồn số lượng.
      - Trả về JSON array: [{productName, quantity, costPrice (giá sau thuế), vat (%), priceBeforeTax (giá trước thuế)}].
      - costPrice, priceBeforeTax, quantity phải là số.
      - Tên sản phẩm sau khi gộp nên là tên chung nhất.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [...imageParts, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                productName: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                costPrice: { type: Type.NUMBER },
                vat: { type: Type.NUMBER },
                priceBeforeTax: { type: Type.NUMBER }
              },
              required: ["productName", "quantity", "costPrice", "vat", "priceBeforeTax"]
            }
          }
        }
      });

      const result = JSON.parse(response.text);
      
      const mappedItems = result.map((item: any, idx: number) => ({
        productId: `temp-${Date.now()}-${idx}`,
        productName: item.productName,
        quantity: item.quantity,
        costPrice: item.costPrice,
        priceBeforeTax: item.priceBeforeTax,
        vat: item.vat,
        isNew: true,
        newProductData: {
          name: item.productName,
          category: 'Gọng kính',
          costPrice: item.costPrice,
          sellingPrice: Math.round(item.costPrice * 1.5), // Default markup
          vat: item.vat
        }
      }));

      setSelectedItems(mappedItems);
      
      // Try to extract supplier name
      const supplierPrompt = "Trích xuất tên đơn vị bán hàng (nhà cung cấp) từ hóa đơn này. Trả về duy nhất tên công ty.";
      const supplierResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [...imageParts, { text: supplierPrompt }] }]
      });
      if (supplierResponse.text) {
        setSupplierName(supplierResponse.text.trim());
      }

      alert('Đã quét hóa đơn và gộp sản phẩm thành công!');
    } catch (error) {
      console.error('AI Scan error:', error);
      alert('Có lỗi khi quét hóa đơn bằng AI. Vui lòng kiểm tra lại.');
    } finally {
      setIsScanning(false);
    }
  };

  const addItem = (product: any) => {
    const existing = selectedItems.find(item => item.productId === product.id);
    const productVat = product.vat || 8;
    if (existing) {
      setSelectedItems(selectedItems.map(item => 
        item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
      ));
    } else {
      setSelectedItems([...selectedItems, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        costPrice: product.costPrice || 0,
        sellingPrice: product.sellingPrice || 0,
        priceBeforeTax: product.costPrice ? Math.round(product.costPrice / (1 + productVat / 100)) : 0,
        vat: productVat
      }]);
    }
  };

  const filteredPurchases = purchases.filter(p => {
    // Warehouse restriction
    const isRestricted = role === 'manager' || role === 'staff';
    if (isRestricted && p.warehouse === 'main') return false;

    const matchesWarehouse = warehouseFilter === 'all' ? true : 
                            (p.warehouse === warehouseFilter || (warehouseFilter === 'main' && !p.warehouse));
    const matchesSearch = p.supplierName.toLowerCase().includes(searchTerm.toLowerCase());
    
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

  const filteredProducts = products.filter(p => 
    (p.name.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(productSearchTerm.toLowerCase())) &&
    p.warehouse === selectedWarehouse
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nhập hàng</h1>
          <p className="text-slate-500">Quản lý các đơn nhập hàng từ nhà cung cấp.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Nhập hàng mới
        </button>
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
            placeholder="Tìm kiếm theo nhà cung cấp..."
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

      {/* Purchases Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày nhập</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nhà cung cấp</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Sản phẩm</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng tiền</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Hóa đơn</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Đang tải dữ liệu...</td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Không tìm thấy đơn nhập hàng nào.</td>
                </tr>
              ) : filteredPurchases.map((purchase) => (
                <tr key={purchase.id} className={cn(
                  "hover:bg-slate-50/50 transition-colors group",
                  purchase.status === 'cancelled' && "opacity-50 grayscale"
                )}>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-900">{formatDate(purchase.date)}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      {purchase.createdByName}
                      {purchase.status === 'cancelled' && (
                        <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded text-[10px] font-bold uppercase">Đã hủy</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-900">{purchase.supplierName}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-600">
                      {purchase.items.length} sản phẩm
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-rose-600">{formatCurrency(purchase.totalAmount)}</div>
                  </td>
                  <td className="px-6 py-4">
                    {purchase.invoiceUrl ? (
                      <button 
                        onClick={() => setViewingInvoice(purchase.invoiceUrl)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline"
                      >
                        <FileText className="w-3 h-3" />
                        Xem hóa đơn
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Không có</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setSelectedPurchase(purchase)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="Xem chi tiết"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {role !== 'staff' && (
                        <>
                          <button 
                            onClick={() => {
                              setEditingPurchase(purchase);
                              setSupplierName(purchase.supplierName);
                              setInvoiceUrl(purchase.invoiceUrl || '');
                              // Deep copy items to prevent modifying editingPurchase.items in real-time
                              setSelectedItems(purchase.items.map(item => ({ ...item })));
                              setSelectedWarehouse(purchase.warehouse || 'main');
                              setPurchaseDate(toLocalISOString(purchase.date));
                              setIsModalOpen(true);
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setDeletingPurchase(purchase)}
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

      {/* Modal */}
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
                  {editingPurchase ? 'Chỉnh sửa đơn nhập' : 'Nhập hàng mới'}
                </h2>
                <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <input 
                    type="datetime-local"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="bg-transparent text-sm font-medium text-slate-600 outline-none"
                  />
                </div>
              </div>
              <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreatePurchase} className="flex-1 overflow-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                {/* 1. Kho nhập hàng */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Kho nhập hàng</label>
                  <select 
                    disabled={!!editingPurchase || role === 'manager' || role === 'staff'}
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value as 'main' | 'general')}
                    className={cn(
                      "w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none",
                      (editingPurchase || role === 'manager' || role === 'staff') && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <option value="general">Kho bán hàng</option>
                    {role !== 'manager' && role !== 'staff' && <option value="main">Kho tặng</option>}
                  </select>
                  {editingPurchase && (
                    <p className="text-[10px] text-amber-600 font-medium italic">* Không thể đổi kho khi đang sửa đơn nhập</p>
                  )}
                </div>

                {/* 2. Hóa đơn đỏ */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Hóa đơn đỏ (PDF)</label>
                  <div className="space-y-3">
                    <div className="relative">
                      <input 
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileChange}
                        className="hidden"
                        id="invoice-upload"
                      />
                      <label 
                        htmlFor="invoice-upload"
                        className={cn(
                          "flex items-center justify-center gap-2 w-full px-4 py-3 border border-dashed rounded-xl cursor-pointer transition-all text-sm font-bold",
                          selectedFile || invoiceUrl 
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" 
                            : "border-slate-200 bg-slate-50 text-slate-500 hover:border-indigo-300 hover:bg-indigo-50"
                        )}
                      >
                        {selectedFile ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                          </>
                        ) : invoiceUrl ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            Đã chọn hóa đơn
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 text-slate-400" />
                            Chọn PDF hóa đơn
                          </>
                        )}
                      </label>
                    </div>

                    {(invoiceImages.length > 0 || selectedFile || invoiceUrl) && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <div className="flex items-center gap-2">
                            {invoiceImages.length > 0 && (
                              <button
                                type="button"
                                onClick={scanInvoice}
                                disabled={isScanning}
                                className={cn(
                                  "flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm",
                                  isScanning && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                {isScanning ? (
                                  <>
                                    <Clock className="w-3 h-3 animate-spin" />
                                    Đang quét...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-3 h-3" />
                                    Quét AI
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          <div className="flex gap-1">
                            {(selectedFile || invoiceUrl) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (selectedFile) {
                                      const url = URL.createObjectURL(selectedFile);
                                      window.open(url, '_blank');
                                    } else if (invoiceUrl) {
                                      window.open(invoiceUrl, '_blank');
                                    }
                                  }}
                                  className="p-2 text-indigo-600 bg-white border border-slate-100 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm"
                                  title="Xem trước"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedFile(null);
                                    setInvoiceUrl('');
                                    setInvoiceImages([]);
                                  }}
                                  className="p-2 text-rose-600 bg-white border border-slate-100 rounded-lg hover:bg-rose-50 transition-colors shadow-sm"
                                  title="Xóa"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <input 
                      type="text"
                      placeholder="Hoặc dán link hóa đơn đỏ tại đây..."
                      value={invoiceUrl}
                      onChange={(e) => setInvoiceUrl(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-indigo-500 italic text-slate-500"
                    />
                  </div>
                  {invoiceUrl && !invoiceUrl.startsWith('data:application/pdf') && !invoiceUrl.startsWith('http') && (
                    <p className="text-[10px] text-amber-600 italic">Lưu ý: Link cũ có thể không xem được trực tiếp. Dung lượng tối đa: 10MB.</p>
                  )}
                </div>

                {/* 3. Nhà cung cấp */}
                <div className="space-y-2 relative">
                  <label className="text-sm font-bold text-slate-700">Nhà cung cấp</label>
                  <div className="relative">
                    <input 
                      required
                      value={supplierName}
                      onChange={(e) => {
                        setSupplierName(e.target.value);
                        setIsSupplierDropdownOpen(true);
                      }}
                      onFocus={() => setIsSupplierDropdownOpen(true)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Tìm hoặc nhập tên NCC..."
                    />
                    {isSupplierDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-auto">
                        {suppliers
                          .filter(s => s.name.toLowerCase().includes(supplierName.toLowerCase()))
                          .map(s => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setSupplierName(s.name);
                                setIsSupplierDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm transition-colors"
                            >
                              {s.name}
                            </button>
                          ))}
                        {supplierName && !suppliers.some(s => s.name.toLowerCase() === supplierName.toLowerCase()) && (
                          <button
                            type="button"
                            onClick={() => handleCreateNewSupplier(supplierName)}
                            className="w-full text-left px-4 py-2 hover:bg-emerald-50 text-sm text-emerald-600 font-bold border-t border-slate-100 flex items-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Thêm mới: "{supplierName}"
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-8">
                <div className="lg:w-[40%] space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <Package className="w-5 h-5 text-indigo-600" />
                      Chọn sản phẩm nhập
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsNewProductModalOpen(true)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-lg"
                    >
                      <Plus className="w-3 h-3" />
                      Thêm mới sản phẩm
                    </button>
                  </div>
                  
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Tìm tên hoặc mã sản phẩm..."
                      value={productSearchTerm}
                      onChange={(e) => setProductSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-2 max-h-[400px] overflow-auto pr-2">
                    {filteredProducts.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 text-sm italic">
                        Không tìm thấy sản phẩm nào.
                      </div>
                    ) : filteredProducts.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addItem(p)}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-left"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">Mã: {p.sku} | {p.warehouse === 'main' ? 'Kho tặng' : 'Kho bán hàng'}: {p.stockQuantity}</p>
                        </div>
                        <Plus className="w-4 h-4 text-indigo-600" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:w-[60%] space-y-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Truck className="w-5 h-5 text-indigo-600" />
                    Danh sách nhập
                  </h3>
                  <div className="space-y-3">
                    {selectedItems.map((item, idx) => (
                      <div key={idx} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm space-y-3">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-sm font-bold text-slate-900 truncate flex-1">{item.productName}</p>
                          <div className="flex items-center gap-1">
                            <button 
                              type="button"
                              onClick={() => {
                                const newItems = [...selectedItems];
                                newItems.splice(idx + 1, 0, { ...item });
                                setSelectedItems(newItems);
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Sao chép dòng"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button 
                              type="button"
                              onClick={() => setSelectedItems(selectedItems.filter((_, i) => i !== idx))}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Xóa dòng"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-8 gap-2">
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase truncate">SL</label>
                            <input 
                              type="number"
                              value={item.quantity}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const newItems = [...selectedItems];
                                newItems[idx].quantity = val;
                                setSelectedItems(newItems);
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="SL"
                            />
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase truncate">VAT</label>
                            <input 
                              type="number"
                              value={item.vat || 8}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const newItems = [...selectedItems];
                                newItems[idx].vat = val;
                                // Update priceBeforeTax based on costPrice and new VAT
                                newItems[idx].priceBeforeTax = Math.round(newItems[idx].costPrice / (1 + val / 100));
                                setSelectedItems(newItems);
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="VAT"
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase truncate">Chưa thuế</label>
                            <input 
                              type="number"
                              value={item.priceBeforeTax || 0}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const newItems = [...selectedItems];
                                newItems[idx].priceBeforeTax = val;
                                // Update costPrice based on priceBeforeTax and VAT
                                newItems[idx].costPrice = Math.round(val * (1 + (newItems[idx].vat || 8) / 100));
                                setSelectedItems(newItems);
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="Chưa thuế"
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase truncate">Sau thuế ({item.vat || 8}%)</label>
                            <input 
                              type="number"
                              value={item.costPrice}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const newItems = [...selectedItems];
                                newItems[idx].costPrice = val;
                                // Update priceBeforeTax based on new costPrice and VAT
                                newItems[idx].priceBeforeTax = Math.round(val / (1 + (newItems[idx].vat || 8) / 100));
                                setSelectedItems(newItems);
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-indigo-600"
                              placeholder="Sau thuế"
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase truncate">Giá bán dự kiến</label>
                            <input 
                              type="number"
                              value={item.sellingPrice || 0}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const newItems = [...selectedItems];
                                newItems[idx].sellingPrice = val;
                                setSelectedItems(newItems);
                              }}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-emerald-600"
                              placeholder="Giá bán"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-lg font-bold">
                    <span className="text-slate-900">Tổng tiền nhập:</span>
                    <span className="text-rose-600">
                      {formatCurrency(selectedItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0))}
                    </span>
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
                onClick={handleCreatePurchase}
                disabled={isUploading}
                className={cn(
                  "px-8 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 flex flex-col items-center justify-center min-w-[180px]",
                  isUploading && "opacity-50 cursor-not-allowed"
                )}
              >
                {isUploading ? (
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <Clock className="w-4 h-4 animate-spin" />
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-white transition-all duration-300" 
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Save className="w-4 h-4" />
                    {editingPurchase ? 'Cập nhật đơn nhập' : 'Hoàn tất nhập hàng'}
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {selectedPurchase && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPurchase(null);
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Chi tiết đơn nhập hàng</h2>
              <button onClick={() => setSelectedPurchase(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Ngày nhập</p>
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    {formatDate(selectedPurchase.date)}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Nhà cung cấp</p>
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Truck className="w-4 h-4 text-indigo-600" />
                    {selectedPurchase.supplierName}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl overflow-hidden">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Người nhập</p>
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <UserIcon className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="truncate" title={selectedPurchase.createdByName}>
                      {selectedPurchase.createdByName}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Tổng tiền</p>
                  <div className="flex items-center gap-2 text-sm font-bold text-rose-600">
                    <DollarSign className="w-4 h-4" />
                    {formatCurrency(selectedPurchase.totalAmount)}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  Hóa đơn đỏ
                </h3>
                {selectedPurchase.invoiceUrl ? (
                  <div className="space-y-4">
                    {detailThumbnails.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                        {detailThumbnails.map((img, i) => (
                          <div key={i} className="relative group shrink-0">
                            <img 
                              src={img} 
                              alt={`Trang ${i+1}`} 
                              className="w-24 h-32 object-cover rounded-xl border border-slate-200 shadow-sm"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                // Hide the entire thumbnail container if page doesn't exist
                                const container = e.currentTarget.parentElement;
                                if (container) container.style.display = 'none';
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setViewingInvoice(img)}
                              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl"
                            >
                              <Eye className="w-5 h-5 text-white" />
                            </button>
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[8px] px-1 rounded">
                              Trang {i+1}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : isGeneratingThumbnails ? (
                      <div className="flex items-center gap-2 text-sm text-slate-400 italic">
                        <Clock className="w-4 h-4 animate-spin" />
                        Đang tạo bản xem trước...
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <FileText className="w-4 h-4 text-slate-400" />
                          Hóa đơn đã được lưu trữ
                        </div>
                        <button 
                          onClick={() => setViewingInvoice(selectedPurchase.invoiceUrl)}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          Xem chi tiết
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-400 italic">
                    Không có hóa đơn đính kèm.
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <Package className="w-5 h-5 text-indigo-600" />
                  Danh sách sản phẩm ({selectedPurchase.items.length})
                </h3>
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 font-bold text-slate-600">Sản phẩm</th>
                        <th className="px-4 py-2 font-bold text-slate-600 text-center">Số lượng</th>
                        <th className="px-4 py-2 font-bold text-slate-600 text-right">Giá chưa thuế</th>
                        <th className="px-4 py-2 font-bold text-slate-600 text-right">Giá sau thuế</th>
                        <th className="px-4 py-2 font-bold text-slate-600 text-right">Giá bán dự kiến</th>
                        <th className="px-4 py-2 font-bold text-slate-600 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPurchase.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 font-medium text-slate-700">{item.productName}</td>
                          <td className="px-4 py-3 text-center text-slate-600">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            {formatCurrency(item.priceBeforeTax || Math.round(item.costPrice / (1 + (item.vat || 8) / 100)))}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 font-bold text-indigo-600">
                            {formatCurrency(item.costPrice)}
                            <span className="text-[10px] ml-1 opacity-60">({item.vat || 8}%)</span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 font-bold text-emerald-600">
                            {formatCurrency(item.sellingPrice || 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(item.costPrice * item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedPurchase.history && selectedPurchase.history.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-5 h-5 text-indigo-600" />
                    Lịch sử thay đổi
                  </h3>
                  <div className="space-y-2">
                    {selectedPurchase.history.map((h, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl text-xs">
                        <div className="w-2 h-2 mt-1 rounded-full bg-indigo-400 shrink-0" />
                        <div className="flex-1">
                          <p className="font-bold text-slate-700">{h.details}</p>
                          <p className="text-slate-500 truncate" title={h.userName}>
                            {h.userName} • {formatDate(h.date)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
              <button 
                onClick={() => setSelectedPurchase(null)}
                className="px-8 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Product Sub-Modal */}
      {isNewProductModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsNewProductModalOpen(false);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Thêm sản phẩm mới</h2>
              <button onClick={() => setIsNewProductModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewProduct} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Tên sản phẩm</label>
                <input 
                  required
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Ví dụ: Kính Ray-Ban Aviator"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Thuế VAT (%)</label>
                  <input 
                    type="number"
                    required
                    value={newProduct.vat}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setNewProduct({...newProduct, vat: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Danh mục</label>
                  <select 
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({...newProduct, category: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Gọng kính">Gọng kính</option>
                    <option value="Tròng kính">Tròng kính</option>
                    <option value="Kính mát">Kính mát</option>
                    <option value="Phụ kiện">Phụ kiện</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Giá chưa thuế ({newProduct.vat}%)</label>
                  <input 
                    type="number"
                    required
                    value={Math.round(newProduct.costPrice / (1 + newProduct.vat / 100))}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setNewProduct({...newProduct, costPrice: Math.round(val * (1 + newProduct.vat / 100))});
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Giá sau thuế</label>
                  <input 
                    type="number"
                    required
                    value={newProduct.costPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setNewProduct({...newProduct, costPrice: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-indigo-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Giá bán dự kiến</label>
                  <input 
                    type="number"
                    required
                    value={newProduct.sellingPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setNewProduct({...newProduct, sellingPrice: Number(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsNewProductModalOpen(false)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-all"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
                >
                  Lưu & Thêm vào đơn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deletingPurchase && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingPurchase(null);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Xác nhận xóa đơn nhập hàng</h3>
            <p className="text-slate-600 mb-6">
              Bạn có chắc chắn muốn xóa vĩnh viễn đơn nhập hàng này? Số lượng sản phẩm sẽ được trừ khỏi kho.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setDeletingPurchase(null)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={handleDeletePurchase}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-100"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Viewer Modal */}
      {viewingInvoice && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[200] flex items-center justify-center p-4 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewingInvoice(null);
          }}
        >
          <div className="bg-white w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Hóa đơn đỏ</h3>
                  <p className="text-xs text-slate-500">Xem chi tiết hóa đơn PDF</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => window.open(viewingInvoice, '_blank')}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  title="Mở trong tab mới"
                >
                  <ExternalLink className="w-5 h-5" />
                </button>
                <a 
                  href={viewingInvoice} 
                  download="hoa-don-nhap-hang.pdf"
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  title="Tải xuống"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button 
                  onClick={() => setViewingInvoice(null)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 p-4 overflow-auto flex justify-center items-start">
              {viewingInvoice.startsWith('data:image') || viewingInvoice.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/) || (viewingInvoice.includes('res.cloudinary.com') && viewingInvoice.includes('pg_')) ? (
                <img 
                  src={viewingInvoice} 
                  className="max-w-full rounded-xl shadow-lg bg-white"
                  alt="Invoice Image"
                  referrerPolicy="no-referrer"
                />
              ) : viewingInvoice.includes('res.cloudinary.com') && viewingInvoice.toLowerCase().endsWith('.pdf') ? (
                <div className="w-full space-y-4">
                  {/* Show pages as images for Cloudinary PDFs to avoid iframe issues */}
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(page => {
                    const urlParts = viewingInvoice.split('/upload/');
                    if (urlParts.length !== 2) return null;
                    const baseUrl = urlParts[0] + '/upload/';
                    const publicId = urlParts[1];
                    const imgUrl = `${baseUrl}pg_${page},w_1200,c_limit/${publicId.replace(/\.[^/.]+$/, "")}.jpg`;
                    
                    return (
                      <div key={page} className="relative">
                        <img 
                          src={imgUrl} 
                          className="w-full rounded-xl shadow-lg bg-white"
                          alt={`Trang ${page}`}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            // Hide image if page doesn't exist
                            (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                          }}
                        />
                        <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-lg">
                          Trang {page}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col gap-4">
                  <iframe 
                    src={viewingInvoice} 
                    className="flex-1 w-full rounded-xl border-none shadow-inner bg-white"
                    title="Invoice PDF"
                  />
                  <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div className="text-sm text-slate-500">
                      Nếu không xem được PDF, vui lòng mở trong tab mới hoặc tải về.
                    </div>
                    <button 
                      onClick={() => window.open(viewingInvoice, '_blank')}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Mở trong tab mới
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
