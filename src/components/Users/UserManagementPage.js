// src/components/Users/UserManagementPage.js
import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc,
    deleteDoc,
    orderBy,
} from 'firebase/firestore';
import AddUserModal from './AddUserModal';
import { toast } from 'react-toastify';
import './UserManagement.css';

export default function UserManagementPage() {
    const { isSuperAdmin, vendorId } = useContext(UserContext);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('all');

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const baseRef = collection(db, 'login');
            let q;

            if (isSuperAdmin) {
                // Super admin sees all users
                q = query(baseRef, orderBy('displayName'));
            } else {
                // Vendor admin sees only their vendor's users
                q = query(baseRef, where('vendorId', '==', vendorId), orderBy('displayName'));
            }

            const snap = await getDocs(q);
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setUsers(list);
        } catch (err) {
            console.error('Error fetching users:', err);
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToggleActive = async (user) => {
        try {
            await updateDoc(doc(db, 'login', user.id), {
                active: !user.active,
            });
            toast.success(`${user.displayName} ${user.active ? 'disabled' : 'enabled'}`);
            fetchUsers();
        } catch (err) {
            console.error(err);
            toast.error('Failed to update user status');
        }
    };

    const handleDeleteUser = async (user) => {
        if (!window.confirm(`Delete user "${user.displayName}"? This cannot be undone.`)) return;
        try {
            await deleteDoc(doc(db, 'login', user.id));
            toast.success(`${user.displayName} deleted`);
            fetchUsers();
        } catch (err) {
            console.error(err);
            toast.error('Failed to delete user');
        }
    };

    // Filters
    const filtered = users.filter(u => {
        const matchesSearch =
            (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (u.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (u.email || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = filterRole === 'all' || u.role === filterRole;
        return matchesSearch && matchesRole;
    });

    const getRoleBadgeClass = (role) => {
        switch ((role || '').toLowerCase()) {
            case 'superadmin': return 'role-badge superadmin';
            case 'admin': return 'role-badge admin';
            case 'user': return 'role-badge user';
            default: return 'role-badge';
        }
    };

    const getRoleLabel = (role) => {
        switch ((role || '').toLowerCase()) {
            case 'superadmin': return 'Super Admin';
            case 'admin': return 'Vendor Admin';
            case 'user': return 'User';
            default: return role || 'Unknown';
        }
    };

    return (
        <div className="um-page">
            <div className="um-header">
                <div>
                    <h1 className="um-title">
                        {isSuperAdmin ? 'All Users' : 'Vendor Users'}
                    </h1>
                    <p className="um-subtitle">
                        {filtered.length} user{filtered.length !== 1 ? 's' : ''} found
                    </p>
                </div>
                <button className="um-add-btn" onClick={() => setShowAddModal(true)}>
                    ➕ Add User
                </button>
            </div>

            {/* Filters */}
            <div className="um-filters">
                <input
                    className="um-search"
                    type="text"
                    placeholder="Search by name, username, or email…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                    className="um-filter-select"
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                >
                    <option value="all">All Roles</option>
                    {isSuperAdmin && <option value="superadmin">Super Admin</option>}
                    <option value="admin">Vendor Admin</option>
                    <option value="user">User</option>
                </select>
            </div>

            {/* Users Table */}
            {loading ? (
                <div className="um-loading">Loading users…</div>
            ) : filtered.length === 0 ? (
                <div className="um-empty">No users found.</div>
            ) : (
                <div className="um-table-wrap">
                    <table className="um-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Role</th>
                                {isSuperAdmin && <th>Vendor</th>}
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((u) => (
                                <tr key={u.id} className={u.active === false ? 'row-disabled' : ''}>
                                    <td className="um-name-cell">
                                        <div className="um-user-avatar">
                                            {(u.displayName || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        {u.displayName || '—'}
                                    </td>
                                    <td>{u.username || '—'}</td>
                                    <td>{u.email || '—'}</td>
                                    <td>
                                        <span className={getRoleBadgeClass(u.role)}>
                                            {getRoleLabel(u.role)}
                                        </span>
                                    </td>
                                    {isSuperAdmin && (
                                        <td className="um-vendor-cell">{u.vendorName || '—'}</td>
                                    )}
                                    <td>
                                        <span className={`status-badge ${u.active !== false ? 'active' : 'inactive'}`}>
                                            {u.active !== false ? 'Active' : 'Disabled'}
                                        </span>
                                    </td>
                                    <td className="um-actions">
                                        <button
                                            className={`um-action-btn ${u.active !== false ? 'disable' : 'enable'}`}
                                            onClick={() => handleToggleActive(u)}
                                            title={u.active !== false ? 'Disable user' : 'Enable user'}
                                        >
                                            {u.active !== false ? '⏸' : '▶️'}
                                        </button>
                                        <button
                                            className="um-action-btn delete"
                                            onClick={() => handleDeleteUser(u)}
                                            title="Delete user"
                                        >
                                            🗑
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add User Modal */}
            {showAddModal && (
                <AddUserModal
                    onClose={() => setShowAddModal(false)}
                    onUserAdded={fetchUsers}
                />
            )}
        </div>
    );
}
