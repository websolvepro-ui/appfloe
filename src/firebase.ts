/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  updateDoc
} from 'firebase/firestore';

// Configuration details from firebase-applet-config.json
const firebaseConfig = {
  apiKey: "AIzaSyDYssTYYCyv_jP-yi7jfWdP9gECzQcT5O4",
  authDomain: "gen-lang-client-0711619409.firebaseapp.com",
  projectId: "gen-lang-client-0711619409",
  storageBucket: "gen-lang-client-0711619409.firebasestorage.app",
  messagingSenderId: "401344287620",
  appId: "1:401344287620:web:5b9931e8d42b24841dc3d1"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Firestore specifying custom database ID if available
// Note: our firebase-applet-config uses firestoreDatabaseId: "ai-studio-floe-467f5543-67c2-450b-8bfb-0821bbd01264"
export const db = getFirestore(app, "ai-studio-floe-467f5543-67c2-450b-8bfb-0821bbd01264");

// Providers
const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    console.error("Google Auth failed, trying fallback:", error);
    throw error;
  }
}

export async function loginAnonymously() {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.error("Anonymous authentication failed:", error);
    throw error;
  }
}

export async function registerWithEmail(email: string, password: string, displayName: string) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  return result.user;
}

export async function loginWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export function logoutUser() {
  return signOut(auth);
}
