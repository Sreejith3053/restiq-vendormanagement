/**
 * SectionHeader.js — Reusable section header with icon, title, subtitle, and action.
 */
import React from 'react';

export default function SectionHeader({ icon, title, subtitle, action, count, style: extraStyle }) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            ...extraStyle,
        }}>
            <div>
                <h2 style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: '#f8fafc',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    {icon && <span style={{ fontSize: 22 }}>{icon}</span>}
                    {title}
                    {count !== undefined && (
                        <span style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#94a3b8',
                            background: 'rgba(255,255,255,0.05)',
                            padding: '2px 8px',
                            borderRadius: 12,
                            marginLeft: 4,
                        }}>
                            {count}
                        </span>
                    )}
                </h2>
                {subtitle && (
                    <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0', lineHeight: 1.4 }}>
                        {subtitle}
                    </p>
                )}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}
