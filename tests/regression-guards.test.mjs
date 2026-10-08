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

test("Ventas: un keepalive solo para envíos chicos", () => {
  // Chrome y Edge descartan sin enviar un fetch keepalive de más de 64 KB: las ventas quedaban pendientes para siempre.
  assert.match(page, /keepalive: body\.length < 60_000/, "sendPendingWrite debe usar keepalive solo si el cuerpo es menor a 60 KB");
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
