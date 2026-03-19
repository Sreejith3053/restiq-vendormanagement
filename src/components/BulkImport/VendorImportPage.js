/**
 * VendorImportPage.js
 * Route: /vendor/import
 *
 * Step 1+2 of the import flow:
 *  - Select import mode (Add New / Update Existing / Add + Update)
 *  - Upload Excel/CSV file via UploadDropzone
 *  - Shows validation summary
 *  - Navigates to preview page with parsed + matched rows
 */
import React, { useState, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { toast } from 'react-toastify';
import UploadDropzone from './UploadDropzone';
import { validateFile, validateAllRows } from './importValidation';
import { parseExcelFile, downloadTemplate, exportVendorCatalog } from './importHelpers';
import { normalizeRow, matchAgainstExistingItems, generateMatchSummary } from './importMatching';
import VendorImportHistoryPage from './VendorImportHistoryPage';

const MODES = [
    {
        value: 'add_and_update',
        label: 'Add + Update',
        icon: '🔄',
        desc: 'Create new items AND update existing ones. Best for large catalog changes.',
    },
    {
        value: 'add_new',
        label: 'Add New Items Only',
        icon: '✨',
        desc: 'Only creates new items. Existing items are left untouched.',
    },
    {
        value: 'update_existing',
        label: 'Update Existing Only',
        icon: '✏️',
        desc: 'Only updates existing catalog items. New rows are skipped.',
    },
];

export default function VendorImportPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { vendorId, vendorName, displayName, userId } = useContext(UserContext);

    const activeTab = searchParams.get('tab') || 'import';

    const [mode, setMode] = useState('add_and_update');
    const [file, setFile] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [fileError, setFileError] = useState('');
    const [parsedSummary, setParsedSummary] = useState(null);

    const handleFileSelected = (f) => {
        setFile(f);
        setFileError('');
        setParsedSummary(null);
    };

    const handleValidateAndPreview = async () => {
        if (!file) { setFileError('Please select a file first.'); return; }

        const fileCheck = validateFile(file);
        if (!fileCheck.valid) { setFileError(fileCheck.error); return; }

        setParsing(true);
        setFileError('');

        try {
            // 1. Parse the file
            const { rows: rawRows, error: parseError } = await parseExcelFile(file);
            if (parseError) { setFileError(parseError); setParsing(false); return; }
            if (!rawRows || rawRows.length === 0) { setFileError('No data rows found in the file.'); setParsing(false); return; }

            // 2. Validate rows
            const validatedRows = validateAllRows(rawRows);

            // 3. Normalize rows
            const normalizedRows = validatedRows.map(normalizeRow);

            // 4. Load existing vendor items from Firestore
            let existingItems = [];
            try {
                const snap = await getDocs(collection(db, 'vendors', vendorId, 'items'));
                existingItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (err) {
                toast.warn('Could not load your existing catalog for comparison. Proceeding without matching.');
            }

            // 5. Match against existing items
            const matchedRows = matchAgainstExistingItems(normalizedRows, existingItems, mode);
            const summary = generateMatchSummary(matchedRows);

            setParsedSummary(summary);

            // 6. Navigate to preview page with state
            navigate('/vendor/import/preview', {
                state: {
                    matchedRows,
                    summary,
                    mode,
                    fileName: file.name,
                    vendorId,
                    vendorName,
                    displayName,
                    userId,
                },
            });
        } catch (err) {
            console.error('[VendorImportPage]', err);
            setFileError('Unexpected error: ' + err.message);
        } finally {
            setParsing(false);
        }
    };

    const handleExportCatalog = async () => {
        if (!vendorId) return;
        try {
            const snap = await getDocs(collection(db, 'vendors', vendorId, 'items'));
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (items.length === 0) { toast.info('Your catalog is empty — nothing to export yet.'); return; }
            exportVendorCatalog(items, vendorName);
            toast.success('Catalog exported!');
        } catch (err) {
            toast.error('Export failed: ' + err.message);
        }
    };

    return (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <button className="ui-btn ghost small" onClick={() => navigate('/items')} style={{ padding: '4px 12px' }}>
                        ← Back to Catalog
                    </button>
                </div>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    📥 Bulk Upload
                </h1>
                <p style={{ color: '#94a3b8', marginTop: 6 }}>
                    Upload an Excel or CSV file to add or update your item catalog in bulk.
                    {vendorName && <span style={{ color: '#38bdf8', marginLeft: 6 }}>— {vendorName}</span>}
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {[{ key: 'import', label: '📥 New Import' }, { key: 'history', label: '🕐 Import History' }].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setSearchParams({ tab: tab.key })}
                        style={{
                            padding: '10px 20px',
                            background: 'none',
                            border: 'none',
                            borderBottom: activeTab === tab.key ? '2px solid #38bdf8' : '2px solid transparent',
                            color: activeTab === tab.key ? '#38bdf8' : '#94a3b8',
                            fontWeight: activeTab === tab.key ? 700 : 500,
                            fontSize: 14,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'history' ? (
                <VendorImportHistoryPage embedded />
            ) : (
            <>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
                <button className="ui-btn ghost small" onClick={() => downloadTemplate()}>
                    📋 Download Template
                </button>
                <button className="ui-btn ghost small" onClick={handleExportCatalog}>
                    📤 Export Current Catalog
                </button>
            </div>

            {/* Step 1: Import Mode */}
            <div className="ui-card" style={{ padding: 24, marginBottom: 20, background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="ui-card-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                    Step 1 — Choose Import Mode
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {MODES.map(m => (
                        <div
                            key={m.value}
                            onClick={() => setMode(m.value)}
                            style={{
                                padding: '16px 18px',
                                borderRadius: 10,
                                border: mode === m.value ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                                background: mode === m.value ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                            }}
                        >
                            <div style={{ fontSize: 22, marginBottom: 8 }}>{m.icon}</div>
                            <div style={{ fontWeight: 700, color: mode === m.value ? '#38bdf8' : '#f8fafc', fontSize: 14, marginBottom: 4 }}>
                                {m.label}
                            </div>
                            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{m.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Step 2: Upload File */}
            <div className="ui-card" style={{ padding: 24, marginBottom: 20, background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="ui-card-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                    Step 2 — Upload Your File
                </div>
                <UploadDropzone onFileSelected={handleFileSelected} disabled={parsing} />

                {fileError && (
                    <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)', color: '#f87171', fontSize: 13 }}>
                        ❌ {fileError}
                    </div>
                )}

                {/* Instructions */}
                <div style={{ marginTop: 20, padding: '14px 18px', borderRadius: 8, background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)' }}>
                    <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 13, marginBottom: 10 }}>📌 Column Guide</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 12 }}>
                        {[
                            ['itemName *', 'Required — exact item name'],
                            ['price *', 'Required — numeric (e.g. 12.99)'],
                            ['unit', 'e.g. kg, L, unit, case'],
                            ['packSize', 'e.g. 10kg, 500g'],
                            ['category', 'e.g. Produce, Meat, Packaging'],
                            ['brand', 'Optional brand name'],
                            ['vendorSKU', 'Your internal SKU — optional'],
                            ['status', 'Active or Inactive (default: Active)'],
                            ['minOrderQty', 'Optional — numeric'],
                            ['leadTimeDays', 'Optional — numeric'],
                            ['notes', 'Optional internal notes'],
                            ['vendorItemId', 'Leave blank for new items'],
                        ].map(([col, desc]) => (
                            <div key={col} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontFamily: 'monospace', color: '#38bdf8', minWidth: 120, flexShrink: 0 }}>{col}</span>
                                <span style={{ color: '#64748b' }}>{desc}</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: '#475569' }}>
                        * vendorSKU is optional. If missing, matching uses itemName + packSize + unit.
                        · Blank optional fields are fine.
                        · If re-uploading from Export, vendorItemId enables exact matching.
                    </div>
                </div>
            </div>

            {/* Continue Button */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button className="ui-btn ghost" onClick={() => navigate('/items')}>Cancel</button>
                <button
                    className="ui-btn primary"
                    onClick={handleValidateAndPreview}
                    disabled={!file || parsing}
                    style={{ minWidth: 200 }}
                >
                    {parsing ? '⏳ Parsing & Matching...' : 'Preview Changes →'}
                </button>
            </div>

            </>
            )}
        </div>
    );
}
