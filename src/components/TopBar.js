import React, { useContext, useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
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
    const navigate = useNavigate();
    const { isSuperAdmin, vendorName, vendorId } = useContext(UserContext);

    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        if (showDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDropdown]);

    useEffect(() => {
        const role = isSuperAdmin ? 'ADMIN' : 'VENDOR';
        if (role === 'VENDOR' && !vendorId) return;

        let q;
        if (role === 'ADMIN') {
            q = query(
                collection(db, 'notifications'),
                where('role', '==', 'ADMIN'),
                orderBy('createdAt', 'desc'),
                limit(10)
            );
        } else {
            q = query(
                collection(db, 'notifications'),
                where('role', '==', 'VENDOR'),
                where('vendorId', '==', vendorId),
                orderBy('createdAt', 'desc'),
                limit(10)
            );
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setNotifications(notifs);
            setUnreadCount(notifs.filter(n => !n.isRead).length);
        });

        return () => unsubscribe();
    }, [isSuperAdmin, vendorId]);

    const handleMarkAsRead = async (notif) => {
        if (!notif.isRead) {
            try {
                await updateDoc(doc(db, 'notifications', notif.id), { isRead: true });
            } catch (err) {
                console.error("Failed to mark as read:", err);
            }
        }
        setShowDropdown(false);
        // Navigate based on type if needed. For now, just navigate to Orders page.
        if (notif.orderId) {
            navigate(`/orders?orderId=${notif.orderId}&search=${notif.orderId.slice(-8).toUpperCase()}`);
        }
    };

    const handleMarkAllRead = async () => {
        const unread = notifications.filter(n => !n.isRead);
        if (unread.length === 0) return;

        try {
            const batch = writeBatch(db);
            unread.forEach(n => {
                batch.update(doc(db, 'notifications', n.id), { isRead: true });
            });
            await batch.commit();
        } catch (err) {
            console.error("Failed to mark all as read:", err);
        }
    };

    const formatTimeAgo = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return "Just now";
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + "y ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + "mo ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + "d ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + "h ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + "m ago";
        return Math.floor(seconds) + "s ago";
    };

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
                {/* Notification Bell with Dropdown */}
                <div className="topbar-bell" ref={dropdownRef} onClick={() => setShowDropdown(!showDropdown)}>
                    🔔
                    {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}

                    {showDropdown && (
                        <div className="notif-dropdown" onClick={e => e.stopPropagation()}>
                            <div className="notif-header">
                                <h4>Notifications</h4>
                                {unreadCount > 0 && (
                                    <button onClick={handleMarkAllRead}>Mark all read</button>
                                )}
                            </div>
                            <div className="notif-list">
                                {notifications.length === 0 ? (
                                    <div className="notif-empty">No notifications yet.</div>
                                ) : (
                                    notifications.map(notif => (
                                        <div
                                            key={notif.id}
                                            className={`notif-item ${!notif.isRead ? 'unread' : ''}`}
                                            onClick={() => handleMarkAsRead(notif)}
                                        >
                                            {!notif.isRead && <div className="notif-dot"></div>}
                                            <div className="notif-content">
                                                <div className="notif-title">{notif.title}</div>
                                                <div className="notif-message">{notif.message}</div>
                                                <div className="notif-time">{formatTimeAgo(notif.createdAt)}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Vendor / role badge */}
                <span className="topbar-badge">
                    {isSuperAdmin ? '🔑 Platform Admin' : `🏢 ${vendorName || 'Vendor'}`}
                </span>
                <span className="topbar-date">{today}</span>
            </div>
        </div>
    );
}
