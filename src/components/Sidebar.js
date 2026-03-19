import React, { useContext, useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import restiqLogo from '../assets/restiq-logo-sidebar.png';
import './Sidebar.css';

// ── Super Admin: 7 flat top-level links ─────────────────────────────
const SUPER_ADMIN_LINKS = [
    { to: '/admin/forecast/control-tower', icon: '🗼', label: 'Control Tower' },
    { to: '/orders-fulfillment',           icon: '⚙️', label: 'Orders & Fulfillment' },
    { to: '/vendors',                      icon: '🏪', label: 'Vendors',  end: true },
    { to: '/catalog-reviews',              icon: '📦', label: 'Catalog & Reviews' },
    { to: '/intelligence',                 icon: '🧠', label: 'Intelligence' },
    { to: '/finance',                      icon: '💰', label: 'Finance' },
    { to: '/platform-admin',              icon: '🔧', label: 'Platform Admin' },
];

// ── Extended search targets: tab-level deep links ───────────────────
// Allows searching for "dispatch" to find Orders & Fulfillment > Dispatch etc.
const SEARCH_TARGETS = [
    // Top-level pages
    ...SUPER_ADMIN_LINKS.map(l => ({ ...l, group: '' })),
    // Orders & Fulfillment tabs
    { to: '/orders-fulfillment?tab=overview',   icon: '📊', label: 'Orders Overview',         group: 'Orders & Fulfillment' },
    { to: '/orders-fulfillment?tab=submitted',  icon: '✅', label: 'Submitted Orders',         group: 'Orders & Fulfillment' },
    { to: '/orders-fulfillment?tab=dispatch',   icon: '📋', label: 'Dispatch Confirmations',    group: 'Orders & Fulfillment' },
    { to: '/orders-fulfillment?tab=delivery',   icon: '📍', label: 'Delivery Status',           group: 'Orders & Fulfillment' },
    { to: '/orders-fulfillment?tab=issues',     icon: '🚨', label: 'Issues & Disputes',         group: 'Orders & Fulfillment' },
    // Vendor tabs
    { to: '/vendors?tab=all',                   icon: '🏢', label: 'All Vendors',               group: 'Vendors' },
    { to: '/vendors?tab=onboarding',            icon: '➕', label: 'Add Vendor / Onboarding',   group: 'Vendors' },
    { to: '/vendors?tab=performance',           icon: '🏆', label: 'Vendor Performance',        group: 'Vendors' },
    // Catalog tabs
    { to: '/catalog-reviews?tab=catalog',       icon: '📦', label: 'Catalog Items',             group: 'Catalog & Reviews' },
    { to: '/catalog-reviews?tab=review-queue',  icon: '🗂️', label: 'Review Queue',             group: 'Catalog & Reviews' },
    { to: '/catalog-reviews?tab=unmapped',      icon: '🔗', label: 'Unmapped Items',            group: 'Catalog & Reviews' },
    { to: '/catalog-reviews?tab=duplicates',    icon: '⚠️', label: 'Duplicates / Merge',       group: 'Catalog & Reviews' },
    { to: '/catalog-reviews?tab=change-requests', icon: '📋', label: 'Pending Reviews / Change Requests', group: 'Catalog & Reviews' },
    { to: '/catalog-reviews?tab=audit-log',     icon: '📜', label: 'Audit Log',                 group: 'Catalog & Reviews' },
    // Intelligence tabs
    { to: '/intelligence?tab=ai-summary',       icon: '🤖', label: 'AI Intelligence Hub',       group: 'Intelligence' },
    { to: '/intelligence?tab=price-intelligence', icon: '📊', label: 'Marketplace Intelligence / Price', group: 'Intelligence' },
    { to: '/intelligence?tab=allocation',       icon: '📦', label: 'Vendor Allocation',         group: 'Intelligence' },
    { to: '/intelligence?tab=capacity',         icon: '🛡️', label: 'Supply Capacity',          group: 'Intelligence' },
    { to: '/intelligence?tab=seasonality',      icon: '🎄', label: 'Festival Calendar / Seasonality', group: 'Intelligence' },
    // Finance tabs
    { to: '/finance?tab=restaurant-invoices',   icon: '🧾', label: 'Restaurant Invoices',       group: 'Finance' },
    { to: '/finance?tab=vendor-invoices',       icon: '🧾', label: 'Vendor Invoices',           group: 'Finance' },
    { to: '/finance?tab=commission',            icon: '💵', label: 'Commission Summary',        group: 'Finance' },
    { to: '/finance?tab=payments',              icon: '📊', label: 'Payment Tracking',          group: 'Finance' },
    // Platform Admin tabs
    { to: '/platform-admin?tab=restaurants',    icon: '🏪', label: 'Restaurants',               group: 'Platform Admin' },
    { to: '/platform-admin?tab=users',          icon: '👥', label: 'Users & Roles',             group: 'Platform Admin' },
    { to: '/platform-admin?tab=permissions',    icon: '⚙️', label: 'Role Permissions',         group: 'Platform Admin' },
    { to: '/platform-admin?tab=migration',      icon: '🔧', label: 'Migration Tools',          group: 'Platform Admin' },
    // Legacy aliases for search
    { to: '/catalog-reviews?tab=review-queue',  icon: '🔍', label: 'Mapping Review',            group: 'Catalog & Reviews' },
];

export default function Sidebar({ isOpen, onClose }) {
    const { displayName, vendorName, vendorId, isSuperAdmin, isAdmin, logout } = useContext(UserContext);
    const navigate = useNavigate();
    const [pendingDispatches, setPendingDispatches] = useState(0);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (isSuperAdmin || !vendorId) return;

        const q = query(
            collection(db, 'vendorDispatches'),
            where('vendorId', '==', vendorId),
            where('status', '==', 'Sent')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setPendingDispatches(snapshot.docs.length);
        }, (err) => {
            console.error('Error fetching pending dispatches for sidebar:', err);
            if (err.message && err.message.includes('index')) return;
        });

        return () => unsubscribe();
    }, [vendorId, isSuperAdmin]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const initials = (displayName || 'U')
        .split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const roleLabel = isSuperAdmin ? 'Super Admin' : isAdmin ? 'Vendor Admin' : 'User';
    const searchFilter = search.trim().toLowerCase() || '';

    // Search results from all targets
    const searchResults = useMemo(() => {
        if (!searchFilter) return [];
        return SEARCH_TARGETS.filter(t => t.label.toLowerCase().includes(searchFilter));
    }, [searchFilter]);

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}

            <div className={`sidebar-container ${isOpen ? '' : 'closed'}`}>
                {/* Brand */}
                <div className="sidebar-brand">
                    <img src={restiqLogo} alt="RestIQ Solutions" className="sidebar-logo" />
                    {isSuperAdmin ? (
                        <div className="brand-tag">Platform Administration</div>
                    ) : (
                        <div className="brand-tag vendor-tag">{vendorName || 'Vendor Portal'}</div>
                    )}
                </div>

                {/* Navigation */}
                {isSuperAdmin ? (
                    <div className="sidebar-nav-scroll">
                        {/* Search */}
                        <div className="sidebar-search-wrap">
                            <div className="sidebar-search">
                                <span className="search-icon">🔍</span>
                                <input
                                    type="text"
                                    placeholder="Search pages..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="sidebar-search-input"
                                />
                                {search && (
                                    <button className="search-clear" onClick={() => setSearch('')}>✕</button>
                                )}
                            </div>
                        </div>

                        {/* Search results mode */}
                        {searchFilter && searchResults.length > 0 ? (
                            <div className="sidebar-section">
                                <div className="sidebar-section-title">Search Results</div>
                                {searchResults.map((r, idx) => (
                                    <NavLink
                                        key={r.to + r.label + idx}
                                        to={r.to}
                                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                                        onClick={() => { setSearch(''); onClose(); }}
                                    >
                                        <span className="link-icon">{r.icon}</span>
                                        <span style={{ flex: 1 }}>{r.label}</span>
                                        {r.group && <span className="search-group-badge">{r.group}</span>}
                                    </NavLink>
                                ))}
                            </div>
                        ) : searchFilter && searchResults.length === 0 ? (
                            <div className="sidebar-empty-search">
                                <span style={{ fontSize: 20 }}>🔍</span>
                                <span>No pages match "{search}"</span>
                            </div>
                        ) : (
                            /* Normal flat navigation — 7 top-level links */
                            <div className="sidebar-section">
                                {SUPER_ADMIN_LINKS.map(link => (
                                    <NavLink
                                        key={link.to}
                                        to={link.to}
                                        end={link.end || false}
                                        className={({ isActive }) => `sidebar-link sidebar-link-pinned ${isActive ? 'active' : ''}`}
                                        onClick={onClose}
                                    >
                                        <span className="link-icon">{link.icon}</span>
                                        {link.label}
                                    </NavLink>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    /* ── Vendor sidebar — workflow-based grouping ── */
                    <div className="sidebar-nav-scroll">
                        {/* 🏠 Dashboard */}
                        <div className="sidebar-section">
                            <NavLink to="/" end className={({ isActive }) => `sidebar-link sidebar-link-pinned ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏠</span> Dashboard
                            </NavLink>
                        </div>

                        {/* ⚙️ Operations */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Operations</div>
                            <NavLink to="/dispatch-requests" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span><span className="link-icon">📦</span> Orders</span>
                                {pendingDispatches > 0 && (
                                    <span style={{ background: '#f59e0b', color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                                        {pendingDispatches}
                                    </span>
                                )}
                            </NavLink>
                            <NavLink to="/vendor/allocation" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📊</span> Demand
                            </NavLink>
                            <NavLink to="/vendor/capacity" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🛡️</span> Capacity Planning
                            </NavLink>
                        </div>

                        {/* 📦 Catalog */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Catalog</div>
                            <NavLink to="/items" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📋</span> Catalog
                            </NavLink>
                            <NavLink to="/vendor/import" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📥</span> Bulk Upload
                            </NavLink>
                        </div>

                        {/* 💰 Finance */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Finance</div>
                            <NavLink to="/vendor/invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">💰</span> Payouts
                            </NavLink>
                        </div>

                        {/* 📈 Performance */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Performance</div>
                            <NavLink to="/vendor/competitiveness" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏆</span> Competitiveness Score
                            </NavLink>
                        </div>

                        {/* 🏢 Business */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Business</div>
                            <NavLink to="/profile" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏢</span> Business Hub
                            </NavLink>
                            {isAdmin && (
                                <>
                                    <NavLink to="/users" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                        <span className="link-icon">👥</span> Manage Users
                                    </NavLink>
                                    <NavLink to="/settings/permissions" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                        <span className="link-icon">⚙️</span> Role Permissions
                                    </NavLink>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Bottom — user info & logout */}
                <div className="sidebar-bottom">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">{initials}</div>
                        <div className="sidebar-user-info">
                            <div className="sidebar-user-name">{displayName || 'User'}</div>
                            <div className="sidebar-user-role">{roleLabel}</div>
                        </div>
                    </div>
                    <button className="logout-btn" onClick={handleLogout}>
                        🚪 Sign Out
                    </button>
                </div>
            </div>
        </>
    );
}
