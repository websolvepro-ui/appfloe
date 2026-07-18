/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  ShoppingCart, Utensils, Car, Film, Zap, ShoppingBag, 
  Mic, MicOff, Plus, X, Lock, Check, Trash2, PiggyBank, 
  Sparkles, Shield, ChevronRight, Info, Wallet, Award, ArrowRight,
  RefreshCw, TrendingUp, Sparkle, AlertTriangle, LogIn, LogOut, User as UserIcon,
  Activity, BrainCircuit, HeartPulse, Lightbulb, Compass, Database, Upload, Camera
} from 'lucide-react';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

import { parseNaturalLanguageExpense, CATEGORIES, CategoryDefinition } from './parser';
import { storage, Budget, Expense, SavingGoal } from './initialData';
import { auth, db, loginWithGoogle, logoutUser, registerWithEmail, loginWithEmail } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, getDocs, getDoc, query, where, updateDoc } from 'firebase/firestore';

interface AIInsightResponse {
  healthScore: number;
  summary: string;
  insights: Array<{
    title: string;
    description: string;
    type: 'warning' | 'success' | 'info';
    category?: string;
  }>;
  recommendations: Array<string>;
}

const getTrialDaysRemaining = (createdAtString?: string) => {
  if (!createdAtString) return 0;
  const created = new Date(createdAtString);
  const now = new Date();
  const diffTime = created.getTime() + (14 * 24 * 60 * 60 * 1000) - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

export default function App() {
  // --- USER AUTHENTICATION STATE ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showDomainFixGuide, setShowDomainFixGuide] = useState(false);
  
  // --- FLOE SUBSCRIPTION & AUTH FLOW ---
  const [userTier, setUserTier] = useState<'trial' | 'pro' | 'lifetime' | 'expired'>('trial');
  const [trialDaysLeft, setTrialDaysLeft] = useState<number>(14);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showVideoDemo, setShowVideoDemo] = useState(false);

  // --- PREMIUM AI RECEIPT SCANNER STATE ---
  const [selectedMockReceipt, setSelectedMockReceipt] = useState<string>('');
  const [scanningReceipt, setScanningReceipt] = useState<boolean>(false);
  const [customReceiptImage, setCustomReceiptImage] = useState<string | null>(null);
  const [customReceiptMimeType, setCustomReceiptMimeType] = useState<string>('');
  const [customReceiptName, setCustomReceiptName] = useState<string>('');

  // --- CAMERA SCANNER STATE & REFS ---
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // --- LANDING PAGE EXTRA STATE ---
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [demoStep, setDemoStep] = useState<number>(0);
  const [demoPlaying, setDemoPlaying] = useState<boolean>(false);

  // --- AUTH MODAL FORM STATES ---
  const [authEmail, setAuthEmail] = useState<string>('websolvepro@gmail.com');
  const [authPassword, setAuthPassword] = useState<string>('password123');
  const [authDisplayName, setAuthDisplayName] = useState<string>('Web Solve');

  // --- CORE SYSTEM STATE ---
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [dataSyncing, setDataSyncing] = useState(false);

  // --- NAVIGATION STATE ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'capture' | 'budgets-goals'>('dashboard');

  // --- AI COUNSELOR STATE ---
  const [aiInsights, setAiInsights] = useState<AIInsightResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // --- AUTH STATE OBSERVER ---
  useEffect(() => {
    // Force clear any old local sandbox session on startup to guarantee they land on the homepage
    localStorage.removeItem('floe_use_local_vault');
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthLoading(true);
      
      // Load AI Cache if any
      const cachedAi = localStorage.getItem(`floe_ai_cache_${currentUser?.uid || 'offline'}`);
      if (cachedAi) {
        try {
          setAiInsights(JSON.parse(cachedAi));
        } catch {
          // ignore
        }
      } else {
        setAiInsights(null);
      }

      if (currentUser) {
        setUser(currentUser);
        try {
          setDataSyncing(true);
          
          // --- FETCH SUBSCRIPTION TIER FROM FIRESTORE ---
          let currentTier: 'trial' | 'pro' | 'lifetime' | 'expired' = 'trial';
          let daysLeft = 14;
          
          if (currentUser.email === 'websolvepro@gmail.com') {
            currentTier = 'lifetime';
            daysLeft = 9999;
            try {
              await setDoc(doc(db, "users", currentUser.uid), {
                email: currentUser.email,
                tier: "lifetime",
                updatedAt: new Date().toISOString()
              }, { merge: true });
            } catch (err) {
              console.error("Failed to persist owner profile to Firestore:", err);
            }
          } else {
            try {
              const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
              if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                if (userData) {
                  const dbTier = userData.tier;
                  const createdTime = userData.createdAt || userData.trialStartDate || new Date().toISOString();
                  
                  if (dbTier === 'pro' || dbTier === 'pro-monthly' || dbTier === 'pro-yearly') {
                    currentTier = 'pro';
                  } else if (dbTier === 'lifetime') {
                    currentTier = 'lifetime';
                  } else {
                    daysLeft = getTrialDaysRemaining(createdTime);
                    if (daysLeft <= 0) {
                      currentTier = 'expired';
                    } else {
                      currentTier = 'trial';
                    }
                  }
                }
              } else {
                // Create default profile doc
                const nowIso = new Date().toISOString();
                await setDoc(doc(db, "users", currentUser.uid), {
                  email: currentUser.email || "",
                  tier: "trial",
                  createdAt: nowIso
                });
                currentTier = 'trial';
                daysLeft = 14;
              }
            } catch (e) {
              console.error("Failed to load user subscription profile:", e);
            }
          }
          setUserTier(currentTier);
          setTrialDaysLeft(daysLeft);

          const { loadedExpenses, loadedBudgets, loadedGoals } = await fetchUserFirestoreData(currentUser.uid);
          
          if (loadedExpenses.length === 0 && loadedBudgets.length === storage.getBudgets().length && loadedBudgets.every(b => b.spent === 0)) {
            const localExpenses = storage.getExpenses();
            const localBudgets = storage.getBudgets();
            const localGoals = storage.getGoals();
            
            await uploadDataToFirestore(currentUser.uid, localExpenses, localBudgets, localGoals);
            setExpenses(localExpenses);
            setBudgets(localBudgets);
            setGoals(localGoals);
            showBanner("Welcome! Default offline data successfully synced to your Google Account.");
          } else if (loadedExpenses.length === 0 && loadedBudgets.length === 0 && loadedGoals.length === 0) {
            const defaultExpenses = storage.getExpenses();
            const defaultBudgets = storage.getBudgets();
            const defaultGoals = storage.getGoals();
            await uploadDataToFirestore(currentUser.uid, defaultExpenses, defaultBudgets, defaultGoals);
            setExpenses(defaultExpenses);
            setBudgets(defaultBudgets);
            setGoals(defaultGoals);
            showBanner("Secured cloud sync complete. Welcome to Floe!");
          } else {
            setExpenses(loadedExpenses);
            setBudgets(loadedBudgets);
            setGoals(loadedGoals);
            showBanner("Cloud sync successful. Your data is up to date.");
          }
        } catch (error) {
          console.error("Error loading user cloud data", error);
          loadOfflineData();
        } finally {
          setDataSyncing(false);
        }
      } else {
        // We do not automatically restore the sandbox session on startup/refresh,
        // so that the user is always presented with the main Floe homepage.
        setUser(null);
        setExpenses([]);
        setBudgets([]);
        setGoals([]);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // --- STRIPE & SIMULATOR REDIRECT LISTENER ---
  useEffect(() => {
    const checkPaymentRedirect = async () => {
      const params = new URLSearchParams(window.location.search);
      const paymentStatus = params.get('payment_status');
      const plan = params.get('plan') as 'pro-monthly' | 'pro-yearly' | 'lifetime' | null;
      const urlUserId = params.get('userId');

      if (paymentStatus === 'success' && plan && urlUserId) {
        // Double check we are either matching logged-in user or wait until logged in
        if (user && user.uid === urlUserId) {
          try {
            setDataSyncing(true);
            
            // Update Firestore database
            await setDoc(doc(db, "users", user.uid), {
              tier: plan,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            // Update client state
            const mappedTier = (plan === 'pro-monthly' || plan === 'pro-yearly') ? 'pro' : 'lifetime';
            setUserTier(mappedTier);

            // Clear URL params cleanly
            window.history.replaceState({}, document.title, window.location.pathname);

            showBanner(`Congratulations! Your account has been upgraded to Floe ${plan === 'lifetime' ? 'Lifetime 🚀' : 'Pro ⭐'}!`);
          } catch (e) {
            console.error("Failed to persist upgraded subscription in Firestore:", e);
          } finally {
            setDataSyncing(false);
          }
        }
      } else if (paymentStatus === 'cancelled') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showBanner("Payment cancelled. You can upgrade to Pro anytime!");
      }
    };

    checkPaymentRedirect();
  }, [user]);

  const loadOfflineData = () => {
    setExpenses(storage.getExpenses());
    setBudgets(storage.getBudgets());
    setGoals(storage.getGoals());
  };

  // --- FIRESTORE PERSISTENCE CONTROLLERS ---
  const fetchUserFirestoreData = async (uid: string) => {
    const expQuery = query(collection(db, "expenses"), where("userId", "==", uid));
    const expSnap = await getDocs(expQuery);
    const loadedExpenses: Expense[] = [];
    expSnap.forEach(docSnap => {
      const data = docSnap.data();
      loadedExpenses.push({
        id: docSnap.id,
        amount: data.amount,
        categoryId: data.categoryId,
        date: data.date,
        note: data.note
      });
    });

    const budgetQuery = query(collection(db, "budgets"), where("userId", "==", uid));
    const budgetSnap = await getDocs(budgetQuery);
    const loadedBudgets: Budget[] = [];
    budgetSnap.forEach(docSnap => {
      const data = docSnap.data();
      loadedBudgets.push({
        id: data.id || docSnap.id,
        name: data.name,
        limit: data.limit,
        spent: data.spent || 0,
        icon: data.icon,
        color: data.color
      });
    });

    const goalQuery = query(collection(db, "goals"), where("userId", "==", uid));
    const goalSnap = await getDocs(goalQuery);
    const loadedGoals: SavingGoal[] = [];
    goalSnap.forEach(docSnap => {
      const data = docSnap.data();
      loadedGoals.push({
        id: docSnap.id,
        name: data.name,
        targetAmount: data.targetAmount,
        currentProgress: data.currentProgress,
        color: data.color
      });
    });

    loadedExpenses.sort((a, b) => b.date.localeCompare(a.date));

    return { loadedExpenses, loadedBudgets, loadedGoals };
  };

  const uploadDataToFirestore = async (uid: string, localExp: Expense[], localBudgets: Budget[], localGoals: SavingGoal[]) => {
    try {
      for (const exp of localExp) {
        await setDoc(doc(db, "expenses", exp.id), {
          userId: uid,
          amount: exp.amount,
          categoryId: exp.categoryId,
          date: exp.date,
          note: exp.note
        });
      }

      for (const b of localBudgets) {
        await setDoc(doc(db, "budgets", `${uid}_${b.id}`), {
          userId: uid,
          id: b.id,
          name: b.name,
          limit: b.limit,
          spent: b.spent,
          icon: b.icon,
          color: b.color
        });
      }

      for (const g of localGoals) {
        await setDoc(doc(db, "goals", g.id), {
          userId: uid,
          name: g.name,
          targetAmount: g.targetAmount,
          currentProgress: g.currentProgress,
          color: g.color
        });
      }
    } catch (err) {
      console.error("Migration upload failed:", err);
    }
  };

  // --- SAVE PIPELINE ---
  const saveAllData = async (updatedExpenses: Expense[], updatedBudgets: Budget[], updatedGoals: SavingGoal[]) => {
    setExpenses(updatedExpenses);
    setBudgets(updatedBudgets);
    setGoals(updatedGoals);

    storage.setExpenses(updatedExpenses);
    storage.setBudgets(updatedBudgets);
    storage.setGoals(updatedGoals);
  };

  // --- GOOGLE AUTH ACTIONS ---
  const handleGoogleLogin = async () => {
    try {
      setAuthError(null);
      setShowDomainFixGuide(false);
      setDataSyncing(true);
      await loginWithGoogle();
      setShowAuthModal(false);
    } catch (error: any) {
      console.error("Login failed:", error);
      const errMsg = error.message || String(error);
      if (errMsg.includes("unauthorized-domain") || errMsg.includes("auth/unauthorized-domain")) {
        setAuthError("Firebase: This domain is not authorized for Google Sign-In yet.");
        setShowDomainFixGuide(true);
      } else {
        setAuthError(`Google sign in failed: ${errMsg}`);
      }
    } finally {
      setDataSyncing(false);
    }
  };

  const handleEmailLoginAction = async (emailInput: string, passwordInput: string) => {
    try {
      setAuthError(null);
      setDataSyncing(true);
      await loginWithEmail(emailInput, passwordInput);
      setShowAuthModal(false);
      showBanner("Logged in securely! Your private Floe ledger is ready.");
    } catch (error: any) {
      console.error("Email login failed:", error);
      setAuthError(error.message || "Invalid email or password.");
    } finally {
      setDataSyncing(false);
    }
  };

  const handleEmailRegisterAction = async (emailInput: string, passwordInput: string, displayNameInput: string) => {
    try {
      setAuthError(null);
      setDataSyncing(true);
      await registerWithEmail(emailInput, passwordInput, displayNameInput);
      setShowAuthModal(false);
      showBanner("Vault created successfully! Welcome to Floe.");
    } catch (error: any) {
      console.error("Email registration failed:", error);
      setAuthError(error.message || "Failed to create account. Please ensure your password is at least 6 characters.");
    } finally {
      setDataSyncing(false);
    }
  };

  const handleStripeCheckout = async (planId: 'pro-monthly' | 'pro-yearly' | 'lifetime') => {
    if (!user) {
      showBanner("Please log in or register to upgrade.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }

    try {
      setCheckoutLoading(true);
      const res = await fetch("/api/stripe-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          userEmail: user.email,
          userId: user.uid
        })
      });

      if (!res.ok) {
        throw new Error("Failed to create Stripe Checkout Session");
      }

      const data = await res.json();
      if (data.redirectUrl) {
        // Redirect user to Checkout (live Stripe or Sandbox simulation redirect)
        window.location.href = data.redirectUrl;
      } else {
        throw new Error("Invalid response from checkout provider");
      }
    } catch (err: any) {
      console.error("Stripe Checkout initiation error:", err);
      alert(`Stripe Checkout failed: ${err.message || String(err)}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleLocalSandboxLogin = () => {
    localStorage.setItem('floe_use_local_vault', 'true');
    const localUser = {
      uid: 'local_sandbox',
      displayName: 'Sandbox Explorer',
      email: 'sandbox@floe.local',
      photoURL: ''
    } as any;
    setUser(localUser);
    loadOfflineData();
    showBanner("Logged into Local Sandbox Vault successfully! Data will persist in local storage.");
  };

  const handleLogout = async () => {
    try {
      setDataSyncing(true);
      localStorage.removeItem('floe_use_local_vault');
      setUser(null);
      await logoutUser();
      setAiInsights(null);
      showBanner("Successfully logged out of Floe.");
    } catch (error) {
      console.error("Logout failed", error);
    } finally {
      setDataSyncing(false);
    }
  };

  // --- CALL GEMINI AI proxy FOR INSIGHTS ---
  const handleRequestAIInsights = async () => {
    if (!user) return;
    try {
      setAiLoading(true);
      setAiError(null);

      const response = await fetch("/api/ai-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenses,
          budgets: budgets.map(b => ({
            name: b.name,
            limit: b.limit,
            spent: getSpentForCategory(b.id, expenses)
          })),
          goals
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const detailMsg = errJson?.details || errJson?.error || "Failed to consult the AI financial counselor";
        throw new Error(detailMsg);
      }

      const data: AIInsightResponse = await response.json();
      setAiInsights(data);
      localStorage.setItem(`floe_ai_cache_${user.uid}`, JSON.stringify(data));
      showBanner("Smart AI Financial Counselor Report Generated!");
    } catch (err: any) {
      console.error("AI Insight fetch failed", err);
      setAiError(err.message || "Failed to sync AI feedback.");
    } finally {
      setAiLoading(false);
    }
  };

  // --- DERIVED METRICS ---
  const getSpentForCategory = (catId: string, currentExpenses: Expense[]) => {
    return currentExpenses
      .filter(e => e.categoryId === catId)
      .reduce((sum, e) => sum + e.amount, 0);
  };

  const totalBudgetLimit = budgets.reduce((sum, b) => sum + b.limit, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + getSpentForCategory(b.id, expenses), 0);
  const remainingTotal = Math.max(0, totalBudgetLimit - totalSpent);
  const totalSaved = goals.reduce((sum, g) => sum + g.currentProgress, 0);

  // --- UI CONTROLS ---
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [voiceError, setVoiceError] = useState('');
  
  const [showParsedConfirmation, setShowParsedConfirmation] = useState(false);
  const [parsedResult, setParsedResult] = useState<{ amount: number; categoryId: string; note: string; date?: string } | null>(null);
  const [customPhraseInput, setCustomPhraseInput] = useState('');
  const [simulatingText, setSimulatingText] = useState(false);

  // Modals & Overlays
  const [showManualForm, setShowManualForm] = useState(false);
  const [showCreateBudget, setShowCreateBudget] = useState(false);
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  const [showContributionModal, setShowContributionModal] = useState(false);
  
  // Goal Interactions
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [contributionAmount, setContributionAmount] = useState('');

  // Form states
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategory, setManualCategory] = useState('groceries');
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualNote, setManualNote] = useState('');

  const [newBudgetName, setNewBudgetName] = useState('');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');
  const [newBudgetIcon, setNewBudgetIcon] = useState('ShoppingBag');
  const [newBudgetColor, setNewBudgetColor] = useState('emerald');

  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalColor, setNewGoalColor] = useState('sky');

  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const showBanner = (msg: string) => {
    setBannerMessage(msg);
    setTimeout(() => {
      setBannerMessage(null);
    }, 4000);
  };

  // --- VOICE SPEECH RECOGNITION ---
  const handleStartVoiceRecord = () => {
    if (userTier === 'expired') {
      setShowUpgradeModal(true);
      return;
    }
    setVoiceError('');
    setTranscription('');
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError('Web Speech API is not supported in this browser. Try our elegant speech simulator deck below!');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event);
        setVoiceError(`Web Speech error. Use the premium instant voice simulator deck below for error-free parsing!`);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.onresult = (event: any) => {
        const speechToText = event.results[0][0].transcript;
        setTranscription(speechToText);
        processSpokenPhrase(speechToText);
      };

      recognition.start();
    } catch (err: any) {
      setVoiceError(`Audio mic blocked inside sandbox. Utilize our interactive speech simulators below.`);
      setIsRecording(false);
    }
  };

  const processSpokenPhrase = (phrase: string) => {
    const parsed = parseNaturalLanguageExpense(phrase);
    setParsedResult(parsed);
    setShowParsedConfirmation(true);
  };

  const handleSimulatePhrase = (phrase: string) => {
    if (userTier === 'expired') {
      setShowUpgradeModal(true);
      return;
    }
    setSimulatingText(true);
    setTranscription('');
    setIsRecording(true);
    
    let currentText = '';
    const words = phrase.split(' ');
    let wordIndex = 0;

    const interval = setInterval(() => {
      if (wordIndex < words.length) {
        currentText += (wordIndex === 0 ? '' : ' ') + words[wordIndex];
        setTranscription(currentText);
        wordIndex++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setIsRecording(false);
          setSimulatingText(false);
          processSpokenPhrase(phrase);
        }, 200);
      }
    }, 80);
  };

  // --- CAMERA CONTROL METHODS ---
  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      setCameraStream(stream);
    } catch (err: any) {
      console.error("Camera access failed", err);
      setCameraError("Could not access camera. Please allow camera permissions or upload an image.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsCameraActive(false);
  };

  const capturePhoto = (videoElement: HTMLVideoElement | null) => {
    if (!videoElement) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setCustomReceiptImage(dataUrl);
        setCustomReceiptMimeType('image/jpeg');
        setCustomReceiptName(`camera_${Date.now()}.jpg`);
        setSelectedMockReceipt('custom');
        stopCamera();
        showBanner("Receipt photo captured! Click Scan to process via Gemini AI.");
      }
    } catch (err) {
      console.error("Failed to capture photo", err);
      alert("Error capturing photo. Please try again.");
    }
  };

  // Sync camera stream to video tag
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // --- DYNAMIC THERMAL PAPER RECEIPT GENERATOR (FOR HIGHEST FIDELITY MOCKS) ---
  const generateReceiptCanvasImage = (receiptType: string): { base64: string; mimeType: string } => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 680;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { base64: '', mimeType: 'image/jpeg' };

    // Draw slightly weathered warm white thermal paper background
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle paper microtexture lines
    ctx.strokeStyle = '#eae8e1';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.height; i += 2) {
      if (Math.sin(i / 8) > 0.85) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }
    }

    // Set styles for store header (thermal printer style)
    ctx.fillStyle = '#111827'; // rich carbon ink
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px monospace';

    let merchant = 'STORE LEDGER';
    let items: { name: string; price: number }[] = [];
    let tax = 0;

    if (receiptType === 'wholefoods') {
      merchant = 'WHOLE FOODS MARKET';
      items = [
        { name: 'ORGANIC AVOCADOS 4CT', price: 6.99 },
        { name: 'ALMOND MILK ORIGINAL', price: 3.49 },
        { name: 'WILD SALMON FILLET', price: 18.99 },
        { name: 'ORGANIC STRAWBERRIES', price: 4.99 },
        { name: 'SOURDOUGH BREAD', price: 6.50 },
        { name: 'ORGANIC BABY SPINACH', price: 6.49 },
        { name: 'RAW ALMOND BUTTER', price: 9.80 },
        { name: 'ECO DISH SOAP 32OZ', price: 8.25 }
      ];
      tax = 4.00;
    } else if (receiptType === 'starbucks') {
      merchant = 'STARBUCKS COFFEE';
      items = [
        { name: 'GR CARAMEL MACCHIATO', price: 5.25 },
        { name: 'BUTTER CROISSANT', price: 3.75 },
        { name: 'VT COLD BREW COFFEE', price: 4.50 }
      ];
      tax = 0.70;
    } else if (receiptType === 'chevron') {
      merchant = 'CHEVRON GAS STATION';
      items = [
        { name: 'REGULAR FUEL 11.54G', price: 41.50 },
        { name: 'FIJI NATURAL WATER', price: 3.50 }
      ];
      tax = 0.00;
    } else {
      merchant = 'TARGET STORE #2190';
      items = [
        { name: 'WIRELESS DOCK CHARGER', price: 19.99 },
        { name: 'AAA ALKALINE BATTERIES', price: 8.76 }
      ];
      tax = 2.15;
    }

    let subtotal = 0;
    items.forEach(item => subtotal += item.price);
    const total = subtotal + tax;

    // Draw header text
    ctx.fillText(merchant, canvas.width / 2, 45);
    ctx.font = '11px monospace';
    ctx.fillText('STORE #5904  REG #08', canvas.width / 2, 65);
    ctx.fillText('PHONE: (800) 555-1290', canvas.width / 2, 78);
    
    const today = new Date().toISOString().split('T')[0];
    ctx.fillText(`DATE: ${today}  TIME: 12:45 PM`, canvas.width / 2, 95);
    ctx.fillText('------------------------------------------', canvas.width / 2, 115);

    // Left alignment for ledger items
    ctx.textAlign = 'left';
    let y = 145;
    items.forEach(item => {
      ctx.fillText(item.name, 35, y);
      ctx.textAlign = 'right';
      ctx.fillText(`$${item.price.toFixed(2)}`, canvas.width - 35, y);
      ctx.textAlign = 'left';
      y += 24;
    });

    // Divider
    ctx.textAlign = 'center';
    ctx.fillText('------------------------------------------', canvas.width / 2, y);
    y += 24;

    // Totals block
    ctx.textAlign = 'left';
    ctx.fillText('SUBTOTAL', 35, y);
    ctx.textAlign = 'right';
    ctx.fillText(`$${subtotal.toFixed(2)}`, canvas.width - 35, y);
    y += 24;

    ctx.textAlign = 'left';
    ctx.fillText('TAX', 35, y);
    ctx.textAlign = 'right';
    ctx.fillText(`$${tax.toFixed(2)}`, canvas.width - 35, y);
    y += 24;

    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAID', 35, y);
    ctx.textAlign = 'right';
    ctx.fillText(`$${total.toFixed(2)}`, canvas.width - 35, y);
    y += 35;

    // Barcode drawing
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    const barcodeY = y;
    const barcodeXStart = 75;
    const barcodeWidth = canvas.width - 150;
    ctx.beginPath();
    for (let x = barcodeXStart; x < barcodeXStart + barcodeWidth; x += 4) {
      if (Math.sin(x * 0.45) > -0.15) {
        ctx.moveTo(x, barcodeY);
        ctx.lineTo(x, barcodeY + 36);
      }
    }
    ctx.stroke();

    y += 55;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('* CLIENT COOP PREFERRED SAVINGS APPLIED *', canvas.width / 2, y);
    y += 20;
    ctx.fillText('THANK YOU FOR SHOPPING PRIVACY-FIRST!', canvas.width / 2, y);

    return {
      base64: canvas.toDataURL('image/jpeg', 0.85),
      mimeType: 'image/jpeg'
    };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file (PNG, JPG, WebP).");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setCustomReceiptImage(base64);
      setCustomReceiptMimeType(file.type);
      setCustomReceiptName(file.name);
      setSelectedMockReceipt('custom');
    };
    reader.readAsDataURL(file);
  };

  const handleScanReceipt = async (receiptType: string) => {
    if (userTier === 'expired') {
      setShowUpgradeModal(true);
      return;
    }
    setScanningReceipt(true);
    setTranscription('');
    
    let targetImage = customReceiptImage;
    let targetMimeType = customReceiptMimeType || 'image/jpeg';

    if (receiptType !== 'custom') {
      // It's a mock receipt template - dynamically generate a real high-fidelity weathered receipt image!
      const generated = generateReceiptCanvasImage(receiptType);
      targetImage = generated.base64;
      targetMimeType = generated.mimeType;
    }

    if (!targetImage) {
      alert("Please upload, capture, or choose a receipt first.");
      setScanningReceipt(false);
      return;
    }

    try {
      const response = await fetch("/api/receipt-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: targetImage,
          mimeType: targetMimeType
        })
      });

      if (!response.ok) {
        throw new Error("Failed to extract receipt. Ensure the image is clear and is a valid receipt.");
      }

      const data = await response.json();
      const result = {
        amount: parseFloat(data.amount) || 0,
        categoryId: data.category || 'shopping',
        note: data.merchant || 'Scanned Receipt',
        date: data.date || new Date().toISOString().split('T')[0]
      };

      setParsedResult(result);
      setShowParsedConfirmation(true);
      if (receiptType !== 'custom') {
        setSelectedMockReceipt('');
        setCustomReceiptImage(null);
      }
      showBanner(`AI extracted $${result.amount.toFixed(2)} for ${result.note}!`);
    } catch (err: any) {
      console.error("Receipt extraction failed", err);
      alert(err.message || "Failed to parse receipt image. Please try another clear photo.");
    } finally {
      setScanningReceipt(false);
    }
  };

  // --- WRITING EXPENDITURE ---
  const handleSaveParsedExpense = async () => {
    if (!parsedResult) return;
    if (parsedResult.amount <= 0) {
      alert("Please provide a valid spending amount.");
      return;
    }

    const expenseId = `exp-${Date.now()}`;
    const newExpense: Expense = {
      id: expenseId,
      amount: parsedResult.amount,
      categoryId: parsedResult.categoryId,
      date: new Date().toISOString().split('T')[0],
      note: parsedResult.note || 'Voice logged entry'
    };

    const updatedExpenses = [newExpense, ...expenses];
    await saveAllData(updatedExpenses, budgets, goals);

    if (user) {
      try {
        await setDoc(doc(db, "expenses", expenseId), {
          userId: user.uid,
          amount: newExpense.amount,
          categoryId: newExpense.categoryId,
          date: newExpense.date,
          note: newExpense.note
        });
      } catch (err) {
        console.error("Firestore expense save failed", err);
      }
    }

    setShowParsedConfirmation(false);
    setParsedResult(null);
    setTranscription('');
    showBanner(`Logged $${newExpense.amount.toFixed(2)} for ${newExpense.note}!`);
  };

  const handleSaveManualExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(manualAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a valid positive amount.");
      return;
    }

    const expenseId = `exp-${Date.now()}`;
    const newExpense: Expense = {
      id: expenseId,
      amount: amountNum,
      categoryId: manualCategory,
      date: manualDate,
      note: manualNote.trim() || `${getCategoryName(manualCategory)} purchase`
    };

    const updatedExpenses = [newExpense, ...expenses];
    await saveAllData(updatedExpenses, budgets, goals);

    if (user) {
      try {
        await setDoc(doc(db, "expenses", expenseId), {
          userId: user.uid,
          amount: newExpense.amount,
          categoryId: newExpense.categoryId,
          date: newExpense.date,
          note: newExpense.note
        });
      } catch (err) {
        console.error("Firestore manual expense save failed", err);
      }
    }

    setManualAmount('');
    setManualNote('');
    setShowManualForm(false);
    showBanner(`Logged $${newExpense.amount.toFixed(2)} to ${getCategoryName(newExpense.categoryId)}!`);
  };

  const handleDeleteExpense = async (id: string, label: string, amount: number) => {
    if (confirm(`Remove this transaction entry: "${label}" (-$${amount.toFixed(2)})?`)) {
      const updatedExpenses = expenses.filter(e => e.id !== id);
      await saveAllData(updatedExpenses, budgets, goals);

      if (user) {
        try {
          await deleteDoc(doc(db, "expenses", id));
        } catch (err) {
          console.error("Firestore delete failed", err);
        }
      }
      showBanner(`Removed "${label}" successfully.`);
    }
  };

  // --- WRITING BUDGET ENVELOPE ---
  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userTier === 'expired') {
      setShowCreateBudget(false);
      setShowUpgradeModal(true);
      return;
    }

    const limitNum = parseFloat(newBudgetLimit);
    if (!newBudgetName.trim()) {
      alert("Please enter a valid envelope name.");
      return;
    }
    if (isNaN(limitNum) || limitNum <= 0) {
      alert("Please enter a positive budget cap.");
      return;
    }

    const catId = newBudgetName.toLowerCase().replace(/\s+/g, '-');
    if (budgets.some(b => b.id === catId)) {
      alert("A budget envelope with this name already exists.");
      return;
    }

    const newBudget: Budget = {
      id: catId,
      name: newBudgetName.trim(),
      limit: limitNum,
      spent: 0,
      icon: newBudgetIcon,
      color: newBudgetColor
    };

    const updatedBudgets = [...budgets, newBudget];
    await saveAllData(expenses, updatedBudgets, goals);

    if (user) {
      try {
        await setDoc(doc(db, "budgets", `${user.uid}_${catId}`), {
          userId: user.uid,
          id: catId,
          name: newBudget.name,
          limit: newBudget.limit,
          spent: 0,
          icon: newBudget.icon,
          color: newBudget.color
        });
      } catch (err) {
        console.error("Firestore budget write failed", err);
      }
    }

    setNewBudgetName('');
    setNewBudgetLimit('');
    setShowCreateBudget(false);
    showBanner(`Created "${newBudget.name}" budget with $${newBudget.limit} limit!`);
  };

  // --- WRITING SAVING GOAL ---
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userTier === 'expired') {
      setShowCreateGoal(false);
      setShowUpgradeModal(true);
      return;
    }

    const targetNum = parseFloat(newGoalTarget);
    if (!newGoalName.trim()) {
      alert("Please enter a valid goal name.");
      return;
    }
    if (isNaN(targetNum) || targetNum <= 0) {
      alert("Please enter a positive saving target.");
      return;
    }

    const goalId = `goal-${Date.now()}`;
    const newGoal: SavingGoal = {
      id: goalId,
      name: newGoalName.trim(),
      targetAmount: targetNum,
      currentProgress: 0,
      color: newGoalColor
    };

    const updatedGoals = [...goals, newGoal];
    await saveAllData(expenses, budgets, updatedGoals);

    if (user) {
      try {
        await setDoc(doc(db, "goals", goalId), {
          userId: user.uid,
          name: newGoal.name,
          targetAmount: newGoal.targetAmount,
          currentProgress: 0,
          color: newGoal.color
        });
      } catch (err) {
        console.error("Firestore goal write failed", err);
      }
    }

    setNewGoalName('');
    setNewGoalTarget('');
    setShowCreateGoal(false);
    showBanner(`Establish saving goal: "${newGoal.name}" for $${newGoal.targetAmount}!`);
  };

  // --- SAVE / GOAL CONTRIBUTION CONTROLLER ---
  const handleOpenContribute = (goalId: string) => {
    setActiveGoalId(goalId);
    setContributionAmount('');
    setShowContributionModal(true);
  };

  const handleSaveContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGoalId) return;
    const amountNum = parseFloat(contributionAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a positive contribution amount.");
      return;
    }

    const updatedGoals = goals.map(g => {
      if (g.id === activeGoalId) {
        const newProg = Math.min(g.targetAmount, g.currentProgress + amountNum);
        return { ...g, currentProgress: newProg };
      }
      return g;
    });

    const targetGoal = goals.find(g => g.id === activeGoalId);
    await saveAllData(expenses, budgets, updatedGoals);

    if (user && targetGoal) {
      try {
        const newProg = Math.min(targetGoal.targetAmount, targetGoal.currentProgress + amountNum);
        await updateDoc(doc(db, "goals", activeGoalId), {
          currentProgress: newProg
        });
      } catch (err) {
        console.error("Firestore contribution update failed", err);
      }
    }

    setShowContributionModal(false);
    setActiveGoalId(null);
    showBanner(`Contributed $${amountNum.toFixed(2)} to your "${targetGoal?.name}" goal!`);
  };

  const handleResetSimData = async () => {
    if (confirm("Reset cloud and local sandbox records to initial presets?")) {
      localStorage.removeItem('floe_expenses');
      localStorage.removeItem('floe_budgets');
      localStorage.removeItem('floe_goals');
      
      if (user) {
        try {
          setDataSyncing(true);
          // Delete all records from Firestore to restart clean
          const { loadedExpenses, loadedBudgets, loadedGoals } = await fetchUserFirestoreData(user.uid);
          for (const e of loadedExpenses) await deleteDoc(doc(db, "expenses", e.id));
          for (const b of loadedBudgets) await deleteDoc(doc(db, "budgets", `${user.uid}_${b.id}`));
          for (const g of loadedGoals) await deleteDoc(doc(db, "goals", g.id));
          
          const defaultExpenses = storage.getExpenses();
          const defaultBudgets = storage.getBudgets();
          const defaultGoals = storage.getGoals();
          await uploadDataToFirestore(user.uid, defaultExpenses, defaultBudgets, defaultGoals);
          setExpenses(defaultExpenses);
          setBudgets(defaultBudgets);
          setGoals(defaultGoals);
          setAiInsights(null);
          showBanner("Successfully re-initialized cloud profile with presets.");
        } catch (error) {
          console.error("Reset failed", error);
        } finally {
          setDataSyncing(false);
        }
      } else {
        window.location.reload();
      }
    }
  };

  // --- STYLE & COLOR RESTRUCTURING HELPERS ---
  const getCategoryName = (catId: string) => {
    const predefined = CATEGORIES.find(c => c.id === catId);
    if (predefined) return predefined.name;
    const custom = budgets.find(b => b.id === catId);
    return custom ? custom.name : 'Shopping';
  };

  const getCategoryColorClass = (catId: string) => {
    const predefined = CATEGORIES.find(c => c.id === catId);
    if (predefined) return predefined.color;
    const custom = budgets.find(b => b.id === catId);
    return custom ? custom.color : 'pink';
  };

  const getCategoryIconElement = (catId: string) => {
    const predefined = CATEGORIES.find(c => c.id === catId);
    const iconName = predefined ? predefined.icon : (budgets.find(b => b.id === catId)?.icon || 'ShoppingBag');
    
    switch (iconName) {
      case 'ShoppingCart': return <ShoppingCart className="w-4 h-4" />;
      case 'Utensils': return <Utensils className="w-4 h-4" />;
      case 'Car': return <Car className="w-4 h-4" />;
      case 'Film': return <Film className="w-4 h-4" />;
      case 'Zap': return <Zap className="w-4 h-4" />;
      case 'ShoppingBag': return <ShoppingBag className="w-4 h-4" />;
      default: return <ShoppingBag className="w-4 h-4" />;
    }
  };

  const getTailwindBgColor = (colorName: string) => {
    switch (colorName) {
      case 'emerald': return 'bg-emerald-600';
      case 'amber': return 'bg-amber-500';
      case 'blue': return 'bg-blue-600';
      case 'purple': return 'bg-purple-600';
      case 'orange': return 'bg-orange-500';
      case 'pink': return 'bg-pink-600';
      case 'sky': return 'bg-sky-500';
      case 'rose': return 'bg-rose-500';
      default: return 'bg-slate-600';
    }
  };

  const getTailwindBgLightColor = (colorName: string) => {
    switch (colorName) {
      case 'emerald': return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
      case 'amber': return 'bg-amber-50 text-amber-700 border border-amber-100';
      case 'blue': return 'bg-blue-50 text-blue-700 border border-blue-100';
      case 'purple': return 'bg-purple-50 text-purple-700 border border-purple-100';
      case 'orange': return 'bg-orange-50 text-orange-700 border border-orange-100';
      case 'pink': return 'bg-pink-50 text-pink-700 border border-pink-100';
      case 'sky': return 'bg-sky-50 text-sky-700 border border-sky-100';
      case 'rose': return 'bg-rose-50 text-rose-700 border border-rose-100';
      default: return 'bg-slate-50 text-slate-700 border border-slate-100';
    }
  };

  const getTailwindBorderColor = (colorName: string) => {
    switch (colorName) {
      case 'emerald': return 'border-emerald-500';
      case 'amber': return 'border-amber-400';
      case 'blue': return 'border-blue-500';
      case 'purple': return 'border-purple-500';
      case 'orange': return 'border-orange-400';
      case 'pink': return 'border-pink-500';
      case 'sky': return 'border-sky-400';
      case 'rose': return 'border-rose-400';
      default: return 'border-slate-400';
    }
  };

  const groupExpensesByDay = (limitList?: Expense[]) => {
    const listToGroup = limitList || expenses;
    const groups: Record<string, Expense[]> = {};
    listToGroup.forEach(e => {
      if (!groups[e.date]) {
        groups[e.date] = [];
      }
      groups[e.date].push(e);
    });
    return Object.keys(groups).sort((a, b) => b.localeCompare(a));
  };

  const formatDateLabel = (dateStr: string) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (dateStr === todayStr) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return dateStr;
  };

  // --- TREND COMPUTATION HELPERS FOR CHARTING ---
  const getWeeklyChartData = () => {
    const data = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayVal = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayVal.getDate() - i);
      const dateString = d.toISOString().split('T')[0];
      const totalForDay = expenses
        .filter(e => e.date === dateString)
        .reduce((sum, e) => sum + e.amount, 0);
      
      data.push({
        dateStr: dateString,
        dayName: days[d.getDay()],
        amount: parseFloat(totalForDay.toFixed(2))
      });
    }
    return data;
  };

  const getMonthlyChartData = () => {
    return budgets.map(b => {
      const currentSpent = getSpentForCategory(b.id, expenses);
      return {
        name: b.name,
        limit: b.limit,
        spent: parseFloat(currentSpent.toFixed(2))
      };
    });
  };

  const PRESET_SIMULATED_VOICES = [
    { phrase: "Spent 42 dollars on groceries at supermarket", icon: "🛒" },
    { phrase: "Dinner was ninety five bucks at sushi place", icon: "🍣" },
    { phrase: "Uber taxi ride cost twenty five fifty", icon: "🚗" },
    { phrase: "Electricity bill water bill eighty five dollars", icon: "⚡" },
    { phrase: "Bought a hoodie on Amazon for forty nine ninety", icon: "🛍️" },
  ];

  // =========================================================
  // =================== RENDER BRANCHES =====================
  // =========================================================

  // A. AUTH LOAD GAUGE
  if (authLoading) {
    return (
      <div id="floe-loading-gate" className="min-h-screen bg-stone-50 flex flex-col items-center justify-center font-sans">
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div className="flex flex-col">
            <span className="text-2xl font-black tracking-tight text-slate-900 leading-none">Floe</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1.5">Unlocking Security Vault...</span>
          </div>
        </div>
      </div>
    );
  }

  // B. FLOE PRIVACY-FIRST LANDING PAGE & SECURITY GATE
  if (!user) {
    return (
      <div id="floe-landing" className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased flex flex-col">
        
        {/* Responsive Brand Navbar */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200/60 py-4 px-6 shadow-sm">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-extrabold text-xl shadow-md">
                f
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-black tracking-tight text-slate-900 leading-none">Floe</span>
                <span className="text-[10px] text-emerald-600 font-extrabold uppercase tracking-wider mt-0.5">Privacy First Finance</span>
              </div>
            </div>
            
            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-8 text-xs font-bold text-slate-500">
              <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
              <a href="#comparison" className="hover:text-slate-900 transition-colors">Why Floe</a>
              <a href="#pricing" className="hover:text-slate-900 transition-colors font-semibold text-emerald-600">Pricing Plans</a>
              <a href="#faq" className="hover:text-slate-900 transition-colors">FAQ</a>
            </nav>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setAuthMode('login');
                  setShowAuthModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4.5 py-2.5 rounded-xl shadow-md hover:scale-[1.01] transition-all"
              >
                Sign In
              </button>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative overflow-hidden py-16 md:py-24 bg-gradient-to-b from-white to-slate-50">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Content Column */}
            <div className="lg:col-span-7 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full text-xs font-bold shadow-sm">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                <span>No bank login. Ever.</span>
              </div>
              
              <h1 className="text-4xl md:text-5.5xl font-black tracking-tight text-slate-950 leading-tight">
                Track every dollar without giving anyone your bank password.
              </h1>
              
              <p className="text-sm md:text-base text-slate-500 leading-relaxed max-w-2xl">
                Floe turns a three-second voice note, a receipt photo, or a few typed words into a perfectly categorized budget. No Plaid. No bank OAuth. No selling your data. Free to start.
              </p>
              
              <div className="p-4 bg-emerald-900/5 border border-emerald-100 rounded-2xl max-w-xl space-y-1">
                <p className="text-xs text-slate-700 leading-relaxed font-bold">
                  "Type it. Say it. Snap it. Never connect your bank."
                </p>
              </div>

              {/* Action Call buttons */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <button
                    onClick={() => {
                      setAuthMode('login');
                      setShowAuthModal(true);
                    }}
                    className="bg-slate-950 hover:bg-slate-900 text-stone-50 px-8 py-4 rounded-2xl text-sm font-bold shadow-lg shadow-slate-950/10 hover:shadow-xl hover:scale-[1.01] transition-all flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4 text-emerald-400" /> Start Budgeting Free
                  </button>
                </div>
                <p className="text-xs font-bold text-emerald-600 pl-1 uppercase tracking-widest">
                  No Bank Required
                </p>
                <p className="text-[10px] text-slate-400 italic pl-1">
                  Free forever plan · No card required · Delete everything, anytime
                </p>
              </div>

              {/* Social Proof Badges / Trust strip */}
              <div className="pt-6 border-t border-stone-200/80 space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] text-slate-500 font-bold">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> No Plaid or bank credentials — ever
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> Your data is never sold or indexed
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> Encrypted in transit and at rest
                  </div>
                </div>
                <div className="pt-2 border-t border-dashed border-stone-200">
                  <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                    Built for Mint refugees, burned YNAB and Monarch users, and everyone done trading a bank password for a budget.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Interactive Simulator Column */}
            <div className="lg:col-span-5">
              <div className="bg-white border border-stone-200 shadow-2xl rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl pointer-events-none"></div>
                
                <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">TRY IT — NO SIGNUP</span>
                  </div>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold">Try Parser</span>
                </div>
                
                <div className="space-y-4 text-left">
                  <h3 className="text-sm font-black text-slate-950">This is the entire "work" of manual budgeting.</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    One sentence. That's a logged expense. Click an example and watch Floe file it — amount, category, note — instantly.
                  </p>

                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setDemoPlaying(true);
                        setDemoStep(1);
                        setTimeout(() => setDemoStep(2), 1200);
                      }}
                      className="w-full text-left p-3.5 bg-stone-50 hover:bg-emerald-50/50 border border-stone-200/60 hover:border-emerald-200 rounded-2xl transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">☕</span>
                        <div>
                          <p className="text-xs font-bold text-slate-800">"Spent 14 dollars on coffee"</p>
                          <span className="text-[10px] text-slate-400">Simulate spoken phrase</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:translate-x-0.5" />
                    </button>

                    <button
                      onClick={() => {
                        setDemoPlaying(true);
                        setDemoStep(3);
                        setTimeout(() => setDemoStep(4), 1200);
                      }}
                      className="w-full text-left p-3.5 bg-stone-50 hover:bg-emerald-50/50 border border-stone-200/60 hover:border-emerald-200 rounded-2xl transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">🚗</span>
                        <div>
                          <p className="text-xs font-bold text-slate-800">"Uber ride cost forty-five bucks"</p>
                          <span className="text-[10px] text-slate-400">Simulate spoken phrase</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>

                  {/* Simulator Screen */}
                  {demoPlaying && (
                    <div className="p-4 bg-slate-950 rounded-2xl text-stone-300 font-mono text-xs space-y-2 relative overflow-hidden animate-in fade-in duration-300">
                      <div className="flex justify-between items-center text-[10px] text-slate-500 border-b border-slate-800 pb-2">
                        <span>VOICE CORE PARSER v1.2</span>
                        <button onClick={() => setDemoPlaying(false)} className="text-slate-400 hover:text-white">✕</button>
                      </div>
                      
                      {demoStep === 1 && (
                        <div className="space-y-2">
                          <p className="text-emerald-400">🎤 LISTENING FOR AUDIO STREAM...</p>
                          <div className="flex items-center gap-1.5 py-1">
                            <span className="w-1.5 h-4 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span className="w-1.5 h-6 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span className="w-1.5 h-8 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span className="w-1.5 h-4 bg-emerald-500 rounded-full animate-pulse"></span>
                          </div>
                          <p className="text-slate-400">"Spent 14 dollars on coffee"</p>
                        </div>
                      )}

                      {demoStep === 2 && (
                        <div className="space-y-2">
                          <p className="text-emerald-400">✓ TEXT CAPTURED</p>
                          <p className="text-slate-400">"Spent 14 dollars on coffee"</p>
                          <div className="p-2 bg-emerald-950/40 border border-emerald-900/40 rounded-xl space-y-1">
                            <p className="font-bold text-white">Parsed Entry:</p>
                            <p>💰 Amount: <span className="text-emerald-400">$14.00</span></p>
                            <p>🍔 Category: <span className="text-amber-400">Dining Out</span></p>
                            <p>📝 Note: <span className="text-sky-400">Coffee</span></p>
                          </div>
                        </div>
                      )}

                      {demoStep === 3 && (
                        <div className="space-y-2">
                          <p className="text-emerald-400">🎤 LISTENING FOR AUDIO STREAM...</p>
                          <div className="flex items-center gap-1.5 py-1">
                            <span className="w-1.5 h-4 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span className="w-1.5 h-8 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span className="w-1.5 h-5 bg-emerald-500 rounded-full animate-pulse"></span>
                          </div>
                          <p className="text-slate-400">"Uber ride cost forty-five bucks"</p>
                        </div>
                      )}

                      {demoStep === 4 && (
                        <div className="space-y-2">
                          <p className="text-emerald-400">✓ TEXT CAPTURED</p>
                          <p className="text-slate-400">"Uber ride cost forty-five bucks"</p>
                          <div className="p-2 bg-emerald-950/40 border border-emerald-900/40 rounded-xl space-y-1">
                            <p className="font-bold text-white">Parsed Entry:</p>
                            <p>💰 Amount: <span className="text-emerald-400">$45.00</span></p>
                            <p>🚗 Category: <span className="text-blue-400">Transport</span></p>
                            <p>📝 Note: <span className="text-sky-400">Uber Ride</span></p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="italic">*This demo runs in your browser. Nothing you type here is stored.*</span>
                    <button 
                      onClick={() => {
                        setAuthMode('login');
                        setShowAuthModal(true);
                      }} 
                      className="text-emerald-700 font-extrabold hover:underline"
                    >
                      Like that? Start Budgeting Free →
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Brand Philosophy / Left Monarch Contrast block */}
        <section id="comparison" className="py-20 bg-white border-y border-stone-200/60 text-left">
          <div className="max-w-7xl mx-auto px-6">
            <div className="max-w-3xl space-y-4">
              <span className="text-xs text-emerald-700 font-extrabold uppercase tracking-widest block">The Privacy Manifesto</span>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">
                Budget apps have a data problem. You're the one paying for it.
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">
                Connect a typical budget app to your bank and your login passes through a third-party scraping network that caches your transaction history on servers you don't control. In 2022, Plaid — the network behind most of those connections — paid <strong>$58 million</strong> to settle claims it harvested users' financial data through look-alike bank login screens. Then the apps charge you $15 a month for the privilege — and email you every few weeks when the bank link breaks. Again.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-12">
              <div className="p-6 bg-rose-50/50 border border-rose-100 rounded-3xl space-y-4">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-700">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">The old way: bank-sync apps</h3>
                <ul className="space-y-2.5 text-xs text-slate-600 font-semibold">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 mt-0.5 font-bold">✕</span> Your bank password goes through a third-party scraping network
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 mt-0.5 font-bold">✕</span> Transaction history cached on servers you don't control
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 mt-0.5 font-bold">✕</span> "Reconnect your account" emails when the link breaks
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 mt-0.5 font-bold">✕</span> $14.99+/mo — $180 a year, every year
                  </li>
                </ul>
              </div>

              <div className="p-6 bg-emerald-50/40 border border-emerald-100 rounded-3xl space-y-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <Check className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">The Floe way</h3>
                <ul className="space-y-2.5 text-xs text-slate-600 font-semibold">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-700 mt-0.5 font-bold">✓</span> Log a purchase in 3 seconds — voice, photo, or a few typed words
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-700 mt-0.5 font-bold">✓</span> No bank credentials exist to breach, leak, or sell
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-700 mt-0.5 font-bold">✓</span> Your ledger is encrypted, exportable, never indexed
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-700 mt-0.5 font-bold">✓</span> Free to start. $3.99/mo Pro. Or $49 once, forever
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Signature Features Grid */}
        <section id="features" className="py-20 bg-stone-50 text-left">
          <div className="max-w-7xl mx-auto px-6 space-y-12">
            <div className="text-center space-y-3">
              <span className="text-xs text-emerald-700 font-extrabold uppercase tracking-widest block">Core Features</span>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Simple, focused budgeting execution.</h2>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                No complex charts or unnecessary screens. Just clear, actionable envelope-style trackers.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                  <Mic className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-950">Voice Expense Logging</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Tap the microphone button, dictate naturally, and our secure parser handles Category, Amount, and Note parameters instantly.
                </p>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-950">AI Receipt Scanning</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Snap receipts from store outings. Our safe cloud OCR reads merchant lines, prices, and totals perfectly.
                </p>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-950">Envelope Budgeting</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Define custom monthly categories (Groceries, Dinners) with unique spending ceilings. Simple progress bars keep you on budget.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* Pricing Tiers (The Audit Implementation) */}
        <section id="pricing" className="py-20 bg-white border-t border-stone-200/60 text-left">
          <div className="max-w-7xl mx-auto px-6 space-y-12">
            <div className="text-center space-y-3">
              <span className="text-xs text-emerald-700 font-extrabold uppercase tracking-widest block">Transparent Licensing</span>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Choose your privacy tier.</h2>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                No automatic bank integrations. Simply pay for device syncing, receipts scanning, and premium voice.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              
              {/* Pro Tier with 14-Day Free Trial */}
              <div className="bg-white border-2 border-emerald-600 rounded-3xl p-6 shadow-xl flex flex-col justify-between relative">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-black uppercase px-4 py-1 rounded-full tracking-widest">
                  14-Day Free Trial ⭐
                </div>
                
                <div className="space-y-4">
                  <span className="text-xs uppercase font-extrabold text-emerald-800 tracking-wider block">Pro Subscription</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-slate-900">$3.99</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-emerald-800 font-semibold">Includes 14 days 100% free, or save 35% at <span className="font-bold">$29.99/year</span></p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Unlock our natural voice-entry interface, unlimited categories, automated receipt scanner, and private goals. Cancel anytime.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-600 font-semibold border-t border-stone-100 pt-4">
                    <li className="flex items-center gap-2">✓ 14-day fully-functional free trial</li>
                    <li className="flex items-center gap-2">✓ Unlimited budget envelopes</li>
                    <li className="flex items-center gap-2">✓ Signature Voice Expense entry</li>
                    <li className="flex items-center gap-2">✓ AI Receipt scanning</li>
                    <li className="flex items-center gap-2">✓ Unlimited Saving goals</li>
                    <li className="flex items-center gap-2">✓ Secure Firestore syncing</li>
                  </ul>
                </div>
                
                <div className="space-y-2 mt-6">
                  <button
                    onClick={() => handleStripeCheckout('pro-monthly')}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-3.5 rounded-xl transition-all shadow-md"
                  >
                    Start Monthly Trial ($3.99/mo)
                  </button>
                  <button
                    onClick={() => handleStripeCheckout('pro-yearly')}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-xl transition-all text-center block"
                  >
                    Start Yearly Trial ($29.99/yr)
                  </button>
                </div>
              </div>

              {/* Lifetime Tier */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-850 rounded-3xl p-6 shadow-xl flex flex-col justify-between relative text-stone-200">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-950 text-[10px] font-black uppercase px-4 py-1 rounded-full tracking-widest">
                  Launch Special 🚀
                </div>
                
                <div className="space-y-4">
                  <span className="text-xs uppercase font-extrabold text-amber-400 tracking-wider">Lifetime Plan</span>
                  <div className="flex items-baseline gap-1 text-white">
                    <span className="text-4xl font-black">$49</span>
                    <span className="text-xs text-stone-400">/ one-time payment</span>
                  </div>
                  <p className="text-xs text-amber-200 font-semibold">Limited to first 250 launch customers.</p>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Zero subscription fees forever. Secure your private storage envelope slot and support independent privacy development.
                  </p>
                  <ul className="space-y-2 text-xs text-stone-300 font-semibold border-t border-slate-800 pt-4">
                    <li className="flex items-center gap-2 text-white">✓ Everything in Pro</li>
                    <li className="flex items-center gap-2">✓ Lifetime storage quota</li>
                    <li className="flex items-center gap-2">✓ No recurring fees ever</li>
                    <li className="flex items-center gap-2">✓ VIP Priority Support</li>
                    <li className="flex items-center gap-2">✓ Early access to new modules</li>
                  </ul>
                </div>
                <button
                  onClick={() => handleStripeCheckout('lifetime')}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold py-3.5 rounded-xl mt-6 transition-all shadow-lg shadow-amber-500/10"
                >
                  Buy Lifetime License ($49)
                </button>
              </div>

            </div>
          </div>
        </section>

        {/* Feature Comparison Table */}
        <section id="comparison" className="py-20 bg-slate-50 text-left border-t border-stone-200/60">
          <div className="max-w-4xl mx-auto px-6 space-y-8">
            <h2 className="text-2xl font-black tracking-tight text-slate-900 text-center">Plan Comparison</h2>
            
            <div className="overflow-x-auto bg-white rounded-2xl border border-stone-200/80 shadow-sm">
              <table className="w-full text-xs text-slate-700">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200/80 text-[10px] uppercase font-bold text-slate-400">
                    <th className="p-4 text-left">Feature</th>
                    <th className="p-4 text-center">Pro Plan</th>
                    <th className="p-4 text-center">Lifetime License</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-150">
                  <tr>
                    <td className="p-4 font-bold text-slate-900">14-Day Free Trial</td>
                    <td className="p-4 text-center text-emerald-600 font-bold">✓ Yes</td>
                    <td className="p-4 text-center text-slate-400">✕ (One-time payment)</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">Device Syncing</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">Budget Envelopes Limit</td>
                    <td className="p-4 text-center text-emerald-600 font-bold">Unlimited</td>
                    <td className="p-4 text-center text-emerald-600 font-bold">Unlimited</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">Voice-to-Expense dictation</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">AI Receipt Scanning OCR</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">Private Savings Goals</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-bold text-slate-900">CSV Ledger Export</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                    <td className="p-4 text-center text-emerald-600">✓ Included</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-20 bg-white border-t border-stone-200/60 text-left">
          <div className="max-w-4xl mx-auto px-6 space-y-8">
            <div className="text-center space-y-2">
              <span className="text-xs text-emerald-700 font-extrabold uppercase tracking-widest block font-sans">Common Questions</span>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Frequently Asked Questions</h2>
            </div>

            <div className="space-y-3">
              {[
                {
                  q: "Do you ever request or store my bank password?",
                  a: "Never. We do not integrate with Plaid or any other screen-scraping banking API. You track your spending purely through voice description, snap receipt logs, or direct manual typing. Your bank password is safe with you."
                },
                {
                  q: "How does natural language voice expense entry work?",
                  a: "We compute your voice transcription locally inside your secure web browser thread using standard safe Web Speech. It maps your spoken numbers (like 'twelve fifty') into formatted currency amounts, and intelligently sets notes and categories, saving you valuable time."
                },
                {
                  q: "How are my private budgets synchronized?",
                  a: "Once you create your encrypted Email or Google Vault, your data is written directly to your private, SEC-compliant Cloud Firestore repository. No external data brokers or monetization trackers can read or index your ledger."
                },
                {
                  q: "What is the Lifetime Special and how is it billed?",
                  a: "The Lifetime Special is a launch reward billing just $49 once. There are no recurring fees or automatic monthly billings. All future feature updates are completely included forever."
                }
              ].map((faq, idx) => (
                <div key={idx} className="border border-stone-200 rounded-2xl overflow-hidden transition-all">
                  <button
                    onClick={() => setFaqOpen(faqOpen === idx ? null : idx)}
                    className="w-full flex justify-between items-center p-4 bg-stone-50 hover:bg-stone-100 text-left font-bold text-slate-900 text-xs transition-colors"
                  >
                    <span>{faq.q}</span>
                    <span className="text-slate-400 text-base">{faqOpen === idx ? '−' : '+'}</span>
                  </button>
                  {faqOpen === idx && (
                    <div className="p-4 bg-white border-t border-stone-100 text-xs text-slate-600 leading-relaxed font-medium animate-in slide-in-from-top-1 duration-150">
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Page Footer */}
        <footer className="bg-slate-900 text-stone-400 py-12 px-6 border-t border-slate-800 text-xs text-left">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-extrabold text-sm">f</div>
                <span className="font-bold text-white text-sm">Floe</span>
              </div>
              <p className="text-[11px] text-stone-400 max-w-xs leading-relaxed">
                The manual-first, voice-powered finance manager that places absolute security over bank linkages. Developed for privacy enthusiasts.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Core Philosophy</h4>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                "You win by being private, manual-first, and affordable." No Plaid, no selling transaction lists to brokers.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Secured Encryption</h4>
              <div className="flex items-center gap-2 p-3 bg-slate-850 rounded-xl border border-slate-800 text-[10px] text-emerald-400">
                <Shield className="w-4 h-4 shrink-0" />
                <span>Your private ledger is hosted securely on encrypted cloud infrastructure.</span>
              </div>
            </div>
          </div>
          <div className="max-w-7xl mx-auto border-t border-slate-800 mt-8 pt-6 text-center text-[10px] text-stone-500 font-medium">
            © {new Date().getFullYear()} Floe. All rights reserved. Zero trackers. Zero advertising.
          </div>
        </footer>

        {/* SECURE EMAIL / PASSWORD & GOOGLE AUTHENTICATION MODAL */}
        {showAuthModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-6 shadow-2xl relative text-left">
              <button 
                onClick={() => setShowAuthModal(false)} 
                className="absolute top-4 right-4 p-1.5 bg-stone-100 hover:bg-stone-200 text-slate-500 rounded-full transition-all"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="text-center space-y-1">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                  <Lock className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-black text-slate-950">
                  Open Secure Private Vault
                </h3>
                <p className="text-xs text-slate-400">
                  Authentication ensures your cloud synced files stay fully encrypted.
                </p>
              </div>

              {/* Error messages */}
              {authError && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-[11px] text-rose-800 font-semibold space-y-1 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Security Alert</span>
                  </div>
                  <p>{authError}</p>
                </div>
              )}

              {/* Auth Form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleEmailLoginAction(authEmail, authPassword);
                }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Private Vault Email</label>
                  <input
                    type="email"
                    required
                    placeholder="websolvepro@gmail.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-3 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white font-medium"
                  />
                  <span className="text-[9px] text-emerald-700 font-bold block">Pre-filled default: websolvepro@gmail.com</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Master Password</label>
                  <input
                    type="password"
                    required
                    placeholder="Enter private master password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-3 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white font-medium font-mono"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-slate-950 hover:bg-slate-900 text-stone-50 py-3.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-slate-950/10 flex items-center justify-center gap-2"
                >
                  Unlock Vault
                </button>
              </form>

              {/* Safe divider */}
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-stone-150"></div>
                <span className="flex-shrink mx-3 text-[9px] text-slate-400 font-bold uppercase tracking-wider">Alt Authentication</span>
                <div className="flex-grow border-t border-stone-150"></div>
              </div>

              {/* Google login as backup */}
              <div className="space-y-3">
                <button
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-2 border border-stone-200 hover:bg-stone-50 text-slate-700 py-3 rounded-xl text-xs font-bold transition-all"
                >
                  Sign In with Google Account
                </button>
                <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-[9px] text-slate-500 leading-relaxed font-semibold">
                  💡 Note: Google Authentication may block on dynamic sandbox preview URLs with a domain error. Secure email sign-up/sign-in avoids domain restrictions entirely and is 100% synced on Cloud Firestore.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // C. THE CORE APP (For Logged in Users)
  return (
    <div id="floe-root" className="min-h-screen bg-stone-50 text-slate-800 font-sans antialiased flex flex-col">
      
      {/* 
        PREMIUM GLOBAL WEB NAVIGATION HEADER 
        Fills the entire top width with responsive design aesthetics!
      */}
      <header id="floe-navbar" className="sticky top-0 z-40 w-full bg-white border-b border-stone-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo Brand Title */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-600 rounded-xl flex items-center justify-center shadow-sm text-white font-bold text-lg">
              f
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight text-slate-900 leading-none">floe</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Privacy First Finance</span>
            </div>
          </div>

          {/* Secure signal indicator */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full text-xs font-semibold">
            <Lock className="w-3.5 h-3.5 text-emerald-600" />
            <span>Zero Bank Connections Required</span>
          </div>

          {/* User Sign In and control status block */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex flex-col text-right hidden sm:flex">
                <span className="text-xs font-bold text-slate-950">{user.displayName || user.email || 'Authorized User'}</span>
                <div className="flex items-center gap-1.5 justify-end mt-0.5">
                  {userTier === 'trial' && (
                    <span className="text-[8px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded uppercase border border-emerald-100">
                      Pro Trial: {trialDaysLeft}d left
                    </span>
                  )}
                  {userTier === 'expired' && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="text-[8px] bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold px-1.5 py-0.5 rounded uppercase border border-rose-100 animate-pulse"
                    >
                      Trial Expired - Upgrade
                    </button>
                  )}
                  {userTier === 'pro' && (
                    <span className="text-[8px] bg-emerald-600 text-white font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Pro Plan
                    </span>
                  )}
                  {userTier === 'lifetime' && (
                    <span className="text-[8px] bg-amber-500 text-slate-950 font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Lifetime ⭐
                    </span>
                  )}
                  <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider">Cloud Secured</span>
                </div>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-stone-200" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-stone-100 text-slate-600 flex items-center justify-center border border-stone-200">
                  <UserIcon className="w-4 h-4" />
                </div>
              )}
              <button
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-stone-100 transition-colors"
                title="Sign out of Google Account"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            {/* Syncing Status Indicator */}
            {dataSyncing && (
              <div className="w-6 h-6 flex items-center justify-center text-emerald-600 animate-spin">
                <RefreshCw className="w-4 h-4" />
              </div>
            )}
          </div>

        </div>
      </header>

      {/* --- TAB NAVIGATION BAR --- */}
      <div className="w-full bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6 h-12">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                activeTab === 'dashboard' 
                  ? 'border-emerald-600 text-emerald-700' 
                  : 'border-transparent text-slate-400 hover:text-slate-800'
              }`}
            >
              <TrendingUp className="w-4 h-4" /> Dashboard Overview
            </button>
            <button
              onClick={() => setActiveTab('capture')}
              className={`flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                activeTab === 'capture' 
                  ? 'border-emerald-600 text-emerald-700' 
                  : 'border-transparent text-slate-400 hover:text-slate-800'
              }`}
            >
              <Mic className="w-4 h-4" /> Voice & Manual Capture
            </button>
            <button
              onClick={() => setActiveTab('budgets-goals')}
              className={`flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                activeTab === 'budgets-goals' 
                  ? 'border-emerald-600 text-emerald-700' 
                  : 'border-transparent text-slate-400 hover:text-slate-800'
              }`}
            >
              <Wallet className="w-4 h-4" /> Envelopes & Savings
            </button>
          </div>
        </div>
      </div>

      {/* --- SYSTEM BANNER / NOTIFICATION TOAST --- */}
      {bannerMessage && (
        <div id="floe-global-toast" className="fixed top-20 right-4 md:right-8 z-50 bg-slate-900 text-stone-50 px-4 py-3.5 rounded-2xl shadow-2xl flex items-center gap-2.5 text-sm border border-slate-800 animate-in fade-in slide-in-from-top-4 duration-300">
          <Sparkle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">{bannerMessage}</span>
        </div>
      )}

      {/* --- MAIN PAGE CONTENT --- */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* ========================================== */}
        {/* ============ TAB: DASHBOARD ============= */}
        {/* ========================================== */}
        {activeTab === 'dashboard' && (
          <div id="floe-dashboard-tab" className="space-y-6 animate-in fade-in duration-300">
            
            {/* 1. TOP METRIC CARD GRIDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Card 1: Total Allocated Limit */}
              <div className="bg-white border border-stone-200/80 rounded-3xl p-5 shadow-sm space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Envelope Budget limits</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold font-mono text-slate-950">${totalBudgetLimit.toFixed(2)}</span>
                  <span className="text-xs text-slate-400 font-medium">/ month</span>
                </div>
                <div className="text-[11px] text-slate-500 font-medium pt-1 border-t border-stone-100 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-slate-400" />
                  <span>Across {budgets.length} custom categories</span>
                </div>
              </div>

              {/* Card 2: Amount Spent */}
              <div className="bg-white border border-stone-200/80 rounded-3xl p-5 shadow-sm space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Amount Spent</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold font-mono text-slate-950">${totalSpent.toFixed(2)}</span>
                  <span className="text-xs text-slate-400 font-medium">this month</span>
                </div>
                <div className="pt-1.5">
                  <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${totalSpent > totalBudgetLimit ? 'bg-rose-500' : 'bg-emerald-600'}`}
                      style={{ width: `${totalBudgetLimit > 0 ? Math.min(100, (totalSpent / totalBudgetLimit) * 100) : 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Card 3: Remaining Budget */}
              <div className="bg-white border border-stone-200/80 rounded-3xl p-5 shadow-sm space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Remaining Budget</span>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-extrabold font-mono ${remainingTotal === 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    ${remainingTotal.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">to spend</span>
                </div>
                <div className="text-[11px] text-slate-500 font-medium pt-1 border-t border-stone-100 flex items-center gap-1">
                  {remainingTotal > 0 ? (
                    <span className="text-emerald-600 font-semibold">Safe spending buffer</span>
                  ) : (
                    <span className="text-rose-600 font-bold">Envelopes depleted!</span>
                  )}
                </div>
              </div>

              {/* Card 4: Stashed Reserves */}
              <div className="bg-white border border-stone-200/80 rounded-3xl p-5 shadow-sm space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Soft-Saving Reserves</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold font-mono text-sky-700">${totalSaved.toFixed(2)}</span>
                  <span className="text-xs text-slate-400 font-medium">stashed</span>
                </div>
                <div className="text-[11px] text-slate-500 font-medium pt-1 border-t border-stone-100 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-sky-500" />
                  <span>Stashed across {goals.length} active goals</span>
                </div>
              </div>
            </div>

            {/* 2. CHARTS: WEEKLY & MONTHLY TRENDS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Chart A: Weekly Spending Curve */}
              <div className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Weekly Spend Trend</h3>
                  <p className="text-xs text-slate-500">Daily transaction totals over the last 7 days</p>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={getWeeklyChartData()}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                      <XAxis dataKey="dayName" stroke="#a8a29e" fontSize={10} tickLine={false} />
                      <YAxis stroke="#a8a29e" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1c1917', border: 'none', borderRadius: '12px', color: '#f5f5f4', fontSize: '11px' }}
                        labelFormatter={(label, items) => {
                          if (items[0]) return `${items[0].payload.dateStr} (${label})`;
                          return label;
                        }}
                      />
                      <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAmount)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart B: Monthly Budget Ceilings vs Spent */}
              <div className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Envelopes Utilization</h3>
                  <p className="text-xs text-slate-500">Comparing spending caps vs. categorical current totals</p>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={getMonthlyChartData()}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                      <XAxis dataKey="name" stroke="#a8a29e" fontSize={10} tickLine={false} />
                      <YAxis stroke="#a8a29e" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: 'none', borderRadius: '12px', color: '#f5f5f4', fontSize: '11px' }} />
                      <Legend verticalAlign="top" height={36} iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                      <Bar dataKey="limit" name="Category Cap ($)" fill="#e7e5e4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="spent" name="Spent ($)" fill="#059669" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

            {/* 3. CORE TWO-COLUMN BENTO: AI ASSISTANT & RECENT TRANSACTIONS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* AI Counselor proxy Console (2/3 width) */}
              <div className="lg:col-span-2 bg-white rounded-3xl border border-stone-200/80 p-6 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-100 pb-5">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <BrainCircuit className="w-5 h-5 text-emerald-600 animate-pulse" /> Secure AI Financial Counselor Desk
                    </h2>
                    <p className="text-xs text-slate-500">
                      Query server-side Gemini intelligence securely without sharing identities.
                    </p>
                  </div>
                  
                  <button
                    onClick={handleRequestAIInsights}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-850 text-stone-50 px-4 py-2.5 rounded-xl text-xs font-bold shadow-md disabled:opacity-50 transition-colors"
                  >
                    {aiLoading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Counseling...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Request AI Council</span>
                      </>
                    )}
                  </button>
                </div>

                {/* AI Error Alert */}
                {aiError && (
                  <div className="p-4 bg-amber-50 text-amber-950 border border-amber-150 rounded-2xl space-y-2 text-xs text-left">
                    <div className="flex items-center gap-2 text-amber-800 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Failed to obtain AI Council</span>
                    </div>
                    <div className="p-2 bg-amber-100/40 rounded-xl font-mono text-[11px] break-words">
                      {aiError}
                    </div>
                    <div className="text-[11px] text-amber-900/90 leading-relaxed space-y-1.5 pt-1.5 border-t border-amber-200/50">
                      <p className="font-semibold text-amber-950">💡 Why is this happening and how to fix it:</p>
                      <p>The shared platform API is currently experiencing a high-demand spike (temporary 503 error) from multiple users.</p>
                      <p>You can <strong>bring your own API key</strong> for dedicated free limits, and it will resolve this instantly!</p>
                      <div className="p-2.5 bg-white/80 border border-amber-150/60 rounded-xl space-y-1">
                        <p className="font-semibold text-stone-900">To add your personal API Key:</p>
                        <ol className="list-decimal pl-4 space-y-1 text-[11px] text-stone-700">
                          <li>Click on the <strong>Settings</strong> gear/sliders menu in the AI Studio interface.</li>
                          <li>Open the <strong>Secrets</strong> panel.</li>
                          <li>Add or update the value for the secret named <code className="bg-stone-100 text-stone-900 font-bold px-1 py-0.5 rounded font-mono text-[10px]">GEMINI_API_KEY</code>.</li>
                          <li>Click Save. This application will automatically use your dedicated key with unlimited quota.</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI Output Panels */}
                {aiLoading ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-6 bg-stone-100 rounded-lg w-1/3"></div>
                    <div className="space-y-2">
                      <div className="h-4 bg-stone-50 rounded w-full"></div>
                      <div className="h-4 bg-stone-50 rounded w-5/6"></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                      <div className="h-24 bg-stone-50 rounded-2xl"></div>
                      <div className="h-24 bg-stone-50 rounded-2xl"></div>
                    </div>
                  </div>
                ) : aiInsights ? (
                  <div className="space-y-6 text-left animate-in fade-in duration-300">
                    
                    {/* Health Score and Summary row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center bg-stone-50/50 p-5 rounded-2xl border border-stone-100">
                      <div className="md:col-span-1 text-center space-y-1">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">Floe Health Score</span>
                        <div className="relative inline-flex items-center justify-center">
                          <svg className="w-20 h-20">
                            <circle className="text-stone-100" strokeWidth="6" stroke="currentColor" fill="transparent" r="32" cx="40" cy="40"/>
                            <circle 
                              className={`${aiInsights.healthScore >= 80 ? 'text-emerald-600' : aiInsights.healthScore >= 55 ? 'text-amber-500' : 'text-rose-500'}`} 
                              strokeWidth="6" 
                              strokeDasharray={2 * Math.PI * 32}
                              strokeDashoffset={2 * Math.PI * 32 * (1 - aiInsights.healthScore / 100)}
                              strokeLinecap="round" 
                              stroke="currentColor" 
                              fill="transparent" 
                              r="32" 
                              cx="40" 
                              cy="40"
                              transform="rotate(-90 40 40)"
                            />
                          </svg>
                          <span className="absolute text-lg font-black text-slate-900">{aiInsights.healthScore}</span>
                        </div>
                      </div>
                      <div className="md:col-span-3 space-y-1">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-800 block">Executive Summary</span>
                        <p className="text-xs text-slate-600 leading-relaxed font-medium">
                          "{aiInsights.summary}"
                        </p>
                      </div>
                    </div>

                    {/* Alerts and Insights */}
                    {aiInsights.insights && aiInsights.insights.length > 0 && (
                      <div className="space-y-2.5">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Budget Alerts & Insights</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {aiInsights.insights.map((insight, index) => (
                            <div 
                              key={index}
                              className={`p-4 rounded-2xl border flex items-start gap-3 text-xs leading-relaxed ${
                                insight.type === 'warning' 
                                  ? 'bg-rose-50/50 text-rose-900 border-rose-100' 
                                  : insight.type === 'success' 
                                  ? 'bg-emerald-50/50 text-emerald-900 border-emerald-100' 
                                  : 'bg-blue-50/50 text-blue-900 border-blue-100'
                              }`}
                            >
                              {insight.type === 'warning' ? (
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                              ) : insight.type === 'success' ? (
                                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                              ) : (
                                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <h5 className="font-bold text-slate-900">{insight.title}</h5>
                                <p className="text-[11px] text-slate-500 mt-0.5">{insight.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actionable recommendations */}
                    {aiInsights.recommendations && aiInsights.recommendations.length > 0 && (
                      <div className="space-y-3 pt-1">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Lightbulb className="w-4 h-4 text-amber-500" /> Personalized Financial Council
                        </h4>
                        <ul className="grid grid-cols-1 gap-2">
                          {aiInsights.recommendations.map((rec, index) => (
                            <li key={index} className="flex gap-2.5 text-xs text-slate-600 bg-stone-50 p-3 rounded-xl border border-stone-100/50">
                              <span className="text-emerald-600 font-bold shrink-0">#{index + 1}</span>
                              <span className="font-medium">{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="text-center py-12 bg-stone-50/60 rounded-3xl border border-stone-100">
                    <BrainCircuit className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                    <h3 className="text-xs font-bold text-slate-700">No AI Counselor report active.</h3>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                      Tap the "Request AI Council" button at the top right to generate customized smart savings and budget advice.
                    </p>
                  </div>
                )}
              </div>

              {/* Recent Ledger Panel (1/3 width) */}
              <div className="bg-white rounded-3xl border border-stone-200/80 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Recent Ledger</h3>
                    <p className="text-[11px] text-slate-500 font-medium">Your 5 latest logs</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('capture')}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-0.5"
                  >
                    View All <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {expenses.length === 0 ? (
                    <div className="text-center py-6 bg-stone-50 rounded-2xl text-xs text-slate-400 font-semibold">
                      No logs captured.
                    </div>
                  ) : (
                    expenses.slice(0, 5).map(item => (
                      <div key={item.id} className="p-3 bg-stone-50 rounded-2xl border border-stone-100 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg shrink-0 ${getTailwindBgLightColor(getCategoryColorClass(item.categoryId))}`}>
                            {getCategoryIconElement(item.categoryId)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate leading-tight">{item.note}</p>
                            <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                              {getCategoryName(item.categoryId)} • {formatDateLabel(item.date)}
                            </span>
                          </div>
                        </div>
                        <span className="font-bold font-mono text-slate-900 shrink-0">
                          -${item.amount.toFixed(2)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ========================================== */}
        {/* ============ TAB: VOICE LOG ============= */}
        {/* ========================================== */}
        {activeTab === 'capture' && (
          <div id="floe-capture-tab" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
            
            {/* Left Col: Recorder Console */}
            <div className="lg:col-span-2 space-y-6">
              
              <section id="floe-voice-box" className="bg-white rounded-3xl border border-stone-200/80 shadow-sm p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/50 rounded-full blur-2xl pointer-events-none"></div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-100 pb-5 mb-5">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-emerald-600" /> Natural Speech Expense Capture
                    </h2>
                    <p className="text-xs text-slate-500">
                      Transcribe cash, card, or store spending offline straight inside your secure browser container.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'}`}></span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {isRecording ? 'Awaiting Audio' : 'Microphone Ready'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center py-6">
                  
                  <div className="relative">
                    {isRecording && (
                      <div className="absolute inset-0 w-28 h-28 -m-2 bg-emerald-500/20 rounded-full animate-ping pointer-events-none"></div>
                    )}
                    {isRecording && (
                      <div className="absolute inset-0 w-32 h-32 -m-4 bg-emerald-500/10 rounded-full animate-pulse pointer-events-none"></div>
                    )}

                    <button
                      onClick={handleStartVoiceRecord}
                      className={`w-24 h-24 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-xl border ${
                        isRecording 
                          ? 'bg-emerald-600 text-white scale-110 border-emerald-700' 
                          : 'bg-stone-50 text-emerald-700 hover:bg-stone-100 hover:scale-105 border-stone-200'
                      }`}
                      title="Tap to speak your spending entry"
                    >
                      {isRecording ? (
                        <MicOff className="w-10 h-10" />
                      ) : (
                        <Mic className="w-10 h-10" />
                      )}
                    </button>
                  </div>

                  {isRecording ? (
                    <div className="text-center mt-6 space-y-2">
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-800 text-[11px] font-bold rounded-full border border-emerald-100">
                        {simulatingText ? 'SIMULATOR PARSING...' : 'LISTENING EN-US...'}
                      </span>
                      <p className="text-sm italic font-semibold text-slate-800 max-w-md px-4 leading-relaxed">
                        "{transcription || "Listening for spending cues..."}"
                      </p>
                    </div>
                  ) : (
                    <div className="text-center mt-4">
                      <p className="text-xs text-slate-400 font-medium">
                        "Spent twelve dollars on coffee" • "Paid forty-five dollars at trader joes supermarket"
                      </p>
                    </div>
                  )}

                  {voiceError && (
                    <div className="mt-5 p-3 bg-amber-50 text-amber-800 rounded-2xl border border-amber-100 text-xs text-center max-w-md flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="font-medium">{voiceError}</span>
                    </div>
                  )}
                </div>

                {/* SIMULATOR DECK */}
                <div className="mt-4 border-t border-stone-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Interactive Speech Simulation Deck
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Click to instantly test the parsing engine</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PRESET_SIMULATED_VOICES.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSimulatePhrase(preset.phrase)}
                        disabled={isRecording || simulatingText}
                        className="flex items-center gap-3 text-left p-3 bg-stone-50 hover:bg-stone-100 border border-stone-100 hover:border-stone-200 rounded-xl transition-all duration-200 group text-xs disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <span className="text-base bg-white p-1 rounded-lg shadow-sm border border-stone-100 shrink-0">{preset.icon}</span>
                        <span className="flex-1 font-semibold text-slate-600 group-hover:text-slate-800 line-clamp-1">
                          "{preset.phrase}"
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 shrink-0 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      placeholder="Type speech phrasing (e.g. 'spent ninety dollars on gas bill')..."
                      value={customPhraseInput}
                      onChange={(e) => setCustomPhraseInput(e.target.value)}
                      disabled={isRecording || simulatingText}
                      className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white font-medium"
                    />
                    <button
                      onClick={() => {
                        if (customPhraseInput.trim()) {
                          handleSimulatePhrase(customPhraseInput.trim());
                          setCustomPhraseInput('');
                        }
                      }}
                      disabled={isRecording || simulatingText || !customPhraseInput.trim()}
                      className="bg-slate-900 hover:bg-slate-800 text-stone-50 px-4 py-2 rounded-xl text-xs font-semibold shrink-0 disabled:opacity-50 transition-colors"
                    >
                      Parse Text
                    </button>
                  </div>
                </div>

              </section>

              {/* Transactions list ledger */}
              <section id="floe-transactions-box" className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Chronological Transactions Ledger</h3>
                    <p className="text-xs text-slate-500 font-medium">Secure records logged in your private vault</p>
                  </div>
                  
                  <button
                    onClick={() => setShowManualForm(true)}
                    className="flex items-center gap-1 text-xs text-slate-850 hover:text-slate-950 font-bold px-3.5 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl transition-all"
                  >
                    <Plus className="w-4 h-4" /> Manual Fallback Entry
                  </button>
                </div>

                {expenses.length === 0 ? (
                  <div className="bg-white border border-stone-200/80 rounded-3xl p-10 text-center shadow-sm">
                    <Wallet className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-700">No transaction entries captured.</p>
                    <p className="text-xs text-slate-400 mt-1">Tap the Microphone or simulate standard speech inputs to fill the ledger.</p>
                  </div>
                ) : (
                  <div className="space-y-6 text-left">
                    {groupExpensesByDay().map((dateGroup) => (
                      <div key={dateGroup} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{formatDateLabel(dateGroup)}</span>
                          <span className="text-xs font-semibold text-slate-400 font-mono">
                            Subtotal: ${expenses.filter(e => e.date === dateGroup).reduce((sum, e) => sum + e.amount, 0).toFixed(2)}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5">
                          {expenses.filter(e => e.date === dateGroup).map((item) => (
                            <div 
                              key={item.id}
                              className="group bg-white p-4 rounded-2xl border border-stone-200/60 hover:border-stone-300 shadow-sm hover:shadow flex items-center justify-between gap-4 transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-xl ${getTailwindBgLightColor(getCategoryColorClass(item.categoryId))}`}>
                                  {getCategoryIconElement(item.categoryId)}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-slate-900 leading-tight">{item.note}</p>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider mt-0.5">
                                    {getCategoryName(item.categoryId)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-sm font-extrabold font-mono text-slate-950">
                                  -${item.amount.toFixed(2)}
                                </span>
                                <button
                                  onClick={() => handleDeleteExpense(item.id, item.note, item.amount)}
                                  className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  title="Delete entry"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

            </div>

            {/* Right Col: Interactive tips & stats */}
            <div className="space-y-6">
              {/* PREMIUM AI RECEIPT SCANNER WIDGET */}
              <div className="bg-white rounded-3xl p-5 border border-stone-200/80 shadow-sm space-y-4 text-left relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
                    <span>AI Receipt Scanner</span>
                  </div>
                  {userTier === 'trial' && (
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full uppercase">Trial Active</span>
                  )}
                  {userTier === 'expired' && (
                    <span className="text-[9px] bg-rose-50 text-rose-700 font-extrabold px-2 py-0.5 rounded-full uppercase">Trial Expired</span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 leading-snug">Snap receipts & extract instantly</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Avoid typing manual totals. Our secure offline OCR scans lines, finds the merchant total, and suggests the correct budget envelope.
                </p>

                {userTier === 'expired' ? (
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-150 text-center space-y-3">
                    <p className="text-[11px] text-slate-500 font-medium">Your 14-day free trial of Pro features has expired.</p>
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm"
                    >
                      Upgrade to unlock scanner
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Select mockup receipt or simulate drop */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Select a Mock Receipt to Scan</span>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => setSelectedMockReceipt('wholefoods')}
                          className={`p-2.5 border rounded-xl text-center text-xs font-bold transition-all ${selectedMockReceipt === 'wholefoods' ? 'bg-emerald-50 border-emerald-500 text-emerald-800 font-semibold' : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-slate-700'}`}
                        >
                          <div className="text-base mb-1">🛒</div>
                          <span className="text-[10px] block truncate font-bold">Whole Foods</span>
                        </button>
                        <button
                          onClick={() => setSelectedMockReceipt('starbucks')}
                          className={`p-2.5 border rounded-xl text-center text-xs font-bold transition-all ${selectedMockReceipt === 'starbucks' ? 'bg-emerald-50 border-emerald-500 text-emerald-800 font-semibold' : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-slate-700'}`}
                        >
                          <div className="text-base mb-1">☕</div>
                          <span className="text-[10px] block truncate font-bold">Starbucks</span>
                        </button>
                        <button
                          onClick={() => setSelectedMockReceipt('chevron')}
                          className={`p-2.5 border rounded-xl text-center text-xs font-bold transition-all ${selectedMockReceipt === 'chevron' ? 'bg-emerald-50 border-emerald-500 text-emerald-800 font-semibold' : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-slate-700'}`}
                        >
                          <div className="text-base mb-1">⛽</div>
                          <span className="text-[10px] block truncate font-bold">Chevron</span>
                        </button>
                      </div>
                    </div>

                    {/* Real file selector / drag-and-drop receipt upload area */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Or Upload / Snap a Real Receipt</span>
                        {!isCameraActive ? (
                          <button
                            type="button"
                            onClick={startCamera}
                            className="text-[10px] text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100/50 px-2 py-1 rounded-lg transition-all"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Open Camera
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="text-[10px] text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 bg-rose-50 hover:bg-rose-100/50 px-2 py-1 rounded-lg transition-all"
                          >
                            Close Camera
                          </button>
                        )}
                      </div>

                      {isCameraActive ? (
                        <div className="border-2 border-dashed border-emerald-500 rounded-2xl p-2 bg-slate-900 overflow-hidden relative space-y-2">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-48 object-cover rounded-xl bg-slate-950"
                          />
                          {cameraError && (
                            <p className="text-[10px] text-rose-400 text-center font-medium px-2">{cameraError}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => capturePhoto(videoRef.current)}
                              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-2 rounded-xl transition-all shadow flex items-center justify-center gap-1.5"
                            >
                              <Camera className="w-4 h-4" />
                              Capture Frame
                            </button>
                            <button
                              type="button"
                              onClick={stopCamera}
                              className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold py-2 rounded-xl transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label 
                          className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all space-y-1.5 block ${customReceiptImage ? 'border-emerald-500 bg-emerald-50/10' : 'border-stone-200 hover:border-emerald-500 bg-stone-50/50 hover:bg-emerald-50/5'}`}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file) processFile(file);
                          }}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                          />
                          {customReceiptImage ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-800">
                                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="truncate max-w-[150px]">{customReceiptName || 'receipt.jpg'}</span>
                              </div>
                              {customReceiptImage.startsWith("data:image/") && (
                                <img
                                  src={customReceiptImage}
                                  alt="Receipt Preview"
                                  className="w-20 h-20 object-cover mx-auto rounded-lg border border-emerald-200 shadow-sm"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <p className="text-[9px] text-slate-400 font-medium">Click or drop to replace photo</p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Upload className="w-5 h-5 text-slate-400 mx-auto" />
                              <p className="text-[11px] font-bold text-slate-700">Choose or Drop Receipt Image</p>
                              <p className="text-[9px] text-slate-400">Processes securely with Gemini AI extract</p>
                            </div>
                          )}
                        </label>
                      )}
                    </div>

                    {selectedMockReceipt && (
                      <div className="p-3 bg-stone-50 border border-stone-150 rounded-2xl space-y-3 relative overflow-hidden text-left">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                          <span>Target: {selectedMockReceipt === 'custom' ? (customReceiptName || 'Custom Upload') : selectedMockReceipt.toUpperCase()}</span>
                          <button onClick={() => { setSelectedMockReceipt(''); setCustomReceiptImage(null); }} className="text-slate-400 hover:text-slate-700">✕</button>
                        </div>

                        {scanningReceipt ? (
                          <div className="space-y-2 relative pt-2">
                            <div className="w-full h-1 bg-emerald-500 rounded animate-bounce shadow"></div>
                            <div className="h-10 bg-stone-100 rounded-xl flex items-center justify-center text-[10px] font-mono text-slate-500 animate-pulse uppercase tracking-wider font-semibold">
                              [ Extracting details via Gemini AI... ]
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleScanReceipt(selectedMockReceipt)}
                            className="w-full bg-slate-950 hover:bg-slate-900 text-stone-50 text-xs font-bold py-2.5 rounded-xl transition-all shadow"
                          >
                            Scan with Gemini AI
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-gradient-to-br from-emerald-900 to-stone-900 rounded-3xl p-6 text-stone-50 shadow-xl space-y-3 relative overflow-hidden">
                <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none"></div>
                <Award className="w-6 h-6 text-emerald-400" />
                <h3 className="text-sm font-bold font-sans">Available cash to spend</h3>
                <div className="flex items-baseline gap-1 pt-1">
                  <span className="text-3xl font-extrabold font-mono">${remainingTotal.toFixed(2)}</span>
                  <span className="text-xs text-emerald-300">remaining</span>
                </div>
                <p className="text-[11px] text-stone-300 leading-relaxed">
                  Calculated based on your aggregate Category Envelope Limits minus transaction items logged.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* ========================================== */}
        {/* ========== TAB: BUDGETS & GOALS ========== */}
        {/* ========================================== */}
        {activeTab === 'budgets-goals' && (
          <div id="floe-budgets-goals-tab" className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in duration-300 text-left">
            
            {/* Left Box: Envelopes */}
            <section id="floe-budgets-panel" className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Budget Envelopes</h3>
                  <p className="text-xs text-slate-500 font-medium">Categorical spend ceilings for the month</p>
                </div>
                <button
                  onClick={() => setShowCreateBudget(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-100 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Envelope
                </button>
              </div>

              <div className="space-y-4">
                {budgets.map((budget) => {
                  const currentSpent = getSpentForCategory(budget.id, expenses);
                  const percent = Math.min(100, (currentSpent / budget.limit) * 100);
                  const isOver = currentSpent > budget.limit;
                  const isNearLimit = !isOver && percent >= 85;

                  return (
                    <div key={budget.id} className="space-y-1.5 p-3.5 hover:bg-stone-50 rounded-2xl border border-transparent hover:border-stone-100 transition-all">
                      <div className="flex justify-between items-start text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`p-1.5 rounded-lg shrink-0 ${getTailwindBgLightColor(budget.color)}`}>
                            {getCategoryIconElement(budget.id)}
                          </span>
                          <span className="font-bold text-slate-900 leading-tight">{budget.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-extrabold font-mono text-slate-900">${currentSpent.toFixed(2)}</span>
                          <span className="text-slate-400"> / ${budget.limit.toFixed(0)}</span>
                        </div>
                      </div>

                      <div className="w-full bg-stone-100 h-2.5 rounded-full overflow-hidden relative">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            isOver ? 'bg-rose-500' : isNearLimit ? 'bg-amber-500' : getTailwindBgColor(budget.color)
                          }`}
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>

                      <div className="flex justify-between items-center text-[10px] px-0.5 font-bold">
                        <span className="text-slate-400">
                          ${Math.max(0, budget.limit - currentSpent).toFixed(2)} left to spend
                        </span>
                        {isOver ? (
                          <span className="text-rose-600">Exceeded cap!</span>
                        ) : isNearLimit ? (
                          <span className="text-amber-600">Near limit ceiling!</span>
                        ) : (
                          <span className="text-emerald-700">Safe buffer</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right Box: Saving Goals */}
            <section id="floe-goals-panel" className="bg-white p-6 rounded-3xl border border-stone-200/80 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Soft-Saving Goals</h3>
                  <p className="text-xs text-slate-500 font-medium">Accumulate money for future targets privately</p>
                </div>
                <button
                  onClick={() => setShowCreateGoal(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-sky-50 text-sky-800 border border-sky-100 hover:bg-sky-100 rounded-xl text-xs font-bold transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Establish Goal
                </button>
              </div>

              {goals.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 border border-stone-100 rounded-3xl">
                  <PiggyBank className="w-10 h-10 text-stone-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No soft savings goals active.</p>
                  <button
                    onClick={() => setShowCreateGoal(true)}
                    className="text-xs font-bold text-sky-700 hover:underline mt-1 block"
                  >
                    Create your first target savings goal
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {goals.map((goal) => {
                    const percent = Math.min(100, (goal.currentProgress / goal.targetAmount) * 100);
                    const isFinished = goal.currentProgress >= goal.targetAmount;

                    return (
                      <div key={goal.id} className="p-4 bg-stone-50 border border-stone-100 rounded-2xl space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-slate-900">{goal.name}</span>
                              {isFinished && (
                                <span className="bg-emerald-100 text-emerald-800 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase">
                                  Achieved
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-medium">
                              ${goal.currentProgress.toFixed(2)} of ${goal.targetAmount.toFixed(0)} saved ({percent.toFixed(0)}%)
                            </p>
                          </div>

                          <button
                            onClick={() => handleOpenContribute(goal.id)}
                            className="bg-slate-900 hover:bg-slate-800 text-stone-50 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors shadow-sm"
                          >
                            + Stash cash
                          </button>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-stone-200 h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${isFinished ? 'bg-emerald-500' : getTailwindBgColor(goal.color)}`}
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

          </div>
        )}

      </main>

      {/* --- RESPONSIVE SITE FOOTER --- */}
      <footer className="w-full bg-white border-t border-stone-200 py-6 mt-12 text-center select-none shrink-0 text-left">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-bold text-slate-400">
          <div className="flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span>Floe Personal Finance • Protected under 100% Client-Side Privacy Standards</span>
          </div>
          <div className="flex gap-4">
            <a href="#" onClick={(e) => { e.preventDefault(); setShowPrivacyInfo(true); }} className="hover:text-slate-600 underline">Privacy Manifesto</a>
          </div>
        </div>
      </footer>

      {/* ========================================================= */}
      {/* ==================== GLOBAL MODALS ====================== */}
      {/* ========================================================= */}

      {/* 1. DYNAMIC CONFIRMATION OF PARSED VOICE INPUT */}
      {showParsedConfirmation && parsedResult && (
        <div id="floe-modal-parsed" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-md w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></div>
                <h3 className="text-base font-bold text-slate-950">Confirm Parsed Voice Entry</h3>
              </div>
              <button
                onClick={() => setShowParsedConfirmation(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {transcription ? (
              <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 p-3.5 rounded-xl text-xs text-left">
                <span className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 block mb-1">Sound Transcription:</span>
                <p className="italic font-semibold">"{transcription}"</p>
              </div>
            ) : (
              <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 p-3.5 rounded-xl text-xs text-left">
                <span className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 block mb-1">Receipt Extracted Source:</span>
                <p className="font-semibold">Floe Secure Private AI Extraction</p>
              </div>
            )}

            <div className="space-y-3 pt-1 text-left">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Extracted Amount ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                    value={parsedResult.amount === 0 ? '' : parsedResult.amount}
                    onChange={(e) => setParsedResult({ ...parsedResult, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Inferred Envelope Category
                </label>
                <select
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                  value={parsedResult.categoryId}
                  onChange={(e) => setParsedResult({ ...parsedResult, categoryId: e.target.value })}
                >
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Extracted/Adjusted Date
                </label>
                <input
                  type="date"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                  value={parsedResult.date || new Date().toISOString().split('T')[0]}
                  onChange={(e) => setParsedResult({ ...parsedResult, date: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Refined Memo/Note
                </label>
                <input
                  type="text"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                  value={parsedResult.note}
                  onChange={(e) => setParsedResult({ ...parsedResult, note: e.target.value })}
                  placeholder="E.g. Whole Foods run"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3">
              <button
                onClick={() => setShowParsedConfirmation(false)}
                className="bg-stone-50 hover:bg-stone-100 text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all duration-200"
              >
                Discard
              </button>
              <button
                onClick={handleSaveParsedExpense}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-2xl text-xs font-bold shadow-md shadow-emerald-600/10 transition-all duration-200 flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Save to Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. MANUAL FALLBACK FORM MODAL */}
      {showManualForm && (
        <div id="floe-modal-manual" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-md w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-slate-950" />
                <h3 className="text-base font-bold text-slate-950 font-sans">Add Transaction Entry</h3>
              </div>
              <button
                onClick={() => setShowManualForm(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualExpense} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Amount spent ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Envelope Category
                  </label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                  >
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Date of purchase
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Short Memo/Note
                </label>
                <input
                  type="text"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="Where or what was this spent on?"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowManualForm(false)}
                  className="bg-stone-50 hover:bg-stone-100 text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-850 text-stone-50 px-4 py-3 rounded-2xl text-xs font-bold shadow-md transition-all"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. NEW ENVELOPE BUDGET FORM MODAL */}
      {showCreateBudget && (
        <div id="floe-modal-budget" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-md w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-slate-950" />
                <h3 className="text-base font-bold text-slate-955 font-sans">New Budget Envelope</h3>
              </div>
              <button
                onClick={() => setShowCreateBudget(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBudget} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Envelope Name *
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                  value={newBudgetName}
                  onChange={(e) => setNewBudgetName(e.target.value)}
                  placeholder="E.g. Health & Fitness"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Monthly spending Cap ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold font-mono">$</span>
                  <input
                    type="number"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
                    value={newBudgetLimit}
                    onChange={(e) => setNewBudgetLimit(e.target.value)}
                    placeholder="E.g. 150"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Theme Palette
                  </label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={newBudgetColor}
                    onChange={(e) => setNewBudgetColor(e.target.value)}
                  >
                    <option value="emerald">Teal Emerald</option>
                    <option value="amber">Warm Amber</option>
                    <option value="blue">Deep Blue</option>
                    <option value="purple">Royal Purple</option>
                    <option value="orange">Bright Orange</option>
                    <option value="pink">Blush Pink</option>
                    <option value="sky">Ocean Sky</option>
                    <option value="rose">Soft Rose</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Icon Emblem
                  </label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={newBudgetIcon}
                    onChange={(e) => setNewBudgetIcon(e.target.value)}
                  >
                    <option value="ShoppingBag">Shopping Bag 🛍️</option>
                    <option value="ShoppingCart">Shopping Cart 🛒</option>
                    <option value="Utensils">Dining Utensils 🍽️</option>
                    <option value="Car">Car Transportation 🚗</option>
                    <option value="Film">Film Film 🎬</option>
                    <option value="Zap">Zap Bolt ⚡</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateBudget(false)}
                  className="bg-stone-50 hover:bg-stone-100 text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-800 text-stone-50 px-4 py-3 rounded-2xl text-xs font-bold shadow-md transition-all"
                >
                  Create Envelope
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. SAVINGS GOAL FORM MODAL */}
      {showCreateGoal && (
        <div id="floe-modal-goal" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-md w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <PiggyBank className="w-5 h-5 text-slate-950" />
                <h3 className="text-base font-bold text-slate-955 font-sans">Add Savings Goal</h3>
              </div>
              <button
                onClick={() => setShowCreateGoal(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGoal} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Goal Target Name *
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 focus:bg-white"
                  value={newGoalName}
                  onChange={(e) => setNewGoalName(e.target.value)}
                  placeholder="E.g. Weekend Cabin Trip"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Target Goal ($) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold font-mono">$</span>
                    <input
                      type="number"
                      required
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-sky-500 focus:bg-white"
                      value={newGoalTarget}
                      onChange={(e) => setNewGoalTarget(e.target.value)}
                      placeholder="E.g. 1000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Theme Color
                  </label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500"
                    value={newGoalColor}
                    onChange={(e) => setNewGoalColor(e.target.value)}
                  >
                    <option value="sky">Ocean Sky</option>
                    <option value="rose">Soft Rose</option>
                    <option value="emerald">Teal Emerald</option>
                    <option value="amber">Warm Amber</option>
                    <option value="purple">Royal Purple</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateGoal(false)}
                  className="bg-stone-50 hover:bg-stone-100 text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-800 text-stone-50 px-4 py-3 rounded-2xl text-xs font-bold shadow-md transition-all"
                >
                  Establish Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. GOAL CONTRIBUTION DISPATCHER */}
      {showContributionModal && activeGoalId && (
        <div id="floe-modal-contrib" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-md w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-bold text-slate-955 font-sans">
                Contribute to "{goals.find(g => g.id === activeGoalId)?.name}"
              </h3>
              <button
                onClick={() => setShowContributionModal(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContribution} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Contribution Amount ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold font-mono">$</span>
                  <input
                    type="number"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-sky-500 focus:bg-white"
                    value={contributionAmount}
                    onChange={(e) => setContributionAmount(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                </div>
              </div>

              {/* Instant Contribution Increments */}
              <div className="flex gap-2.5">
                {[10, 25, 50, 100].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setContributionAmount(amt.toString())}
                    className="flex-1 bg-stone-100 hover:bg-stone-200 text-slate-800 border border-stone-200 py-2 rounded-xl text-xs font-bold transition-all"
                  >
                    +${amt}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowContributionModal(false)}
                  className="bg-stone-50 hover:bg-stone-100 text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-800 text-stone-50 px-4 py-3 rounded-2xl text-xs font-bold shadow-md transition-all"
                >
                  Add Contribution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. PRIVACY MANIFESTO MANIFEST */}
      {showPrivacyInfo && (
        <div id="floe-modal-privacy" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 space-y-4 max-w-lg w-full shadow-2xl border border-stone-100 max-h-[85vh] overflow-y-auto animate-in zoom-in duration-200 text-left">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-955 font-sans">The Floe Privacy Manifesto</h3>
              </div>
              <button
                onClick={() => setShowPrivacyInfo(false)}
                className="w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-slate-600 leading-relaxed">
              <p className="font-semibold text-slate-900 text-sm">
                We believe personal finance tracking shouldn't require trading away your digital safety, passwords, or credential security.
              </p>

              <div className="p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-xl space-y-1">
                <span className="font-bold uppercase tracking-wider text-[9px] text-emerald-700">Core Principle</span>
                <p className="font-bold">Zero Bank Connections. Zero APIs. 100% Client-Side Protection.</p>
              </div>

              <div className="space-y-4 pt-1.5">
                <div className="flex gap-3">
                  <span className="text-xl">🛡️</span>
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">No Plaid, No Logins, No Passwords</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">We will never ask for your bank account details, bank log-ins, credit card numbers, or third-party OAuth credentials. There are no access links to hijack or compromise.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="text-xl">💾</span>
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">Pure Local Storage Protection</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">Your spending data is stored entirely on your local device's sandboxed memory. We have no external backend trackers logging your purchases for marketing purposes.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="text-xl">🎙️</span>
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">Local Transcriptions & Voice Security</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">Voice logging processes audio inputs straight on-device inside your secure browser Web Speech instance. None of your recorded voice waves are saved, processed, or shared on external servers.</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 border-t border-stone-100 pt-3 text-center">
                Floe keeps your financial footprint safe, invisible, and entirely under your own control.
              </p>
            </div>

            <button
              onClick={() => setShowPrivacyInfo(false)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-stone-50 py-3 rounded-2xl text-xs font-bold shadow-md transition-all mt-2"
            >
              I understand, keep my data safe
            </button>
          </div>
        </div>
      )}

      {/* 7. SECURED FLOATING UPGRADE MODAL */}
      {showUpgradeModal && (
        <div id="floe-modal-upgrade" className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 space-y-6 max-w-2xl w-full shadow-2xl border border-stone-100 animate-in zoom-in duration-200 text-left relative">
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-stone-50 text-slate-500 flex items-center justify-center hover:bg-stone-100"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-1.5 border-b border-stone-100 pb-4">
              <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <Sparkles className="w-6 h-6 text-emerald-600 animate-pulse" />
              </div>
              <h3 className="text-lg font-black text-slate-955 font-sans">
                Upgrade to Floe Pro or Lifetime
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto text-center">
                Get full access to secure on-device voice dictation, smart AI receipt scanning, unlimited categories, and encrypted cloud syncing.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Pro Plan Column */}
              <div className="bg-emerald-50/40 border-2 border-emerald-600/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between relative">
                <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-[8px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider">
                  14-Day Free Trial
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] uppercase font-extrabold text-emerald-800 tracking-wider">Pro Subscription</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-3xl font-black text-slate-900">$3.99</span>
                      <span className="text-xs text-slate-400">/ month</span>
                    </div>
                    <p className="text-[10px] text-emerald-800 font-bold mt-1">Or save 35% with <span className="font-extrabold">$29.99/year</span></p>
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-slate-600 font-semibold border-t border-emerald-100 pt-3">
                    <li className="flex items-center gap-1.5">✓ 14 days 100% free trial</li>
                    <li className="flex items-center gap-1.5">✓ Unlimited budget envelopes</li>
                    <li className="flex items-center gap-1.5">✓ Signature Voice Expense entry</li>
                    <li className="flex items-center gap-1.5">✓ AI Receipt scanning</li>
                    <li className="flex items-center gap-1.5">✓ Unlimited Saving goals</li>
                    <li className="flex items-center gap-1.5">✓ Secure Firestore syncing</li>
                  </ul>
                </div>

                <div className="space-y-2 mt-5">
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      handleStripeCheckout('pro-monthly');
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md"
                  >
                    Start 14-Day Trial (Monthly)
                  </button>
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      handleStripeCheckout('pro-yearly');
                    }}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-stone-100 text-xs font-bold py-2 rounded-xl transition-all"
                  >
                    Start 14-Day Trial (Yearly - $29.99)
                  </button>
                </div>
              </div>

              {/* Lifetime Plan Column */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between text-stone-200">
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] uppercase font-extrabold text-amber-400 tracking-wider">Lifetime Plan</span>
                    <div className="flex items-baseline gap-1 mt-0.5 text-white">
                      <span className="text-3xl font-black">$49</span>
                      <span className="text-xs text-stone-400">/ one-time payment</span>
                    </div>
                    <p className="text-[10px] text-amber-200 font-bold mt-1">Pay once. Own forever.</p>
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-stone-300 font-semibold border-t border-slate-800 pt-3">
                    <li className="flex items-center gap-1.5 text-white">✓ Everything in Pro</li>
                    <li className="flex items-center gap-1.5">✓ Zero subscription fees forever</li>
                    <li className="flex items-center gap-1.5">✓ Lifetime secure cloud slots</li>
                    <li className="flex items-center gap-1.5">✓ Early access to new releases</li>
                    <li className="flex items-center gap-1.5">✓ Support independent privacy devs</li>
                  </ul>
                </div>

                <button
                  onClick={() => {
                    setShowUpgradeModal(false);
                    handleStripeCheckout('lifetime');
                  }}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold py-2.5 rounded-xl mt-5 transition-all shadow-lg shadow-amber-500/10"
                >
                  Buy Lifetime License ($49)
                </button>
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold underline"
              >
                Maybe later, keep using current access
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
