require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const alertsRoutes = require('./routes/alerts.routes');
const watchlistRoutes = require('./routes/watchlist.routes');
const checklistRoutes = require('./routes/checklist.routes');
const tradesRoutes = require('./routes/trades.routes');
const journalRoutes = require('./routes/journal.routes');
const caucionesRoutes = require('./routes/cauciones.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// En producción, restringí el origen al dominio real del frontend
// (ej: https://tu-proyecto.pages.dev) seteando CORS_ORIGIN en las
// variables de entorno. Si no está seteada, se permite cualquier origen
// (útil en desarrollo local).
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// Confirma que el servidor esta vivo
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Confirma que la base de datos anda: cada GET inserta una fila y devuelve
// cuantas hay en total. Sirve solo para probar la conexion.
app.get('/api/db-check', (req, res) => {
  db.prepare('INSERT INTO ping DEFAULT VALUES').run();
  const { count } = db.prepare('SELECT COUNT(*) as count FROM ping').get();
  const last = db.prepare('SELECT * FROM ping ORDER BY id DESC LIMIT 5').all();
  res.json({ status: 'db ok', total_pings: count, last_pings: last });
});

app.use('/api/alerts', alertsRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/cauciones', caucionesRoutes);

app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});