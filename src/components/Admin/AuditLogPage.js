// src/components/Admin/AuditLogPage.js
//
// SuperAdmin-only audit log viewer.
// Reads from systemLogs and adminChangeLogs with date, user, action, and entity filters.
// Supports CSV export and cursor-based pagination (50 records/page).
//
import React, { useState, useCallback } from 'react';
import { db } from '../../firebase';
import {
    collection, query, where, orderBy, limit,
    startAfter, getDocs, Timestamp,
} from 'firebase/firestore';

const PAGE_SIZE = 50;

const LOG_COLLECTIONS = [
    { key: 'systemLogs',      label: 'System Logs' },
    { key: 'adminChangeLogs', label: 'Change Logs' },
];

const SEVERITY_COLORS = {
    critical: '#f43f5e',
    error:    '#f97316',
    warn:     '#fbbf24',
    warning:  '#fbbf24',
    info:     '#38bdf8',
    debug:    '#64748b',
};

export default function AuditLogPage() {
    const [activeCollection, setActiveCollection] = useState('systemLogs');
    const [logs, setLogs]           = useState([]);
    const [loading, setLoading]     = useState(false);
    const [lastDoc, setLastDoc]     = useState(null);
    const [hasMore, setHasMore]     = useState(false);
    const [isFirstLoad, setIsFirstLoad] = useState(true);

    // Filters
    const [filterUser,   setFilterUser]   = useState('');
    const [filterAction, setFilterAction] = useState('');
    const [filterEntity, setFilterEntity] = useState('');
    const [filterFrom,   setFilterFrom]   = useState('');
    const [filterTo,     setFilterTo]     = useState('');

    const buildQuery = useCallback((afterDoc = null) => {
        const constraints = [orderBy('timestamp', 'desc'), limit(PAGE_SIZE)];

        if (filterFrom) {
            constraints.push(where('timestamp', '>=', Timestamp.fromDate(new Date(filterFrom))));
        }
        if (filterTo) {
            const toDate = new Date(filterTo);
            toDate.setHours(23, 59, 59, 999);
            constraints.push(where('timestamp', '<=', Timestamp.fromDate(toDate)));
        }
        if (filterUser)   constraints.push(where('performedBy', '==', filterUser.trim()));
        if (filterAction) constraints.push(where('action', '==', filterAction.trim()));
        if (filterEntity) constraints.push(where('entityType', '==', filterEntity.trim()));
        if (afterDoc)     constraints.push(startAfter(afterDoc));

        return query(collection(db, activeCollection), ...constraints);
    }, [activeCollection, filterUser, filterAction, filterEntity, filterFrom, filterTo]);

    const fetchLogs = async (reset = false) => {
        setLoading(true);
        try {
            const q = buildQuery(reset ? null : lastDoc);
            const snap = await getDocs(q);
            const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            setLogs(prev => reset ? fetched : [...prev, ...fetched]);
            setLastDoc(snap.docs[snap.docs.length - 1] || null);
            setHasMore(fetched.length === PAGE_SIZE);
            setIsFirstLoad(false);
        } catch (err) {
            console.error('[AuditLogPage] Fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = () => fetchLogs(true);

    const handleExportCSV = () => {
        if (!logs.length) return;
        const headers = ['Timestamp', 'Level', 'Category', 'Action', 'Entity Type', 'Entity ID', 'Performed By', 'Error'];
        const rows = logs.map(l => [
            l.ts || (l.timestamp?.toDate ? l.timestamp.toDate().toISOString() : ''),
            l.level || '',
            l.category || l.entityType || '',
            l.action || '',
            l.entityType || '',
            l.entityId || '',
            l.performedBy || l.changedBy || '',
            l.errorMessage || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_log_${activeCollection}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const formatTs = (log) => {
        try {
            if (log.timestamp?.toDate) return log.timestamp.toDate().toLocaleString('en-CA');
            if (log.ts) return new Date(log.ts).toLocaleString('en-CA');
        } catch (_) {}
        return '—';
    };

    const chip = (level) => {
        const color = SEVERITY_COLORS[(level || '').toLowerCase()] || '#64748b';
        return (
            <span style={{
                background: `${color}22`, color, border: `1px solid ${color}44`,
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
                {level || 'info'}
            </span>
        );
    };

    return (
        <div style={{ padding: '24px', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>
                        📋 Audit Logs
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                        Platform-level activity, changes, and error events.
                    </p>
                </div>
                <button
                    onClick={handleExportCSV}
                    disabled={!logs.length}
                    style={{
                        background: logs.length ? '#1e40af' : '#1e293b',
                        color: logs.length ? '#93c5fd' : '#475569',
                        border: 'none', borderRadius: 8, padding: '8px 16px',
                        cursor: logs.length ? 'pointer' : 'default', fontSize: 13, fontWeight: 600,
                    }}
                >
                    ↓ Export CSV
                </button>
            </div>

            {/* Collection Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {LOG_COLLECTIONS.map(c => (
                    <button
                        key={c.key}
                        onClick={() => { setActiveCollection(c.key); setLogs([]); setLastDoc(null); setIsFirstLoad(true); }}
                        style={{
                            padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                            border: '1px solid',
                            borderColor: activeCollection === c.key ? '#3b82f6' : '#1e293b',
                            background: activeCollection === c.key ? 'rgba(59,130,246,0.15)' : '#0f1923',
                            color: activeCollection === c.key ? '#60a5fa' : '#64748b',
                            cursor: 'pointer',
                        }}
                    >
                        {c.label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div style={{
                background: '#0f1923', border: '1px solid #1e293b', borderRadius: 12,
                padding: 16, marginBottom: 20, display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12,
            }}>
                {[
                    { label: 'From Date', val: filterFrom, set: setFilterFrom, type: 'date' },
                    { label: 'To Date',   val: filterTo,   set: setFilterTo,   type: 'date' },
                    { label: 'Performed By', val: filterUser,   set: setFilterUser,   type: 'text', placeholder: 'user_id or system' },
                    { label: 'Action',       val: filterAction, set: setFilterAction, type: 'text', placeholder: 'e.g. invoice_created' },
                    { label: 'Entity Type',  val: filterEntity, set: setFilterEntity, type: 'text', placeholder: 'e.g. invoice' },
                ].map(f => (
                    <div key={f.label}>
                        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{f.label}</label>
                        <input
                            type={f.type}
                            value={f.val}
                            onChange={e => f.set(e.target.value)}
                            placeholder={f.placeholder || ''}
                            style={{
                                width: '100%', padding: '7px 10px', background: '#1e293b',
                                border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0',
                                fontSize: 13, outline: 'none', boxSizing: 'border-box',
                            }}
                        />
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                        onClick={handleSearch}
                        style={{
                            width: '100%', padding: '8px 0', background: 'rgba(59,130,246,0.15)',
                            border: '1px solid #3b82f6', borderRadius: 6, color: '#60a5fa',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        Search
                    </button>
                </div>
            </div>

            {/* Log Table */}
            {isFirstLoad ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: 40, fontSize: 14 }}>
                    Apply filters and click <strong>Search</strong> to load logs.
                </div>
            ) : loading && !logs.length ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Loading…</div>
            ) : logs.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: 40, fontSize: 14 }}>
                    No logs found for the selected filters.
                </div>
            ) : (
                <>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                                    {['Timestamp', 'Level', 'Category / Entity', 'Action', 'Performed By', 'Entity ID'].map(h => (
                                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr
                                        key={log.id}
                                        style={{ borderBottom: '1px solid #0f1923', transition: 'background .15s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={{ padding: '10px 12px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatTs(log)}</td>
                                        <td style={{ padding: '10px 12px' }}>{chip(log.level)}</td>
                                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>
                                            {log.category || log.entityType || '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#38bdf8', fontSize: 12 }}>
                                            {log.action || '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{log.performedBy || log.changedBy || '—'}</td>
                                        <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
                                            {log.entityId ? log.entityId.slice(-12) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 20 }}>
                        {hasMore && (
                            <button
                                onClick={() => fetchLogs(false)}
                                disabled={loading}
                                style={{
                                    padding: '8px 24px', background: 'rgba(59,130,246,0.1)',
                                    border: '1px solid #334155', borderRadius: 8, color: '#60a5fa',
                                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                }}
                            >
                                {loading ? 'Loading…' : `Load Next ${PAGE_SIZE}`}
                            </button>
                        )}
                        <span style={{ color: '#475569', fontSize: 13, lineHeight: '36px' }}>
                            {logs.length} record{logs.length !== 1 ? 's' : ''} loaded
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
