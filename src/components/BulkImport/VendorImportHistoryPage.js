/**
 * VendorImportHistoryPage.js
 * Route: /vendor/import/history
 *
 * Lists all import batches for the vendor with expandable detail drawer.
 */
import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import {
    collection,
    getDocs,
    query,
    orderBy,
} from 'firebase/firestore';
import { generateErrorReport } from './importHelpers';

const MODE_LABELS = {
    add_and_update:  { label: 'Add + Update', color: '#38bdf8' },
    add_new:         { label: 'Add New Only',  color: '#4ade80' },
    update_existing: { label: 'Update Only',   color: '#fbbf24' },
};

function timeAgo(ts) {
    if (!ts) return '—';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Stat({ label, value, color }) {
    return (
        <div style={{ textAlign: 'center', padding: '8px 12px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: color || '#f8fafc' }}>{value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
        </div>
    );
}

export default function VendorImportHistoryPage() {
    const navigate = useNavigate();
    const { vendorId } = useContext(UserContext);
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [batchRows, setBatchRows] = useState({});
    const [loadingRows, setLoadingRows] = useState(false);

    useEffect(() => {
        if (!vendorId) return;
        (async () => {
            try {
                const q = query(
                    collection(db, 'vendors', vendorId, 'importBatches'),
                    orderBy('uploadedAt', 'desc')
                );
                const snap = await getDocs(q);
                setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error('[ImportHistory] load batches:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId]);

    const handleExpand = async (batchId) => {
        if (expandedId === batchId) { setExpandedId(null); return; }
        setExpandedId(batchId);

        if (batchRows[batchId]) return; // already loaded

        setLoadingRows(true);
        try {
            const snap = await getDocs(
                query(collection(db, 'vendors', vendorId, 'importBatches', batchId, 'rows'), orderBy('rowNumber', 'asc'))
            );
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setBatchRows(prev => ({ ...prev, [batchId]: rows }));
        } catch (err) {
            console.error('[ImportHistory] load rows:', err);
        } finally {
            setLoadingRows(false);
        }
    };

    const ACTION_COLORS = {
        new_item:        '#4ade80',
        update:          '#38bdf8',
        unchanged:       '#64748b',
        potential_match: '#a78bfa',
        error:           '#f87171',
        skip:            '#475569',
        none:            '#475569',
    };

    const ACTION_LABELS = {
        new_item:        '✨ Created',
        update:          '✏️ Updated',
        unchanged:       '➖ No Change',
        potential_match: '🔍 Needs Review',
        error:           '❌ Error',
        skip:            '⏭️ Skipped',
        none:            '—',
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <button className="ui-btn ghost small" onClick={() => navigate('/items')} style={{ marginBottom: 8, padding: '4px 12px' }}>
                    ← Back to Catalog
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>🕐 Import History</h1>
                        <p style={{ color: '#94a3b8', marginTop: 4 }}>All past bulk import sessions for your catalog.</p>
                    </div>
                    <button className="ui-btn primary small" onClick={() => navigate('/vendor/import')}>
                        📥 New Import
                    </button>
                </div>
            </div>

            {loading && (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading import history…</div>
            )}

            {!loading && batches.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
                    <div style={{ fontSize: 16, color: '#64748b', marginBottom: 20 }}>No imports yet.</div>
                    <button className="ui-btn primary" onClick={() => navigate('/vendor/import')}>Start Your First Import</button>
                </div>
            )}

            {!loading && batches.map(batch => {
                const isExpanded = expandedId === batch.id;
                const modeCfg = MODE_LABELS[batch.importMode] || { label: batch.importMode, color: '#94a3b8' };

                return (
                    <div
                        key={batch.id}
                        style={{
                            marginBottom: 12,
                            borderRadius: 10,
                            border: isExpanded ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(255,255,255,0.07)',
                            background: '#1A1A2E',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Batch header row */}
                        <div
                            onClick={() => handleExpand(batch.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '14px 20px',
                                cursor: 'pointer',
                                flexWrap: 'wrap',
                                gap: 12,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 20 }}>📁</div>
                                <div>
                                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 14 }}>
                                        {batch.fileName || 'Unknown file'}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                        {timeAgo(batch.uploadedAt)} &nbsp;·&nbsp; by {batch.uploadedByName || batch.uploadedBy || 'Unknown'}
                                    </div>
                                </div>
                                <span style={{
                                    padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                                    background: 'rgba(56,189,248,0.1)', color: modeCfg.color, border: '1px solid ' + modeCfg.color + '44',
                                }}>
                                    {modeCfg.label}
                                </span>
                            </div>

                            {/* Counts */}
                            <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <Stat label="Total" value={batch.totalRows || 0} />
                                <Stat label="Created" value={batch.createdCount || 0} color="#4ade80" />
                                <Stat label="Updated" value={batch.updatedCount || 0} color="#38bdf8" />
                                <Stat label="Errors" value={batch.errorCount || 0} color="#f87171" />
                            </div>

                            <div style={{ color: '#64748b', fontSize: 16 }}>{isExpanded ? '▲' : '▼'}</div>
                        </div>

                        {/* Expanded row detail */}
                        {isExpanded && (
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px' }}>
                                {loadingRows && !batchRows[batch.id] && (
                                    <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>Loading rows…</div>
                                )}
                                {batchRows[batch.id] && batchRows[batch.id].length === 0 && (
                                    <div style={{ color: '#64748b', fontSize: 13 }}>No row-level data stored for this batch.</div>
                                )}
                                {batchRows[batch.id] && batchRows[batch.id].length > 0 && (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                                                Row Results ({batchRows[batch.id].length} rows)
                                            </div>
                                            {(batch.errorCount || 0) > 0 && (
                                                <button
                                                    className="ui-btn ghost small"
                                                    style={{ padding: '3px 12px', fontSize: 12 }}
                                                    onClick={() => generateErrorReport(
                                                        batchRows[batch.id]
                                                            .filter(r => r.actionTaken === 'error')
                                                            .map(r => ({
                                                                ...r.rawData,
                                                                _rowNumber: r.rowNumber,
                                                                errors: r.errorMessages,
                                                                warnings: r.warningMessages,
                                                            }))
                                                    )}
                                                >
                                                    📥 Download Error Report
                                                </button>
                                            )}
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                <thead>
                                                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                                        {['Row', 'Item Name', 'Action', 'Changed Fields', 'Errors/Warnings'].map(h => (
                                                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {batchRows[batch.id].slice(0, 100).map((row, ri) => (
                                                        <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                            <td style={{ padding: '7px 12px', color: '#475569', fontFamily: 'monospace' }}>{row.rowNumber}</td>
                                                            <td style={{ padding: '7px 12px', color: '#f8fafc', fontWeight: 600 }}>{row.rawData?.itemName || '—'}</td>
                                                            <td style={{ padding: '7px 12px' }}>
                                                                <span style={{ color: ACTION_COLORS[row.actionTaken] || '#94a3b8', fontWeight: 600 }}>
                                                                    {ACTION_LABELS[row.actionTaken] || row.actionTaken}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '7px 12px', color: '#94a3b8' }}>
                                                                {(row.changedFields || []).join(', ') || '—'}
                                                            </td>
                                                            <td style={{ padding: '7px 12px' }}>
                                                                {(row.errorMessages || []).map((e, i) => (
                                                                    <div key={i} style={{ color: '#f87171' }}>❌ {e}</div>
                                                                ))}
                                                                {(row.warningMessages || []).map((w, i) => (
                                                                    <div key={i} style={{ color: '#fbbf24' }}>⚠️ {w}</div>
                                                                ))}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {batchRows[batch.id].length > 100 && (
                                                <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 8 }}>
                                                    Showing first 100 of {batchRows[batch.id].length} rows.
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
