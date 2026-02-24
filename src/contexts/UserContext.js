// src/contexts/UserContext.js
import React, { createContext, useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

export const UserContext = createContext({
    user: null,
    userId: null,
    role: null,
    vendorId: null,
    vendorName: '',
    isSuperAdmin: false,
    displayName: '',
    login: () => { },
    logout: () => { },
});

const loadUserFromStorage = () => {
    try {
        const raw = localStorage.getItem('vm_user');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.error('Failed to parse user from localStorage', e);
        return null;
    }
};

export function UserProvider({ children }) {
    const [user, setUser] = useState(() => loadUserFromStorage());

    // Hydrate extra fields from Firestore on mount
    useEffect(() => {
        if (!user?.id) return;
        (async () => {
            try {
                const loginsSnap = await getDoc(doc(db, 'login', user.id));
                if (loginsSnap.exists()) {
                    const data = loginsSnap.data();
                    const updates = {};
                    if (data.vendorId && !user.vendorId) updates.vendorId = data.vendorId;
                    if (data.vendorName && !user.vendorName) updates.vendorName = data.vendorName;
                    if (data.position && !user.position) updates.position = data.position;
                    if (Object.keys(updates).length > 0) {
                        const updatedUser = { ...user, ...updates };
                        setUser(updatedUser);
                        localStorage.setItem('vm_user', JSON.stringify(updatedUser));
                    }
                }
            } catch (e) {
                console.warn('Could not fetch user data:', e);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    const login = (userData, options = {}) => {
        const remember = options.remember ?? true;
        const nextUser = { ...userData };
        setUser(nextUser);
        if (remember) {
            localStorage.setItem('vm_user', JSON.stringify(nextUser));
            if (nextUser.role) localStorage.setItem('vm_role', nextUser.role);
        } else {
            localStorage.removeItem('vm_user');
            localStorage.removeItem('vm_role');
        }
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('vm_user');
        localStorage.removeItem('vm_role');
        localStorage.removeItem('vm_lastPath');
    };

    const normalizedRole = (user?.role || '').trim().toLowerCase();

    const value = {
        user,
        userId: user?.id || user?.uid || null,
        role: user?.role || null,
        vendorId: user?.vendorId || null,
        vendorName: user?.vendorName || '',
        isSuperAdmin: normalizedRole === 'superadmin',
        isAdmin: normalizedRole === 'admin',
        isUser: normalizedRole === 'user',
        displayName: user?.displayName || '',
        login,
        logout,
    };

    return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
