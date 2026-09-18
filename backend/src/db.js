const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'schema.sql');
const configuredPath = process.env.DB_PATH;
const DB_PATH = configuredPath
  ? path.resolve(process.cwd(), configuredPath)
  : path.join(__dirname, '..', 'data', 'dashboard.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// PRAGMAs antes de crear tablas: esto asegura que ON DELETE CASCADE esté
// activo desde la primera operación que modifica datos relacionados.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Un único schema es la fuente de verdad tanto para SQLite local como para D1.
// Esto evita que una tabla exista en un entorno y no en el otro.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Compatibilidad con bases SQLite antiguas creadas antes de ccl/ratio.
// Las columnas nuevas ya forman parte del schema actual, por lo que estos
// ALTER TABLE solo se ejecutan cuando una instalación vieja todavía no las tiene.
const tradesColumns = db.prepare('PRAGMA table_info(trades)').all().map((column) => column.name);
if (!tradesColumns.includes('ccl')) db.exec('ALTER TABLE trades ADD COLUMN ccl REAL;');
if (!tradesColumns.includes('ratio')) db.exec('ALTER TABLE trades ADD COLUMN ratio REAL NOT NULL DEFAULT 1;');

module.exports = db;
