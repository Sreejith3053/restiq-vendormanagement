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
import React, { useState, useContext, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../contexts/UserContext.js";
import { auth, db } from "../firebase";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import {
    collection, getDocs, query, where, limit,
    doc, getDoc, addDoc, serverTimestamp,
} from "firebase/firestore";

import restiqLogo from "../assets/restiq-logo.png";
import "./Login.css";

// ── Rate Limiting ──────────────────────────────────────────────────────────
const MAX_ATTEMPTS        = 5;
const ATTEMPT_WINDOW_MS   = 2 * 60 * 1000;  // 2 min
const LOCKOUT_DURATION_MS = 60 * 1000;       // 60 s

export default function Login() {
    const { authLoading } = useContext(UserContext);
    const navigate         = useNavigate();

    const [identifier,      setIdentifier]      = useState("");
    const [password,        setPassword]        = useState("");
    const [showPw,          setShowPw]          = useState(false);
    const [loading,         setLoading]         = useState(false);
    const [err,             setErr]             = useState("");
    const [lockoutRemaining, setLockoutRemaining] = useState(0);

    const failureTimestamps = useRef([]);
    const lockoutTimer      = useRef(null);

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

    // ── Look up the Firestore login doc by username or email ──────────────
    // Returns { docId, data } or null
    const resolveFirestoreUser = async (identifierVal) => {
        const trimmed = identifierVal.trim();
        try {
            // Try by email first
            let q = query(collection(db, "login"), where("email", "==", trimmed), limit(1));
            let snap = await getDocs(q);
            if (!snap.empty) return { docId: snap.docs[0].id, data: snap.docs[0].data() };

            // Try by username
            q = query(collection(db, "login"), where("username", "==", trimmed), limit(1));
            snap = await getDocs(q);
            if (!snap.empty) return { docId: snap.docs[0].id, data: snap.docs[0].data() };
        } catch (e) {
            console.warn("[Login] Firestore user lookup failed:", e.message);
        }
        return null;
    };

    // ── Just-in-time Firebase Auth migration ──────────────────────────────
    // Called when Firestore check succeeds but Firebase Auth account doesn't exist yet.
    const migrateUserToFirebaseAuth = async (email, password, uid) => {
        try {
            // We can't preserve the original UID via the client SDK (Admin SDK only).
            // So we create a new Firebase Auth account. The UID in `login/{uid}` stays
            // the docId — the new Firebase Auth UID will be different.
            // UserContext handles this: it calls fetchUserProfile(firebaseUser.uid).
            // For existing docs keyed by a non-UID doc ID, we also try lookup by email.
            await createUserWithEmailAndPassword(auth, email, password);
            // Success — Firebase Auth will fire onAuthStateChanged in UserContext
        } catch (createErr) {
            if (createErr.code === "auth/email-already-in-use") {
                // Race/retry — just sign in
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                console.warn("[Login] JIT migration failed:", createErr.message);
                // Don't block the user — they're already verified by Firestore
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
            // ── Step 1: resolve Firestore user doc ───────────────────────
            const firestoreUser = await resolveFirestoreUser(identifier);
            if (!firestoreUser) {
                recordFailure(identifier);
                setErr("No account found with that username or email.");
                setLoading(false);
                return;
            }
            const { docId, data } = firestoreUser;
            const email = data.email || `${data.username}@restiq.internal`;

            // Check active flag early
            if (data.active === false) {
                setErr("Your account has been deactivated. Contact admin.");
                setLoading(false);
                return;
            }

            // ── Step 2: try Firebase Auth ────────────────────────────────
            try {
                await signInWithEmailAndPassword(auth, email, password);
                navigate("/");
                return; // ✅ Firebase Auth path — done
            } catch (firebaseErr) {
                const code = firebaseErr.code || "";
                const notMigrated =
                    code === "auth/user-not-found"       ||
                    code === "auth/invalid-credential"   ||
                    code === "auth/invalid-login-credentials";

                if (!notMigrated) {
                    // Real Firebase Auth error (wrong password on FB side, disabled, etc.)
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

                // ── Step 3: Firebase Auth account doesn't exist yet — try Firestore legacy ──
                const storedPw = data.password;
                if (!storedPw) {
                    // Account not migrated and has no password stored — needs admin reset
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

                // ✅ Firestore credentials valid — auto-migrate to Firebase Auth
                await migrateUserToFirebaseAuth(email, password, docId);
                navigate("/");
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
                <div style={{ color: "#9db2ce", textAlign: "center", marginTop: 80 }}>Loading…</div>
            </div>
        );
    }

    return (
        <div className="login-wrap">
            <div className="login-card">
                <div className="login-brand">
                    <img src={restiqLogo} alt="RestIQ" className="brand-logo" />
                    <div className="brand-sub">Vendor Management Portal</div>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="field">
                        <label>Username or Email</label>
                        <input
                            type="text"
                            autoComplete="username"
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            placeholder="you@company.com or username"
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
                                placeholder="••••••••"
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
                        <span className="hint">Need access? Contact admin.</span>
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
                    <span>© {new Date().getFullYear()} RestIQ Solutions</span>
                </div>
            </div>
        </div>
    );
}
