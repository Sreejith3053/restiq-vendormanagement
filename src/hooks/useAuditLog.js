/**
 * useAuditLog.js
 *
 * React hook to fetch audit logs filtered by entityType and/or entityId.
 * Used in detail drawers and audit log panels.
 *
 * Usage:
 *   const { logs, loading, error, refresh } = useAuditLog({ entityType: 'order', entityId: orderId });
 */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

/**
 * Fetch audit logs from adminChangeLogs collection.
 *
 * @param {Object} options
 * @param {string} [options.entityType] - Filter by entity type
 * @param {string} [options.entityId]   - Filter by entity ID
 * @param {number} [options.maxItems=50] - Max logs to fetch
 * @param {boolean} [options.enabled=true] - Set to false to disable auto-fetch
 * @returns {{ logs: Array, loading: boolean, error: string|null, refresh: Function }}
 */
export default function useAuditLog({ entityType, entityId, maxItems = 50, enabled = true } = {}) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchLogs = useCallback(async () => {
        if (!enabled) return;

        setLoading(true);
        setError(null);

        try {
            const constraints = [];

            if (entityType) {
                constraints.push(where('entityType', '==', entityType));
            }
            if (entityId) {
                constraints.push(where('entityId', '==', entityId));
            }

            constraints.push(orderBy('timestamp', 'desc'));
            constraints.push(limit(maxItems));

            const q = query(collection(db, 'adminChangeLogs'), ...constraints);
            const snap = await getDocs(q);

            const fetchedLogs = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));

            setLogs(fetchedLogs);
        } catch (err) {
            console.error('[useAuditLog] Fetch failed:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [entityType, entityId, maxItems, enabled]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    return { logs, loading, error, refresh: fetchLogs };
}
