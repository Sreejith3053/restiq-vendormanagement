// src/utils/authFetch.js
//
// Wrapper around fetch() that automatically attaches the Firebase Auth
// ID token to outgoing API requests. Use this for all protected /api/ calls.
//
import { auth } from '../firebase';

/**
 * Fetch wrapper that attaches Firebase Auth ID token as a Bearer token.
 * Falls back to a regular fetch if no user is signed in.
 *
 * @param {string} url - The URL to fetch
 * @param {RequestInit} [options={}] - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    try {
        const user = auth.currentUser;
        if (user) {
            const token = await user.getIdToken();
            headers['Authorization'] = `Bearer ${token}`;
        }
    } catch (err) {
        console.warn('[authFetch] Could not get ID token:', err.message);
    }

    return fetch(url, { ...options, headers });
}
