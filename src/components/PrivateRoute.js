// src/components/PrivateRoute.js
//
// Route-level access guard. Replaces the bare {isSuperAdmin && ...} pattern.
// Prevents unauthorized users from accessing protected routes — even if they
// manipulate client-side state.
//
// Usage:
//   <Route path="/admin/dashboard" element={
//     <PrivateRoute requiredRole="superadmin">
//       <SuperAdminDashboard />
//     </PrivateRoute>
//   } />
//
import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';

// Role hierarchy for access decisions
const ROLE_HIERARCHY = {
    superadmin: 4,
    admin:      3,
    vendor:     2,
    restaurant: 1,
    user:       1,
};

/**
 * Determines whether the user's role satisfies the required role.
 *
 * @param {string} userRole - The authenticated user's role
 * @param {string} requiredRole - The minimum role required for this route
 * @param {'exact'|'minimum'} mode
 *   - 'exact': role must match exactly
 *   - 'minimum': role must be >= required (default)
 */
function hasAccess(userRole, requiredRole, mode = 'minimum') {
    const normalized = (userRole || '').toLowerCase().trim();
    const required   = (requiredRole || '').toLowerCase().trim();

    if (mode === 'exact') return normalized === required;

    const userLevel     = ROLE_HIERARCHY[normalized]     ?? 0;
    const requiredLevel = ROLE_HIERARCHY[required] ?? 999;
    return userLevel >= requiredLevel;
}

export default function PrivateRoute({
    children,
    requiredRole,
    mode = 'minimum',
}) {
    const { user, role, authLoading } = useContext(UserContext);
    const location = useLocation();

    // ── Still resolving Firebase Auth state — show nothing (avoid flash) ──
    if (authLoading) {
        return (
            <div style={{ padding: 32, color: '#9db2ce', textAlign: 'center' }}>
                Verifying session…
            </div>
        );
    }

    // ── Not authenticated ─────────────────────────────────────────────────
    if (!user) {
        // Preserve the attempted path so we can redirect back after login (future enhancement)
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // ── Authenticated but wrong role ──────────────────────────────────────
    if (requiredRole && !hasAccess(role, requiredRole, mode)) {
        const normalizedRole = (role || '').toLowerCase().trim();
        // Redirect to the appropriate home for their actual role
        const fallback = normalizedRole === 'superadmin'
            ? '/admin/forecast/control-tower'
            : '/';
        console.warn(
            `[PrivateRoute] Access denied: role="${role}" tried to access "${location.pathname}" ` +
            `(required: "${requiredRole}"). Redirecting to "${fallback}".`
        );
        return <Navigate to={fallback} replace />;
    }

    // ── Authorized ────────────────────────────────────────────────────────
    return children;
}
