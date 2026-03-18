/**
 * CatalogMatchSuggestions.js
 *
 * Shows ranked suggestions for:
 * A. Master catalog item matches (catalogItems)
 * B. Existing vendor item matches (possible duplicates)
 *
 * Each suggestion has an action button to select it.
 */
import React, { useState } from 'react';

function SimBar({ pct }) {
    const color = pct >= 80 ? '#4ade80' : pct >= 60 ? '#fbbf24' : '#f87171';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 32 }}>{pct}%</span>
        </div>
    );
}

function MatchCard({ item, type, onSelect, selected }) {
    const name     = item.canonicalName || item.name || item.itemName || '—';
    const price    = item.vendorPrice ?? item.price;
    const sim      = item.similarity ?? 0;
    const isActive = selected === item.id;

    return (
        <div
            onClick={() => onSelect(item)}
            style={{
                padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                border: isActive ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.07)',
                background: isActive ? 'rgba(56,189,248,0.07)' : 'rgba(255,255,255,0.02)',
                transition: 'all 0.15s', marginBottom: 6,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>{name}</div>
                {isActive && <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>✓ Selected</span>}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                {item.category && <span style={{ fontSize: 10, color: '#64748b' }}>{item.category}</span>}
                {item.packSize  && <span style={{ fontSize: 10, color: '#64748b' }}>• {item.packSize}</span>}
                {item.unit      && <span style={{ fontSize: 10, color: '#64748b' }}>{item.unit}</span>}
                {price !== undefined && price !== '' && (
                    <span style={{ fontSize: 10, color: '#fbbf24' }}>• ${Number(price).toFixed(2)}</span>
                )}
            </div>

            {type === 'catalog' && item.aliases?.length > 0 && (
                <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>
                    Aliases: {item.aliases.join(', ')}
                </div>
            )}

            <SimBar pct={sim} />
        </div>
    );
}

export default function CatalogMatchSuggestions({
    catalogMatches = [],
    vendorMatches = [],
    selectedCatalogItem = null,
    selectedVendorItem = null,
    onSelectCatalog,
    onSelectVendor,
    loading = false,
}) {
    const [tab, setTab] = useState('catalog');

    const tabStyle = (active) => ({
        padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        cursor: 'pointer',
        border: active ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.09)',
        background: active ? 'rgba(56,189,248,0.1)' : 'transparent',
        color: active ? '#38bdf8' : '#64748b',
    });

    return (
        <div>
            {/* Tab selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button style={tabStyle(tab === 'catalog')} onClick={() => setTab('catalog')}>
                    🗂️ Master Catalog ({catalogMatches.length})
                </button>
                <button style={tabStyle(tab === 'vendor')} onClick={() => setTab('vendor')}>
                    📦 Vendor Items ({vendorMatches.length})
                </button>
            </div>

            {loading && <div style={{ fontSize: 12, color: '#475569', padding: 12 }}>Loading suggestions...</div>}

            {tab === 'catalog' && !loading && (
                <>
                    {catalogMatches.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#475569', padding: '8px 0' }}>No catalog matches found</div>
                    ) : (
                        catalogMatches.map(item => (
                            <MatchCard
                                key={item.id}
                                item={item}
                                type="catalog"
                                onSelect={onSelectCatalog}
                                selected={selectedCatalogItem?.id}
                            />
                        ))
                    )}
                </>
            )}

            {tab === 'vendor' && !loading && (
                <>
                    {vendorMatches.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#475569', padding: '8px 0' }}>No similar vendor items found</div>
                    ) : (
                        vendorMatches.map(item => (
                            <MatchCard
                                key={item.id}
                                item={item}
                                type="vendor"
                                onSelect={onSelectVendor}
                                selected={selectedVendorItem?.id}
                            />
                        ))
                    )}
                </>
            )}
        </div>
    );
}
