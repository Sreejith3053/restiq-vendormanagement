import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function ForecastSettingsPage() {
    const [config, setConfig] = useState({
        safetyBufferPercent: 0.15,
        defaultMondaySplit: 0.40,
        defaultThursdaySplit: 0.60
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const docSnap = await getDoc(doc(db, 'forecastConfig', 'global'));
            if (docSnap.exists()) {
                setConfig(docSnap.data());
            }
        } catch (err) {
            console.error("Failed to load settings:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await setDoc(doc(db, 'forecastConfig', 'global'), config, { merge: true });
            alert("Settings updated successfully. They will apply to the next engine run.");
        } catch (err) {
            console.error("Failed to save settings:", err);
            alert("Error saving settings.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Forecast Algorithm Settings</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Configure buffers, rules, and global properties for the deterministic logic engine.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading configuration...</div>
            ) : (
                <div className="ui-card" style={{ padding: 24, maxWidth: 600 }}>
                    <h3 style={{ margin: '0 0 20px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>Safety Stock Rules</h3>
                    <div style={{ marginBottom: 20 }}>
                        <label className="ui-label">Default Safety Buffer (%)</label>
                        <p style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--muted)' }}>Applied on top of calculated baseline demand to cover sudden mid-week spikes.</p>
                        <input
                            type="number"
                            step="0.01"
                            className="ui-input"
                            value={config.safetyBufferPercent || 0}
                            onChange={e => setConfig({ ...config, safetyBufferPercent: parseFloat(e.target.value) })}
                        />
                    </div>

                    <h3 style={{ margin: '32px 0 20px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>New User / Low History Splitting Defaults</h3>
                    <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--muted)' }}>When a restaurant lacks enough weekday history, the engine falls back to this raw split metric across the weekly boundary.</p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div>
                            <label className="ui-label">Default Mon-Wed Need (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="ui-input"
                                value={config.defaultMondaySplit || 0}
                                onChange={e => setConfig({ ...config, defaultMondaySplit: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="ui-label">Default Thu-Sun Need (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="ui-input"
                                value={config.defaultThursdaySplit || 0}
                                onChange={e => setConfig({ ...config, defaultThursdaySplit: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="ui-btn primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : 'Update Engine Parameters'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
