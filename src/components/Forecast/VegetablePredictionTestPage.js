import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, deleteDoc, writeBatch, doc, query, where } from 'firebase/firestore';
import { toast } from 'react-toastify';
import testData from './vegetableTestData.json';

export default function VegetablePredictionTestPage() {
    const [loading, setLoading] = useState(false);
    const [seededData, setSeededData] = useState([]);
    const [predictions, setPredictions] = useState([]);

    const COLLECTION_NAME = 'vegetablePurchaseHistory';

    useEffect(() => {
        fetchSeededData();
    }, []);

    const fetchSeededData = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, COLLECTION_NAME));
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort by date descending
            data.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
            setSeededData(data);
        } catch (err) {
            console.error('Fetch error:', err);
            toast.error('Failed to load seeded data');
        } finally {
            setLoading(false);
        }
    };

    const handleSeedTestData = async () => {
        if (!window.confirm(`Seed ${testData.length} records into Firestore?`)) return;
        setLoading(true);
        try {
            const colRef = collection(db, COLLECTION_NAME);
            const batchActions = [];

            let currentBatch = writeBatch(db);
            let operationCount = 0;

            for (const item of testData) {
                const docRef = doc(colRef);
                currentBatch.set(docRef, { ...item, category: "vegetable", createdAt: new Date().toISOString() });
                operationCount++;

                if (operationCount === 400) {
                    batchActions.push(currentBatch.commit());
                    currentBatch = writeBatch(db);
                    operationCount = 0;
                }
            }
            if (operationCount > 0) {
                batchActions.push(currentBatch.commit());
            }

            await Promise.all(batchActions);
            toast.success(`Successfully seeded ${testData.length} records!`);
            fetchSeededData();
        } catch (err) {
            console.error('Seeding error:', err);
            toast.error('Failed to seed data');
        } finally {
            setLoading(false);
        }
    };

    const handleClearTestData = async () => {
        if (!window.confirm('Clear ALL seeded test data? This cannot be undone.')) return;
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, COLLECTION_NAME));
            const batchActions = [];
            let currentBatch = writeBatch(db);
            let count = 0;

            snap.docs.forEach((d) => {
                currentBatch.delete(d.ref);
                count++;
                if (count === 400) {
                    batchActions.push(currentBatch.commit());
                    currentBatch = writeBatch(db);
                    count = 0;
                }
            });

            if (count > 0) batchActions.push(currentBatch.commit());

            await Promise.all(batchActions);
            toast.success('Test data cleared');
            setSeededData([]);
            setPredictions([]);
        } catch (err) {
            console.error('Clear error:', err);
            toast.error('Failed to clear data');
        } finally {
            setLoading(false);
        }
    };

    const handleRunPrediction = async () => {
        if (seededData.length === 0) {
            toast.warn('No data to predict from. Please seed data first.');
            return;
        }

        setLoading(true);
        try {
            // Group seeded predictions by itemName
            const historyMap = {};
            seededData.forEach(row => {
                if (!historyMap[row.itemName]) {
                    historyMap[row.itemName] = [];
                }
                historyMap[row.itemName].push(row);
            });

            // 1. Load all active OVERALL items from ON Thyme
            const catalogMap = {};

            // Because seed data items can be custom names historically, 
            // merge what is in seed *first* so we don't lose test items.
            Object.keys(historyMap).forEach(itemName => {
                catalogMap[itemName] = { itemName, history: historyMap[itemName] };
            });

            // Fetch live catalog
            try {
                const vendorSnap = await getDocs(collection(db, 'vendors'));
                const targetVendorIds = [];
                vendorSnap.docs.forEach(doc => {
                    const data = doc.data();
                    const vName = data.name || data.businessName || '';
                    if (vName.toLowerCase().includes('thyme')) {
                        targetVendorIds.push(doc.id);
                    }
                });

                if (targetVendorIds.length > 0) {
                    for (const vid of targetVendorIds) {
                        const q = query(collection(db, `vendors/${vid}/items`));
                        const catalogSnap = await getDocs(q);
                        catalogSnap.docs.forEach(doc => {
                            const data = doc.data();

                            // Highly permissive active check:
                            const isInactive = data.status === 'inactive' || data.status === 'deleted' || data.disabled || data.outOfStock || data.status === 'in-review';

                            if (!isInactive && data.name) {
                                const itemName = data.name;
                                if (!catalogMap[itemName]) {
                                    catalogMap[itemName] = { itemName, history: [] }; // Explicitly insert 0-history items
                                }
                            }
                        });
                    }
                } else {
                    console.warn('Could not find vendor containing "thyme".');
                }
            } catch (queryErr) {
                console.warn('Could not load ON Thyme vendorItems:', queryErr);
                // Non-fatal, we will just use seededMap
            }

            const results = [];

            // 2. Run prediction calculation for each tracked item map
            Object.values(catalogMap).forEach(item => {
                const history = item.history.sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));

                let totalQty = 0;
                let recentTotalQty = 0;
                let activeWeeks8Set = new Set();
                let maxDateMs = Date.now();
                let oneWeekAgoMs = maxDateMs;
                let twoWeeksAgoMs = maxDateMs;

                let week1qty = 0; // older of the last 2 weeks
                let week2qty = 0; // newer of the last 2 weeks

                if (history.length > 0) {
                    const maxDateStr = history[history.length - 1].purchaseDate;
                    const maxDate = new Date(maxDateStr);
                    maxDateMs = maxDate.getTime();

                    oneWeekAgoMs = maxDateMs - (7 * 24 * 60 * 60 * 1000);
                    twoWeeksAgoMs = maxDateMs - (14 * 24 * 60 * 60 * 1000);

                    history.forEach(record => {
                        const qty = Number(record.qty) || 0;
                        if (qty === 0) return;

                        totalQty += qty;
                        activeWeeks8Set.add(record.weekStart);

                        const recordMs = new Date(record.purchaseDate).getTime();

                        if (recordMs > twoWeeksAgoMs) {
                            recentTotalQty += qty;
                            if (recordMs <= oneWeekAgoMs) {
                                week1qty += qty;
                            } else {
                                week2qty += qty;
                            }
                        }
                    });
                }

                // If no history, these default to 0
                const activeWeeks8 = activeWeeks8Set.size;
                const avg8Weeks = totalQty / 8;
                const avg2Weeks = recentTotalQty / 2;

                const fastMoversList = ['Onion Cooking 50lbs', 'Onion - Cooking', 'Onion Red 25lbs', 'Onion - Red', 'Cabbage', 'Carrot', 'Carrot 50lbs', 'Beans'];
                const mediumMoversList = ['Mint', 'Mint Leaves', 'Coriander', 'Coriander Leaves', 'Green Onion', 'Plantain', 'Plantain Green', 'Okra', 'Lemon', 'Lime', 'Curry Leaves'];
                const slowMoversList = ['Beets', 'Leeks', 'Celery', 'Pepper mix', 'Pepper Mix', 'Long Beans', 'French Beans', 'Cauliflower', 'Peeled Garlic', 'Ginger', 'Potatoes', 'Thai Chilli', 'Ash Guard', 'Garlic'];

                let predictionType = 'Slow Mover';
                let confidence = 'Low';
                let forecast = 0;
                let reasoning = '';

                // Classification 
                if (fastMoversList.includes(item.itemName)) {
                    predictionType = 'Fast Mover';
                    confidence = 'High';
                    forecast = (0.5 * avg8Weeks) + (0.5 * avg2Weeks);
                    if (forecast > 0) {
                        forecast = forecast * 1.1;
                        reasoning = 'Fast Mover formula + 10% spoilage buffer.';
                    } else {
                        reasoning = 'No recent purchase trend detected. No order recommended.';
                    }
                } else if (mediumMoversList.includes(item.itemName)) {
                    predictionType = 'Medium Mover';
                    confidence = 'Medium';
                    forecast = avg8Weeks;
                    if (forecast > 0) {
                        reasoning = 'Medium Mover formula (uses flat 8-wk avg).';
                    } else {
                        reasoning = 'No recent purchase trend detected. No order recommended.';
                    }
                } else {
                    predictionType = 'Slow Mover';
                    confidence = 'Low';
                    if (week1qty > 0 || week2qty > 0) {
                        forecast = avg8Weeks;
                        reasoning = 'Slow Mover purchased recently.';
                    } else {
                        forecast = 0;
                        reasoning = 'No recent purchase trend detected. No order recommended.';
                    }
                }

                let predictedTotal = Math.ceil(forecast);
                let predictedMonday = 0;
                let predictedThursday = 0;

                if (predictedTotal > 0) {
                    predictedMonday = Math.round(predictedTotal * 0.6);
                    predictedThursday = predictedTotal - predictedMonday;
                }

                results.push({
                    itemName: item.itemName,
                    type: predictionType,
                    confidence,
                    avg8Weeks: avg8Weeks.toFixed(1),
                    avg2Weeks: avg2Weeks.toFixed(1),
                    predictedMonday,
                    predictedThursday,
                    totalNextWeek: predictedTotal,
                    reasoning: reasoning.trim()
                });
            });

            results.sort((a, b) => b.totalNextWeek - a.totalNextWeek);
            setPredictions(results);
            toast.success('Vegetable Prediction engine executed successfully!');

        } catch (err) {
            console.error('Prediction error:', err);
            toast.error('Prediction failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2>Vegetable Demand Prediction Test</h2>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="ui-btn secondary" onClick={handleSeedTestData} disabled={loading}>
                        🌱 Seed Test Data
                    </button>
                    <button className="ui-btn danger" onClick={handleClearTestData} disabled={loading}>
                        🗑️ Clear Data
                    </button>
                    <button className="ui-btn primary" onClick={handleRunPrediction} disabled={loading}>
                        🚀 Run Prediction
                    </button>
                </div>
            </div>

            {loading && <div style={{ marginBottom: 20 }}>Processing... Please wait...</div>}

            {predictions.length > 0 && (
                <div className="ui-card" style={{ marginBottom: 32 }}>
                    <h3 style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>Next Week Vegetable Demand</h3>
                    <div className="ui-table-wrap">
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Item Name</th>
                                    <th>Speed</th>
                                    <th>Confidence</th>
                                    <th>8wk Avg</th>
                                    <th>2wk Avg</th>
                                    <th>Monday Qty</th>
                                    <th>Thursday Qty</th>
                                    <th>Total Qty</th>
                                    <th>Reasoning</th>
                                </tr>
                            </thead>
                            <tbody>
                                {predictions.map((p, i) => (
                                    <tr key={i} className="is-row">
                                        <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                        <td>
                                            <span className={`badge ${p.type === 'Fast Mover' ? 'green' : p.type === 'Medium Mover' ? 'blue' : 'gray'}`}>
                                                {p.type}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${p.confidence === 'High' ? 'green' : p.confidence === 'Medium' ? 'amber' : 'red'}`} style={{ fontSize: 10 }}>
                                                {p.confidence}
                                            </span>
                                        </td>
                                        <td>{p.avg8Weeks}</td>
                                        <td>{p.avg2Weeks}</td>
                                        <td><span className="badge blue">{p.predictedMonday}</span></td>
                                        <td><span className="badge purple">{p.predictedThursday}</span></td>
                                        <td><span className="badge green" style={{ fontSize: 13 }}>{p.totalNextWeek}</span></td>
                                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.reasoning}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="ui-card">
                <h3 style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                    Seeded Vegetable History ({seededData.length} records)
                </h3>
                {seededData.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                        No seeded data found. Click "Seed Test Data" to populate.
                    </div>
                ) : (
                    <div className="ui-table-wrap" style={{ maxHeight: 600, overflowY: 'auto' }}>
                        <table className="ui-table">
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)' }}>
                                <tr>
                                    <th>Purchase Date</th>
                                    <th>Item</th>
                                    <th>Vendor</th>
                                    <th>Unit</th>
                                    <th>Qty Purchased</th>
                                </tr>
                            </thead>
                            <tbody>
                                {seededData.map((d, i) => (
                                    <tr key={i}>
                                        <td>{d.purchaseDate}</td>
                                        <td>{d.itemName}</td>
                                        <td>{d.vendor}</td>
                                        <td><span className="badge gray">{d.unit}</span></td>
                                        <td style={{ fontWeight: 'bold' }}>{d.qty}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
