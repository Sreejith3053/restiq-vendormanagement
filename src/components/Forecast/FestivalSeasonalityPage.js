import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function FestivalSeasonalityPage() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);

    // Form State
    const [form, setForm] = useState({ id: null, eventName: '', startDate: '', endDate: '', isActive: true, notes: '' });
    const [ruleCategory, setRuleCategory] = useState('Meat');
    const [rulePercent, setRulePercent] = useState(15);
    const [upliftRules, setUpliftRules] = useState([]);

    useEffect(() => {
        loadEvents();
    }, []);

    const loadEvents = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'festivalCalendar'));
            const list = [];
            snap.forEach(d => list.push({ id: d.id, ...d.data() }));
            list.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
            setEvents(list);
        } catch (err) {
            console.error("Failed to fetch events:", err);
        } finally {
            setLoading(false);
        }
    };

    const addRule = () => {
        if (!ruleCategory) return;
        setUpliftRules([...upliftRules, { targetType: 'category', targetValue: ruleCategory, percent: Number(rulePercent) }]);
        setRulePercent(15);
    };

    const removeRule = (idx) => {
        setUpliftRules(upliftRules.filter((_, i) => i !== idx));
    };

    const saveEvent = async () => {
        if (!form.eventName || !form.startDate || !form.endDate) return alert("Missing required fields.");
        try {
            const payload = {
                eventName: form.eventName,
                startDate: form.startDate,
                endDate: form.endDate,
                isActive: form.isActive,
                notes: form.notes,
                upliftRules: upliftRules
            };

            if (form.id) {
                await updateDoc(doc(db, 'festivalCalendar', form.id), payload);
            } else {
                await addDoc(collection(db, 'festivalCalendar'), payload);
            }

            resetForm();
            loadEvents();
        } catch (err) {
            console.error("Save error:", err);
        }
    };

    const resetForm = () => {
        setForm({ id: null, eventName: '', startDate: '', endDate: '', isActive: true, notes: '' });
        setUpliftRules([]);
        setIsEditing(false);
    };

    const editEvent = (evt) => {
        setForm({ id: evt.id, eventName: evt.eventName, startDate: evt.startDate, endDate: evt.endDate, isActive: evt.isActive, notes: evt.notes || '' });
        setUpliftRules(evt.upliftRules || []);
        setIsEditing(true);
    };

    const deleteEvent = async (id) => {
        if (!window.confirm("Are you sure you want to delete this event? This will stop applying its rules to forecasts immediately.")) return;
        try {
            await deleteDoc(doc(db, 'festivalCalendar', id));
            loadEvents();
        } catch (err) {
            console.error("Delete err:", err);
        }
    };

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Festival & Seasonality Calendar</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Configure impact percentage multipliers for cultural events intersecting with delivery days.</p>
                </div>
                {!isEditing && <button className="ui-btn primary" onClick={() => setIsEditing(true)}>+ Add New Event</button>}
            </div>

            {isEditing ? (
                <div className="ui-card" style={{ padding: 24, marginBottom: 24, background: 'rgba(0,0,0,0.2)', border: '1px solid #4dabf7' }}>
                    <h3 style={{ margin: '0 0 16px 0', color: '#4dabf7' }}>{form.id ? 'Edit Event Configuration' : 'Create New Event'}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr)', gap: 16 }}>
                        <div><label className="ui-label">Event Name</label><input className="ui-input" value={form.eventName} onChange={e => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. Onam Week" /></div>
                        <div><label className="ui-label">Start Date</label><input type="date" className="ui-input" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
                        <div><label className="ui-label">End Date</label><input type="date" className="ui-input" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
                    </div>

                    <div style={{ marginTop: 24, background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8 }}>
                        <h4 style={{ margin: '0 0 12px 0' }}>Uplift Multipliers</h4>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
                            <div style={{ flex: 1 }}><label className="ui-label">Target Category</label>
                                <select className="ui-input" value={ruleCategory} onChange={e => setRuleCategory(e.target.value)}>
                                    <option value="Meat">Meat</option>
                                    <option value="Seafood">Seafood</option>
                                    <option value="Vegetables">Vegetables</option>
                                    <option value="Packaging">Packaging</option>
                                    <option value="Spices">Spices</option>
                                </select>
                            </div>
                            <div style={{ flex: 1 }}><label className="ui-label">Uplift Percent (+%)</label><input type="number" className="ui-input" value={rulePercent} onChange={e => setRulePercent(e.target.value)} /></div>
                            <button className="ui-btn ghost" onClick={addRule}>+ Add Rule</button>
                        </div>

                        {upliftRules.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {upliftRules.map((r, i) => (
                                    <div key={i} style={{ background: '#4dabf722', color: '#4dabf7', padding: '4px 12px', borderRadius: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <strong>{r.targetValue}</strong> <span>+{r.percent}% Demand</span>
                                        <button onClick={() => removeRule(i)} style={{ background: 'none', border: 'none', color: '#ff6b7a', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
                            <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} style={{ width: 16, height: 16 }} />
                            <label htmlFor="isActive" style={{ margin: 0, fontSize: 14 }}>Event is Active</label>
                        </div>
                        <button className="ui-btn ghost" onClick={resetForm}>Cancel</button>
                        <button className="ui-btn primary" onClick={saveEvent}>{form.id ? 'Update Event Rules' : 'Save Event'}</button>
                    </div>
                </div>
            ) : null}

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading events...</div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Event Name</th>
                                <th>Active Dates</th>
                                <th>Applied Uplifts</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map(evt => (
                                <tr key={evt.id} style={{ opacity: evt.isActive ? 1 : 0.5 }}>
                                    <td data-label="Event Name" style={{ fontWeight: 600 }}>{evt.eventName}</td>
                                    <td data-label="Dates">{evt.startDate} to {evt.endDate}</td>
                                    <td data-label="Applied Uplifts">
                                        {evt.upliftRules?.map((r, i) => (
                                            <span key={i} style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>
                                                {r.targetValue}: <span style={{ color: '#4ade80' }}>+{r.percent}%</span>
                                            </span>
                                        )) || <span style={{ color: 'var(--muted)' }}>None</span>}
                                    </td>
                                    <td data-label="Status">
                                        {evt.isActive ? <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 600 }}>● Active</span> : <span style={{ color: '#ff6b7a', fontSize: 12 }}>● Disabled</span>}
                                    </td>
                                    <td data-label="Actions">
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className="ui-btn small ghost" onClick={() => editEvent(evt)}>Edit</button>
                                            <button className="ui-btn small ghost" style={{ color: '#ff6b7a', borderColor: 'transparent' }} onClick={() => deleteEvent(evt.id)}>Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
