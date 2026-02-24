import React, { useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import './TopBar.css';

const routeTitles = {
    '/': 'Dashboard',
    '/vendors': 'Vendors',
    '/vendors/add': 'Add Vendor',
    '/items': 'Item Catalog',
    '/users': 'User Management',
    '/profile': 'Vendor Profile',
};

export default function TopBar({ onMenuClick }) {
    const location = useLocation();
    const { isSuperAdmin, vendorName } = useContext(UserContext);

    // Resolve breadcrumb title
    let title = routeTitles[location.pathname] || '';
    if (!title && location.pathname.startsWith('/vendors/')) {
        title = 'Vendor Details';
    }

    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

    return (
        <div className="topbar-container">
            <div className="topbar-left">
                <button className="topbar-hamburger" onClick={onMenuClick} aria-label="Open menu">
                    ☰
                </button>
                <span className="topbar-breadcrumb">{title}</span>
            </div>
            <div className="topbar-right">
                {/* Vendor / role badge */}
                <span className="topbar-badge">
                    {isSuperAdmin ? '🔑 Platform Admin' : `🏢 ${vendorName || 'Vendor'}`}
                </span>
                <span className="topbar-date">{today}</span>
            </div>
        </div>
    );
}
