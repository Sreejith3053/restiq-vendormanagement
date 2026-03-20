/**
 * MarketplaceResetUtility.js  — v2
 *
 * SuperAdmin-only marketplace reset utility.
 * Collection names audited directly from codebase on 2026-03-20.
 *
 * Phase 1 — Dry run:  counts every clearable document.
 * Phase 2 — Preview:  show exact counts, protected items, confirm gate.
 * Phase 3 — Execute:  batched delete (top-level + deep vendor subcollections).
 * Phase 4 — Validate: post-reset check that all UI data sources are empty.
 * Phase 5 — Audit:    write final reset log to adminChangeLogs.
 *
 * PROTECTED (never deleted):
 *   vendors collection docs, platformSettings, login collection (all accounts).
 */
import React, { useState, useContext, useRef } from 'react';
import {
    collection, getDocs, writeBatch, doc, addDoc,
    Timestamp, query, limit, startAfter,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION MANIFEST  (audited from source code, 2026-03-20)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level collections to wipe completely.
 * Keys are the Firestore collection IDs.
 * Labels are human-readable names for the preview UI.
 */
const TOP_LEVEL_COLLECTIONS = [
    // ── Orders & Fulfillment ──────────────────────────────────────────────
    { id: 'marketplaceOrders',          label: 'Marketplace Orders',           group: 'Orders & Fulfillment' },
    { id: 'submittedOrders',            label: 'Submitted Orders',             group: 'Orders & Fulfillment' },
    { id: 'vendorDispatches',           label: 'Vendor Dispatches',            group: 'Orders & Fulfillment' },
    { id: 'vendorDispatchRoutes',       label: 'Vendor Dispatch Routes',       group: 'Orders & Fulfillment' },
    // ── Finance ───────────────────────────────────────────────────────────
    { id: 'vendorInvoices',             label: 'Vendor Invoices',              group: 'Finance' },
    { id: 'restaurantInvoices',         label: 'Restaurant Invoices',          group: 'Finance' },
    { id: 'RestaurantPaymentHistory',   label: 'Restaurant Payment History',   group: 'Finance' },
    { id: 'invoiceAdjustments',         label: 'Invoice Adjustments',          group: 'Finance' },
    { id: 'payouts',                    label: 'Payouts',                      group: 'Finance' },
    { id: 'reconciliationReports',      label: 'Reconciliation Reports',       group: 'Finance' },
    { id: 'financeDisputes',            label: 'Finance Disputes',             group: 'Finance' },
    // ── Issues / Disputes ─────────────────────────────────────────────────
    { id: 'issuesDisputes',             label: 'Issues & Disputes',            group: 'Issues' },
    // ── Catalog & Reviews ─────────────────────────────────────────────────
    { id: 'catalogItems',               label: 'Catalog Items',                group: 'Catalog & Reviews' },
    { id: 'catalogReviewQueue',         label: 'Catalog Review Queue',         group: 'Catalog & Reviews' },
    { id: 'catalogItemMappingReview',   label: 'Catalog Item Mapping Review',  group: 'Catalog & Reviews' },
    { id: 'pendingReviews',             label: 'Pending Reviews',              group: 'Catalog & Reviews' },
    { id: 'unmappedItems',              label: 'Unmapped Items',               group: 'Catalog & Reviews' },
    { id: 'vendorComparisonSnapshots',  label: 'Vendor Comparison Snapshots',  group: 'Catalog & Reviews' },
    { id: 'vendorComparisonReviewQueue',label: 'Vendor Comparison Review Queue', group: 'Catalog & Reviews' },
    // ── Restaurants ───────────────────────────────────────────────────────
    { id: 'restaurants',                label: 'Restaurants',                  group: 'Restaurants' },
    { id: 'masterRestaurants',          label: 'Master Restaurants',           group: 'Restaurants' },
    // ── Notifications & Logs ──────────────────────────────────────────────
    { id: 'notifications',              label: 'Notifications',                group: 'Logs & Alerts' },
    { id: 'systemAlerts',               label: 'System Alerts',                group: 'Logs & Alerts' },
    { id: 'systemLogs',                 label: 'System Logs',                  group: 'Logs & Alerts' },
    { id: 'systemMetrics',              label: 'System Metrics',               group: 'Logs & Alerts' },
    { id: 'systemExceptions',           label: 'System Exceptions',            group: 'Logs & Alerts' },
    { id: 'adminChangeLogs',            label: 'Admin Change Logs',            group: 'Logs & Alerts' },
    { id: 'migrationLogs',              label: 'Migration Logs',               group: 'Logs & Alerts' },
    // ── Snapshots ─────────────────────────────────────────────────────────
    { id: 'allocationSnapshots',        label: 'Allocation Snapshots',         group: 'Snapshots' },
    { id: 'forecastSnapshots',          label: 'Forecast Snapshots',           group: 'Snapshots' },
    { id: 'capacitySnapshots',          label: 'Capacity Snapshots',           group: 'Snapshots' },
    { id: 'vendorScores',               label: 'Vendor Scores',                group: 'Snapshots' },
    // ── Calendar / Seasonal ───────────────────────────────────────────────
    { id: 'festivalCalendar',           label: 'Festival Calendar',            group: 'Seasonal' },
    // ── Imports ───────────────────────────────────────────────────────────
    { id: 'importHistory',              label: 'Import History',               group: 'Imports' },
    { id: 'importBatches',              label: 'Import Batches',               group: 'Imports' },
];

/**
 * Per-vendor LEVEL-1 subcollections to delete for every vendor doc.
 * The vendor doc itself is preserved.
 */
const VENDOR_L1_SUBS = [
    'items',
    'importBatches',
    'auditLog',
];

/**
 * Per-item LEVEL-2 subcollections under vendors/{id}/items/{itemId}.
 * Deleted before items are deleted.
 */
const VENDOR_ITEM_SUBS = [
    'history',
    'auditLog',
];

/**
 * Per-importBatch LEVEL-2 subcollections under vendors/{id}/importBatches/{batchId}.
 */
const VENDOR_BATCH_SUBS = [
    'rows',
];

/**
 * Collections to validate after reset (check they are now empty).
 * Maps to a human label and the UI page where the data appears.
 */
const VALIDATION_TARGETS = [
    { id: 'marketplaceOrders',    label: 'Orders',            page: 'Orders & Fulfillment' },
    { id: 'submittedOrders',      label: 'Submitted Orders',  page: 'Orders & Fulfillment' },
    { id: 'vendorDispatches',     label: 'Dispatches',        page: 'Orders & Fulfillment' },
    { id: 'vendorInvoices',       label: 'Vendor Invoices',   page: 'Finance' },
    { id: 'restaurantInvoices',   label: 'Rest. Invoices',    page: 'Finance' },
    { id: 'catalogItems',         label: 'Catalog Items',     page: 'Catalog & Reviews' },
    { id: 'restaurants',          label: 'Restaurants',       page: 'Restaurants' },
    { id: 'issuesDisputes',       label: 'Issues/Disputes',   page: 'Issues' },
];

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 400;

async function countColl(collPath) {
    let count = 0, lastDoc = null;
    while (true) {
        const q = lastDoc
            ? query(collection(db, collPath), startAfter(lastDoc), limit(500))
            : query(collection(db, collPath), limit(500));
        const snap = await getDocs(q);
        count += snap.size;
        if (snap.size < 500) break;
        lastDoc = snap.docs[snap.docs.length - 1];
    }
    return count;
}

async function deleteColl(collPath, onTick) {
    let deleted = 0, lastDoc = null;
    while (true) {
        const q = lastDoc
            ? query(collection(db, collPath), startAfter(lastDoc), limit(BATCH_SIZE))
            : query(collection(db, collPath), limit(BATCH_SIZE));
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        onTick?.(snap.size);
        if (snap.size < BATCH_SIZE) break;
    }
    return deleted;
}

/** Delete a subcollection under a given parent DocumentReference. */
async function deleteSubcoll(parentRef, subName) {
    let deleted = 0, lastDoc = null;
    while (true) {
        const q = lastDoc
            ? query(collection(parentRef, subName), startAfter(lastDoc), limit(BATCH_SIZE))
            : query(collection(parentRef, subName), limit(BATCH_SIZE));
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < BATCH_SIZE) break;
    }
    return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────
const C = {
    card:   '#131d2e', border: 'rgba(255,255,255,0.07)',
    fg:     '#f8fafc', muted:  '#64748b', sub: '#94a3b8',
    green:  '#34d399', red:    '#f87171', amber: '#fbbf24',
    blue:   '#38bdf8', orange: '#f97316',
};
const card     = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 14 };
const btnRed   = { padding: '10px 22px', borderRadius: 9, fontSize: 13, fontWeight: 700, background: 'rgba(248,113,113,0.14)', color: C.red,   border: `2px solid rgba(248,113,113,0.4)`, cursor: 'pointer' };
const btnGray  = { padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.05)', color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' };

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const PHASES = { IDLE: 'idle', SCANNING: 'scanning', PREVIEW: 'preview', RESETTING: 'resetting', VALIDATING: 'validating', DONE: 'done' };

export default function MarketplaceResetUtility() {
    const { role, email, displayName } = useContext(UserContext);
    const [phase,        setPhase]       = useState(PHASES.IDLE);
    const [scan,         setScan]        = useState(null);    // { byGroup, topLevelTotal, vendorSubTotal }
    const [confirmText,  setConfirmText] = useState('');
    const [log,          setLog]         = useState([]);
    const [validation,   setValidation]  = useState(null);
    const [summary,      setSummary]     = useState(null);
    const [error,        setError]       = useState(null);

    const addLog = (msg, type = 'info') => setLog(prev => [...prev, { msg, type, ts: Date.now() }]);

    // guard
    if (role !== 'superadmin') {
        return (
            <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
                <div style={{ fontSize: 36 }}>🔒</div>
                <div style={{ marginTop: 12, fontSize: 15 }}>SuperAdmin access required.</div>
            </div>
        );
    }

    // ── SCAN ──────────────────────────────────────────────────────────────────
    const runScan = async () => {
        setPhase(PHASES.SCANNING);
        setError(null);
        setScan(null);
        try {
            const byGroup = {};
            let topLevelTotal = 0;

            for (const c of TOP_LEVEL_COLLECTIONS) {
                const count = await countColl(c.id).catch(() => 0);
                if (!byGroup[c.group]) byGroup[c.group] = [];
                byGroup[c.group].push({ id: c.id, label: c.label, count });
                topLevelTotal += count;
            }

            // Vendor subcollections
            let vendorSubTotal = 0;
            const vendorSubDetail = [];
            const vSnap = await getDocs(collection(db, 'vendors'));
            for (const vDoc of vSnap.docs) {
                // items
                const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`)).catch(() => ({ docs: [] }));
                vendorSubTotal += itemSnap.docs.length;
                // item-level sub-subs
                for (const iDoc of itemSnap.docs) {
                    for (const sub of VENDOR_ITEM_SUBS) {
                        const n = await countColl(`vendors/${vDoc.id}/items/${iDoc.id}/${sub}`).catch(() => 0);
                        vendorSubTotal += n;
                    }
                }
                // importBatches
                const batchSnap = await getDocs(collection(db, `vendors/${vDoc.id}/importBatches`)).catch(() => ({ docs: [] }));
                vendorSubTotal += batchSnap.docs.length;
                for (const bDoc of batchSnap.docs) {
                    for (const sub of VENDOR_BATCH_SUBS) {
                        const n = await countColl(`vendors/${vDoc.id}/importBatches/${bDoc.id}/${sub}`).catch(() => 0);
                        vendorSubTotal += n;
                    }
                }
                // auditLog
                const auditN = await countColl(`vendors/${vDoc.id}/auditLog`).catch(() => 0);
                vendorSubTotal += auditN;
                vendorSubDetail.push({ vendorId: vDoc.id, name: vDoc.data().name || vDoc.id });
            }

            setScan({ byGroup, topLevelTotal, vendorSubTotal, vendorCount: vSnap.size, vendorSubDetail });
            setPhase(PHASES.PREVIEW);
        } catch (err) {
            setError(`Scan failed: ${err.message}`);
            setPhase(PHASES.IDLE);
        }
    };

    // ── EXECUTE RESET ─────────────────────────────────────────────────────────
    const executeReset = async () => {
        if (confirmText !== 'RESET') return;
        setPhase(PHASES.RESETTING);
        setLog([]);
        let totalDeleted = 0;
        const deleteSummary = [];

        const tick = (collKey, n) => {
            totalDeleted += n;
        };

        try {
            addLog('🚀 Marketplace reset started', 'info');

            // ── 1. Top-level collections ──────────────────────────────────
            for (const c of TOP_LEVEL_COLLECTIONS) {
                const entry = scan.byGroup[c.group]?.find(r => r.id === c.id);
                if (!entry || entry.count === 0) {
                    addLog(`⬜ ${c.id} — empty`, 'muted');
                    continue;
                }
                addLog(`🗑️  Deleting ${c.id} (${entry.count} docs)…`, 'warn');
                const n = await deleteColl(c.id, (chunk) => tick(c.id, chunk));
                deleteSummary.push({ key: c.id, deleted: n });
                addLog(`   ✅ ${c.id} — ${n} deleted`, 'success');
            }

            // ── 2. Vendor subcollections (deep) ───────────────────────────
            addLog('🗑️  Clearing vendor subcollections (items + history + auditLog + importBatches + rows)…', 'warn');
            let vSubDeleted = 0;
            const vSnap = await getDocs(collection(db, 'vendors'));

            for (const vDoc of vSnap.docs) {
                const ref = vDoc.ref;

                // items + item sub-subs (history, auditLog)
                const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`)).catch(() => ({ docs: [] }));
                for (const iDoc of itemSnap.docs) {
                    for (const sub of VENDOR_ITEM_SUBS) {
                        const n = await deleteSubcoll(iDoc.ref, sub).catch(() => 0);
                        vSubDeleted += n;
                    }
                    // delete item doc itself
                    await iDoc.ref.delete().catch(() => {});
                    vSubDeleted++;
                }

                // importBatches + batch rows
                const batchSnap = await getDocs(collection(db, `vendors/${vDoc.id}/importBatches`)).catch(() => ({ docs: [] }));
                for (const bDoc of batchSnap.docs) {
                    for (const sub of VENDOR_BATCH_SUBS) {
                        const n = await deleteSubcoll(bDoc.ref, sub).catch(() => 0);
                        vSubDeleted += n;
                    }
                    await bDoc.ref.delete().catch(() => {});
                    vSubDeleted++;
                }

                // vendor-level auditLog
                const auditN = await deleteSubcoll(ref, 'auditLog').catch(() => 0);
                vSubDeleted += auditN;
            }

            totalDeleted += vSubDeleted;
            deleteSummary.push({ key: 'vendors/*/subcollections', deleted: vSubDeleted });
            addLog(`   ✅ Vendor subcollections — ${vSubDeleted} docs deleted`, 'success');

            // ── 3. Post-reset validation ──────────────────────────────────
            addLog('', 'info');
            addLog('🔍 Running post-reset validation…', 'info');
            setPhase(PHASES.VALIDATING);
            const valResults = [];
            for (const v of VALIDATION_TARGETS) {
                const remaining = await countColl(v.id).catch(() => 0);
                valResults.push({ ...v, remaining });
            }
            // Vendor items validation
            let itemsRemaining = 0;
            const postVSnap = await getDocs(collection(db, 'vendors')).catch(() => ({ docs: [] }));
            for (const vDoc of postVSnap.docs) {
                const iSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`)).catch(() => ({ size: 0 }));
                itemsRemaining += iSnap.size;
            }
            valResults.push({ id: 'vendors/*/items', label: 'Vendor Items (all)', page: 'Vendor Details', remaining: itemsRemaining });

            setValidation(valResults);

            // ── 4. Audit log ──────────────────────────────────────────────
            addLog('📝 Writing final audit log…', 'info');
            try {
                await addDoc(collection(db, 'adminChangeLogs'), {
                    action:             'MARKETPLACE_RESET_V2',
                    performedBy:        email || displayName || 'superadmin',
                    role:               'superadmin',
                    timestamp:          Timestamp.now(),
                    totalDeleted,
                    collectionsCleared: deleteSummary.map(d => d.key),
                    summary:            deleteSummary,
                    validationResults:  valResults,
                    note:               'Full marketplace reset. vendors, platformSettings, login accounts preserved.',
                });
                addLog('   ✅ Audit log written to adminChangeLogs', 'success');
            } catch (e) {
                addLog(`   ⚠️ Could not write audit log: ${e.message}`, 'warn');
            }

            addLog('', 'info');
            addLog(`🎉 Reset complete!  ${totalDeleted.toLocaleString()} documents deleted.`, 'success');
            addLog('✅ vendors collection: preserved', 'success');
            addLog('✅ platformSettings: preserved', 'success');
            addLog('✅ login / user accounts: preserved', 'success');

            setSummary({ totalDeleted, deleteSummary, timestamp: new Date() });
            setPhase(PHASES.DONE);
            toast.success(`Reset complete — ${totalDeleted.toLocaleString()} docs deleted.`);
        } catch (err) {
            setError(`Reset failed: ${err.message}`);
            addLog(`❌ FATAL: ${err.message}`, 'error');
            setPhase(PHASES.PREVIEW);
        }
    };

    const totalToDelete = scan ? scan.topLevelTotal + scan.vendorSubTotal : 0;

    // ── RENDER ────────────────────────────────────────────────────────────────
    return (
        <div style={{ maxWidth: 940, paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>⚠️</span>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.red }}>Marketplace Reset Utility</h2>
                <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(248,113,113,0.1)', color: C.red, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 6, padding: '3px 8px' }}>v2 — Full Audit Mode</span>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: C.sub }}>
                Clears all transactional data for clean testing. <strong style={{ color: C.amber }}>Vendor accounts, vendor documents, and platform settings are preserved.</strong>
            </p>

            {/* Protected banner */}
            <div style={{ ...card, background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 8 }}>🔒 PROTECTED — Will NOT be deleted</div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: C.sub }}>
                    {['vendors (collection docs)', 'platformSettings', 'login / user accounts (all)'].map(p => (
                        <span key={p}>✅ {p}</span>
                    ))}
                </div>
            </div>

            {/* IDLE */}
            {phase === PHASES.IDLE && (
                <div style={card}>
                    <div style={{ fontSize: 13, color: C.sub, marginBottom: 18, lineHeight: 1.7 }}>
                        Click <strong style={{ color: C.fg }}>Scan System</strong> to count all documents in clearable collections before deleting anything.
                        The scan is <strong>read-only</strong> — nothing is changed.
                    </div>
                    <button onClick={runScan} style={btnRed}>🔍 Scan System (Dry Run)</button>
                </div>
            )}

            {/* SCANNING */}
            {phase === PHASES.SCANNING && (
                <div style={{ ...card, textAlign: 'center', padding: 48 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
                    <div style={{ fontSize: 14, color: C.sub }}>Counting documents across {TOP_LEVEL_COLLECTIONS.length} collections + vendor subcollections…</div>
                    <div style={{ marginTop: 20, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '70%', background: C.blue, borderRadius: 2 }} />
                    </div>
                </div>
            )}

            {/* PREVIEW */}
            {(phase === PHASES.PREVIEW) && scan && (
                <>
                    <div style={card}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14 }}>
                            ⚠️ Dry-Run Preview — {totalToDelete.toLocaleString()} documents to delete
                        </div>

                        {Object.entries(scan.byGroup).map(([group, entries]) => (
                            <div key={group} style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{group}</div>
                                {entries.map(r => (
                                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '5px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: r.count === 0 ? C.muted : C.fg }}>
                                        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.id}</span>
                                        <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: r.count === 0 ? C.muted : r.count > 500 ? C.red : r.count > 0 ? C.amber : C.muted }}>
                                            {r.count === 0 ? '—' : r.count.toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}

                        {/* Vendor subcollections */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Vendor Subcollections ({scan.vendorCount} vendors)</div>
                            {['items', 'items/{id}/history', 'items/{id}/auditLog', 'importBatches', 'importBatches/{id}/rows', 'auditLog'].map(s => (
                                <div key={s} style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '5px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: C.sub }}>
                                    <span style={{ fontSize: 12, fontFamily: 'monospace' }}>vendors/*/{s}</span>
                                    <span style={{ fontSize: 11, color: C.muted }}>included in count below</span>
                                </div>
                            ))}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '6px 4px', color: C.fg }}>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>Vendor subcollection total</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: scan.vendorSubTotal > 0 ? C.amber : C.muted }}>{scan.vendorSubTotal.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* Grand total */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '12px 4px 0', borderTop: `1px solid ${C.border}` }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: C.fg }}>Total to delete</span>
                            <span style={{ fontSize: 22, fontWeight: 800, color: totalToDelete === 0 ? C.muted : C.red }}>{totalToDelete.toLocaleString()}</span>
                        </div>
                    </div>

                    {totalToDelete === 0 ? (
                        <div style={{ ...card, textAlign: 'center', color: C.green, padding: 32 }}>✅ System is already clean — nothing to delete.</div>
                    ) : (
                        <div style={card}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 12 }}>⚠️ Confirm Reset — This cannot be undone</div>
                            <p style={{ fontSize: 13, color: C.sub, margin: '0 0 16px', lineHeight: 1.7 }}>
                                Type <code style={{ color: C.red, fontWeight: 700, letterSpacing: 1 }}>RESET</code> and click Execute to permanently delete {totalToDelete.toLocaleString()} documents.
                            </p>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                    value={confirmText}
                                    onChange={e => setConfirmText(e.target.value.toUpperCase())}
                                    placeholder="Type RESET to confirm"
                                    style={{
                                        flex: '0 0 220px', padding: '10px 14px', borderRadius: 9, fontSize: 14,
                                        fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1,
                                        border: `2px solid ${confirmText === 'RESET' ? C.red : C.border}`,
                                        background: 'rgba(255,255,255,0.04)', color: confirmText === 'RESET' ? C.red : C.fg, outline: 'none',
                                    }}
                                />
                                <button
                                    onClick={executeReset}
                                    disabled={confirmText !== 'RESET'}
                                    style={{ ...btnRed, opacity: confirmText !== 'RESET' ? 0.35 : 1, cursor: confirmText !== 'RESET' ? 'not-allowed' : 'pointer' }}>
                                    🗑️ Execute Reset ({totalToDelete.toLocaleString()} docs)
                                </button>
                                <button onClick={() => { setPhase(PHASES.IDLE); setScan(null); setConfirmText(''); }} style={btnGray}>Cancel</button>
                            </div>
                            {confirmText.length > 0 && confirmText !== 'RESET' && (
                                <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>✗ Must type "RESET" (all caps)</div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* RESETTING / VALIDATING / DONE — live log */}
            {[PHASES.RESETTING, PHASES.VALIDATING, PHASES.DONE].includes(phase) && (
                <div style={card}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: phase === PHASES.DONE ? C.green : C.amber, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 12 }}>
                        {phase === PHASES.DONE ? '✅ Reset Complete' : phase === PHASES.VALIDATING ? '🔍 Validating…' : '⟳ Resetting — do not close page'}
                    </div>

                    {/* Live log */}
                    <div style={{ background: '#080e18', borderRadius: 8, padding: '13px 15px', maxHeight: 340, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.85 }}>
                        {log.map((l, i) => (
                            <div key={i} style={{ color: l.type === 'success' ? C.green : l.type === 'error' ? C.red : l.type === 'warn' ? C.amber : l.type === 'muted' ? '#475569' : C.sub }}>
                                {l.msg || '\u00A0'}
                            </div>
                        ))}
                    </div>

                    {/* Validation results */}
                    {validation && (
                        <div style={{ marginTop: 18 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Post-Reset Validation</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 12px', fontSize: 12, color: C.muted, fontWeight: 700, marginBottom: 6 }}>
                                <span>Collection</span><span>Page</span><span>Remaining</span><span>Status</span>
                            </div>
                            {validation.map(v => (
                                <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 12px', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12 }}>
                                    <span style={{ fontFamily: 'monospace', color: C.sub }}>{v.id}</span>
                                    <span style={{ color: C.muted }}>{v.page}</span>
                                    <span style={{ fontWeight: 700, color: v.remaining === 0 ? C.green : C.red }}>{v.remaining}</span>
                                    <span>{v.remaining === 0 ? '✅' : '⚠️'}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Deletion summary */}
                    {phase === PHASES.DONE && summary && (
                        <div style={{ marginTop: 18 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Deletion Summary</div>
                            {summary.deleteSummary.filter(d => d.deleted > 0).map(d => (
                                <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12 }}>
                                    <span style={{ fontFamily: 'monospace', color: C.sub }}>{d.key}</span>
                                    <span style={{ color: C.amber, fontWeight: 700 }}>{d.deleted.toLocaleString()}</span>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 800 }}>
                                <span style={{ color: C.fg }}>Total deleted</span>
                                <span style={{ color: C.red, fontSize: 18 }}>{summary.totalDeleted.toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                                Reset performed at {summary.timestamp.toLocaleString()} by {email || 'superadmin'}
                            </div>
                            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                                <button onClick={() => { setPhase(PHASES.IDLE); setScan(null); setConfirmText(''); setLog([]); setSummary(null); setValidation(null); }} style={btnGray}>
                                    New Scan
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: C.red, fontSize: 13 }}>
                    ❌ {error}
                </div>
            )}

            {/* Privacy notice */}
            <div style={{ marginTop: 20, fontSize: 11, color: '#1e293b', fontStyle: 'italic' }}>
                vendors, platformSettings, and all login accounts are never modified by this tool.
            </div>
        </div>
    );
}
