import React, { useContext, useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import restiqLogo from '../assets/restiq-logo-sidebar.png';
import './Sidebar.css';

export default function Sidebar({ isOpen, onClose }) {
    const { displayName, vendorName, vendorId, isSuperAdmin, isAdmin, logout } = useContext(UserContext);
    const navigate = useNavigate();
    const [pendingDispatches, setPendingDispatches] = useState(0);

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
                    <>
                        {/* Home */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Home</div>
                            <NavLink to="/admin/forecast/control-tower" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🗼</span> Control Tower
                            </NavLink>
                        </div>

                        {/* Order Planning */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Order Planning</div>
                            <NavLink to="/admin/forecast/suggested-order-review" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📝</span> Suggested Orders
                            </NavLink>
                            <NavLink to="/admin/forecast/submitted-orders" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">✅</span> Submitted Orders
                            </NavLink>
                            <NavLink to="/admin/forecast/combined" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🛒</span> Combined Demand
                            </NavLink>
                        </div>

                        {/* Dispatch & Logistics */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Dispatch &amp; Logistics</div>
                            <NavLink to="/admin/forecast/vendors" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🚚</span> Vendor Dispatch
                            </NavLink>
                            <NavLink to="/admin/dispatch/confirmations" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📋</span> Dispatch Confirmations
                            </NavLink>
                            <NavLink to="/admin/dispatch/warehouse" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏭</span> Warehouse Pick List
                            </NavLink>
                            <NavLink to="/admin/dispatch/delivery" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📍</span> Delivery Status
                            </NavLink>
                            <NavLink to="/admin/dispatch/issues" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🚨</span> Issues &amp; Disputes
                            </NavLink>
                        </div>

                        {/* Vendors */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Vendors</div>
                            <NavLink to="/vendors" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏢</span> All Vendors
                            </NavLink>
                            <NavLink to="/vendors/add" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">➕</span> Add Vendor
                            </NavLink>
                            <NavLink to="/admin/invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🧾</span> Vendor Invoices
                            </NavLink>
                        </div>

                        {/* Restaurants */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Restaurants</div>
                            <NavLink to="/admin/restaurants" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏪</span> All Restaurants
                            </NavLink>
                            <NavLink to="/admin/restaurant-invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🧾</span> Restaurant Invoices
                            </NavLink>
                        </div>

                        {/* Catalog & Requests */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Catalog &amp; Requests</div>
                            <NavLink to="/admin/items" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📋</span> All Items
                            </NavLink>
                            <NavLink to="/admin/requests" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📩</span> Requests
                            </NavLink>
                            <NavLink to="/admin/marketplace-intelligence" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📊</span> Marketplace Intelligence
                            </NavLink>
                            <NavLink to="/admin/vendor-competitiveness" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏆</span> Vendor Competitiveness
                            </NavLink>
                            <NavLink to="/admin/vendor-allocation" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📦</span> Vendor Allocation
                            </NavLink>
                            <NavLink to="/admin/supply-capacity" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🛡️</span> Supply Capacity
                            </NavLink>
                        </div>

                        {/* Administration */}
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Administration</div>
                            <NavLink to="/users" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">👥</span> User Management
                            </NavLink>
                            <NavLink to="/settings/permissions" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">⚙️</span> Role Permissions
                            </NavLink>
                        </div>
                    </>
                ) : (
                    <>
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
                            <NavLink to="/orders" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📦</span> Orders
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
                                <span className="link-icon">📦</span> Expected Allocation
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
                    </>
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
