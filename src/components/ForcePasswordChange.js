// src/components/ForcePasswordChange.js
//
// Shown when a user logs in with mustChangePassword: true.
// Forces them to set a new password before accessing the app.
//
import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { auth, db } from '../firebase';
import { updatePassword } from 'firebase/auth';
import {
    collection, query, where, limit, getDocs,
    updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import restiqLogo from '../assets/restiq-logo.png';

export default function ForcePasswordChange() {
    const { user, logout } = useContext(UserContext);
    const navigate = useNavigate();

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!newPassword || newPassword.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setSaving(true);
        try {
            // 1. Update Firebase Auth password
            if (auth.currentUser) {
                await updatePassword(auth.currentUser, newPassword);
            }

            // 2. Update Firestore login doc — clear mustChangePassword, update password
            const email = user?.email || auth.currentUser?.email;
            if (email) {
                const q = query(collection(db, 'login'), where('email', '==', email), limit(1));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const loginDoc = snap.docs[0];
                    await updateDoc(loginDoc.ref, {
                        password: newPassword,
                        mustChangePassword: false,
                        passwordChangedAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                }

                // 3. Mirror to users collection
                const uq = query(collection(db, 'users'), where('email', '==', email), limit(1));
                const uSnap = await getDocs(uq);
                if (!uSnap.empty) {
                    await updateDoc(uSnap.docs[0].ref, {
                        mustChangePassword: false,
                        updatedAt: serverTimestamp(),
                    });
                }
            }

            toast.success('Password updated successfully!');
            navigate('/');
        } catch (err) {
            console.error('[ForcePasswordChange] Error:', err);
            if (err.code === 'auth/requires-recent-login') {
                setError('Session expired. Please log in again and retry.');
                setTimeout(() => logout(), 2000);
            } else {
                setError('Failed to update password. Please try again.');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0b1120', padding: 20,
        }}>
            <div style={{
                background: '#131d2e', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20, padding: '40px 36px', width: 420, maxWidth: '100%',
                boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            }}>
                {/* Brand */}
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                    <img src={restiqLogo} alt="RestIQ" style={{ height: 48, marginBottom: 12 }} />
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>Change Your Password</h2>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                        For your security, you must set a new password before continuing.
                    </p>
                </div>

                {/* Info banner */}
                <div style={{
                    background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)',
                    borderRadius: 10, padding: '12px 16px', marginBottom: 24,
                    fontSize: 12, color: '#94a3b8', lineHeight: 1.6,
                }}>
                    🔒 Choose a strong password with at least <strong style={{ color: '#f8fafc' }}>8 characters</strong>.
                    Mix uppercase, lowercase, numbers, and symbols for best security.
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            New Password
                        </label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            autoFocus
                            style={{
                                width: '100%', padding: '11px 14px', borderRadius: 10, boxSizing: 'border-box',
                                background: '#0f1923', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#f8fafc', fontSize: 14, outline: 'none',
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Confirm Password
                        </label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="Re-enter your new password"
                            style={{
                                width: '100%', padding: '11px 14px', borderRadius: 10, boxSizing: 'border-box',
                                background: '#0f1923', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#f8fafc', fontSize: 14, outline: 'none',
                            }}
                        />
                        {newPassword && confirmPassword && newPassword !== confirmPassword && (
                            <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>✗ Passwords don't match</div>
                        )}
                        {newPassword && confirmPassword && newPassword === confirmPassword && newPassword.length >= 8 && (
                            <div style={{ fontSize: 11, color: '#34d399', marginTop: 6 }}>✓ Passwords match</div>
                        )}
                    </div>

                    {error && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                            color: '#f87171', fontSize: 13,
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={saving || !newPassword || !confirmPassword}
                        style={{
                            width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                            background: saving ? 'rgba(37,99,235,0.3)' : 'linear-gradient(135deg, #2563eb, #4f46e5)',
                            color: '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                            boxShadow: saving ? 'none' : '0 4px 16px rgba(37,99,235,0.3)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {saving ? '⏳ Updating...' : '🔐 Set New Password'}
                    </button>
                </form>

                <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <div style={{ fontSize: 11, color: '#1e293b' }}>
                        © {new Date().getFullYear()} RestIQ Solutions
                    </div>
                </div>
            </div>
        </div>
    );
}
