import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { AppUser, UserRole } from '@/types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// كل دور وله صلاحياته — يُستخدم كطبقة أولى في الواجهة فقط.
// التحقق الحقيقي والملزم يتم عبر Firestore Security Rules و Cloud Functions.
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير النظام',
  raw_material_keeper: 'أمين مخزن الخامات',
  production_supervisor: 'مسؤول الإنتاج',
  scrap_keeper: 'أمين مخزن الهالك',
  reviewer: 'المراجع / المحاسب',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        const snap = await getDoc(doc(db, 'users', fbUser.uid));
        if (snap.exists()) {
          setAppUser({ uid: fbUser.uid, ...(snap.data() as Omit<AppUser, 'uid'>) });
        } else {
          setAppUser(null);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await fbSignOut(auth);
  };

  const hasRole = (...roles: UserRole[]) => {
    if (!appUser) return false;
    if (appUser.role === 'admin') return true;
    return roles.includes(appUser.role);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, signIn, signOut, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
