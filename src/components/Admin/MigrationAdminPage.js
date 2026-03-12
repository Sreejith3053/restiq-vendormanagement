import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { migrateRestaurants } from '../../utils/migrateRestaurants';
import { migrateCatalogItems } from '../../utils/migrateCatalogItems';
import { toast } from 'react-toastify';

export default function MigrationAdminPage() {
    const [activeTab, setActiveTab] = useState('overview');
    const [migrating, setMigrating] = useState(null); // 'restaurants' | 'catalog' | null
    const [progressLog, setProgressLog] = useState([]);
    const [migrationResult, setMigrationResult] = useState(null);

    // Collections stats
    const [stats, setStats] = useState({ restaurants: 0, catalogItems: 0, vendorItems: 0, reviewItems: 0, migrationLogs: 0 });
    const [reviewItems, setReviewItems] = useState([]);
    const [migrationLogs, setMigrationLogs] = useState([]);
    const [catalogItems, setCatalogItems] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchStats = useCallback(async () => {
        setLoading(true);
        try {
            const [restSnap, catSnap, revSnap, logSnap] = await Promise.all([
                getDocs(collection(db, 'restaurants')),
                getDocs(collection(db, 'catalogItems')),
                getDocs(collection(db, 'catalogItemMappingReview')),
                getDocs(collection(db, 'migrationLogs')),
            ]);

            // Count vendor items
            let viCount = 0;
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            for (const v of vendorsSnap.docs) {
                const itemsSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                viCount += itemsSnap.docs.length;
            }

            setStats({
                restaurants: restSnap.docs.length,
                catalogItems: catSnap.docs.length,
                vendorItems: viCount,
                reviewItems: revSnap.docs.length,
                migrationLogs: logSnap.docs.length,
            });

            setCatalogItems(catSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setReviewItems(revSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status === 'pending'));
            setMigrationLogs(logSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')));
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    const handleMigrate = async (type) => {
        setMigrating(type);
        setProgressLog([]);
        setMigrationResult(null);
        try {
            const fn = type === 'restaurants' ? migrateRestaurants : migrateCatalogItems;
            const result = await fn((msg) => setProgressLog(prev => [...prev, msg]));
            setMigrationResult(result);
            toast.success(`${type} migration complete!`);
            fetchStats();
        } catch (err) {
            toast.error(`Migration error: ${err.message}`);
        }
        setMigrating(null);
    };

    const handleResolveReview = async (reviewItem, catalogItemId) => {
        try {
            // Link the vendor item
            await updateDoc(doc(db, `vendors/${reviewItem.vendorId}/items`, reviewItem.itemId), {
                catalogItemId,
                updatedAt: new Date().toISOString(),
            });
            // Mark review as resolved
            await updateDoc(doc(db, 'catalogItemMappingReview', reviewItem.id), {
                status: 'resolved',
                resolvedCatalogItemId: catalogItemId,
                resolvedAt: serverTimestamp(),
            });
            toast.success(`Linked "${reviewItem.itemName}" → ${catalogItemId}`);
            fetchStats();
        } catch (err) { toast.error(err.message); }
    };

    const handleDismissReview = async (reviewItem) => {
        try {
            await updateDoc(doc(db, 'catalogItemMappingReview', reviewItem.id), {
                status: 'dismissed',
                resolvedAt: serverTimestamp(),
            });
            toast.info('Dismissed');
            fetchStats();
        } catch (err) { toast.error(err.message); }
    };

    const tabs = [
        { id: 'overview', label: '📊 Overview' },
        { id: 'migrate', label: '🔄 Run Migration' },
        { id: 'review', label: `⚠️ Review Queue (${reviewItems.length})` },
        { id: 'logs', label: '📋 Migration Logs' },
    ];

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🔧 Migration & Backfill</h2>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8' }}>Safely populate master collections from existing marketplace data</p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 0 }}>
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setActiveTab(t.id)}
                        style={{ padding: '10px 18px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: activeTab === t.id ? 'rgba(56,189,248,0.15)' : 'transparent', color: activeTab === t.id ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === t.id ? '2px solid #38bdf8' : '2px solid transparent', transition: 'all 0.15s' }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
                <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                        {[
                            { label: 'Master Restaurants', value: stats.restaurants, icon: '🏪', color: '#10b981' },
                            { label: 'Catalog Items', value: stats.catalogItems, icon: '📦', color: '#38bdf8' },
                            { label: 'Total Vendor Items', value: stats.vendorItems, icon: '🏷️', color: '#a78bfa' },
                            { label: 'Pending Review', value: stats.reviewItems, icon: '⚠️', color: stats.reviewItems > 0 ? '#fbbf24' : '#10b981' },
                            { label: 'Migration Runs', value: stats.migrationLogs, icon: '📋', color: '#94a3b8' },
                        ].map(s => (
                            <div key={s.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{loading ? '…' : s.value}</div>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{s.icon} {s.label}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: 18, fontSize: 13, color: '#94a3b8' }}>
                        <strong style={{ color: '#38bdf8' }}>💡 How it works:</strong>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
                            <li><strong>Restaurant Backfill</strong> scans marketplaceOrders + submittedOrders → creates master restaurant profiles</li>
                            <li><strong>Catalog Backfill</strong> scans vendor items → normalizes names → creates catalogItems → links vendor items</li>
                            <li>Ambiguous names (short/generic like "Fish", "Oil") are sent to the <strong>Review Queue</strong> for manual linking</li>
                            <li>All migrations are <strong>idempotent</strong> — safe to run multiple times without creating duplicates</li>
                            <li>Each run is logged in <strong>migrationLogs</strong> for audit trail</li>
                        </ul>
                    </div>
                </div>
            )}

            {/* MIGRATION TAB */}
            {activeTab === 'migrate' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Restaurant Migration */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🏪 Restaurant Backfill</h3>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>Scans orders → creates master restaurant records</p>
                            </div>
                            <button onClick={() => handleMigrate('restaurants')} disabled={!!migrating}
                                style={{ padding: '10px 20px', borderRadius: 8, background: migrating === 'restaurants' ? 'rgba(56,189,248,0.2)' : '#10b981', color: '#fff', border: 'none', cursor: migrating ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: migrating && migrating !== 'restaurants' ? 0.5 : 1 }}>
                                {migrating === 'restaurants' ? '⏳ Running...' : '▶ Run Restaurant Backfill'}
                            </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                            Sources: <code>marketplaceOrders</code>, <code>submittedOrders</code> → Target: <code>restaurants</code>
                        </div>
                    </div>

                    {/* Catalog Migration */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📦 Catalog Items Backfill</h3>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>Scans vendor items → normalizes → creates catalog + links</p>
                            </div>
                            <button onClick={() => handleMigrate('catalog')} disabled={!!migrating}
                                style={{ padding: '10px 20px', borderRadius: 8, background: migrating === 'catalog' ? 'rgba(56,189,248,0.2)' : '#10b981', color: '#fff', border: 'none', cursor: migrating ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: migrating && migrating !== 'catalog' ? 0.5 : 1 }}>
                                {migrating === 'catalog' ? '⏳ Running...' : '▶ Run Catalog Backfill'}
                            </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                            Sources: <code>vendors/*/items</code> → Targets: <code>catalogItems</code>, <code>catalogItemMappingReview</code>
                        </div>
                    </div>

                    {/* Live Progress */}
                    {progressLog.length > 0 && (
                        <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 16, maxHeight: 300, overflowY: 'auto' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 8, position: 'sticky', top: 0, background: 'rgba(0,0,0,0.8)', padding: '4px 0' }}>📡 Live Progress</div>
                            {progressLog.map((msg, i) => (
                                <div key={i} style={{ fontSize: 11, color: msg.startsWith('✅') ? '#10b981' : msg.startsWith('❌') ? '#f43f5e' : msg.startsWith('✓') ? '#34d399' : '#94a3b8', marginBottom: 2, fontFamily: 'monospace' }}>
                                    {msg}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Result Summary */}
                    {migrationResult && (
                        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, padding: 18 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 10 }}>✅ Migration Complete</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                                {Object.entries(migrationResult).filter(([k]) => typeof migrationResult[k] === 'number').map(([k, v]) => (
                                    <div key={k} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{v}</div>
                                        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</div>
                                    </div>
                                ))}
                            </div>
                            {migrationResult.errors?.length > 0 && (
                                <div style={{ marginTop: 12, fontSize: 11, color: '#f87171' }}>
                                    <strong>Errors ({migrationResult.errors.length}):</strong>
                                    {migrationResult.errors.slice(0, 5).map((e, i) => <div key={i}>• {e}</div>)}
                                    {migrationResult.errors.length > 5 && <div>...and {migrationResult.errors.length - 5} more</div>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* REVIEW QUEUE TAB */}
            {activeTab === 'review' && (
                <div>
                    {reviewItems.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
                            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                            <div style={{ fontSize: 14 }}>No items pending review. All vendor items are either mapped or haven't been scanned yet.</div>
                        </div>
                    ) : (
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '12px 18px', background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.1)', fontSize: 12, color: '#fbbf24', fontWeight: 600 }}>
                                ⚠️ {reviewItems.length} vendor items need manual catalog mapping
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                        {['Vendor', 'Item Name', 'Suggested Key', 'Category', 'Actions'].map(h => (
                                            <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {reviewItems.map(r => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                            <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{r.vendorName}</td>
                                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#f8fafc' }}>{r.itemName}</td>
                                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{r.suggestedNormalizedKey || '—'}</td>
                                            <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{r.category || '—'}</td>
                                            <td style={{ padding: '10px 14px' }}>
                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <select
                                                        onChange={(e) => { if (e.target.value) handleResolveReview(r, e.target.value); }}
                                                        defaultValue=""
                                                        style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', maxWidth: 160 }}>
                                                        <option value="">Link to catalog…</option>
                                                        {catalogItems.map(c => (
                                                            <option key={c.catalogItemId} value={c.catalogItemId}>{c.canonicalName}</option>
                                                        ))}
                                                    </select>
                                                    <button onClick={() => handleDismissReview(r)}
                                                        style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* MIGRATION LOGS TAB */}
            {activeTab === 'logs' && (
                <div>
                    {migrationLogs.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>No migration logs yet. Run a migration to see logs here.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {migrationLogs.map(log => {
                                const isSuccess = log.status === 'completed';
                                return (
                                    <div key={log.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 18 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: log.type === 'restaurantsBackfill' ? 'rgba(16,185,129,0.1)' : 'rgba(56,189,248,0.1)', color: log.type === 'restaurantsBackfill' ? '#10b981' : '#38bdf8' }}>
                                                    {log.type === 'restaurantsBackfill' ? '🏪 Restaurants' : '📦 Catalog Items'}
                                                </span>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: isSuccess ? '#10b981' : '#fbbf24' }}>● {log.status}</span>
                                            </div>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>{log.completedAt}</span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
                                            {[
                                                { label: 'Processed', value: log.totalProcessed || 0 },
                                                { label: 'Created', value: log.totalCreated || 0, color: '#10b981' },
                                                { label: 'Updated', value: log.totalUpdated || 0, color: '#38bdf8' },
                                                { label: 'Skipped', value: log.totalSkipped || 0 },
                                                { label: 'Review', value: log.totalNeedsReview || 0, color: '#fbbf24' },
                                                { label: 'Errors', value: log.errorCount || 0, color: log.errorCount > 0 ? '#f43f5e' : '#94a3b8' },
                                            ].map(s => (
                                                <div key={s.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 8, textAlign: 'center' }}>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: s.color || '#f8fafc' }}>{s.value}</div>
                                                    <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>{s.label}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {log.notes && <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>{log.notes}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
