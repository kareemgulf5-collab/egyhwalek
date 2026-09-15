import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as secondarySignOut } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { UserRole } from '@/types';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export async function createUserAccount(params: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  createdBy: string;
}) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, params.email, params.password);
    const newUid = cred.user.uid;

    await secondarySignOut(secondaryAuth);

    await runTransaction(db, async (tx) => {
      tx.set(doc(db, 'users', newUid), {
        email: params.email,
        displayName: params.displayName,
        role: params.role,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: params.createdBy,
      });
    });

    return newUid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function bootstrapFirstAdmin(uid: string, email: string, displayName: string) {
  await runTransaction(db, async (tx) => {
    const bootstrapFlagRef = doc(db, 'settings', 'bootstrap_flag');
    const flagSnap = await tx.get(bootstrapFlagRef);
    if (flagSnap.exists()) {
      throw new Error('تم تفعيل أول مدير للنظام بالفعل');
    }
    tx.set(doc(db, 'users', uid), {
      email,
      displayName: displayName || email,
      role: 'admin',
      active: true,
      createdAt: serverTimestamp(),
    });
    tx.set(bootstrapFlagRef, { done: true, doneBy: uid, doneAt: serverTimestamp() });
  });
}