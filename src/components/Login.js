// src/components/Login.js
//
// HYBRID LOGIN — works during the Firebase Auth migration period.
// Strategy:
//   1. Resolve username → email (Firestore lookup)
//   2. Try Firebase Auth signInWithEmailAndPassword
//   3. If the account doesn't exist in Firebase Auth yet, fall back to
//      the Firestore plaintext check (legacy path) and auto-create the
//      Firebase Auth account on first success ("just-in-time migration").
//   4. Rate limit: 5 failures in 2 min → 60s lockout, logged to systemLogs.
//
import React, { useState, useContext, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../contexts/UserContext.js";
import { auth, db } from "../firebase";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
} from "firebase/auth";
import {
    collection, getDocs, query, where, limit,
    doc, getDoc, addDoc, serverTimestamp,
} from "firebase/firestore";

import restiqLogo from "../assets/restiq-logo.png";
import heroImg1 from "../assets/vendor-hero-1.png";
import heroImg2 from "../assets/vendor-hero-2.png";
import heroImg3 from "../assets/vendor-hero-3.png";
import "./Login.css";

// ── Hero Carousel Data ────────────────────────────────────────────────────
const HERO_SLIDES = [
    {
        image: heroImg1,
        heading: "Streamline Your Supply Chain",
        subtitle: "Manage orders, dispatches, and invoices — all in one place.",
    },
    {
        image: heroImg2,
        heading: "Quality at Every Step",
        subtitle: "Track your catalog, pricing, and inventory with precision.",
    },
    {
        image: heroImg3,
        heading: "Deliver with Confidence",
        subtitle: "Real-time logistics, dispatch tracking, and fulfillment tools.",
    },
];

const SLIDE_INTERVAL = 3000; // 3 seconds

// ── Rate Limiting ──────────────────────────────────────────────────────────
const MAX_ATTEMPTS        = 5;
const ATTEMPT_WINDOW_MS   = 2 * 60 * 1000;  // 2 min
const LOCKOUT_DURATION_MS = 60 * 1000;       // 60 s

export default function Login() {
    const { authLoading } = useContext(UserContext);
    const navigate         = useNavigate();

    const [identifier,       setIdentifier]       = useState("");
    const [password,         setPassword]         = useState("");
    const [showPw,           setShowPw]           = useState(false);
    const [loading,          setLoading]          = useState(false);
    const [err,              setErr]              = useState("");
    const [lockoutRemaining, setLockoutRemaining] = useState(0);
    const [rememberMe,       setRememberMe]       = useState(true);

    // Password reset modal state
    const [showReset,       setShowReset]       = useState(false);
    const [resetEmail,      setResetEmail]      = useState("");
    const [resetLoading,    setResetLoading]    = useState(false);
    const [resetMsg,        setResetMsg]        = useState("");
    const [resetErr,        setResetErr]        = useState("");

    // Carousel
    const [currentSlide, setCurrentSlide] = useState(0);

    const failureTimestamps = useRef([]);
    const lockoutTimer      = useRef(null);

    // ── Auto-rotate carousel ──────────────────────────────────────────────
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentSlide(prev => (prev + 1) % HERO_SLIDES.length);
        }, SLIDE_INTERVAL);
        return () => clearInterval(timer);
    }, []);

    // ── Rate limit helpers ────────────────────────────────────────────────
    const checkRateLimit = () => {
        const now = Date.now();
        failureTimestamps.current = failureTimestamps.current.filter(
            ts => now - ts < ATTEMPT_WINDOW_MS
        );
        return failureTimestamps.current.length >= MAX_ATTEMPTS;
    };

    const recordFailure = (id) => {
        failureTimestamps.current.push(Date.now());
        addDoc(collection(db, "systemLogs"), {
            level: "warn", category: "auth", action: "login_failed",
            entityType: "user", entityId: id,
            metadata: { identifier: id, attempts: failureTimestamps.current.length },
            performedBy: "system", timestamp: serverTimestamp(),
        }).catch(() => {});
        if (failureTimestamps.current.length >= MAX_ATTEMPTS) startLockout();
    };

    const startLockout = () => {
        setLockoutRemaining(Math.ceil(LOCKOUT_DURATION_MS / 1000));
        const iv = setInterval(() => {
            setLockoutRemaining(p => {
                if (p <= 1) { clearInterval(iv); failureTimestamps.current = []; return 0; }
                return p - 1;
            });
        }, 1000);
        lockoutTimer.current = iv;
    };

    // ── Password Reset ────────────────────────────────────────────────────
    const handlePasswordReset = async (e) => {
        e.preventDefault();
        setResetErr("");
        setResetMsg("");
        if (!resetEmail.trim()) { setResetErr("Enter your email address."); return; }
        setResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, resetEmail.trim());
            setResetMsg("Reset link sent! Check your inbox (and spam folder).");
        } catch (err) {
            const code = err.code || "";
            if (code === "auth/user-not-found") {
                setResetMsg("If that email is registered, a reset link has been sent.");
            } else {
                setResetErr("Failed to send reset email. Please try again.");
            }
        } finally {
            setResetLoading(false);
        }
    };

    // ── Look up the Firestore login doc by username or email ──────────────
    const resolveFirestoreUser = async (identifierVal) => {
        const trimmed = identifierVal.trim();
        try {
            let q = query(collection(db, "login"), where("email", "==", trimmed), limit(1));
            let snap = await getDocs(q);
            if (!snap.empty) return { docId: snap.docs[0].id, data: snap.docs[0].data() };

            q = query(collection(db, "login"), where("username", "==", trimmed), limit(1));
            snap = await getDocs(q);
            if (!snap.empty) return { docId: snap.docs[0].id, data: snap.docs[0].data() };
        } catch (e) {
            console.warn("[Login] Firestore user lookup failed:", e.message);
        }
        return null;
    };

    // ── Just-in-time Firebase Auth migration ──────────────────────────────
    const migrateUserToFirebaseAuth = async (email, password, uid) => {
        try {
            await createUserWithEmailAndPassword(auth, email, password);
        } catch (createErr) {
            if (createErr.code === "auth/email-already-in-use") {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                console.warn("[Login] JIT migration failed:", createErr.message);
            }
        }
    };

    // ── Main submit ───────────────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErr("");
        if (!identifier || !password) { setErr("Enter your username/email and password."); return; }
        if (checkRateLimit())          { setErr("Too many failed attempts. Please wait."); return; }
        if (lockoutRemaining > 0)      { setErr(`Locked — try again in ${lockoutRemaining}s.`); return; }

        setLoading(true);
        try {
            const firestoreUser = await resolveFirestoreUser(identifier);
            if (!firestoreUser) {
                recordFailure(identifier);
                setErr("No account found with that username or email.");
                setLoading(false);
                return;
            }
            const { docId, data } = firestoreUser;
            const email = data.email || `${data.username}@restiq.internal`;

            if (data.active === false) {
                setErr("Your account has been deactivated. Contact admin.");
                setLoading(false);
                return;
            }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                if (data.mustChangePassword === true) {
                    navigate('/change-password');
                } else {
                    navigate('/');
                }
                return;
            } catch (firebaseErr) {
                const code = firebaseErr.code || "";
                const notMigrated =
                    code === "auth/user-not-found"       ||
                    code === "auth/invalid-credential"   ||
                    code === "auth/invalid-login-credentials";

                if (!notMigrated) {
                    if (code === "auth/wrong-password") {
                        recordFailure(identifier);
                        setErr("Incorrect password.");
                    } else if (code === "auth/user-disabled") {
                        setErr("Account disabled. Contact admin.");
                    } else if (code === "auth/too-many-requests") {
                        setErr("Too many attempts. Your account is temporarily locked.");
                    } else {
                        console.error("[Login] Firebase Auth error:", firebaseErr);
                        setErr("Sign-in failed. Please try again.");
                    }
                    setLoading(false);
                    return;
                }

                const storedPw = data.password;
                if (!storedPw) {
                    setErr("Account not yet set up for sign-in. Contact your admin.");
                    setLoading(false);
                    return;
                }

                if (String(storedPw) !== String(password)) {
                    recordFailure(identifier);
                    setErr("Incorrect password.");
                    setLoading(false);
                    return;
                }

                await migrateUserToFirebaseAuth(email, password, docId);
                if (data.mustChangePassword === true) {
                    navigate('/change-password');
                } else {
                    navigate('/');
                }
            }
        } catch (err) {
            console.error("[Login] Unexpected error:", err);
            setErr("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Show minimal loader while Firebase resolves initial auth state
    if (authLoading) {
        return (
            <div className="login-wrap">
                <div style={{ color: "#9db2ce", textAlign: "center", margin: "auto" }}>Loading…</div>
            </div>
        );
    }

    const activeSlide = HERO_SLIDES[currentSlide];

    return (
        <div className="login-wrap">
            {/* ── Left: Hero Carousel ─────────────────────────────── */}
            <div className="login-hero">
                {HERO_SLIDES.map((slide, idx) => (
                    <div
                        key={idx}
                        className={`hero-slide ${idx === currentSlide ? 'active' : ''}`}
                        style={{ backgroundImage: `url(${slide.image})` }}
                    />
                ))}
                <div className="hero-overlay" />
                <div className="hero-content">
                    <div className="hero-logo">
                        <span>Rest<span style={{ color: '#818cf8' }}>IQ</span></span>
                    </div>
                    <h2 key={currentSlide + '-h'}>{activeSlide.heading}</h2>
                    <p key={currentSlide + '-p'}>{activeSlide.subtitle}</p>
                    <div className="hero-indicators">
                        {HERO_SLIDES.map((_, idx) => (
                            <div
                                key={idx}
                                className={`dot ${idx === currentSlide ? 'active' : ''}`}
                                onClick={() => setCurrentSlide(idx)}
                                style={{ cursor: 'pointer' }}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Right: Login Form ───────────────────────────────── */}
            <div className="login-panel">
                <div className="login-panel-inner">
                    <div className="login-brand">
                        <div className="brand-name">Rest<span style={{ color: '#818cf8' }}>IQ</span></div>
                    </div>

                    <div className="login-welcome">
                        <h2>Welcome back</h2>
                        <p>Sign in to your vendor management account.</p>
                    </div>

                    <form className="login-form" onSubmit={handleSubmit}>
                        <div className="field">
                            <label>Username or Email</label>
                            <input
                                type="text"
                                autoComplete="username"
                                value={identifier}
                                onChange={e => setIdentifier(e.target.value)}
                                placeholder="you@company.com or johndoe"
                                disabled={lockoutRemaining > 0}
                            />
                        </div>

                        <div className="field">
                            <label>Password</label>
                            <div className="pw-box">
                                <input
                                    type={showPw ? "text" : "password"}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    disabled={lockoutRemaining > 0}
                                />
                                <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => setShowPw(s => !s)}
                                    aria-label={showPw ? "Hide password" : "Show password"}
                                >
                                    {showPw ? "🙈" : "👁️"}
                                </button>
                            </div>
                        </div>

                        <div className="row-between">
                            <label className="remember-label">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={e => setRememberMe(e.target.checked)}
                                />
                                Remember me
                            </label>
                            <button
                                type="button"
                                className="forgot-link"
                                onClick={() => {
                                    setShowReset(true);
                                    setResetEmail(identifier.includes('@') ? identifier : '');
                                    setResetMsg('');
                                    setResetErr('');
                                }}
                            >
                                Forgot Password?
                            </button>
                        </div>

                        {lockoutRemaining > 0 && (
                            <div className="error">
                                Too many failed attempts. Please wait {lockoutRemaining}s before retrying.
                            </div>
                        )}
                        {err && !lockoutRemaining && <div className="error">{err}</div>}

                        <button
                            className="login-btn"
                            type="submit"
                            disabled={loading || lockoutRemaining > 0}
                        >
                            {loading
                                ? "Signing in…"
                                : lockoutRemaining > 0
                                ? `Locked (${lockoutRemaining}s)`
                                : "Sign in"}
                        </button>
                    </form>

                    <div className="login-footer">
                        <span>© {new Date().getFullYear()} RestIQ Solutions · <a href="https://restiqsolutions.com" target="_blank" rel="noopener noreferrer">restiqsolutions.com</a></span>
                    </div>
                </div>
            </div>

            {/* ── Password Reset Modal ─────────────────────────── */}
            {showReset && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }} onClick={() => setShowReset(false)}>
                    <div style={{
                        background: '#131d2e', border: '1px solid #1e3a5f',
                        borderRadius: 16, padding: '32px 28px', width: 360, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 6px', color: '#f1f5f9', fontSize: 18, fontWeight: 700 }}>Reset Password</h3>
                        <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 13 }}>
                            Enter your email and we'll send a reset link.
                        </p>

                        <form onSubmit={handlePasswordReset}>
                            <input
                                type="email"
                                autoFocus
                                value={resetEmail}
                                onChange={e => setResetEmail(e.target.value)}
                                placeholder="your@email.com"
                                style={{
                                    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                                    background: '#0f1923', border: '1px solid #1e3a5f',
                                    borderRadius: 8, color: '#e2e8f0', fontSize: 14, outline: 'none',
                                    marginBottom: 12,
                                }}
                            />

                            {resetErr && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{resetErr}</div>}
                            {resetMsg && <div style={{ color: '#34d399', fontSize: 13, marginBottom: 10 }}>{resetMsg}</div>}

                            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                                <button
                                    type="submit"
                                    disabled={resetLoading}
                                    style={{
                                        flex: 1, padding: '10px 0',
                                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        border: 'none', borderRadius: 8, color: '#fff',
                                        fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    {resetLoading ? 'Sending…' : 'Send Reset Link'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowReset(false)}
                                    style={{
                                        padding: '10px 16px',
                                        background: 'transparent', border: '1px solid #1e3a5f',
                                        borderRadius: 8, color: '#64748b',
                                        fontSize: 14, cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
