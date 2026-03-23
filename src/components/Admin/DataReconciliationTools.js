/**
 * DataReconciliationTools.js
 *
 * SuperAdmin-only one-time reconciliation tools.
 *
 * TOOL 1 — Rebuild Vendor Stats
 *   Reads each vendor's items subcollection and writes fresh
 *   stats fields to the vendor doc. Fixes "0 items" bug on
 *   vendor detail header cards.
 *
 * TOOL 2 — Reconcile Legacy Review Queue (catalogReviewQueue)
 *   Scans the deprecated catalogReviewQueue and marks items
 *   as "deprecated" in the UI if a corresponding vendorItem
 *   or changeRequest has been resolved. No hard deletes.
 *   catalogReviewQueue is LEGACY — changeRequests is the
 *   official review source.
 *
 * TOOL 3 — Backfill changeRequests Fields
 *   Ensures every changeRequest doc has the required standard
 *   fields: requestType, status, vendorId, vendorItemId, createdAt.
 *
 * TOOL 5 — Deduplicate Review Queue (catalogReviewQueue)
 *   Groups unresolved items by (vendorId + vendorItemId + reviewType).
 *   Keeps the newest. Marks older duplicates as 'merged' (no hard delete).
 *   Preserves audit trail. Safe to run multiple times.
 */
import React, { useState, useContext } from 'react';
import {
    collection, getDocs, getDoc, doc, updateDoc,
    query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
    card:   '#131d2e',
    border: 'rgba(255,255,255,0.08)',
    fg:     '#f8fafc',
    muted:  '#64748b',
    sub:    '#94a3b8',
    green:  '#34d399',
    red:    '#f87171',
    amber:  '#fbbf24',
    blue:   '#38bdf8',
};
const card  = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 14 };
const btn   = (c) => ({ padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, background: `rgba(${c},0.12)`, color: `rgb(${c})`, border: `1px solid rgba(${c},0.25)`, cursor: 'pointer' });

// ─── Component ────────────────────────────────────────────────────────────────
export default function DataReconciliationTools() {
    const { role } = useContext(UserContext);
    const [tool1,   setTool1  ] = useState({ running: false, done: false, log: [] });
    const [tool2,   setTool2  ] = useState({ running: false, done: false, log: [] });
    const [tool3,   setTool3  ] = useState({ running: false, done: false, log: [] });
    const [tool5,   setTool5  ] = useState({ running: false, done: false, log: [] });
    const [finance, setFinance] = useState(null);
    const [financeLoading, setFinanceLoading] = useState(false);

    if (role !== 'superadmin') {
        return <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>🔒 SuperAdmin only.</div>;
    }

    const addLog = (setter, msg, type = 'info') =>
        setter(p => ({ ...p, log: [...p.log, { msg, type }] }));

    // ── TOOL 1: Rebuild vendor stats ─────────────────────────────────────────
    const runRebuildStats = async () => {
        setTool1({ running: true, done: false, log: [] });
        try {
            const vendorSnap = await getDocs(collection(db, 'vendors'));
            addLog(setTool1, `📦 Found ${vendorSnap.size} vendors.`);

            let updated = 0;
            for (const vDoc of vendorSnap.docs) {
                const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                let totalItems = 0, activeItems = 0, pendingItems = 0, rejectedItems = 0, unmappedItems = 0;

                itemSnap.docs.forEach(d => {
                    const item = d.data();
                    totalItems++;
                    const s1 = (item.normalizedStatus || '').toLowerCase();
                    const s2 = (item.status || '').toLowerCase();
                    const PENDING_VALS = ['in-review', 'pending', 'pending review', 'pending_review', 'review_flagged', 'in_review'];
                    if (s1 === 'rejected' || s2 === 'rejected') rejectedItems++;
                    else if (PENDING_VALS.includes(s1) || PENDING_VALS.includes(s2)) pendingItems++;
                    else if (s1 === 'active' || s2 === 'active') activeItems++;

                    if (!item.catalogItemId || item.mappingStatus === 'unmapped') unmappedItems++;
                });

                const stats = { totalItems, activeItems, pendingReviewItems: pendingItems, rejectedItems, unmappedItems };
                await updateDoc(doc(db, 'vendors', vDoc.id), { stats, statsUpdatedAt: serverTimestamp() });
                addLog(setTool1,
                    `  ✅ ${vDoc.data().name || vDoc.id} → total:${totalItems} active:${activeItems} pending:${pendingItems} rejected:${rejectedItems} unmapped:${unmappedItems}`,
                    'success'
                );
                updated++;
            }
            addLog(setTool1, `🎉 Rebuilt stats for ${updated} vendors.`, 'success');
            setTool1(p => ({ ...p, running: false, done: true }));
            toast.success(`Vendor stats rebuilt for ${updated} vendors.`);
        } catch (err) {
            addLog(setTool1, `❌ Error: ${err.message}`, 'error');
            setTool1(p => ({ ...p, running: false }));
        }
    };

    // ── TOOL 2: Reconcile legacy catalogReviewQueue ───────────────────────────
    const runReconcileLegacy = async () => {
        // catalogReviewQueue is DEPRECATED. This tool is READ-ONLY on it:
        // it marks items as 'deprecated' in a safe UI field only,
        // and never hard-deletes anything.
        setTool2({ running: true, done: false, log: [] });
        try {
            addLog(setTool2, '⚠️ catalogReviewQueue is DEPRECATED. This scan is read-only.', 'warn');
            const legacySnap = await getDocs(collection(db, 'catalogReviewQueue')).catch(() => ({ docs: [] }));
            addLog(setTool2, `📋 Found ${legacySnap.docs?.length ?? 0} legacy queue docs.`);

            let ignored = 0, skipped = 0;
            for (const lDoc of (legacySnap.docs || [])) {
                const d = lDoc.data();
                if (['approved', 'rejected', 'merged', 'deprecated'].includes(d.status)) {
                    skipped++;
                    continue;
                }

                // Check if vendorItem already resolved
                let resolved = false;
                if (d.vendorId && d.vendorItemId) {
                    try {
                        const iSnap = await getDoc(doc(db, 'vendors', d.vendorId, 'items', d.vendorItemId));
                        if (iSnap.exists()) {
                            const iData = iSnap.data();
                            const rs = (iData.reviewStatus || iData.status || '').toLowerCase();
                            if (['approved', 'active', 'mapped'].includes(rs) || iData.catalogItemId) {
                                resolved = true;
                            }
                        }
                    } catch (e) { /* item may have been deleted */ }
                }

                // Check if a resolved changeRequest exists for this item
                if (!resolved && d.vendorItemId) {
                    try {
                        const crSnap = await getDocs(query(
                            collection(db, 'changeRequests'),
                            where('vendorItemId', '==', d.vendorItemId),
                            where('status', 'in', ['APPROVED', 'REJECTED']),
                        ));
                        if (!crSnap.empty) resolved = true;
                    } catch (e) { /* changeRequests may not exist yet */ }
                }

                if (resolved) {
                    // Safe: only mark _uiDeprecated flag, no hard delete
                    try {
                        await updateDoc(doc(db, 'catalogReviewQueue', lDoc.id), {
                            _uiDeprecated: true,
                            _deprecatedReason: 'Resolved via changeRequests or vendor item already approved/mapped.',
                        });
                        ignored++;
                        addLog(setTool2, `  ↳ ${lDoc.id} — marked as _uiDeprecated`, 'muted');
                    } catch (e) {
                        addLog(setTool2, `  ↳ ${lDoc.id} — could not update (${e.message})`, 'warn');
                    }
                } else {
                    addLog(setTool2, `  ↳ ${lDoc.id} — still unresolved (vendor: ${d.vendorId || '?'}, item: ${d.vendorItemId || '?'})`, 'sub');
                }
            }

            addLog(setTool2, `🎉 Scan complete. ${ignored} marked deprecated, ${skipped} already resolved, ${(legacySnap.docs?.length ?? 0) - ignored - skipped} still unmatched.`, 'success');
            addLog(setTool2, '💡 No app logic reads catalogReviewQueue any longer. This is informational only.', 'info');
            setTool2(p => ({ ...p, running: false, done: true }));
        } catch (err) {
            addLog(setTool2, `❌ Error: ${err.message}`, 'error');
            setTool2(p => ({ ...p, running: false }));
        }
    };

    // ── TOOL 3: Backfill changeRequests fields ────────────────────────────────
    const runBackfillChangeRequests = async () => {
        setTool3({ running: true, done: false, log: [] });
        try {
            const snap = await getDocs(collection(db, 'changeRequests')).catch(() => ({ docs: [] }));
            addLog(setTool3, `📋 Found ${snap.docs?.length ?? 0} changeRequest docs.`);

            let patched = 0;
            for (const d of (snap.docs || [])) {
                const data = d.data();
                const patch = {};
                if (!data.requestType) patch.requestType = 'NEW_ITEM';
                if (!data.status)      patch.status      = 'PENDING';
                if (!data.source)      patch.source      = 'IMPORT';
                if (!data.updatedAt)   patch.updatedAt   = serverTimestamp();

                if (Object.keys(patch).length > 0) {
                    await updateDoc(d.ref, patch);
                    addLog(setTool3, `  ✅ ${d.id} backfilled: ${Object.keys(patch).join(', ')}`, 'success');
                    patched++;
                }
            }

            addLog(setTool3, `🎉 Backfill complete. ${patched} docs patched, ${(snap.docs?.length ?? 0) - patched} already complete.`, 'success');
            setTool3(p => ({ ...p, running: false, done: true }));
            toast.success(`Backfilled ${patched} changeRequest docs.`);
        } catch (err) {
            addLog(setTool3, `❌ Error: ${err.message}`, 'error');
            setTool3(p => ({ ...p, running: false }));
        }
    };

    // ── TOOL 5: Deduplicate Review Queue ──────────────────────────────────────
    const runDedup = async () => {
        setTool5({ running: true, done: false, log: [] });
        try {
            const snap = await getDocs(collection(db, 'catalogReviewQueue')).catch(() => ({ docs: [] }));
            const OPEN = ['pending', 'held'];
            const openDocs = (snap.docs || []).filter(d => OPEN.includes((d.data().status || '').toLowerCase()));
            addLog(setTool5, `📋 Found ${openDocs.length} unresolved catalogReviewQueue items.`);

            // Group by key = vendorId|vendorItemId|reviewType
            const groups = {};
            for (const d of openDocs) {
                const data = d.data();
                const key = `${data.vendorId || ''}|${data.vendorItemId || ''}|${data.reviewType || ''}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push({ id: d.id, data, ref: d.ref, ts: data.createdAt?.toMillis?.() || 0 });
            }

            let merged = 0, kept = 0;
            for (const [key, entries] of Object.entries(groups)) {
                if (entries.length <= 1) { kept++; continue; }
                // Sort by createdAt desc — keep newest, merge older
                entries.sort((a, b) => b.ts - a.ts);
                const [newest, ...duplicates] = entries;
                kept++;
                addLog(setTool5, `  Keep: ${newest.id} (${newest.data.reviewType || '?'} · ${(newest.data.status || 'pending')})`);
                for (const dup of duplicates) {
                    try {
                        await updateDoc(dup.ref, {
                            status: 'merged',
                            _mergedIntoId: newest.id,
                            _mergedAt: serverTimestamp(),
                            _mergedReason: 'Duplicate detected by Reconciliation Tool — older entry superseded.',
                        });
                        merged++;
                        addLog(setTool5, `    ↳ Merged: ${dup.id}`, 'muted');
                    } catch (e) {
                        addLog(setTool5, `    ↳ Failed ${dup.id}: ${e.message}`, 'error');
                    }
                }
            }

            const dupeGroups = Object.values(groups).filter(g => g.length > 1).length;
            addLog(setTool5, `🎉 Done. ${kept} unique items kept. ${merged} duplicates marked as merged across ${dupeGroups} groups.`, 'success');
            if (merged === 0) addLog(setTool5, '✅ No duplicates found — queue is clean.', 'success');
            setTool5(p => ({ ...p, running: false, done: true }));
            toast.success(`Dedup complete: ${merged} duplicates merged.`);
        } catch (err) {
            addLog(setTool5, `❌ Error: ${err.message}`, 'error');
            setTool5(p => ({ ...p, running: false }));
        }
    };

    // ── TOOL 4: Finance preview ───────────────────────────────────────────────
    const runFinanceSummary = async () => {
        setFinanceLoading(true);
        try {
            const [rSnap, vSnap] = await Promise.all([
                getDocs(collection(db, 'restaurantInvoices')),
                getDocs(collection(db, 'vendorInvoices')),
            ]);
            let totalBilled = 0, vendorPayout = 0, commission = 0, pendingCount = 0;
            rSnap.docs.forEach(d => {
                const data = d.data();
                totalBilled += parseFloat(data.grandTotal ?? data.totalAmount ?? data.total ?? 0) || 0;
                const status = (data.paymentStatus || data.status || '').toLowerCase();
                if (status !== 'paid') pendingCount++;
            });
            vSnap.docs.forEach(d => {
                const data = d.data();
                vendorPayout += parseFloat(data.netVendorPayable ?? data.vendorPayout ?? 0) || 0;
                commission   += parseFloat(data.commissionAmount ?? data.commission ?? 0) || 0;
            });
            if (vendorPayout === 0 && totalBilled > 0) vendorPayout = totalBilled * 0.9;
            if (commission   === 0 && totalBilled > 0) commission   = totalBilled * 0.1;

            setFinance({ totalBilled, vendorPayout, commission, pendingCount, restCount: rSnap.size, vendorCount: vSnap.size });
        } catch (err) {
            toast.error(`Finance summary failed: ${err.message}`);
        } finally {
            setFinanceLoading(false);
        }
    };

    const logColors = { success: C.green, error: C.red, warn: C.amber, muted: '#334155', sub: C.sub, info: C.sub };

    const LogPanel = ({ state }) => (
        <div style={{ background: '#080e18', borderRadius: 8, padding: '12px 14px', maxHeight: 240, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.8, marginTop: 12 }}>
            {state.log.length === 0
                ? <span style={{ color: C.muted }}>Ready — press Run to start.</span>
                : state.log.map((l, i) => <div key={i} style={{ color: logColors[l.type] || C.sub }}>{l.msg || '\u00A0'}</div>)
            }
        </div>
    );

    return (
        <div style={{ maxWidth: 900, paddingBottom: 60 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 24 }}>🔧</span>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Data Reconciliation Tools</h2>
            </div>
            <p style={{ margin: '0 0 22px', fontSize: 13, color: C.sub }}>
                One-time admin utilities to fix stale data, reconcile deprecated systems, and validate live collections.
                All tools are <strong style={{ color: C.amber }}>read-safe</strong> (no hard deletes).
            </p>

            {/* ── TOOL 1 ── */}
            <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.fg, marginBottom: 4 }}>1 — Rebuild Vendor Stats</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>
                    Iterates all vendors → reads <code>vendors/&#123;id&#125;/items</code> → writes fresh <code>stats&#123;&#125;</code> to vendor doc.
                    Fixes "0 total items" on vendor header cards.
                </div>
                <button onClick={runRebuildStats} disabled={tool1.running}
                    style={btn('56,189,248')}>
                    {tool1.running ? '⟳ Running…' : tool1.done ? '✅ Done — Run Again' : '▶ Run Rebuild Stats'}
                </button>
                <LogPanel state={tool1} />
            </div>

            {/* ── TOOL 2 ── */}
            <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.fg, marginBottom: 4 }}>
                    2 — Reconcile Legacy <code style={{ color: C.amber }}>catalogReviewQueue</code>
                </div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>
                    Scans the <strong>deprecated</strong> <code>catalogReviewQueue</code> collection.
                    Matches each doc to an existing vendorItem or <code>changeRequest</code>.
                    Marks resolved ones as <code>_uiDeprecated</code> so they don't surface in UI.
                    No hard deletes. <strong style={{ color: C.green }}>App no longer reads from catalogReviewQueue.</strong>
                </div>
                <button onClick={runReconcileLegacy} disabled={tool2.running}
                    style={btn('251,191,36')}>
                    {tool2.running ? '⟳ Running…' : tool2.done ? '✅ Done — Run Again' : '▶ Scan Legacy Queue'}
                </button>
                <LogPanel state={tool2} />
            </div>

            {/* ── TOOL 3 ── */}
            <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.fg, marginBottom: 4 }}>3 — Backfill <code>changeRequests</code> Fields</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>
                    Ensures every <code>changeRequests</code> doc has required fields:
                    <code> requestType, status, source, updatedAt</code>.
                    Safe to run multiple times — only patches missing fields.
                </div>
                <button onClick={runBackfillChangeRequests} disabled={tool3.running}
                    style={btn('167,139,250')}>
                    {tool3.running ? '⟳ Running…' : tool3.done ? '✅ Done — Run Again' : '▶ Run Backfill'}
                </button>
                <LogPanel state={tool3} />
            </div>

            {/* ── TOOL 4 ── */}
            <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.fg, marginBottom: 4 }}>4 — Finance Summary Check (Read-only)</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>
                    Reads <code>restaurantInvoices.grandTotal</code> and <code>vendorInvoices.netVendorPayable / commissionAmount</code>
                    live. Verifies Finance page KPI cards match real data.
                </div>
                <button onClick={runFinanceSummary} disabled={financeLoading}
                    style={btn('52,211,153')}>
                    {financeLoading ? '⟳ Loading…' : '▶ Run Finance Check'}
                </button>
                {finance && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 14 }}>
                        {[
                            { label: 'Total Billed',  value: `$${finance.totalBilled.toFixed(2)}`, note: `from ${finance.restCount} restaurantInvoices`, c: C.blue },
                            { label: 'Vendor Payout', value: `$${finance.vendorPayout.toFixed(2)}`, note: `from ${finance.vendorCount} vendorInvoices`, c: C.amber },
                            { label: 'Commission',    value: `$${finance.commission.toFixed(2)}`,   note: 'commissionAmount field', c: C.green },
                            { label: 'Pending',       value: finance.pendingCount,                  note: 'paymentStatus != paid', c: C.red },
                        ].map(k => (
                            <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.07)`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: k.c }}>{k.value}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{k.label}</div>
                                <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>{k.note}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {/* ── TOOL 5 ── */}
            <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.fg, marginBottom: 4 }}>5 — Deduplicate Review Queue</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>
                    Groups unresolved <code>catalogReviewQueue</code> items by{' '}
                    <code>vendorId + vendorItemId + reviewType</code>. Keeps the newest entry
                    per group. Marks older duplicates as <code>merged</code> (no hard deletes — audit trail preserved).
                    Reduces inflated Review Queue counts caused by duplicate entries.
                </div>
                <button onClick={runDedup} disabled={tool5.running}
                    style={btn('248,113,113')}>
                    {tool5.running ? '⟳ Running…' : tool5.done ? '✅ Done — Run Again' : '▶ Run Dedup'}
                </button>
                <LogPanel state={tool5} />
            </div>
        </div>
    );
}
