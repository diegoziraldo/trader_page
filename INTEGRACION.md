# STRATEGY LAB — guía de integración

## Qué encontré en tu proyecto (FASE 1)
- **Frontend:** Vue 3 + Vite, sin vue-router ni Pinia; las secciones son modales abiertos desde `QuickLinks`. Ya usás `chart.js`.
- **Backend activo:** Cloudflare Pages Functions + Hono + **D1** (`functions/`). La carpeta `backend/` (Express + better-sqlite3) es la versión vieja y **este módulo no la cubre**.
- **Convenciones respetadas:** errores `{status, message}`, métricas derivadas calculadas al leer (como `journal.js`), migraciones SQL idempotentes, variables CSS de `style.css`.

## Instalación (4 pasos)
1. Copiá las carpetas de este paquete a la raíz del repo (no pisan ningún archivo existente).
2. Aplicá el parche (toca solo 4 archivos, ~25 líneas): `git apply patches/strategy-lab-integration.patch`
3. Migración (no toca tablas existentes, se puede repetir):
   `npx wrangler d1 execute DB --local --file=./migrations/004_strategy_lab.sql` (y `--remote` en producción).
4. `npm run pages:dev` + `npm run dev` → botón **🧪 Strategy Lab** en la barra de accesos.

## Tests (opcional)
`npm i -D vitest happy-dom @vue/test-utils` → `node --test tests/*.test.mjs` (37 tests de cálculo, estadísticas y backend sobre SQLite real) y `npx vitest run tests/smoke.test.js` (UI completa contra el backend).

## Decisiones que conviene que conozcas
- **Base de cálculo R / % / $:** las métricas se calculan sobre una base elegida (default R). Operaciones sin valor en esa base se excluyen y se informa cuántas. Mezclar ARS y USD en `$` no tiene sentido; por eso R es la base comparable.
- **R:** neto de comisiones si hay stop + cantidad; bruto si falta cantidad; sin stop ni riesgo → sin R (nunca se inventa).
- **Win rate** incluye breakeven en el denominador; **breakeven** = |R| < 0.05. **Rachas:** el breakeven las corta. **Drawdown:** suma simple en orden de cierre.
- **Versionado:** una versión con operaciones nunca se modifica; cambiar reglas crea versión nueva. Si la versión vigente **no tiene operaciones**, se corrige en el lugar (evita decenas de versiones de borrador); hay casilla "Forzar versión nueva". Nombre, descripción, categoría, notas y estado no versionan.
- **Estrategia/versión de una operación son inmutables** (para editarlas: eliminar y recargar). Una estrategia con operaciones no se elimina: se archiva.
- **Duplicados:** índice único por estrategia + tipo + activo + temporalidad + dirección + fecha + hora + precio de entrada.
- **Capturas:** D1 no es un almacén de archivos y no hay R2 configurado, así que se guardan reducidas (~1 MB, máx. 3 por operación) en `trade_attachments`. Si agregás R2 solo cambia esa tabla.
- **Sin fallback a localStorage** a propósito (pediste persistencia real en SQLite).
- Filtros y estadísticas se calculan en el navegador sobre todas las operaciones; sobra para miles de registros.
- **Muestra:** insuficiente < 10, orientativa 10–29, confiable ≥ 30; se muestra `n` en todas partes e intervalo de confianza de Wilson del win rate.

## No verificado
No pude abrirlo en un navegador real ni correr D1/wrangler: validé contra SQLite con un shim de D1 y un DOM simulado. Conviene una pasada visual y probar la migración en tu D1 local antes de producción.
