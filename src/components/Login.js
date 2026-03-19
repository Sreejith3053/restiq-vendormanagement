// src/components/Login.js
//
// HARDENED: Uses Firebase Auth signInWithEmailAndPassword.
// No plaintext password comparison. Supports username → email lookup.
// Client-side rate limiting: 5 failures in 2 min → 60s lockout + logged to systemLogs.
//
import React, { useState, useContext, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../contexts/UserContext.js";
import { auth, db } from "../firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    addDoc,
    serverTimestamp,
} from "firebase/firestore";

import restiqLogo from "../assets/restiq-logo.png";
import "./Login.css";

// ── Rate Limiting Constants ────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 2 * 60 * 1000;    // 2 minutes
const LOCKOUT_DURATION_MS = 60 * 1000;       // 60 seconds

export default function Login() {
    const { authLoading } = useContext(UserContext);
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [lockoutRemaining, setLockoutRemaining] = useState(0);

    // Rate limiting tracked in component refs (survives re-renders, but not page refresh — intentional)
    const failureTimestamps = useRef([]);
    const lockoutTimer = useRef(null);

    // ── Rate limit check ───────────────────────────────────────────────────
    const checkRateLimit = () => {
        const now = Date.now();
        // Remove attempts older than the window
        failureTimestamps.current = failureTimestamps.current.filter(
            (ts) => now - ts < ATTEMPT_WINDOW_MS
        );
        return failureTimestamps.current.length >= MAX_ATTEMPTS;
    };

    const recordFailure = (identifierAttempted) => {
        failureTimestamps.current.push(Date.now());

        // Log to systemLogs (fire and forget — don't block login flow)
        addDoc(collection(db, "systemLogs"), {
            level: "warn",
            levelNum: 2,
            category: "auth",
            action: "login_failed",
            entityType: "user",
            entityId: identifierAttempted,
            metadata: { identifier: identifierAttempted, attemptCount: failureTimestamps.current.length },
            performedBy: "system",
            errorMessage: "Invalid credentials",
            timestamp: serverTimestamp(),
            ts: new Date().toISOString(),
        }).catch(() => { }); // silent — don't break login on log failure

        // Check if we've hit the threshold
        if (failureTimestamps.current.length >= MAX_ATTEMPTS) {
            startLockout();
        }
    };

    const startLockout = () => {
        setLockoutRemaining(Math.ceil(LOCKOUT_DURATION_MS / 1000));
        const interval = setInterval(() => {
            setLockoutRemaining((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    failureTimestamps.current = [];
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        lockoutTimer.current = interval;
    };

    // ── Resolve username → email ───────────────────────────────────────────
    // Firebase Auth requires email. If user enters a username, we look it up in Firestore.
    const resolveEmail = async (identifierValue) => {
        const trimmed = identifierValue.trim();
        // Already an email
        if (trimmed.includes("@")) return trimmed;

        // Look up by username
        try {
            const q = query(
                collection(db, "login"),
                where("username", "==", trimmed),
                limit(1)
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
                const data = snap.docs[0].data();
                return data.email || null;
            }
        } catch (e) {
            console.warn("[Login] Username lookup failed:", e.message);
        }
        return null;
    };

    // ── Submit handler ─────────────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErr("");

        if (!identifier || !password) {
            setErr("Enter your username/email and password.");
            return;
        }

        if (checkRateLimit()) {
            setErr("Too many failed attempts. Please wait before trying again.");
            return;
        }

        if (lockoutRemaining > 0) {
            setErr(`Account temporarily locked. Try again in ${lockoutRemaining}s.`);
            return;
        }

        setLoading(true);

        try {
            const email = await resolveEmail(identifier);
            if (!email) {
                recordFailure(identifier);
                setErr("No account found with that username/email.");
                setLoading(false);
                return;
            }

            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged in UserContext handles the rest — no manual state here
            navigate("/");
        } catch (firebaseErr) {
            // Map Firebase error codes to user-friendly messages
            const code = firebaseErr.code || "";
            if (
                code === "auth/user-not-found" ||
                code === "auth/wrong-password" ||
                code === "auth/invalid-credential" ||
                code === "auth/invalid-email"
            ) {
                recordFailure(identifier);
                setErr("Incorrect email/username or password.");
            } else if (code === "auth/user-disabled") {
                setErr("This account has been disabled. Contact your admin.");
            } else if (code === "auth/too-many-requests") {
                setErr("Too many failed attempts. Your account is temporarily locked by Firebase. Try again later.");
            } else {
                console.error("[Login] Unexpected error:", firebaseErr);
                setErr("Something went wrong. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    // While Firebase is resolving auth state on first load, show nothing (prevents flash)
    if (authLoading) {
        return (
            <div className="login-wrap">
                <div style={{ color: "#9db2ce", textAlign: "center", marginTop: 80 }}>
                    Loading…
                </div>
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
                            onChange={(e) => setIdentifier(e.target.value)}
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
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                disabled={lockoutRemaining > 0}
                            />
                            <button
                                type="button"
                                className="ghost"
                                onClick={() => setShowPw((s) => !s)}
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
                        {loading ? "Signing in…" : lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : "Sign in"}
                    </button>
                </form>

                <div className="login-footer">
                    <span>© {new Date().getFullYear()} RestIQ Solutions</span>
                </div>
            </div>
        </div>
    );
}
