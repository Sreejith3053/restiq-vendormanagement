/**
 * VendorImportPreviewPage.js
 * Route: /vendor/import/preview
 *
 * Step 3+4: shows preview table with before/after diff, summary cards,
 * lets vendor exclude rows, then confirms import.
 */
import React, { useState, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import ImportSummaryCards from './ImportSummaryCards';
import ImportPreviewTable from './ImportPreviewTable';
import { generateErrorReport } from './importHelpers';
import { generateMatchSummary } from './importMatching';
import {
    createImportBatch,
    finalizeBatch,
    writeBatchRowResults,
    processImportBatch,
} from './importFirestore';

export default function VendorImportPreviewPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const ctx = useContext(UserContext);

    const state = location.state || {};
    const initialRows = state.matchedRows || [];
    const mode = state.mode || 'add_and_update';
    const fileName = state.fileName || '';

    // vendorId and userId come from navigation state, with UserContext as fallback
    // This covers the case where UserContext wasn't fully loaded when navigate() was called
    const vendorId   = state.vendorId   || ctx.vendorId   || '';
    const userId     = state.userId     || ctx.userId     || '';
    const displayName = state.displayName || ctx.displayName || '';

    // All hooks must appear before any early returns
    // High Risk and Possible Duplicate rows start excluded for safety — user must opt in
    const safeInitialRows = initialRows.map(r => {
        if (r.actionResult === 'high_risk_review' || r.actionResult === 'new_possible_duplicate') {
            return { ...r, _excluded: true };
        }
        return r;
    });
    const [rows, setRows] = useState(safeInitialRows);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState(false);
    const [importResult, setImportResult] = useState(null);

    // Early return after hooks
    if (!state.matchedRows) {
        return (
            <div style={{ padding: 32, textAlign: 'center' }}>
                <h2 style={{ color: '#f87171' }}>No import data found.</h2>
                <button className="ui-btn primary" onClick={() => navigate('/vendor/import')}>← Back to Import</button>
            </div>
        );
    }

    const summary = generateMatchSummary(rows);
    const errorRows = rows.filter(r => r.actionResult === 'error');
    // Rows that will be written directly to catalog
    const actionableCount = rows.filter(r =>
        !r._excluded &&
        (r.actionResult === 'new_item' ||
         r.actionResult === 'new_possible_duplicate' ||
         r.actionResult === 'update_high' ||
         r.actionResult === 'update_medium' ||
         r.actionResult === 'high_risk_review' ||
         r._userAction === 'update_high' ||
         r._userAction === 'new_item')
    ).length;

    // needs_review rows go to the admin review queue (not written directly)
    const queueBoundCount = rows.filter(r => !r._excluded && r.actionResult === 'needs_review').length;

    // Total rows that will trigger a Firestore write (either catalog or queue)
    const totalProcessable = actionableCount + queueBoundCount;

    const handleToggleRow = (rowNumber) => {
        setRows(prev => prev.map(r =>
            r._rowNumber === rowNumber ? { ...r, _excluded: !r._excluded } : r
        ));
    };

    const handleSelectAll = (included) => {
        setRows(prev => prev.map(r => {
            if (['error', 'unchanged', 'skip'].includes(r.actionResult)) return r;
            return { ...r, _excluded: !included };
        }));
    };

    // Handle action dropdown choices from ImportPreviewTable
    const handleRowAction = (rowNumber, actionType, payload) => {
        setRows(prev => prev.map(r => {
            if (r._rowNumber !== rowNumber) return r;
            if (actionType === 'match_to') {
                // User selected a specific Firestore item to match to
                const candidate = (r.ambiguousCandidates || []).find(c => c.id === payload);
                return {
                    ...r,
                    _excluded: false,
                    actionResult: 'update_high',
                    matchedItemId: payload,
                    matchedItem: candidate || r.matchedItem,
                    confidence: 'high',
                    reason: 'Manually matched by vendor',
                    _userAction: 'update_high',
                };
            }
            if (actionType === 'create_new') {
                return { ...r, _excluded: false, actionResult: 'new_item', _userAction: 'new_item' };
            }
            if (actionType === 'skip') {
                return { ...r, _excluded: true };
            }
            if (actionType === 'set_action') {
                if (payload === 'skip') return { ...r, _excluded: true };
                if (payload === 'new_item') return { ...r, _excluded: false, actionResult: 'new_item', _userAction: 'new_item' };
                if (payload === 'update_high') return { ...r, _excluded: false, actionResult: 'update_medium', _userAction: 'update_high' };
            }
            return r;
        }));
    };

    const handleConfirmImport = async () => {
        console.log('[ConfirmImport] clicked', {
            vendorId,
            userId,
            totalRows: rows.length,
            actionableCount,
            queueBoundCount,
            totalProcessable,
            mode,
            fileName,
        });
        if (!vendorId) {
            toast.error('Import failed: vendorId is missing. Please go back and start the import again.');
            console.error('[ConfirmImport] vendorId is missing from navigation state!');
            return;
        }
        if (totalProcessable === 0) {
            toast.warn('Nothing to import — all rows are unchanged or skipped.');
            return;
        }

        setConfirming(true);
        try {
            // 1. Create batch record
            const batchId = await createImportBatch(vendorId, {
                fileName,
                importMode: mode,
                uploadedBy: userId || '',
                uploadedByName: displayName || '',
                totalRows: rows.length,
            });

            // 2. Process rows (create/update in Firestore)
            const { processedRows, counts } = await processImportBatch(
                vendorId,
                rows,
                batchId,
                userId,
                displayName
            );

            // 3. Finalize batch with counts
            await finalizeBatch(vendorId, batchId, {
                createdCount: counts.createdCount,
                updatedHighCount: counts.updatedHighCount,
                updatedMediumCount: counts.updatedMediumCount,
                unchangedCount: counts.unchangedCount,
                warningCount: counts.warningCount,
                errorCount: counts.errorCount,
                reviewCount: counts.reviewCount,
                skippedCount: counts.skippedCount,
            });

            // 4. Write per-row results
            await writeBatchRowResults(vendorId, batchId, processedRows);

            setImportResult({ batchId, counts });
            setDone(true);
            toast.success('Import complete! ' + counts.createdCount + ' created, ' + counts.updatedCount + ' updated.');
        } catch (err) {
            console.error('[ImportPreview] confirm error:', err);
            toast.error('Import failed: ' + err.message);
        } finally {
            setConfirming(false);
        }
    };

    // ── Done / Success screen ──────────────────────────────────────────────────
    if (done && importResult) {
        const c = importResult.counts;
        return (
            <div style={{ maxWidth: 700, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: '#4ade80', marginBottom: 8 }}>Import Complete!</h1>
                <p style={{ color: '#94a3b8', marginBottom: 28 }}>Your catalog has been updated.</p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
                    {[
                        { label: 'Created',      value: c.createdCount,       color: '#4ade80' },
                        { label: 'Auto Updated', value: c.updatedHighCount,   color: '#38bdf8' },
                        { label: 'Reviewed Upd.',value: c.updatedMediumCount, color: '#fbbf24' },
                        { label: 'Errors',       value: c.errorCount,         color: '#f87171' },
                    ].map(item => (
                        <div key={item.label} style={{ padding: 16, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: 28, fontWeight: 800, color: item.color }}>{item.value}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{item.label}</div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="ui-btn primary" onClick={() => navigate('/items')}>View Catalog</button>
                    <button className="ui-btn ghost" onClick={() => navigate('/vendor/import/history')}>View Import History</button>
                    {c.errorCount > 0 && (
                        <button className="ui-btn ghost" onClick={() => generateErrorReport(rows.filter(r => r.actionResult === 'error'))}>
                            📥 Download Error Report
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ── Preview screen ─────────────────────────────────────────────────────────
    const modeLabel = mode === 'add_new' ? 'Add New Items Only' : mode === 'update_existing' ? 'Update Existing Only' : 'Add + Update';

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <button className="ui-btn ghost small" onClick={() => navigate('/vendor/import')} style={{ marginBottom: 8, display: 'block', padding: '4px 12px' }}>
                        ← Back to Upload
                    </button>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                        🔍 Preview Import
                    </h1>
                    <div style={{ marginTop: 6, display: 'flex', gap: 16, fontSize: 13, color: '#94a3b8', flexWrap: 'wrap' }}>
                        <span>📁 {fileName}</span>
                        <span>🔄 Mode: <strong style={{ color: '#38bdf8' }}>{modeLabel}</strong></span>
                        <span>📋 {rows.length} rows loaded</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {errorRows.length > 0 && (
                        <button className="ui-btn ghost small" onClick={() => generateErrorReport(errorRows)}>
                            📥 Download Error Report
                        </button>
                    )}
                    <button className="ui-btn ghost small" onClick={() => handleSelectAll(true)}>Select All</button>
                    <button className="ui-btn ghost small" onClick={() => handleSelectAll(false)}>Deselect All</button>
                </div>
            </div>

            {/* Summary Cards */}
            <ImportSummaryCards summary={summary} />

            {/* Info banners */}
            {summary.review > 0 && (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', fontSize: 13, color: '#a78bfa' }}>
                    🔍 <strong>{summary.review} rows</strong> need review — these have ambiguous matches and will be sent to the <strong>Admin Review Queue</strong> for manual resolution.
                </div>
            )}
            {summary.errors > 0 && (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', fontSize: 13, color: '#f87171' }}>
                    ❌ <strong>{summary.errors} rows</strong> have errors and will be skipped. Download the error report to fix and re-upload.
                </div>
            )}

            {/* Preview Table */}
            <div className="ui-card" style={{ padding: 20, marginBottom: 20, background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: '#f8fafc' }}>
                    Row-by-Row Preview
                    <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12, fontWeight: 400 }}>
                        Use checkboxes to include/exclude rows before confirming
                    </span>
                </div>
                <ImportPreviewTable rows={rows} onToggleRow={handleToggleRow} onRowAction={handleRowAction} />
            </div>

            {/* Confirm bar */}
            <div style={{ padding: '16px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* Row breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
                    {[
                        { label: 'Auto Updates',    value: rows.filter(r => !r._excluded && r.actionResult === 'update_high').length,                                                        color: '#38bdf8', emoji: '✅' },
                        { label: 'New Items',        value: rows.filter(r => !r._excluded && (r.actionResult === 'new_item' || r.actionResult === 'new_possible_duplicate')).length,         color: '#4ade80', emoji: '✨' },
                        { label: 'Review (incl.)',   value: rows.filter(r => !r._excluded && r.actionResult === 'update_medium').length,                                                     color: '#fbbf24', emoji: '⚡' },
                        { label: 'High Risk (incl.)',value: rows.filter(r => !r._excluded && r.actionResult === 'high_risk_review').length,                                                  color: '#f97316', emoji: '🚨' },
                        { label: 'Skipped',          value: rows.filter(r => r._excluded || r.actionResult === 'skip' || r.actionResult === 'unchanged').length,                             color: '#475569', emoji: '⏭️' },
                    ].map(item => (
                        <div key={item.label} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: 16 }}>{item.emoji}</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1.1 }}>{item.value}</div>
                            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2, fontWeight: 700 }}>{item.label}</div>
                        </div>
                    ))}
                </div>

                {/* High risk warning banner */}
                {rows.filter(r => !r._excluded && r.actionResult === 'high_risk_review').length > 0 && (
                    <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 7, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', fontSize: 12, color: '#f97316' }}>
                        🚨 <strong>{rows.filter(r => !r._excluded && r.actionResult === 'high_risk_review').length} high-risk rows included</strong> — significant price or unit changes detected. Uncheck to skip, or review carefully before confirming.
                    </div>
                )}

                {/* Action row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ fontSize: 13, color: '#64748b' }}>
                        <strong style={{ color: '#4ade80' }}>{actionableCount}</strong> rows to catalog
                        {queueBoundCount > 0 && (
                            <span style={{ marginLeft: 8 }}>
                                · <strong style={{ color: '#a78bfa' }}>{queueBoundCount}</strong> to review queue
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button className="ui-btn ghost" onClick={() => navigate('/vendor/import')}>Cancel</button>
                        <button
                            className="ui-btn primary"
                            onClick={handleConfirmImport}
                            disabled={confirming || totalProcessable === 0}
                            style={{ minWidth: 180 }}
                        >
                            {confirming ? '⏳ Importing...' : 'Confirm Import ✓'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
