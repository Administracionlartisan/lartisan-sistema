// Pruebas anti-regresión: cada una protege una corrección de la auditoría de
// octubre 2026. Si una falla, el mensaje explica qué se rompió y por qué importa.
// Antes de "arreglar" una de estas pruebas, leé AGENTS.md: casi siempre el
// problema está en el cambio, no en la prueba.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/page.tsx");
const outbox = read("app/modules/shared/operationalOutbox.ts");
const bootstrap = read("donweb-api/bootstrap.php");
const index = read("donweb-api/index.php");
const htaccess = read("donweb-api/.htaccess");
const phpFiles = readdirSync(new URL("../donweb-api/", import.meta.url)).filter((file) => file.endsWith(".php"));
const php = Object.fromEntries(phpFiles.map((file) => [file, read(`donweb-api/${file}`)]));

/** Lista separada por comas al primer nivel de paréntesis, desde la posición de "(". */
function topLevelList(source, openIndex) {
  let depth = 0, current = "", items = [], quote = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) { current += ch; if (ch === quote && source[i - 1] !== "\\") quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === "(") { depth++; if (depth === 1) continue; }
    if (ch === ")") { depth--; if (depth === 0) { items.push(current.trim()); return items; } }
    if (ch === "," && depth === 1) { items.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  return null;
}

test("SQL: cada INSERT tiene la misma cantidad de columnas que de valores", () => {
  // La preparación de facturas y de notas de crédito ARCA fallaba siempre por esto.
  const problems = [];
  for (const [file, source] of Object.entries(php)) {
    const pattern = /INSERT INTO\s+`?(\w+)`?\s*\(/g;
    for (let match; (match = pattern.exec(source));) {
      const columns = topLevelList(source, match.index + match[0].length - 1);
      const rest = source.slice(match.index + match[0].length - 1);
      const valuesAt = rest.search(/\)\s*VALUES\s*\(/i);
      if (!columns || valuesAt < 0) continue;
      const openValues = match.index + match[0].length - 1 + valuesAt + rest.slice(valuesAt).indexOf("(");
      const values = topLevelList(source, openValues);
      if (!values || values.some((value) => /^\$|implode|array_fill/.test(value))) continue;
      if (columns.length !== values.length) problems.push(`${file}: INSERT INTO ${match[1]} tiene ${columns.length} columnas y ${values.length} valores`);
    }
  }
  assert.deepEqual(problems, []);
});

test("Ventas: las escrituras interactivas no usan keepalive", () => {
  // El POST normal permite esperar y confirmar la respuesta. La cola IndexedDB
  // conserva el pendiente si se cierra el navegador o se pierde Internet.
  assert.match(page, /keepalive:\s*false/, "sendPendingWrite no debe usar keepalive en una operación interactiva");
  assert.doesNotMatch(page, /keepalive:\s*true/, "keepalive: true vuelve a romper el guardado en Chrome y Edge");
});

test("Ventas: la cola de pendientes usa IndexedDB, en orden y acumulando", () => {
  // localStorage (~5 MB) no alcanzaba para dos ventas sin conexión.
  assert.match(outbox, /indexedDB\.open/);
  assert.doesNotMatch(outbox, /localStorage\.setItem/, "no volver a guardar la cola en localStorage");
  assert.match(page, /drainingSites/, "el envío por local debe ser secuencial (drainSite)");
  assert.match(page, /for \(const local of outbox\.sites\(\)\) await drainSite\(local\)/, "los locales pendientes deben sincronizarse en secuencia");
  assert.match(page, /await outbox\.markSent\(local, write\.requestId\)/, "un envío despachado se reintenta con el mismo requestId");
});

test("Operaciones: el estado de cada local se compacta y lo recortado se archiva", () => {
  // Sin esto, cada local se bloquea al superar ~1.850 ventas (límite de 4 MB).
  assert.match(index, /compact_operational_state\(\$untrimmedState, \$config\)/);
  assert.match(index, /archive_removed_operational_items\(\$pdo, \$site/);
  assert.match(index, /compact_oversized_site_state\(\$pdo, \$config, \$site\)/);
});

test("Ventas: el servidor controla importes y cambios de comprobante", () => {
  assert.match(index, /validate_operational_sales\(\$previousState, \$untrimmedState/);
  assert.match(index, /enforce_invoice_type_changes\(\$pdo, \$user, \$previousState, \$state\)/);
});

test("Caja: el turno cerrado se envía como null y la apertura usa la fecha ISO", () => {
  // Con undefined, JSON omite el campo y el servidor dejaba el turno abierto: ningún cierre llegaba a reportes.
  assert.match(page, /activeShift: activeShiftBySite\[local\] \?\? null/);
  assert.match(bootstrap, /iso_datetime\(\$session\['openedAtISO'\] \?\? null\)/);
});

test("Relevos: las ventas y la caja del local se actualizan sin cambiar de usuario", () => {
  // La caja es del local, no de quien abrió la pantalla. Sin esta recarga la
  // responsable del segundo turno podía cerrar con una vista anterior.
  assert.match(page, /const refreshOperationalData = async \(\)/);
  assert.match(page, /Ventas y caja de \$\{site\} actualizadas/);
  assert.match(page, /window\.setInterval\([\s\S]*?loadOperationalData\(\)[\s\S]*?30_000/);
  assert.match(page, /Actualizar ventas y caja/);
});

test("Relevos: una cola bloqueada no oculta la caja vigente del local", () => {
  // El rechazo queda guardado para auditoría, pero una vendedora no puede ver
  // su estado local rechazado en lugar de la caja que otro turno abrió y la
  // API confirmó para el mismo local.
  assert.match(page, /const pendingSites = \(outbox\?\.sites\(\) \?\? \[\]\)\.filter\(\(local\) => \{/);
  assert.match(page, /queue\?\.writes\.length && !queue\.blocked/);
  assert.match(page, /Una cola bloqueada fue rechazada definitivamente/);
});

test("Relevos: una apertura local obsoleta no bloquea nuevas ventas", () => {
  assert.match(outbox, /function isOpeningSupersededByServer/);
  assert.match(outbox, /No admite[\s\S]*ventas, cobros, stock ni ningún otro movimiento/);
  assert.match(outbox, /discardSupersededOpening/);
  assert.match(outbox, /writes: queue\.writes\.slice\(1\), blocked: undefined/);
  assert.match(page, /Las ventas pendientes se enviarán ahora sin duplicarlas/);
  assert.match(page, /void drainSite\(local\)/);
});

test("Acceso: el relevo puede volver al inicio con el botón Cambiar usuario", () => {
  assert.match(page, /Cambiar usuario/);
  assert.match(page, /onClick=\{logout\}/);
  assert.match(page, /auth\/logout/);
});

test("Relevos: Cambiar usuario envía la cola antes de cerrar la sesión", () => {
  // La venta en viaje llegaba sin sesión (401) y quedaba en la cola de la
  // vendedora saliente: con otro usuario conectado nunca se enviaba.
  assert.match(page, /const logout = async \(\) => \{[\s\S]*?await flushPendingWrites\(\)[\s\S]*?auth\/logout/);
  assert.match(page, /const closeForInactivity = async \(\) => \{[\s\S]*?await flushPendingWrites\(\)[\s\S]*?auth\/logout/);
  // Pedir drenar un local ocupado espera ese envío en vez de volver al instante.
  assert.match(page, /const running = drainingSites\.current\.get\(local\);\s*if \(running\) return running;/);
  // Desde que se toca «Cambiar usuario» no se encola nada que quedaría sin sesión.
  assert.match(page, /const logout = async \(\) => \{[\s\S]*?loggingOutRef\.current = true;[\s\S]*?await flushPendingWrites\(\)/);
  assert.match(page, /operationalVersion === 0 \|\| loggingOutRef\.current\) return;/);
  // El motivo de una cola trabada no se pierde: otro local no lo borra y
  // una cola rechazada lo vuelve a mostrar tras recargar.
  assert.match(page, /if \(syncFailureSite\.current === local\) \{\s*syncFailureSite\.current = null;\s*setSyncFailure\(""\);/);
  assert.doesNotMatch(page, /result\.revision;\s*setSyncFailure\(""\);/);
  assert.match(page, /if \(write && queue\.blocked\) \{[\s\S]*?setSyncFailure\(`La API rechazó una operación de \$\{local\}: \$\{queue\.blocked\}`\);/);
  // Quien entra después no hereda la última acción ni el ticket de la sesión anterior.
  assert.match(page, /const logout = async \(\) => \{[\s\S]*?auth\/logout[\s\S]*?setOperationalVersion\(0\);[\s\S]*?setReceiptSale\(null\);[\s\S]*?setUser\(null\);/);
});

test("Límites: cada local recibe los suyos y la interfaz los combina", () => {
  assert.match(bootstrap, /\$ownLimits/, "operational_snapshot_for_user debe conservar los límites del propio local");
  assert.match(page, /setLimitsBySite\(\(current\) => \(\{ \.\.\.current, \.\.\.receivedLimits \}\)\)/);
});

test("Stock: aprobar un ajuste aplica la diferencia, no pisa el stock", () => {
  assert.match(page, /\(adjustment\.counted - adjustment\.theoretical\)/);
  assert.doesNotMatch(page, /\[adjustment\.productId\]: adjustment\.counted,/);
  assert.doesNotMatch(page, /Simular ingreso desde Central/, "botón de demostración que sumaba stock sin registro");
});

test("Hora: una sola zona horaria para PHP y MySQL", () => {
  // Sin esto, los códigos de recuperación valían 3 h en lugar de 15 min y las ventas nocturnas cambiaban de día.
  assert.match(bootstrap, /date_default_timezone_set\(/);
  assert.match(bootstrap, /SET time_zone = /);
  assert.match(bootstrap, /->setTimezone\(new DateTimeZone\(date_default_timezone_get\(\)\)\)/);
});

test("Seguridad: origen obligatorio y clave temporal en toda escritura", () => {
  assert.match(index, /in_array\(\$method, \['POST', 'PUT', 'PATCH', 'DELETE'\], true\)\s*&& !in_array\(\$_SERVER\['HTTP_ORIGIN'\]/);
  assert.match(index, /Primero debés cambiar la contraseña temporal\./);
  assert.match(bootstrap, /set_exception_handler\(/, "los errores no controlados deben responder JSON genérico");
});

test("Seguridad: el servidor web bloquea configuración y módulos internos", () => {
  assert.match(htaccess, /<FilesMatch "\^\(config\\\.local\\\.php\|config\\\.example\\\.php\|bootstrap\\\.php/);
  assert.match(htaccess, /Require all denied/);
  assert.ok(htaccess.includes("RewriteRule ^(.+)$ index.php?route=$1 [QSA,L]"));
});

test("Usuarios: editar sin permisos conserva los existentes", () => {
  // Bloquear o cambiar de local dejaba a la vendedora sin poder cobrar.
  assert.match(index, /: \$existing\['action_permissions'\];/);
  assert.match(index, /: \$existing\['report_permissions'\];/);
});

test("ARCA: una respuesta sin CAE legible no se marca como rechazada", () => {
  const wsfe = php["arca_wsfe.php"];
  assert.match(wsfe, /if \(\$result === 'R'\)/, "solo el rechazo explícito habilita reintentar");
  assert.match(wsfe, /ARCA respondió sin un CAE legible/);
});

test("MRP: la producción confirmada lee el último MRP verificado", () => {
  for (const [file, source] of Object.entries(php)) assert.doesNotMatch(source, /status='completed'/, `${file}: 'completed' no existe en mrp_sync_runs`);
});

test("Sync: nada dentro de la transacción de /sync emite DDL ni bloquea la ventana de prueba", () => {
  const testDate = php["test_operating_date.php"];
  const active = testDate.match(/function active_test_operating_date[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(active, /ensure_|CREATE TABLE|ALTER TABLE/, "un DDL dentro de /sync hace COMMIT implícito y libera el FOR UPDATE del local");
  assert.doesNotMatch(testDate, /UNIQUE KEY uq_test_operating_date_active/, "la clave única impedía desactivar la ventana por segunda vez");
  assert.match(testDate, /DROP INDEX uq_test_operating_date_active/, "las bases existentes deben perder la clave única");
});

test("Sync: un rechazo definitivo responde 422 para detener la cola, no 500", () => {
  assert.match(index, /\$error instanceof OperationalSyncRejected\)[\s\S]{0,300}, 422\);/);
  const check = php["test_operating_date.php"].match(/function check_test_operating_snapshot[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(check, /throw new (?!OperationalSyncRejected)/, "la ventana de prueba debe rechazar con OperationalSyncRejected");
  assert.match(php["attendance_presence.php"], /throw new OperationalSyncRejected\('La caja solo puede ser abierta/);
});

test("Sync: con copia base siempre se combina; reemplazar sacaba ventas de otro equipo del local", () => {
  assert.match(index, /elseif \(\$currentRow !== false && is_array\(\$baseState\)\) \{[\s\S]{0,700}merge_operational_snapshot\(\$baseState, \$previousState, \$authorizedIncoming\)/);
});

test("Sync: el requestId se busca después de bloquear el local", () => {
  const sync = index.slice(index.indexOf("$isSyncOperationWrite = "));
  assert.ok(sync.indexOf("FOR UPDATE") < sync.indexOf("FROM operation_requests WHERE request_id"), "dos envíos paralelos del mismo requestId deben esperar el bloqueo y recibir la confirmación del primero");
});

test("Caja: relevo acumulado aceptado y cierre obsoleto sin perder cobros", () => {
  const cash = php["attendance_presence.php"];
  assert.match(cash, /\$completedHandover = \$validOpening\(\) && shift_closed_in_snapshot/);
  assert.match(cash, /'Cierre de caja', 'Sobre enviado a Caja Mayor', 'Gastos declarados al cierre', 'Retiros declarados al cierre'/);
});

test("Registro técnico: los errores del servidor quedan visibles para Administración", () => {
  assert.match(index, /'system_error_log' => static fn \(\) => ensure_system_error_log_schema\(\$pdo\)/, "la tabla se crea en la migración inicial, nunca dentro de /sync");
  const helper = bootstrap.match(/function system_error\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(helper, /CREATE TABLE|ALTER TABLE|ensure_/, "system_error() puede correr dentro de la transacción de /sync");
  assert.match(index, /route === 'admin\/system-errors'\) \{\s*require_user\(\$pdo, \['administracion'\]\);/);
  const remaining = [...index.matchAll(/error_log\('([^']+)/g)].map((match) => match[1]);
  assert.deepEqual(remaining, ["LARTISAN API database initialization failed: ", "LARTISAN operation sync failure audit failed: "], "un error nuevo debe usar system_error() para que Administración lo vea");
  assert.match(page, /adminReport === "Errores" && <SystemErrorLog \/>/);
});
