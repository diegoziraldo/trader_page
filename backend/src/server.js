require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const alertsRoutes = require('./routes/alerts.routes');
const watchlistRoutes = require('./routes/watchlist.routes');
const checklistRoutes = require('./routes/checklist.routes');
const tradesRoutes = require('./routes/trades.routes');
const journalRoutes = require('./routes/journal.routes');

const app = express();
const PORT = process.env.PORT || 3001;

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Diagnóstico de conexión sin escribir datos en la tabla ping.
app.get('/api/db-check', (req, res, next) => {
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    res.json({ status: row?.ok === 1 ? 'db ok' : 'db error', driver: 'sqlite' });
  } catch (error) {
    next(error);
  }
});

app.use('/api/alerts', alertsRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/journal', journalRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', code: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[API] ${req.method} ${req.originalUrl}`, err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno',
    code: err.code || 'INTERNAL_ERROR',
  });
});

app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});
