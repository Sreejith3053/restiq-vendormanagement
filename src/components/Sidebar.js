import React, { useContext, useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import restiqLogo from '../assets/restiq-logo-sidebar.png';
import './Sidebar.css';

// ── Navigation group definitions for SuperAdmin ─────────────────────
// Pinned top-level link (not in a collapsible group)
const PINNED_LINK = { to: '/admin/forecast/control-tower', icon: '🗼', label: 'Control Tower' };

const NAV_GROUPS = [
    {
        id: 'operations',
        label: 'Operations',
        icon: '⚙️',
        defaultOpen: true,
        links: [
            { to: '/orders', icon: '📦', label: 'All Orders' },
            { to: '/admin/forecast/suggested-order-review', icon: '📝', label: 'Suggested Orders' },
            { to: '/admin/forecast/submitted-orders', icon: '✅', label: 'Submitted Orders' },
            { to: '/admin/dispatch/confirmations', icon: '📋', label: 'Dispatch Confirmations' },
            { to: '/admin/dispatch/delivery', icon: '📍', label: 'Delivery Status' },
            { to: '/admin/dispatch/issues', icon: '🚨', label: 'Issues & Disputes' },
        ],
    },
    {
        id: 'marketplace',
        label: 'Marketplace',
        icon: '🏪',
        defaultOpen: true,
        links: [
            { to: '/vendors', icon: '🏢', label: 'All Vendors', end: true },
            { to: '/vendors/add', icon: '➕', label: 'Add Vendor' },
            { to: '/admin/manage-catalog', icon: '📦', label: 'Catalog Items' },
            { to: '/admin/mapping-review',   icon: '🔍', label: 'Mapping Review' },
            { to: '/admin/catalog-review',    icon: '🗂️', label: 'Catalog Review Queue' },
            { to: '/admin/vendor-competitiveness', icon: '🏆', label: 'Vendor Scores' },
            { to: '/admin/unmapped-items',          icon: '🔗', label: 'Unmapped Items' },
        ],
    },
    {
        id: 'intelligence',
        label: 'Intelligence',
        icon: '🧠',
        defaultOpen: false,
        links: [
            { to: '/admin/ai-intelligence', icon: '🤖', label: 'AI Intelligence Hub' },
            { to: '/admin/marketplace-intelligence', icon: '📊', label: 'Marketplace Intelligence' },
            { to: '/admin/vendor-allocation', icon: '📦', label: 'Vendor Allocation' },
            { to: '/admin/supply-capacity', icon: '🛡️', label: 'Supply Capacity' },
            { to: '/admin/forecast/festivals', icon: '🎄', label: 'Festival Calendar' },
        ],
    },
    {
        id: 'administration',
        label: 'Administration',
        icon: '🔧',
        defaultOpen: false,
        links: [
            { to: '/admin/restaurants', icon: '🏪', label: 'All Restaurants' },
            { to: '/admin/restaurant-invoices', icon: '🧾', label: 'Restaurant Invoices' },
            { to: '/admin/invoices', icon: '🧾', label: 'Vendor Invoices' },
            { to: '/admin/manage-restaurants', icon: '🏪', label: 'Master Restaurants' },
            { to: '/admin/pending-reviews', icon: '📋', label: 'Pending Reviews' },
            { to: '/users', icon: '👥', label: 'Users & Roles' },
            { to: '/settings/permissions', icon: '⚙️', label: 'Role Permissions' },
            { to: '/admin/migration', icon: '🔧', label: 'Migration Tools' },
        ],
    },
];

// ── Collapsible Nav Group Component ─────────────────────────────────
function NavGroup({ group, onClose, searchFilter }) {
    const [open, setOpen] = useState(group.defaultOpen);

    // If searching, show all groups open
    const isOpen = searchFilter ? true : open;

    const links = searchFilter
        ? group.links.filter(l => l.label.toLowerCase().includes(searchFilter))
        : group.links;

    if (searchFilter && links.length === 0) return null;

    return (
        <div className="sidebar-group">
            <button className={`sidebar-group-header ${isOpen ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
                <span className="group-icon">{group.icon}</span>
                <span className="group-label">{group.label}</span>
                <span className={`group-chevron ${isOpen ? 'open' : ''}`}>›</span>
            </button>
            {isOpen && (
                <div className="sidebar-group-links">
                    {links.map(link => (
                        <NavLink
                            key={link.to + link.label}
                            to={link.to}
                            end={link.end || false}
                            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                            onClick={onClose}
                        >
                            <span className="link-icon">{link.icon}</span>
                            {link.label}
                        </NavLink>
                    ))}
                </div>
            )}
        </div>
    );
}

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

    // Flatten all links for quick page search results
    const searchResults = useMemo(() => {
        if (!searchFilter) return [];
        const results = [];
        NAV_GROUPS.forEach(g => {
            g.links.forEach(l => {
                if (l.label.toLowerCase().includes(searchFilter)) {
                    results.push({ ...l, group: g.label });
                }
            });
        });
        return results;
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
                                {searchResults.map(r => (
                                    <NavLink
                                        key={r.to + r.label}
                                        to={r.to}
                                        end={r.end || false}
                                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                                        onClick={() => { setSearch(''); onClose(); }}
                                    >
                                        <span className="link-icon">{r.icon}</span>
                                        <span style={{ flex: 1 }}>{r.label}</span>
                                        <span className="search-group-badge">{r.group}</span>
                                    </NavLink>
                                ))}
                            </div>
                        ) : searchFilter && searchResults.length === 0 ? (
                            <div className="sidebar-empty-search">
                                <span style={{ fontSize: 20 }}>🔍</span>
                                <span>No pages match "{search}"</span>
                            </div>
                        ) : (
                            /* Normal grouped navigation */
                            <>
                                {/* Pinned Control Tower */}
                                <div className="sidebar-pinned">
                                    <NavLink
                                        to={PINNED_LINK.to}
                                        className={({ isActive }) => `sidebar-link sidebar-link-pinned ${isActive ? 'active' : ''}`}
                                        onClick={onClose}
                                    >
                                        <span className="link-icon">{PINNED_LINK.icon}</span>
                                        {PINNED_LINK.label}
                                    </NavLink>
                                </div>

                                {NAV_GROUPS.map(group => (
                                    <NavGroup
                                        key={group.id}
                                        group={group}
                                        onClose={onClose}
                                        searchFilter={searchFilter}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                ) : (
                    /* ── Vendor sidebar (unchanged) ──────────────── */
                    <div className="sidebar-nav-scroll">
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Main</div>
                            <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏠</span> Dashboard
                            </NavLink>
                        </div>
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Catalog</div>
                            <NavLink to="/items" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📋</span> Items
                            </NavLink>
                            <NavLink to="/vendor/import" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📥</span> Import Catalog
                            </NavLink>
                            <NavLink to="/vendor/import/history" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🕐</span> Import History
                            </NavLink>
                            <NavLink to="/dispatch-requests" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span><span className="link-icon">🚚</span> Dispatch Requests</span>
                                {pendingDispatches > 0 && (
                                    <span style={{ background: '#f59e0b', color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                                        {pendingDispatches}
                                    </span>
                                )}
                            </NavLink>
                        </div>
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Vendor</div>
                            <NavLink to="/profile" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏢</span> Vendor Profile
                            </NavLink>
                            <NavLink to="/vendor/invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">💳</span> My Invoices
                            </NavLink>
                            <NavLink to="/vendor/competitiveness" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏆</span> Competitiveness Score
                            </NavLink>
                            <NavLink to="/vendor/allocation" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📅</span> Combined Forecast
                            </NavLink>
                            <NavLink to="/vendor/capacity" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🛡️</span> Capacity Planning
                            </NavLink>
                            {isAdmin && (
                                <>
                                    <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Settings</div>
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
