import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, deleteDoc, writeBatch, doc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import testData from './containerTestData.json';

export default function ContainerPredictionTestPage() {
    const [loading, setLoading] = useState(false);
    const [seededData, setSeededData] = useState([]);
    const [predictions, setPredictions] = useState([]);

    const COLLECTION_NAME = 'containerPredictionHistory';

    useEffect(() => {
        fetchSeededData();
    }, []);

    const fetchSeededData = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, COLLECTION_NAME));
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort by date descending
            data.sort((a, b) => new Date(b.date) - new Date(a.date));
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
            const batchActions = []; // Batches hold up to 500 writes

            let currentBatch = writeBatch(db);
            let operationCount = 0;

            for (const item of testData) {
                const docRef = doc(colRef);
                currentBatch.set(docRef, { ...item, createdAt: new Date().toISOString() });
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

    const handleRunPrediction = () => {
        if (seededData.length === 0) {
            toast.warn('No data to predict from. Please seed data first.');
            return;
        }

        setLoading(true);
        try {
            // Group by itemName
            const itemsMap = {};
            seededData.forEach(row => {
                if (!itemsMap[row.itemName]) {
                    itemsMap[row.itemName] = {
                        itemName: row.itemName,
                        category: row.category,
                        history: []
                    };
                }
                itemsMap[row.itemName].history.push(row);
            });

            const results = [];

            // Process each item
            Object.values(itemsMap).forEach(item => {
                const history = item.history.sort((a, b) => new Date(a.date) - new Date(b.date));

                let totalBoxes = 0;
                let recentTotalBoxes = 0;

                const maxDateStr = history[history.length - 1].date;
                const maxDate = new Date(maxDateStr);
                const maxDateMs = maxDate.getTime();

                const oneWeekAgoMs = maxDateMs - (7 * 24 * 60 * 60 * 1000);
                const twoWeeksAgoMs = maxDateMs - (14 * 24 * 60 * 60 * 1000);
                const fourWeeksAgoMs = maxDateMs - (28 * 24 * 60 * 60 * 1000);

                let week1boxes = 0; // older of the last 2 weeks
                let week2boxes = 0; // newer of the last 2 weeks

                const activeWeeks8Set = new Set();
                const activeWeeks4Set = new Set();

                history.forEach(record => {
                    const boxes = Number(record.boxesOrdered) || 0;
                    if (boxes === 0) return;

                    totalBoxes += boxes;
                    activeWeeks8Set.add(record.weekStart);

                    const recordMs = new Date(record.date).getTime();

                    if (recordMs > fourWeeksAgoMs) {
                        activeWeeks4Set.add(record.weekStart);
                    }

                    if (recordMs > twoWeeksAgoMs) {
                        recentTotalBoxes += boxes;
                        if (recordMs <= oneWeekAgoMs) {
                            week1boxes += boxes;
                        } else {
                            week2boxes += boxes;
                        }
                    }
                });

                const activeWeeks8 = activeWeeks8Set.size;
                const activeWeeks4 = activeWeeks4Set.size;

                const avg8Weeks = totalBoxes / 8;
                const avg2Weeks = recentTotalBoxes / 2;

                let predictionType = 'Slow';
                let confidence = 'Low';
                let forecast = 0;
                let reasoning = '';

                if (activeWeeks8 >= 6) {
                    predictionType = 'Fast';
                    confidence = 'High';
                    forecast = (0.6 * avg2Weeks) + (0.4 * avg8Weeks);
                    reasoning = 'Fast Mover.';
                } else if (activeWeeks8 >= 3 && activeWeeks8 <= 5) {
                    predictionType = 'Medium';
                    confidence = 'Medium';
                    forecast = (0.4 * avg2Weeks) + (0.6 * avg8Weeks);
                    reasoning = 'Medium Mover.';
                } else {
                    predictionType = 'Slow';
                    confidence = 'Low';
                    if (week1boxes > 0 && week2boxes > 0) {
                        forecast = 1;
                        reasoning = 'Slow Mover (recent activity).';
                    } else {
                        forecast = avg8Weeks;
                        if (week1boxes === 0 || week2boxes === 0) {
                            forecast = 0;
                            reasoning = 'Slow Mover.';
                        }
                    }
                }

                if (avg2Weeks >= (avg8Weeks * 1.4) && activeWeeks8 >= 4) {
                    reasoning += ' Recent spikes detected.';
                }

                let predictedTotal = Math.ceil(forecast);

                if (predictedTotal >= 3) {
                    predictedTotal += 1;
                    reasoning += ' Added +1 safety box.';
                }

                let predictedMonday = 0;
                let predictedThursday = 0;

                if (predictedTotal > 0) {
                    if (predictionType === 'Fast') {
                        predictedMonday = Math.round(predictedTotal * 0.4);
                        predictedThursday = predictedTotal - predictedMonday;
                    } else if (predictionType === 'Medium') {
                        predictedMonday = Math.round(predictedTotal * 0.5);
                        predictedThursday = predictedTotal - predictedMonday;
                    } else {
                        predictedMonday = 0;
                        predictedThursday = predictedTotal;
                    }
                }

                results.push({
                    itemName: item.itemName,
                    category: item.category,
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

            // Sort results by total boxes descending
            results.sort((a, b) => b.totalNextWeek - a.totalNextWeek);
            setPredictions(results);
            toast.success('Prediction engine logic executed successfully!');

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
                <h2>Container Prediction Test</h2>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="ui-btn secondary" onClick={handleSeedTestData} disabled={loading}>
                        🌱 Seed Test Data
                    </button>
                    <button className="ui-btn danger" onClick={handleClearTestData} disabled={loading}>
                        🗑️ Clear Data
                    </button>
                    <button className="ui-btn primary" onClick={handleRunPrediction} disabled={loading}>
                        🚀 Run Prediction Test
                    </button>
                </div>
            </div>

            {loading && <div style={{ marginBottom: 20 }}>Processing... Please wait...</div>}

            {predictions.length > 0 && (
                <div className="ui-card" style={{ marginBottom: 32 }}>
                    <h3 style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>Next Week Predictions</h3>
                    <div className="ui-table-wrap">
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Item Name</th>
                                    <th>Speed</th>
                                    <th>Conf.</th>
                                    <th>8-Wk Avg</th>
                                    <th>2-Wk Avg</th>
                                    <th>Monday Boxes</th>
                                    <th>Thursday Boxes</th>
                                    <th>Total Boxes</th>
                                    <th>Reasoning</th>
                                </tr>
                            </thead>
                            <tbody>
                                {predictions.map((p, i) => (
                                    <tr key={i} className="is-row">
                                        <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                        <td>
                                            <span className={`badge ${p.type === 'Fast' ? 'green' : p.type === 'Medium' ? 'blue' : 'gray'}`}>
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
                    Seeded Historical Data ({seededData.length} records)
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
                                    <th>Date</th>
                                    <th>Day</th>
                                    <th>Item</th>
                                    <th>Pack Type</th>
                                    <th>Boxes Ordered</th>
                                    <th>Spike Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {seededData.map((d, i) => (
                                    <tr key={i}>
                                        <td>{d.date}</td>
                                        <td><span className="badge">{d.deliveryDay}</span></td>
                                        <td>{d.itemName}</td>
                                        <td>{d.packType} ({d.packSize})</td>
                                        <td style={{ fontWeight: 'bold' }}>{d.boxesOrdered}</td>
                                        <td style={{ fontSize: 12 }}>{d.spikeReason || '—'}</td>
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
