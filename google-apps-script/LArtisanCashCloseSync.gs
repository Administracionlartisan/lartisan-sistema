/**
 * L'ARTISAN · sincronización segura de cierres diarios
 *
 * Instalación:
 * 1. El dueño de las planillas crea un proyecto en script.google.com.
 * 2. Pega este archivo completo.
 * 3. En Configuración del proyecto > Propiedades del script agrega
 *    LARTISAN_SYNC_SECRET con una clave aleatoria de 32+ caracteres.
 * 4. Implementar > Nueva implementación > Aplicación web.
 *    Ejecutar como: Yo. Acceso: Cualquier persona.
 * 5. Entrega la URL /exec y la misma clave al administrador del servidor,
 *    quien las carga en lartisan-cash-sheet-config.php fuera de public_html.
 *
 * Nunca se crea una fila ni se cambia una fórmula. Una reapertura del mismo
 * día puede sustituir exclusivamente los valores que esta integración había
 * escrito antes y que siguen intactos; no sobrescribe cambios manuales.
 * Novo Pacheco queda intencionalmente fuera de esta configuración.
 */

const LARTISAN_LOCATIONS = {
  'Recoleta': {
    spreadsheetId: '131eexo3o0ALWmrOhu0HfUnTLTVH33aHTGQ2sEMlwHtk', sheet: 'INGRESOS', headerRow: 5,
    fields: { total: 'FACT TOTAL', tickets: 'Tickets', discounts: 'DESCUENTOS' },
    payments: { 'Efectivo': 'EFECT', 'Tarjeta': 'TRJE', 'Open Pay': 'Open Pay', 'Mercado Pago / QR': 'MP/QR', 'Banco Nación': 'Banco Nación', 'Banco Provincia': 'Banco Provincia', 'Banco Galicia': 'Banco Galicia', 'Transferencia': 'TRANSFERENCIA', 'MP Delivery': 'MP Delivery', 'Pedidos Ya Efectivo': 'PEDIDOS YA EFECTIVO', 'Pedidos Ya': 'PEDIDOS YA', 'Rappi': 'RAPPI' },
  },
  'Villa Mitre': {
    spreadsheetId: '1Tkd2Mhe28OsCzOl9-TAEEFyFAczFrCbe3b08Vf2oF2k', sheet: 'INGRESOS', headerRow: 5,
    fields: { total: 'FACT TOTAL', tickets: 'Tickets', discounts: 'DESCUENTOS' },
    payments: { 'Efectivo': 'EFECT', 'Tarjeta': 'TRJE', 'Clover': 'Clover', 'Banco Frances': 'Banco Frances', 'Banco Provincia': 'banco provincia', 'QR Galicia': 'QR GALICIA', 'QR Banco Nación': 'QR BANCO NACION', 'Mercado Pago / QR': 'MP/QR', 'Transferencia': 'Transferencia', 'MP Delivery': 'MP DELIVERY', 'Pedidos Ya Efectivo': 'Pedidos Ya Efectivo', 'Pedidos Ya Online': 'Pedidos Ya online', 'Rappi': 'RAPPI' },
  },
  'Congreso': {
    spreadsheetId: '14BEXikqLBuiGeBKyIqwSRkCRAFfopPYM7ZhnjKdrPBk', sheet: 'ingresos', headerRow: 5,
    fields: { total: 'FACT TOTAL', tickets: 'Tickets', discounts: 'DESCUENTOS' },
    payments: { 'Efectivo': 'EFECT', 'Tarjeta': 'TRJE', 'Clover': 'Clover', 'Open Pay': 'Open Pay( Banco Frances)', 'Banco Provincia': 'BANCO PROVINCIA', 'BNA + QR': 'BNA+QR', 'QR Galicia': 'QR Galicia', 'Mercado Pago / QR': 'MP', 'Transferencia': 'TRANSFERENCIA', 'MP Delivery': 'MP DELIVERY', 'Pedidos Ya Tarjeta': 'PEDIDOS YA tarjeta', 'Pedidos Ya Efectivo': 'Pedidos Ya Efectivo', 'Rappi': 'RAPPI' },
  },
  'Maure': {
    spreadsheetId: '10RKMEItTwD1Dw_T671cLT1QcS1qCUvm1ZhcjlsoYGU0', sheet: 'INGRESOS DIARIOS', headerRow: 5,
    fields: { total: 'FACT TOTAL', tickets: 'Tickets', discounts: 'DESCUENTOS' },
    payments: { 'Efectivo': 'EFECT', 'Tarjeta': 'TRJE', 'Clover': 'Clover', 'Open Pay': 'Open Pay(Banco Frances)', 'Banco Provincia': 'BANCO PROVINCIA', 'BNA + QR': 'BNA+QR', 'QR Galicia': 'GALICIA PROMO', 'Mercado Pago / QR': 'MP PROMOS', 'Transferencia': 'TRANSFERENCIA', 'MP Delivery': 'MP DELIVERY', 'Pedidos Ya Tarjeta': 'PEDIDOS YA tarjeta', 'Pedidos Ya Efectivo': 'Pedidos Ya Efectivo', 'Rappi': 'RAPPI' },
  },
};

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const signatureV2 = String(request.signatureV2 || '');
    const canonicalB64 = String(request.canonicalB64 || '');
    const canonical = String(request.canonical || '');
    delete request.signatureV2;
    delete request.canonicalB64;
    delete request.canonical;
    const signedPayload = {
      version: request.version, closeId: request.closeId, site: request.site,
      businessDate: request.businessDate, payments: request.payments, metrics: request.metrics,
      kind: request.kind, adjustmentId: request.adjustmentId, saleId: request.saleId,
      amount: request.amount, paymentMethod: request.paymentMethod, reason: request.reason,
      auditReference: request.auditReference,
      replaceDaily: request.replaceDaily,
    };
    const secret = PropertiesService.getScriptProperties().getProperty('LARTISAN_SYNC_SECRET');
    let decoded = '';
    try { decoded = Utilities.newBlob(Utilities.base64Decode(canonicalB64)).getDataAsString('UTF-8'); } catch (_) {}
    if (!secret || !canonicalB64 || decoded !== canonical || signatureV2 !== hmacHex_(canonicalB64, secret)) throw new Error('Firma de cierre no válida.');
    if (JSON.stringify(JSON.parse(canonical || '{}')) !== JSON.stringify(signedPayload)) throw new Error('El cierre firmado no coincide con los datos recibidos.');
    if (request.version !== 1 || !/^[a-f0-9-]{36}$/i.test(String(request.closeId || ''))) throw new Error('Solicitud de cierre inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(request.businessDate || ''))) throw new Error('Fecha de cierre inválida.');
    const location = LARTISAN_LOCATIONS[request.site];
    if (!location) throw new Error('El local no está habilitado para esta integración.');
    const result = request.kind === 'post_close_cancellation_adjustment' ? syncAdjustment_(location, request) : syncClose_(location, request);
    return json_({ ok: true, ...result });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

// El histórico de ingresos nunca se toca: la compensación vive en una pestaña
// separada y su propiedad estable sobrevive a reintentos simultáneos.
function syncAdjustment_(location, request) {
  if (!/^[a-f0-9-]{36}$/i.test(String(request.adjustmentId || '')) || !/^[a-f0-9-]{36}$/i.test(String(request.saleId || ''))) throw new Error('Ajuste inválido.');
  if (!(Number(request.amount) > 0) || !String(request.paymentMethod || '').trim() || !String(request.reason || '').trim() || !String(request.auditReference || '').trim()) throw new Error('Datos de ajuste incompletos.');
  const store = PropertiesService.getScriptProperties();
  const key = 'LARTISAN_ADJUSTMENT_' + request.adjustmentId;
  const prior = store.getProperty(key);
  if (prior) return JSON.parse(prior);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = store.getProperty(key);
    if (again) return JSON.parse(again);
    const book = SpreadsheetApp.openById(location.spreadsheetId);
    const name = 'AJUSTES SISTEMA';
    let sheet = book.getSheetByName(name);
    if (!sheet) {
      sheet = book.insertSheet(name);
      sheet.appendRow(['FECHA','LOCAL','IMPORTE','MEDIO','MOTIVO','VENTA_ID','CIERRE_ID','AJUSTE_ID','REFERENCIA_AUDITORIA']);
    }
    sheet.appendRow([
      request.businessDate, request.site, -Math.abs(Number(request.amount)), request.paymentMethod,
      request.reason, request.saleId, request.closeId, request.adjustmentId, request.auditReference,
    ]);
    const result = { alreadySynced: false, sheet: name, row: sheet.getLastRow(), adjustmentId: request.adjustmentId };
    store.setProperty(key, JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function syncClose_(location, request) {
  const store = PropertiesService.getScriptProperties();
  const idempotencyKey = 'LARTISAN_CLOSE_' + request.closeId;
  const prior = store.getProperty(idempotencyKey);
  if (prior && !request.replaceDaily) return JSON.parse(prior);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = store.getProperty(idempotencyKey);
    if (again && !request.replaceDaily) return JSON.parse(again);
    const spreadsheet = SpreadsheetApp.openById(location.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(location.sheet);
    if (!sheet) throw new Error('No se encontró la pestaña configurada.');
    const width = Math.max(1, sheet.getLastColumn());
    const headers = sheet.getRange(location.headerRow, 1, 1, width).getDisplayValues()[0];
    const index = {};
    headers.forEach((header, column) => { const key = normalize_(header); if (key && index[key] === undefined) index[key] = column; });
    const dateColumn = index[normalize_('FECHA')];
    if (dateColumn === undefined) throw new Error('No se encontró el encabezado FECHA.');
    const firstDataRow = location.headerRow + 1;
    const lastRow = sheet.getLastRow();
    if (lastRow < firstDataRow) throw new Error('No existe una fila para la fecha del cierre; no se agregó una fila nueva.');
    const dateValues = sheet.getRange(firstDataRow, dateColumn + 1, lastRow - location.headerRow, 1).getValues();
    const offset = dateValues.findIndex(row => dateMatches_(row[0], request.businessDate));
    if (offset < 0) throw new Error('No existe una fila para la fecha del cierre; no se agregó una fila nueva.');
    const row = firstDataRow + offset;
    const values = sheet.getRange(row, 1, 1, width).getDisplayValues()[0];
    const formulas = sheet.getRange(row, 1, 1, width).getFormulas()[0];
    const writes = {};
    Object.keys(location.fields).forEach(metric => {
      const column = index[normalize_(location.fields[metric])];
      if (column !== undefined) writes[column] = Number((request.metrics || {})[metric] || 0);
    });
    Object.keys(request.payments || {}).forEach(method => {
      const heading = location.payments[method];
      if (!heading) return;
      const column = index[normalize_(heading)];
      if (column === undefined) throw new Error('No se encontró el encabezado configurado para ' + method + '.');
      writes[column] = Number(request.payments[method] || 0);
    });
    if (!Object.keys(writes).length) throw new Error('No hay campos válidos para actualizar.');
    const fields = {};
    const previous = prior ? JSON.parse(prior) : null;
    Object.keys(writes).forEach(key => {
      const column = Number(key), next = writes[column], current = numeric_(values[column]);
      if (String(formulas[column] || '').startsWith('=')) throw new Error('La columna ' + headers[column] + ' contiene una fórmula y no se reemplazó.');
      const label = headers[column] || ('Columna ' + (column + 1));
      const priorValue = previous && previous.fields ? previous.fields[label] : undefined;
      // Una reapertura solo puede sustituir exactamente el valor que este
      // sistema registró para ese cierre. Si una persona lo editó en Drive,
      // se detiene para que Administración lo concilie conscientemente.
      if (request.replaceDaily && priorValue !== undefined && Math.abs(current - Number(priorValue)) > 0.01) throw new Error('La columna ' + label + ' fue modificada manualmente; no se sobrescribió.');
      if (!request.replaceDaily && String(values[column] || '').trim() && Math.abs(current) > 0.01 && Math.abs(current - next) > 0.01) throw new Error('La columna ' + label + ' ya tiene un valor distinto; no se sobrescribió.');
      sheet.getRange(row, column + 1).setValue(next);
      fields[label] = next;
    });
    const result = { alreadySynced: false, row: row, sheet: location.sheet, fields: fields };
    store.setProperty(idempotencyKey, JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function hmacHex_(text, secret) { return Utilities.computeHmacSha256Signature(text, secret).map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join(''); }
function normalize_(value) { return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
function dateMatches_(value, expected) { if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return Utilities.formatDate(value, 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd') === expected; const text = String(value || '').trim(); const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/); if (match) return [match[3].length === 2 ? '20' + match[3] : match[3], ('0' + match[2]).slice(-2), ('0' + match[1]).slice(-2)].join('-') === expected; return text === expected; }
function numeric_(value) { let text = String(value || '').replace(/[^0-9,.-]/g, ''); if (text.indexOf(',') >= 0 && text.indexOf('.') >= 0) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''); else text = text.replace(',', '.'); const number = Number(text); return isFinite(number) ? number : 0; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
