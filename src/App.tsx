import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, getDocFromServer, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/firestore-utils';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Purchases from './pages/Purchases';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import Users from './pages/Users';
import Reports from './pages/Reports';
import ActivityLogs from './pages/ActivityLogs';
import Settings from './pages/Settings';
import Layout from './components/Layout';
import AuthGuard from './components/AuthGuard';
import ErrorBoundary from './components/ErrorBoundary';

interface AuthContextType {
  user: User | null;
  role: 'admin' | 'super_admin' | 'manager' | 'staff' | null;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextType>({ user: null, role: null, loading: true });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'super_admin' | 'manager' | 'staff' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        
        // Connection test only when authenticated
        try {
          await getDocFromServer(doc(db, 'settings', 'permissions'));
        } catch (error) {
          console.warn("Firestore connection test warning:", error);
          // Don't throw here as it's just a test, just log for debugging
          console.debug('Connection test failed, this is usually fine if permissions are not yet set up.');
        }

        let userDoc;
        let currentRole: 'admin' | 'super_admin' | 'manager' | 'staff' = 'staff';
        const userPath = `users/${currentUser.uid}`;
        try {
          userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        } catch (error) {
          console.error("Error fetching user document:", error);
          handleFirestoreError(error, OperationType.GET, userPath);
        }

        if (userDoc?.exists()) {
          currentRole = userDoc.data().role;
        } else {
          // Check if there's a pre-assigned role for this email
          let preAssignedData = null;
          let preAssignedDocId = null;
          
          try {
            const q = query(collection(db, 'users'), where('email', '==', currentUser.email));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
              // Found a pre-assigned doc
              const firstDoc = querySnapshot.docs[0];
              preAssignedData = firstDoc.data();
              preAssignedDocId = firstDoc.id;
            }
          } catch (error) {
            console.error("Error checking pre-assigned role:", error);
          }

          const isInitialAdmin = currentUser.email === 'bshieumat@gmail.com' || currentUser.email === 'mrihachnach@gmail.com' || currentUser.email === 'hoanghiep1296@gmail.com' || currentUser.email === 'nguyenhiep.drts@gmail.com' || currentUser.email === 'admin@admin.com';
          currentRole = preAssignedData?.role || (isInitialAdmin ? 'admin' : 'staff');
          
          const userData = {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName || preAssignedData?.displayName || (isInitialAdmin ? 'Admin' : 'Staff'),
            role: currentRole,
            status: preAssignedData?.status || 'active',
            createdAt: preAssignedData?.createdAt || new Date().toISOString()
          };
          
          try {
            // Create the real user doc with UID
            await setDoc(doc(db, 'users', currentUser.uid), userData);
            
            // If we claimed a pre-assigned doc that had a different ID, delete it
            if (preAssignedDocId && preAssignedDocId !== currentUser.uid) {
              await deleteDoc(doc(db, 'users', preAssignedDocId));
            }
          } catch (error) {
            console.error("Error creating user document:", error);
            handleFirestoreError(error, OperationType.CREATE, userPath);
          }
        }
        setRole(currentRole);
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, role, loading }}>
        <Router>
          <Routes>
            <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
            <Route element={<AuthGuard><Layout /></AuthGuard>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/users" element={<Users />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/activity-logs" element={<ActivityLogs />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Router>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
