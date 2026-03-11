import React, { useState, useEffect, useMemo } from 'react';
import { FiCheckCircle, FiAlertCircle, FiRefreshCw, FiPlus, FiTrash2, FiSave, FiSend, FiLock, FiInfo, FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useCorrectionLearning from './useCorrectionLearning';
import { runCorrectionEngine } from './forecastCorrectionEngine';
import SavingsOpportunityBanner from './SavingsOpportunityBanner';
import BundleCompatibilityAlert from './BundleCompatibilityAlert';
import { findMissingBundlePairs } from '../Vendors/marketplaceIntelligence';

// Mock catalog for the 'Add Item' flow
const MOCK_CATALOG = [
    { name: 'Tomato', category: 'Produce', unit: 'box' },
    { name: 'Onion - Cooking', category: 'Produce', unit: '50lb bag' },
    { name: 'Onion - Red', category: 'Produce', unit: '25lb bag' },
    { name: 'French Beans', category: 'Produce', unit: '1.5lb bag' },
    { name: 'Carrot', category: 'Produce', unit: '50lb bag' },
    { name: 'Cabbage', category: 'Produce', unit: '50lb bag' },
    { name: 'Plantain Green', category: 'Produce', unit: '5lb pack' },
    { name: 'Green Onion', category: 'Produce', unit: 'bundle' },
    { name: 'Coriander Leaves', category: 'Produce', unit: 'bunch' },
    { name: 'Mint Leaves', category: 'Produce', unit: 'bunch' },
    { name: 'Lemon', category: 'Produce', unit: 'case' },
    { name: 'Lime', category: 'Produce', unit: '3.64kg pack' },
    { name: 'Peeled Garlic', category: 'Produce', unit: 'case' },
    { name: 'Ginger', category: 'Produce', unit: '30lb box' },
    { name: 'Thai Chilli', category: 'Produce', unit: '30lb box' },
    { name: 'Curry Leaves', category: 'Produce', unit: '12lb box' },
    { name: 'Okra', category: 'Produce', unit: 'packet' },
    { name: '16oz Clear Container', category: 'Packaging', unit: 'case' },
    { name: '24oz Clear Container', category: 'Packaging', unit: 'case' },
    { name: 'Napkins', category: 'Cleaning Supplies', unit: 'case' }
];

// Mock starting prediction
const MOCK_PREDICTION_LINES = [
    { id: 'i1', itemName: 'Onion - Cooking', category: 'Produce', packLabel: '50lb bag', predictedQty: 6, finalQty: 6, note: '' },
    { id: 'i2', itemName: 'Tomato', category: 'Produce', packLabel: 'box', predictedQty: 4, finalQty: 4, note: '' },
    { id: 'i3', itemName: 'French Beans', category: 'Produce', packLabel: '1.5lb bag', predictedQty: 2, finalQty: 2, note: '' },
    { id: 'i4', itemName: 'Coriander Leaves', category: 'Produce', packLabel: 'bunch', predictedQty: 10, finalQty: 10, note: '' },
    { id: 'i5', itemName: '16oz Clear Container', category: 'Packaging', packLabel: 'case', predictedQty: 1, finalQty: 1, note: '' },
    { id: 'i6', itemName: 'Peeled Garlic', category: 'Produce', packLabel: 'case', predictedQty: 1, finalQty: 1, note: '' }
];

// Derive change type automatically
const getChangeType = (predicted, final) => {
    if (predicted === 0 && final > 0) return 'Added';
    if (final === 0 && predicted > 0) return 'Removed';
    if (final > predicted) return 'Increased';
    if (final < predicted) return 'Reduced';
    return 'Unchanged';
};

export default function SuggestedOrderReview() {
    const [status, setStatus] = useState('Draft Suggestion');
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [searchItemStr, setSearchItemStr] = useState('');
    const [expandedSavings, setExpandedSavings] = useState({});

    // Core Correction Learning Hook - Mocking for 'oruma-takeout' on 'Monday'
    const { learningProfiles } = useCorrectionLearning('oruma-takeout', 'Monday');

    // Simulate data load
    useEffect(() => {
        setTimeout(() => {
            setLines(MOCK_PREDICTION_LINES.map(line => {
                // Apply learning engine adjustments
                const profile = learningProfiles[line.id];
                let adjustedPredictedQty = line.predictedQty;
                let learningHint = null;

                if (profile && (profile.confidence === 'High' || profile.confidence === 'Medium') && profile.recommendedCorrection !== 0) {
                    adjustedPredictedQty = Math.max(0, line.predictedQty + profile.recommendedCorrection);
                    learningHint = `Learned adjustment: ${profile.recommendedCorrection > 0 ? '+' : ''}${profile.recommendedCorrection} ${line.packLabel.split(' ')[0]}`;
                }

                // If confidence is low, don't adjust but we can pass status
                if (profile && profile.historyCount < 3) {
                    learningHint = 'Not enough history';
                }

                return {
                    ...line,
                    predictedQty: line.predictedQty,       // Raw base prediction
                    adjustedPredictedQty,                  // Learned correction applied
                    finalQty: adjustedPredictedQty,        // Final starts equal to the best guess adjusted prediction
                    deltaQty: adjustedPredictedQty - line.predictedQty,
                    deltaType: getChangeType(line.predictedQty, adjustedPredictedQty),
                    learningHint: learningHint,
                    learningProfile: profile
                };
            }));
            setLoading(false);
        }, 800);
    }, [learningProfiles]);

    // Time references — Correct sequence: Generated < Cutoff < Delivery Day
    //   Generated: Saturday 23:30 of the current week (AI run)
    //   Cutoff:    Sunday 10:00 (restaurant must submit by then)
    //   Delivery:  next Monday (or Thursday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun .. 6=Sat

    // Find next Monday from today
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
    const deliveryDate = new Date(now);
    deliveryDate.setDate(now.getDate() + daysUntilMonday);
    deliveryDate.setHours(6, 0, 0, 0);

    // Cutoff = Sunday before delivery at 10:00
    const cutoffDate = new Date(deliveryDate);
    cutoffDate.setDate(deliveryDate.getDate() - 1);
    cutoffDate.setHours(10, 0, 0, 0);

    // Generated = Saturday at 23:30 (day before cutoff)
    const generatedDate = new Date(cutoffDate);
    generatedDate.setDate(cutoffDate.getDate() - 1);
    generatedDate.setHours(23, 30, 0, 0);

    const isLocked = status === 'Locked' || status === 'Submitted';

    // Analytics computation
    const metrics = useMemo(() => {
        const predictedActiveCount = lines.filter(l => l.predictedQty > 0).length;
        const predictedPacks = lines.reduce((acc, l) => acc + l.predictedQty, 0);

        const finalActiveCount = lines.filter(l => l.finalQty > 0).length;
        const finalPacks = lines.reduce((acc, l) => acc + l.finalQty, 0);

        const changesCount = lines.filter(l => l.deltaType !== 'Unchanged').length;
        const netDeltaPacks = finalPacks - predictedPacks;

        return {
            predictedActiveCount,
            predictedPacks,
            finalActiveCount,
            finalPacks,
            changesCount,
            netDeltaPacks,
            confidence: 82 // Mocked confidence
        };
    }, [lines]);

    const changeSummary = useMemo(() => {
        const added = lines.filter(l => l.deltaType === 'Added');
        const increased = lines.filter(l => l.deltaType === 'Increased');
        const reduced = lines.filter(l => l.deltaType === 'Reduced');
        const removed = lines.filter(l => l.deltaType === 'Removed');
        return { added, increased, reduced, removed };
    }, [lines]);

    // ── Savings opportunities: mock cheaper-supplier data per item ──
    const savingsData = useMemo(() => {
        // In production this would come from a live Firestore scan.
        // For now, hardcode a few examples to demonstrate the feature.
        const cheaperMap = {
            'Onion - Cooking':  { cheaperPrice: 17.50, monthlyUsage: 24 },
            'Coriander Leaves': { cheaperPrice: 8.00,  monthlyUsage: 40 },
        };
        const result = {};
        lines.forEach(l => {
            const entry = cheaperMap[l.itemName];
            if (entry) {
                const currentPrice = l.itemName === 'Onion - Cooking' ? 19.50 : 9.50;
                if (entry.cheaperPrice < currentPrice) {
                    result[l.id] = { currentPrice, cheaperPrice: entry.cheaperPrice, monthlyUsage: entry.monthlyUsage };
                }
            }
        });
        return result;
    }, [lines]);

    // ── Bundle compatibility: detect missing paired items ──
    const missingBundlePairs = useMemo(() => {
        const orderItemNames = lines.filter(l => l.finalQty > 0).map(l => l.itemName);
        return findMissingBundlePairs(orderItemNames);
    }, [lines]);

    // Handlers
    const handleQtyChange = (id, newQty) => {
        if (isLocked) return;
        const val = parseInt(newQty) || 0;
        if (val < 0) return;

        setLines(prev => prev.map(line => {
            if (line.id === id) {
                const final = val;
                // Compare to raw base prediction to understand delta properly
                const type = getChangeType(line.predictedQty, final);
                const delta = final - line.predictedQty;
                return { ...line, finalQty: final, deltaType: type, deltaQty: delta };
            }
            return line;
        }));

        if (status === 'Draft Suggestion' || status === 'Saved Draft') {
            setStatus('In Review');
        }
    };

    const handleNoteChange = (id, noteStr) => {
        if (isLocked) return;
        setLines(prev => prev.map(line => line.id === id ? { ...line, note: noteStr } : line));
        if (status === 'Draft Suggestion' || status === 'Saved Draft') setStatus('In Review');
    };

    const handleRemoveLine = (id) => {
        if (isLocked) return;
        setLines(prev => prev.map(line => {
            if (line.id === id) {
                const type = getChangeType(line.predictedQty, 0);
                const delta = 0 - line.predictedQty;
                return { ...line, finalQty: 0, deltaType: type, deltaQty: delta };
            }
            return line;
        }));
        if (status === 'Draft Suggestion' || status === 'Saved Draft') setStatus('In Review');
    };

    const handleAddItem = (catalogItem) => {
        // Prevent duplicates
        const existing = lines.find(l => l.itemName === catalogItem.name);
        if (existing) {
            handleQtyChange(existing.id, existing.finalQty + 1);
        } else {
            const newLine = {
                id: `new_${Date.now()}`,
                itemName: catalogItem.name,
                category: catalogItem.category,
                packLabel: catalogItem.unit,
                predictedQty: 0,
                finalQty: 1, // Start newly added items at 1
                deltaQty: 1,
                deltaType: 'Added',
                note: ''
            };
            setLines(prev => [newLine, ...prev]);
        }

        if (status === 'Draft Suggestion' || status === 'Saved Draft') setStatus('In Review');
        setIsAddModalOpen(false);
        setSearchItemStr('');
    };

    const simulateFirestoreWrite = (newStatus) => {
        // Build document mimicking requested `suggestedOrders` schema
        const doc = {
            suggestionId: `sug_${Date.now()}`,
            restaurantId: 'rest_demo_123',
            restaurantName: 'Oruma Takeout',
            deliveryDay: 'Monday',
            weekStart: generatedDate.toISOString(),
            cutoffAt: cutoffDate.toISOString(),
            generatedAt: generatedDate.toISOString(),
            status: newStatus,
            predictedItemsCount: metrics.predictedActiveCount,
            predictedTotalPacks: metrics.predictedPacks,
            finalItemsCount: metrics.finalActiveCount,
            finalTotalPacks: metrics.finalPacks,
            changesCount: metrics.changesCount,
            predictionConfidence: metrics.confidence,
            submittedAt: newStatus === 'Submitted' ? new Date().toISOString() : null,
            lockedAt: isLocked ? new Date().toISOString() : null,
            lines: lines.map(l => ({
                itemId: l.id,
                itemName: l.itemName,
                category: l.category,
                packLabel: l.packLabel,
                predictedQty: l.predictedQty,
                finalQty: l.finalQty,
                deltaQty: l.deltaQty,
                deltaType: l.deltaType,
                note: l.note
            }))
        };
        console.log("Simulated Firebase Write to 'suggestedOrders':", doc);
    };

    const handleSaveDraft = () => {
        setStatus('Saved Draft');
        simulateFirestoreWrite('Saved Draft');
        toast.info('Draft changes safely recorded. Do not forget to submit before cutoff!');
    };

    const handleSubmitOrder = async () => {
        if (!window.confirm('Are you sure you want to submit this order? You will not be able to edit it after submission.')) return;
        setSubmitting(true);
        try {
            const weekStart = generatedDate.toISOString();
            const result = await runCorrectionEngine({
                suggestionId: `sug_rest_demo_123_${Date.now()}`,
                restaurantId: 'rest_demo_123',
                restaurantName: 'Oruma Takeout',
                deliveryDay: 'Monday',
                weekStart,
                lines,
                metrics,
                catalogPrices: {}, // Wire real catalog prices here when available
            });
            setStatus('Submitted');
            toast.success(
                `🎉 Order submitted! ${result.correctionCount} item corrections recorded. Learning engine updated.`,
                { autoClose: 5000 }
            );
        } catch (err) {
            console.error('Submission error:', err);
            toast.error('Submission failed. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    // Filter catalog for modal
    const filteredCatalog = MOCK_CATALOG.filter(c => c.name.toLowerCase().includes(searchItemStr.toLowerCase()));

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--muted)', fontSize: 16 }}>
                <FiRefreshCw className="spin" style={{ marginRight: 12 }} /> Connecting to Prediction Engine...
            </div>
        );
    }

    return (
        <div style={{ padding: '0 24px', maxWidth: 1500, margin: '0 auto', paddingBottom: 120 }}>
            <ToastContainer theme="dark" position="bottom-right" />

            {/* A. HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '32px 0 24px 0' }}>
                <div>
                    <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                        Marketplace Suggested Order
                        <span style={{
                            fontSize: 12, padding: '4px 10px', borderRadius: 20, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                            background: status === 'Submitted' || status === 'Locked' ? 'rgba(16, 185, 129, 0.1)' :
                                status === 'In Review' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: status === 'Submitted' || status === 'Locked' ? '#10b981' :
                                status === 'In Review' ? '#38bdf8' : '#f59e0b',
                            border: `1px solid ${status === 'Submitted' || status === 'Locked' ? 'rgba(16, 185, 129, 0.2)' : status === 'In Review' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`
                        }}>
                            {status}
                        </span>
                    </h1>
                    <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>Review your predicted weekly order and submit the final list before cutoff.</p>
                </div>

                <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: 'var(--bg-panel)', padding: '12px 20px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Delivery Day</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>Monday</div>
                    </div>
                    <div style={{ width: 1, height: 32, background: 'var(--border)' }}></div>
                    <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Submission Cutoff</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#f43f5e' }}>{cutoffDate.toLocaleString('default', { weekday: 'long' })} {cutoffDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                </div>
            </div>

            {/* C. PREDICTION INFO BANNER */}
            <div style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', padding: '16px 20px', borderRadius: 8, display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
                <FiInfo style={{ color: '#38bdf8', fontSize: 20, marginTop: 2, flexShrink: 0 }} />
                <div>
                    <h4 style={{ margin: '0 0 4px 0', color: '#e0f2fe', fontSize: 15 }}>Suggested order prepared from your past patterns.</h4>
                    <p style={{ margin: 0, color: '#bae6fd', fontSize: 13, opacity: 0.8 }}>Please review and adjust inline before submitting. Only your final submitted order will be processed. This recommendation improves over time as the system learns from your submitted corrections.</p>
                    <div style={{ fontSize: 11, color: 'rgba(56, 189, 248, 0.6)', marginTop: 8 }}>Generated: {generatedDate.toLocaleString()}</div>
                </div>
            </div>

            {/* B. ORDER SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: 32 }}>
                <div className="ui-card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Predicted Items</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#94a3b8', marginTop: 4 }}>{metrics.predictedActiveCount}</div>
                </div>
                <div className="ui-card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Predicted Packs</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#94a3b8', marginTop: 4 }}>{metrics.predictedPacks}</div>
                </div>

                <div className="ui-card" style={{ padding: '16px 20px', borderTop: '3px solid #3b82f6', background: 'rgba(59, 130, 246, 0.02)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Final Items</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#f8fafc', marginTop: 4 }}>{metrics.finalActiveCount}</div>
                </div>
                <div className="ui-card" style={{ padding: '16px 20px', borderTop: '3px solid #60a5fa', background: 'rgba(59, 130, 246, 0.02)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Final Packs</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#f8fafc', marginTop: 4 }}>{metrics.finalPacks}</div>
                </div>

                <div className="ui-card" style={{ padding: '16px 20px', borderTop: '3px solid #f59e0b' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Changes Made</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: metrics.changesCount > 0 ? '#f59e0b' : '#94a3b8', marginTop: 4 }}>{metrics.changesCount}</div>
                </div>
                <div className="ui-card" style={{ padding: '16px 20px', borderTop: '3px solid #10b981' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Confidence</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{metrics.confidence}%</div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 24 }}>

                {/* D. EDITABLE SUGGESTED ORDER TABLE */}
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Review List</h3>
                        {!isLocked && (
                            <button onClick={() => setIsAddModalOpen(true)} className="ui-btn" style={{ padding: '6px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}>
                                <FiPlus /> Add Item Not Seen
                            </button>
                        )}
                    </div>

                    {/* BUNDLE COMPATIBILITY ALERTS */}
                    {missingBundlePairs.length > 0 && (
                        <BundleCompatibilityAlert
                            missingPairs={missingBundlePairs}
                            onAddItem={(matchName) => {
                                const catalogItem = MOCK_CATALOG.find(c => c.name === matchName);
                                if (catalogItem) handleAddItem(catalogItem);
                                else toast.info(`${matchName} not found in catalog`);
                            }}
                        />
                    )}

                    <div className="ui-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="ui-table" style={{ margin: 0, width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>Category</th>
                                    <th>Pack Type</th>
                                    <th style={{ textAlign: 'center' }}>Suggested</th>
                                    <th style={{ textAlign: 'center', background: 'rgba(59, 130, 246, 0.05)' }}>Final Qty</th>
                                    <th>Change Type</th>
                                    <th>Notes (Optional)</th>
                                    <th style={{ width: 60, textAlign: 'center' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line) => {
                                    const isRemoved = line.deltaType === 'Removed';

                                    // Badge color resolution map
                                    const badgeStyles = {
                                        Added: { bg: 'rgba(52, 211, 153, 0.15)', color: '#34d399' },
                                        Increased: { bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' },
                                        Reduced: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
                                        Removed: { bg: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e' },
                                        Unchanged: { bg: 'transparent', color: 'var(--muted)' }
                                    };
                                    const badge = badgeStyles[line.deltaType];

                                    return (
                                        <React.Fragment key={line.id}>
                                        <tr style={{ opacity: isRemoved ? 0.4 : 1, transition: 'opacity 0.2s', background: line.deltaType !== 'Unchanged' && !isRemoved ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                            <td>
                                                <div style={{ fontWeight: 600, color: isRemoved ? 'var(--muted)' : '#f8fafc' }}>
                                                    {line.itemName}
                                                    {savingsData[line.id] && !isRemoved && (
                                                        <button
                                                            onClick={() => setExpandedSavings(prev => ({ ...prev, [line.id]: !prev[line.id] }))}
                                                            style={{
                                                                marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px',
                                                                borderRadius: 4, border: '1px solid rgba(245,158,11,0.3)',
                                                                background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
                                                                cursor: 'pointer', verticalAlign: 'middle',
                                                            }}
                                                        >
                                                            💰 Savings
                                                        </button>
                                                    )}
                                                </div>
                                                {line.learningHint && (
                                                    <div style={{
                                                        fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4,
                                                        color: line.learningHint === 'Not enough history' ? 'var(--muted)' :
                                                            line.learningProfile?.recommendedCorrection > 0 ? '#38bdf8' :
                                                                line.learningProfile?.recommendedCorrection < 0 ? '#f59e0b' : '#10b981'
                                                    }}>
                                                        {line.learningProfile?.recommendedCorrection > 0 ? <FiTrendingUp /> : line.learningProfile?.recommendedCorrection < 0 ? <FiTrendingDown /> : <FiAlertCircle />}
                                                        {line.learningHint}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ color: 'var(--muted)', fontSize: 13 }}>{line.category}</td>
                                            <td style={{ color: 'var(--muted)', fontSize: 13 }}>{line.packLabel}</td>
                                            <td style={{ textAlign: 'center', fontWeight: 600, color: 'var(--muted)' }}>
                                                {line.deltaType === 'Added' ? '-' : (
                                                    <div>
                                                        {line.adjustedPredictedQty !== line.predictedQty && (
                                                            <span style={{ textDecoration: 'line-through', fontSize: 11, marginRight: 6, opacity: 0.5 }}>{line.predictedQty}</span>
                                                        )}
                                                        <span style={{ color: line.adjustedPredictedQty !== line.predictedQty ? '#e2e8f0' : 'inherit' }}>
                                                            {line.adjustedPredictedQty}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center', background: 'rgba(59, 130, 246, 0.02)' }}>
                                                <input
                                                    type="number"
                                                    value={line.finalQty}
                                                    onChange={(e) => handleQtyChange(line.id, e.target.value)}
                                                    disabled={isLocked}
                                                    min="0"
                                                    style={{
                                                        width: 60, textAlign: 'center', padding: '6px', borderRadius: 6,
                                                        background: 'rgba(0,0,0,0.3)', border: `1px solid ${line.deltaType !== 'Unchanged' ? badge.color : 'var(--border)'}`,
                                                        color: '#f8fafc', fontWeight: 700, outline: 'none'
                                                    }}
                                                />
                                            </td>
                                            <td>
                                                {line.deltaType !== 'Unchanged' ? (
                                                    <span style={{ background: badge.bg, color: badge.color, padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                        {line.deltaType} {line.deltaType !== 'Removed' ? `(${line.deltaQty > 0 ? '+' : ''}${line.deltaQty})` : ''}
                                                    </span>
                                                ) : (
                                                    <span style={{ background: 'rgba(148,163,184,0.08)', color: '#64748b', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>Unchanged</span>
                                                )}
                                            </td>
                                            <td>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Extra prep needed"
                                                    value={line.note}
                                                    onChange={(e) => handleNoteChange(line.id, e.target.value)}
                                                    disabled={isLocked}
                                                    style={{
                                                        width: '100%', background: 'transparent', border: 'none',
                                                        borderBottom: '1px solid transparent', color: 'var(--muted)', fontSize: 13, padding: '4px 0', outline: 'none',
                                                        transition: 'border-color 0.2s'
                                                    }}
                                                    onFocus={(e) => e.target.style.borderBottom = '1px solid var(--muted)'}
                                                    onBlur={(e) => e.target.style.borderBottom = '1px solid transparent'}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {!isLocked && !isRemoved && (
                                                    <button onClick={() => handleRemoveLine(line.id)} title="Remove Item" style={{ background: 'transparent', border: 'none', color: '#f43f5e', cursor: 'pointer', padding: 6, opacity: 0.7 }} onMouseOver={e => e.currentTarget.style.opacity = 1} onMouseOut={e => e.currentTarget.style.opacity = 0.7}>
                                                        <FiTrash2 />
                                                    </button>
                                                )}
                                                {isRemoved && !isLocked && (
                                                    <button onClick={() => handleQtyChange(line.id, line.predictedQty)} style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                                                        Undo
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {/* Expanded Savings Banner */}
                                        {expandedSavings[line.id] && savingsData[line.id] && (
                                            <tr>
                                                <td colSpan={8} style={{ padding: '0 16px 8px 16px', background: 'rgba(245,158,11,0.02)' }}>
                                                    <SavingsOpportunityBanner
                                                        itemName={line.itemName}
                                                        currentPrice={savingsData[line.id].currentPrice}
                                                        cheaperPrice={savingsData[line.id].cheaperPrice}
                                                        monthlyUsage={savingsData[line.id].monthlyUsage}
                                                        onCompare={() => toast.info(`Comparing options for ${line.itemName}…`)}
                                                        onSwitch={() => toast.success(`${line.itemName} will use the cheaper supplier on your next order`)}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                                {lines.length === 0 && (
                                    <tr>
                                        <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No items found in prediction list. Please add items manually.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* E. CHANGE SUMMARY PANEL */}
                <div style={{ width: 340, flexShrink: 0 }}>
                    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, position: 'sticky', top: 24 }}>
                        <h3 style={{ margin: '0 0 20px 0', fontSize: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                            Modification Summary
                            <span style={{ fontSize: 13, color: metrics.netDeltaPacks > 0 ? '#38bdf8' : metrics.netDeltaPacks < 0 ? '#f59e0b' : 'var(--muted)' }}>
                                {metrics.netDeltaPacks > 0 ? '+' : ''}{metrics.netDeltaPacks} net packs
                            </span>
                        </h3>

                        {metrics.changesCount === 0 ? (
                            <div style={{ color: 'var(--muted)', fontSize: 14, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                                No adjustments made yet.<br />The final order matches prediction.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                {/* Added Section */}
                                {changeSummary.added.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', marginBottom: 6 }}>Added ({changeSummary.added.length})</div>
                                        {changeSummary.added.map(l => (
                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                                <span>{l.itemName}</span>
                                                <span style={{ fontWeight: 600 }}>+{l.finalQty}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Increased Section */}
                                {changeSummary.increased.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', marginBottom: 6 }}>Increased ({changeSummary.increased.length})</div>
                                        {changeSummary.increased.map(l => (
                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                                <span>{l.itemName}</span>
                                                <span style={{ fontWeight: 600 }}>+{l.deltaQty}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Reduced Section */}
                                {changeSummary.reduced.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 6 }}>Reduced ({changeSummary.reduced.length})</div>
                                        {changeSummary.reduced.map(l => (
                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                                <span>{l.itemName}</span>
                                                <span style={{ fontWeight: 600 }}>{l.deltaQty}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Removed Section */}
                                {changeSummary.removed.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f43f5e', textTransform: 'uppercase', marginBottom: 6 }}>Removed ({changeSummary.removed.length})</div>
                                        {changeSummary.removed.map(l => (
                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                                <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{l.itemName}</span>
                                                <span style={{ fontWeight: 600, color: 'var(--muted)' }}>-{l.predictedQty}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ANALYTICS LEARNING INSIGHTS */}
                        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 12px 0' }}>Learning Insights</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                    <span style={{ color: 'var(--muted)' }}>Last week accuracy</span>
                                    <span style={{ fontWeight: 600, color: '#10b981' }}>87%</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
                                    <span style={{ color: 'var(--muted)' }}>Most edited item</span>
                                    <span style={{ fontWeight: 600, color: '#f8fafc' }}>Onion - Cooking</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
                                    <span style={{ color: 'var(--muted)' }}>Consistently reduced</span>
                                    <span style={{ fontWeight: 600, color: '#f59e0b' }}>French Beans</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                                    <span style={{ color: 'rgba(56, 189, 248, 0.8)' }}>Active learned items</span>
                                    <span style={{ fontWeight: 600, color: '#38bdf8' }}>{Object.values(learningProfiles).filter(p => p.confidence === 'High' || p.confidence === 'Medium').length}</span>
                                </div>
                            </div>
                        </div>

                        {/* F. SUBMIT SECTION BUTTONS */}
                        <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                            {isLocked ? (
                                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 8, color: '#10b981', textAlign: 'center', fontSize: 14 }}>
                                    <FiCheckCircle style={{ fontSize: 24, marginBottom: 8 }} />
                                    <div style={{ fontWeight: 600 }}>Order Submitted successfully.</div>
                                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Your required supplies logic is locked for routing and dispatch planning.</div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <button
                                        onClick={handleSubmitOrder}
                                        disabled={submitting}
                                        className="ui-btn primary"
                                        style={{ width: '100%', padding: '12px 0', fontSize: 15, fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, opacity: submitting ? 0.7 : 1 }}>
                                        {submitting ? <FiRefreshCw className="spin" /> : <FiSend />}
                                        {submitting ? 'Submitting & Learning...' : 'Submit Final Order'}
                                    </button>
                                    <button onClick={handleSaveDraft} className="ui-btn ghost" style={{ width: '100%', padding: '10px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                                        <FiSave /> Save as Draft
                                    </button>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                        <FiLock /> After Cutoff on Sunday, order will lock.
                                    </div>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>

            {/* ADD ITEM MODAL */}
            {
                isAddModalOpen && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
                        <div className="ui-card" style={{ width: '100%', maxWidth: 500, background: '#0f172a', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: 18 }}>Add Missing Item</h3>
                                <button onClick={() => setIsAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 24 }}>&times;</button>
                            </div>
                            <div style={{ padding: 24 }}>
                                <input
                                    type="text"
                                    placeholder="Search marketplace catalog..."
                                    value={searchItemStr}
                                    onChange={e => setSearchItemStr(e.target.value)}
                                    className="ui-input"
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: '#f8fafc', padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16 }}
                                    autoFocus
                                />
                                <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                                    {filteredCatalog.length === 0 ? (
                                        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No items found matching "{searchItemStr}"</div>
                                    ) : (
                                        filteredCatalog.map((item, idx) => (
                                            <div key={idx} onClick={() => handleAddItem(item)} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                                                <div>
                                                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{item.name}</div>
                                                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.category} • {item.unit}</div>
                                                </div>
                                                <FiPlus style={{ color: '#38bdf8' }} />
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
