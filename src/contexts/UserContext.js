// src/contexts/UserContext.js
//
// HARDENED: Uses Firebase Auth (onAuthStateChanged) as the source of truth.
// User profile (role, vendorId) is fetched from Firestore on each auth state change.
// NO plaintext credentials or full user objects are stored in localStorage.
//
import React, { createContext, useEffect, useState, useCallback } from 'react';
import { auth, db } from '../firebase';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export const UserContext = createContext({
    user: null,
    userId: null,
    role: null,
    vendorId: null,
    vendorName: '',
    isSuperAdmin: false,
    isAdmin: false,
    isUser: false,
    permissions: {},
    displayName: '',
    authLoading: true,
    login: async () => { },
    logout: async () => { },
});

/**
 * Fetch the user's platform profile from the Firestore `login` collection.
 * This is separate from Firebase Auth — Auth proves identity, Firestore holds role/vendor.
 */
async function fetchUserProfile(uid) {
    try {
        const snap = await getDoc(doc(db, 'login', uid));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    } catch (err) {
        console.warn('[UserContext] Could not fetch profile:', err.message);
        return null;
    }
}

export function UserProvider({ children }) {
    // null = loading, object = authenticated, false = signed out
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);

    // ── Listen to Firebase Auth state ──────────────────────────────────────
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) {
                setUser(false);
                setAuthLoading(false);
                return;
            }
            // Firebase says we're authenticated — fetch the platform profile
            const profile = await fetchUserProfile(firebaseUser.uid);
            if (!profile) {
                // Auth exists but no Firestore profile — sign them out cleanly
                console.warn('[UserContext] No profile found for uid:', firebaseUser.uid);
                await signOut(auth);
                setUser(false);
                setAuthLoading(false);
                return;
            }

            // Check account is still active
            if (profile.active === false) {
                console.warn('[UserContext] Account is disabled.');
                await signOut(auth);
                setUser(false);
                setAuthLoading(false);
                return;
            }

            setUser({
                id: firebaseUser.uid,
                firebaseUid: firebaseUser.uid,
                email: firebaseUser.email || profile.email || null,
                displayName: profile.displayName || profile.name || profile.username || firebaseUser.email || '',
                role: profile.role || null,
                vendorId: profile.vendorId || null,
                vendorName: profile.vendorName || null,
                permissions: profile.permissions || {},
                active: profile.active !== false,
                position: profile.position || null,
            });
            setAuthLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // ── Login via Firebase Auth ────────────────────────────────────────────
    const login = useCallback(async (emailOrUsername, password) => {
        // Firebase Auth requires an email. If the identifier looks like a username,
        // we must look up that username in Firestore to find the email.
        // For now, pass directly — callers (Login.js) resolve usernames to emails first.
        await signInWithEmailAndPassword(auth, emailOrUsername, password);
        // onAuthStateChanged above will handle the rest
    }, []);

    // ── Logout ────────────────────────────────────────────────────────────
    const logout = useCallback(async () => {
        await signOut(auth);
        // Clear any residual legacy keys
        ['vm_user', 'vm_role', 'vm_lastPath'].forEach(k => localStorage.removeItem(k));
        setUser(false);
    }, []);

    // ── Derived values ─────────────────────────────────────────────────────
    const normalizedRole = (user?.role || '').trim().toLowerCase();

    const value = {
        user: user || null,
        userId: user?.id || null,
        role: user?.role || null,
        vendorId: user?.vendorId || null,
        vendorName: user?.vendorName || '',
        isSuperAdmin: normalizedRole === 'superadmin',
        isAdmin: normalizedRole === 'admin',
        isUser: normalizedRole === 'user',
        permissions: user?.permissions || {},
        displayName: user?.displayName || '',
        authLoading,
        login,
        logout,
    };

    return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
