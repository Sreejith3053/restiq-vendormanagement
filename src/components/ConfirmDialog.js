// src/components/ConfirmDialog.js
import React, { useEffect } from 'react';

/**
 * Reusable in-app confirmation dialog.
 *
 * Props:
 *   open        – boolean, whether the dialog is visible
 *   title       – heading text
 *   message     – body / description (string or JSX)
 *   icon        – optional emoji / icon for the header
 *   confirmText – label for the confirm button (default "Confirm")
 *   cancelText  – label for the cancel button  (default "Cancel")
 *   variant     – "danger" | "warning" | "primary" (controls confirm button style)
 *   loading     – if true, shows a spinner state on the confirm button
 *   onConfirm   – callback when user confirms
 *   onCancel    – callback when user cancels / clicks backdrop
 */
export default function ConfirmDialog({
    open,
    title = 'Are you sure?',
    message = '',
    icon = '⚠️',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',       // danger | warning | primary
    loading = false,
    onConfirm,
    onCancel,
}) {
    // Close on Escape key
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === 'Escape') onCancel?.(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onCancel]);

    // Lock body scroll while open
    useEffect(() => {
        if (open) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    if (!open) return null;

    const btnClass = variant === 'primary' ? 'ui-btn primary' :
        variant === 'warning' ? 'ui-btn amber-btn' :
            'ui-btn danger';

    const accentColor = variant === 'danger' ? '#ff6b6b' :
        variant === 'warning' ? '#f59e0b' :
            '#4dabf7';

    return (
        <div className="confirm-dialog-backdrop" onClick={onCancel}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                {/* Icon */}
                <div className="confirm-dialog__icon" style={{ background: `${accentColor}18` }}>
                    <span>{icon}</span>
                </div>

                {/* Title */}
                <h3 className="confirm-dialog__title">{title}</h3>

                {/* Message */}
                {message && (
                    <p className="confirm-dialog__message">{message}</p>
                )}

                {/* Actions */}
                <div className="confirm-dialog__actions">
                    <button
                        className="ui-btn ghost"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        {cancelText}
                    </button>
                    <button
                        className={btnClass}
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {loading ? 'Processing…' : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
