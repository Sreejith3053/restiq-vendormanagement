// server.js — Express API server for Vendor Management
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vendor-management-api' });
});

// In production, serve the React build
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'build')));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`🚀 Vendor Management API running on port ${PORT}`);
});
