import React, { useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import restiqLogo from '../assets/restiq-logo.png';
import './Sidebar.css';

export default function Sidebar({ isOpen, onClose }) {
    const { displayName, vendorName, isSuperAdmin, isAdmin, logout } = useContext(UserContext);
    const navigate = useNavigate();

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
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Platform</div>
                            <NavLink to="/admin/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📊</span> Dashboard
                            </NavLink>
                            <NavLink to="/vendors" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏢</span> All Vendors
                            </NavLink>
                            <NavLink to="/vendors/add" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">➕</span> Add Vendor
                            </NavLink>
                            <NavLink to="/orders" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📦</span> Orders
                            </NavLink>
                        </div>
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Administration</div>
                            <NavLink to="/admin/items" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📋</span> All Items
                            </NavLink>
                            <NavLink to="/admin/requests" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">📩</span> Requests
                            </NavLink>
                            <NavLink to="/users" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">👥</span> User Management
                            </NavLink>
                            <NavLink to="/settings/permissions" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">⚙️</span> Role Permissions
                            </NavLink>

                            <NavLink to="/admin/invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🧾</span> Vendor Invoices
                            </NavLink>
                            <NavLink to="/admin/restaurants" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏪</span> All Restaurants
                            </NavLink>
                            <NavLink to="/admin/restaurant-invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🧾</span> Restaurant Invoices
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
                        </div>
                        <div className="sidebar-section">
                            <div className="sidebar-section-title">Vendor</div>
                            <NavLink to="/profile" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">🏢</span> Vendor Profile
                            </NavLink>
                            <NavLink to="/vendor/invoices" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                                <span className="link-icon">💳</span> My Invoices
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
