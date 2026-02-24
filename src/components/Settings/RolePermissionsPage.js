import React, { useState, useEffect, useContext } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import './RolePermissionsPage.css';

export default function RolePermissionsPage() {
    const { isSuperAdmin, isAdmin, vendorId } = useContext(UserContext);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const usersRef = collection(db, 'login');
            // Fetch users that belong to this vendor and have the standard 'user' role
            // SuperAdmins can fetch all 'user' roles, while vendor admins fetch only their own
            const q = (isSuperAdmin && !vendorId)
                ? query(usersRef, where('role', '==', 'user'))
                : query(usersRef, where('vendorId', '==', vendorId), where('role', '==', 'user'));

            const snap = await getDocs(q);
            const list = snap.docs.map(d => ({
                id: d.id,
                ...d.data(),
                permissions: d.data().permissions || {
                    canManageItems: false,
                    canManageOrders: false,
                    canEditProfile: false
                }
            }));

            // Sort alphabetically
            list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
            setUsers(list);
        } catch (err) {
            console.error("Error fetching users for permissions:", err);
            toast.error("Failed to load user permissions.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isAdmin && !isSuperAdmin) return;
        fetchUsers();
    }, [isAdmin, isSuperAdmin, vendorId]);

    const handleTogglePermission = async (userId, permissionKey, currentValue) => {
        try {
            // Optimistic UI update
            setUsers(prevUsers => prevUsers.map(u => {
                if (u.id === userId) {
                    return {
                        ...u,
                        permissions: {
                            ...u.permissions,
                            [permissionKey]: !currentValue
                        }
                    };
                }
                return u;
            }));

            // Firestore update
            const userRef = doc(db, 'login', userId);
            await updateDoc(userRef, {
                [`permissions.${permissionKey}`]: !currentValue
            });

            toast.success("Permissions updated successfully", { autoClose: 1500 });
        } catch (err) {
            console.error("Error updating permission:", err);
            toast.error("Failed to update permission");
            // Revert on failure
            fetchUsers();
        }
    };

    if (loading) {
        return (
            <div className="permissions-page">
                <div className="page-header">
                    <div>
                        <h1>Role Permissions</h1>
                        <p className="subtitle">Loading users...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!isAdmin && !isSuperAdmin) {
        return <div style={{ padding: 24 }}>You do not have access to this page.</div>;
    }

    return (
        <div className="permissions-page">
            <div className="page-header">
                <div>
                    <h1>Role Permissions</h1>
                    <p className="subtitle">Manage granular access controls for your standard users</p>
                </div>
            </div>

            <div className="permissions-list-container">
                <div className="orders-table-wrapper">
                    <table className="permissions-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th style={{ textAlign: 'center' }}>Manage Items<br /><small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>Add/Edit/Delete</small></th>
                                <th style={{ textAlign: 'center' }}>Manage Orders<br /><small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>Accept/Reject</small></th>
                                <th style={{ textAlign: 'center' }}>Edit Profile<br /><small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>Vendor Info</small></th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                                        No standard users found for this vendor.
                                    </td>
                                </tr>
                            ) : (
                                users.map(user => (
                                    <tr key={user.id}>
                                        <td>
                                            <div className="user-cell">
                                                <div className="user-avatar">
                                                    {(user.displayName || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <div className="user-details">
                                                    <span className="user-name">{user.displayName || 'Unnamed User'}</span>
                                                    <span className="user-email">{user.email || user.username || 'No email'}</span>
                                                    {isSuperAdmin && <span className="user-email" style={{ color: 'var(--primary)', marginTop: 2 }}>{user.vendorName}</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <label className="toggle-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={user.permissions.canManageItems}
                                                    onChange={() => handleTogglePermission(user.id, 'canManageItems', user.permissions.canManageItems)}
                                                />
                                                <span className="toggle-slider"></span>
                                            </label>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <label className="toggle-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={user.permissions.canManageOrders}
                                                    onChange={() => handleTogglePermission(user.id, 'canManageOrders', user.permissions.canManageOrders)}
                                                />
                                                <span className="toggle-slider"></span>
                                            </label>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <label className="toggle-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={user.permissions.canEditProfile}
                                                    onChange={() => handleTogglePermission(user.id, 'canEditProfile', user.permissions.canEditProfile)}
                                                />
                                                <span className="toggle-slider"></span>
                                            </label>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
