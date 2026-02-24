import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../contexts/UserContext.js";
import { db } from "../firebase";
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    updateDoc,
    doc,
    serverTimestamp,
} from "firebase/firestore";

import "./Login.css";

export default function Login() {
    const { login } = useContext(UserContext);
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [remember, setRemember] = useState(true);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErr("");

        if (!identifier || !password) {
            setErr("Enter your username/email and password.");
            return;
        }

        setLoading(true);
        try {
            const baseRef = collection(db, "login");
            const q1 = query(baseRef, where("username", "==", identifier), limit(1));
            const q2 = query(baseRef, where("email", "==", identifier), limit(1));

            let snap = await getDocs(q1);
            if (snap.empty) snap = await getDocs(q2);

            if (snap.empty) {
                setErr("No user found with that username/email.");
                setLoading(false);
                return;
            }

            const docSnap = snap.docs[0];
            const data = docSnap.data();

            // Check if account is active
            if (data.active === false) {
                setErr("Account is disabled. Contact admin.");
                setLoading(false);
                return;
            }

            // Password check
            if (String(data.password || "") !== String(password)) {
                setErr("Incorrect password.");
                setLoading(false);
                return;
            }

            // Role detection
            const role = (data.role || "").trim().toLowerCase();
            if (!role) {
                setErr("This account has no role assigned. Contact admin.");
                setLoading(false);
                return;
            }

            // Vendor scoping validation — non-superadmins must have a vendorId
            if (role !== "superadmin" && !data.vendorId) {
                setErr("No vendor assigned to this account. Contact admin.");
                setLoading(false);
                return;
            }

            const userPayload = {
                id: docSnap.id,
                displayName: data.displayName || data.name || data.username || data.email || identifier,
                email: data.email || null,
                username: data.username || null,
                role: data.role,
                vendorId: data.vendorId || null,
                vendorName: data.vendorName || null,
                active: data.active !== false,
            };

            login(userPayload, { remember });

            // Update last login timestamp
            try {
                await updateDoc(doc(db, "login", docSnap.id), {
                    lastLogin: serverTimestamp(),
                });
            } catch (updateErr) {
                console.error("Failed to update last login:", updateErr);
            }

            // Route based on role
            if (role === "superadmin") {
                navigate("/vendors");
            } else {
                navigate("/");
            }
        } catch (e2) {
            console.error(e2);
            setErr("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-wrap">
            <div className="login-card">
                <div className="login-brand">
                    <div className="brand-icon">📦</div>
                    <h1>Vendor Management</h1>
                    <div className="brand-sub">Supplier & Inventory Portal</div>
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
                        <label className="remember">
                            <input
                                type="checkbox"
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                            />
                            Remember me
                        </label>
                        <span className="hint">Need access? Contact admin.</span>
                    </div>

                    {err && <div className="error">{err}</div>}

                    <button className="login-btn" type="submit" disabled={loading}>
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                </form>

                <div className="login-footer">
                    <span>© {new Date().getFullYear()} Vendor Management</span>
                </div>
            </div>
        </div>
    );
}
