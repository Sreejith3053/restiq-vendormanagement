/**
 * UploadDropzone.js
 * Drag-and-drop + click-to-browse file upload area.
 * Accepts .xlsx, .xls, .csv
 */
import React, { useRef, useState, useCallback } from 'react';

const ACCEPTED = '.xlsx,.xls,.csv';
const ACCEPTED_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'application/csv', ''];

export default function UploadDropzone({ onFileSelected, disabled = false }) {
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);

    const handleFile = useCallback((file) => {
        if (!file) return;
        setSelectedFile(file);
        onFileSelected(file);
    }, [onFileSelected]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    }, [disabled, handleFile]);

    const handleChange = (e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const handleRemove = (e) => {
        e.stopPropagation();
        setSelectedFile(null);
        onFileSelected(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const zone = {
        border: dragOver ? '2px dashed #38bdf8' : '2px dashed rgba(56,189,248,0.3)',
        borderRadius: 12,
        padding: '40px 24px',
        textAlign: 'center',
        background: dragOver ? 'rgba(56,189,248,0.08)' : 'rgba(56,189,248,0.03)',
        transition: 'all 0.2s ease',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
    };

    return (
        <div>
            <div
                style={zone}
                onClick={() => !disabled && !selectedFile && inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
            >
                {selectedFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 36 }}>📄</div>
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: '#f8fafc' }}>{selectedFile.name}</div>
                            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                                {(selectedFile.size / 1024).toFixed(1)} KB &nbsp;·&nbsp;
                                <span style={{ color: '#4ade80' }}>✓ File selected</span>
                            </div>
                        </div>
                        <button
                            onClick={handleRemove}
                            style={{ background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                        >
                            ✕ Remove
                        </button>
                    </div>
                ) : (
                    <div>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>📥</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginBottom: 8 }}>
                            {dragOver ? 'Drop file here' : 'Drag & Drop your Excel or CSV file'}
                        </div>
                        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
                            Supports <strong style={{ color: '#38bdf8' }}>.xlsx</strong>, <strong style={{ color: '#38bdf8' }}>.xls</strong>, <strong style={{ color: '#38bdf8' }}>.csv</strong> &nbsp;·&nbsp; Max 10MB
                        </div>
                        <button
                            style={{ background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8', borderRadius: 8, padding: '8px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                        >
                            Browse File
                        </button>
                    </div>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                style={{ display: 'none' }}
                onChange={handleChange}
            />
        </div>
    );
}
