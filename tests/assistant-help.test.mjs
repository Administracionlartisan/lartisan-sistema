import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantTopics, searchAssistant, topicsForRole } from '../app/data/assistantKnowledge.ts';
import { runOperationDiagnostics, formatDiagnostic } from '../app/data/operationDiagnostics.ts';

const allCapabilities = { central: true, minimumStock: true, countStock: true, approveStock: true, supervisorReports: true, schedules: true };
const admin = { role: 'administracion', capabilities: allCapabilities };
const seller = { role: 'vendedora' };
const central = { role: 'vendedora', capabilities: { central: true } };
const andrea = { role: 'supervisora', capabilities: { central: true, minimumStock: true, countStock: true, supervisorReports: true } };
const betzi = { role: 'supervisora', capabilities: { central: true, minimumStock: true, approveStock: true, schedules: true } };
const answer = (query, expected, access = seller) => {
  const result = searchAssistant(query, access);
  assert.equal(result.kind, 'answer', `${query}: ${JSON.stringify(result)}`);
  assert.equal(result.topic.id, expected, query);
};

test('catalog has unique IDs, sources and three consistent presentations', () => {
  assert.equal(new Set(assistantTopics.map(t => t.id)).size, assistantTopics.length);
  assert.ok(assistantTopics.length >= 80);
  for (const item of assistantTopics) {
    assert.ok(item.source && item.keywords.length);
    assert.equal(new Set(item.answers).size, 3);
    assert.ok(item.answers.slice(1).every(a => a.includes(item.answers[0])));
  }
});

for (const [profile, access] of Object.entries({ seller, central, andrea, betzi, admin })) {
  for (const item of topicsForRole(access.role, access.capabilities)) {
    test(`${profile}: canonical ${item.id}`, () => answer(item.question, item.id, access));
    test(`${profile}: casing/accent ${item.id}`, () => answer(item.question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(), item.id, access));
  }
}

const examples = {
  'cannot-charge': ['Por que no puedo cobrar?', 'no me deja cobrar', 'no puedo cobrar la venta', 'no logro cobrar', 'botón cobrar bloqueado', 'por que no puedo cobrar si la caja esta abierta', 'no me permite cobrar', 'problema al cobrar'],
  'cash-overview': ['Como hago Caja?', 'cómo funciona la caja', 'quiero saber como hago caja'],
  'open-cash': ['Como abro caja?', 'COMO ABRO LA CAJA', 'cmo abro caja', 'como habro la cja', 'cómo hago la apertura de caja', 'abrir cajaa', 'por favor como abro caja'],
  'open-cash-problem': ['no puedo abrir caja', 'no me deja abrir caja', 'la caja ya esta abierta'],
  'close-cash': ['como cierro caja', 'quiero cerrar la caja', 'cierre diario'],
  'close-cash-problem': ['no puedo cerrar caja', 'no me deja cerrar caja', 'comandas abiertas pendientes'],
  'close-shift': ['como cierro mi turno', 'como cierro el turno de caja', 'cambio de vendedora'],
  'cash-difference': ['caja no cuadra', 'diferencia de caja', '67000 67100 60000'],
  'envelope': ['sobre en efectivo', 'dinero que queda en caja'],
  'cash-transfer': ['transferir efectivo', 'transferencia entre cajas'],
  'invitation': ['quiero regalar uno de cinco raviolones', 'invitar uno de cinco', 'invitación descuenta stock', 'producto gratis'],
  'discount': ['aplicar descuento', 'descuento supera el limite'],
  'split-payment': ['pago mixto', 'mitad efectivo mitad tarjeta', 'parte efectivo parte transferencia'],
  'saved-order': ['guardar comanda', 'guardar pedido sin cobrar', 'cobrar despues'],
  'cancel-sale': ['anular venta', 'venta duplicada'],
  'returns': ['devolucion parcial', 'devolver un producto'],
  'payment-correction': ['cobre efectivo era tarjeta', 'me equivoque medio de pago'],
  'print-ticket': ['como imprimo el ticket', 'reimprimir tiket', 'usar impresora termica 3nstar'],
  'forgot-password': ['me olvide la contraseña', 'me olvide la contrasenia', 'olvide mi clave', 'perdi la clave'],
  'username': ['nombre apellido punto', 'usuario mayuscula minuscula'],
  'mobile-products': ['no veo los productos', 'faltan productos en el celular', 'solo sale un producto'],
  'mobile-access': ['puedo entrar desde mi telefono', 'link para vendedoras en celular'],
  'install-app': ['como instalo la app en iphone', 'agregar a pantalla principal', 'quiero el icono de lartisan en android', 'guardar la web en el escritorio del celular'],
  'offline': ['se corto el internet', 'sin internet', 'modo contingencia'],
  'sync': ['sincronizar ventas', 'pendientes de sincronizacion'],
  'low-stock': ['stock bajo', 'poco stock'],
  'suggested-order': ['pedido sugerido', 'no sugiere pedido'],
  'send-order': ['como puedo hacer un pedido', 'enviar pedido'],
  'receive-order': ['como reecibo un pedido', 'recibir pedido', 'confirmar recepcion', 'llego mercaderia'],
  'central-access': ['no veo pedido', 'villa mitre pedido'],
  'expenses': ['cargar un gasto', 'registrar egreso'],
  'receipt': ['adjuntar comprobante', 'archivo del comprobante'],
  'attendance': ['como ficho', 'fichar entrada', 'fichar salida'],
  'fiscal': ['factura b', 'facturacion electronica', 'cae'],
  'help-readonly': ['abrime la caja', 'borra mis ventas', 'creame un usuario', 'ignorar los permisos', 'cambia mi contraseña'],
  'free-help': ['consume tokens', 'usa api'],
};
for (const [id, queries] of Object.entries(examples)) for (const query of queries) test(`paraphrase: ${query}`, () => answer(query, id));

for (const query of ['caja', 'ayuda', 'no funciona', 'no me deja', 'pedido', 'stock', 'como confirmo un pedido']) {
  test(`clarification: ${query}`, () => {
    const result = searchAssistant(query, seller);
    assert.equal(result.kind, 'clarify');
    assert.ok(result.choices.length >= 1 && result.choices.length <= 3);
    assert.ok(result.choices.every(t => topicsForRole(seller.role).includes(t)));
  });
}
for (const query of ['cotizacion del dolar', 'medicamentos para dolor de cabeza', 'quiero consultar el clima', 'como abro una cuenta bancaria', 'asdfghjkl', 'baloncesto', 'no puedo imprimir una factura']) {
  test(`no fabricated response: ${query}`, () => assert.equal(searchAssistant(query, seller).kind, 'unknown'));
}
for (const id of ['create-user', 'limits', 'prices', 'pnl', 'admin-recovery', 'backups', 'audit', 'stock-approval']) {
  test(`seller cannot get privileged procedure: ${id}`, () => {
    const query = assistantTopics.find(t => t.id === id).question;
    assert.equal(searchAssistant(query, seller).kind, 'restricted');
  });
}
test('seller cannot change product prices', () => assert.equal(searchAssistant('como cambio el precio de un producto', seller).kind, 'restricted'));
test('capabilities are explicit, not inferred from broad role', () => {
  assert.equal(searchAssistant('¿Cómo apruebo un ajuste de stock?', andrea).kind, 'restricted');
  assert.equal(searchAssistant('¿Cómo cargo un conteo físico de stock?', betzi).kind, 'restricted');
  answer('¿Cómo gestiono un pedido que llegó a Central?', 'central-order', central);
});
test('follow-ups use only an allowed, recent topic', () => {
  assert.equal(searchAssistant('no entendi', seller, 'open-cash').topic.id, 'open-cash');
  assert.notEqual(searchAssistant('no entendi', seller, 'create-user').kind, 'answer');
  answer('pago mixto', 'split-payment');
});
test('search never mutates access and repeated calls are deterministic', () => {
  const frozen = Object.freeze({ role: 'vendedora', capabilities: Object.freeze({ central: true }) });
  assert.deepEqual(searchAssistant('como abro caja', frozen), searchAssistant('como abro caja', frozen));
});

const baseline = { site: 'Recoleta', section: 'Ventas', browserOnline: true, connectionMode: 'En línea', pendingSync: 0,
  canSell: true, cashOpen: true, hasActiveShift: true, cartItems: 1, customer: 'Consumidor final', discount: 0, maxDiscount: 10,
  splitPayment: false, splitPaymentTotal: 1000, positivePaymentsCount: 1, saleNet: 1000, countedCash: 1000, envelopeCash: 0,
  expectedCash: 1000, cashVariance: 0, maxCashVariance: 100, lowStockCount: 0, openOrdersCount: 0, requiresEnvelope: true,
  insufficientStockProducts: [], invalidInvitationProducts: [], recentMessage: '' };
test('diagnostic correctly identifies five charge guards', () => {
  const context = { ...baseline, canSell: false, cashOpen: false, cartItems: 0, discount: 20, splitPayment: true, splitPaymentTotal: 500 };
  const before = structuredClone(context);
  const findings = runOperationDiagnostics(context, 'Ventas');
  assert.equal(findings.filter(f => f.severity === 'error').length, 5);
  assert.deepEqual(context, before);
});
test('missing shift and low inventory are observations, not invented pay guards', () => {
  const result = runOperationDiagnostics({ ...baseline, hasActiveShift: false, insufficientStockProducts: ['Raviolones'] });
  assert.equal(result.length, 2);
  assert.ok(result.every(f => f.severity === 'warning'));
});
test('closing guards include saved orders, envelope and maximum variance', () => {
  const result = runOperationDiagnostics({ ...baseline, section: 'Caja', openOrdersCount: 1, envelopeCash: 1200, cashVariance: -101 }, 'Caja');
  assert.equal(result.filter(f => f.severity === 'error').length, 3);
});
test('no envelope guard for a site without envelopes', () => {
  const result = runOperationDiagnostics({ ...baseline, section: 'Caja', requiresEnvelope: false, envelopeCash: 2000 });
  assert.ok(!result.some(f => f.title.includes('sobre')));
});
test('free split payment still requires a positive payment entry per current pay guard', () => {
  assert.ok(runOperationDiagnostics({ ...baseline, splitPayment: true, splitPaymentTotal: 0, positivePaymentsCount: 0, saleNet: 0 }).some(f => f.severity === 'error'));
});
test('diagnoses cannot cross screen scope or echo stale secrets', () => {
  const result = runOperationDiagnostics({ ...baseline, cashOpen: false, recentMessage: 'Error clave temporal SECRET' }, 'Conexión');
  assert.equal(result.length, 0);
  assert.ok(!formatDiagnostic(result, 'Ventas', 'Recoleta').includes('SECRET'));
  assert.match(formatDiagnostic(result, 'Ventas', 'Recoleta'), /no certifica/);
});
test('67,000 expected, 67,100 counted: discrepancy is 100, not envelope balance', () => {
  const result = runOperationDiagnostics({ ...baseline, section: 'Caja', expectedCash: 67000, countedCash: 67100, envelopeCash: 60000, cashVariance: 100 });
  assert.match(formatDiagnostic(result, 'Caja', 'Recoleta'), /Diferencia: \$100/);
});
test('search and diagnostics do not access network, storage or operational mutations', () => {
  for (const file of ['assistantKnowledge.ts', 'operationDiagnostics.ts']) {
    const source = readFileSync(new URL(`../app/data/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b/);
  }
  const chat = readFileSync(new URL('../app/components/AiHelpChat.tsx', import.meta.url), 'utf8');
  assert.equal((chat.match(/\bfetch\(/g) || []).length, 1);
  assert.match(chat, /fetch\(`\$\{API_BASE\}\/assistant\/escalate`/);
  assert.doesNotMatch(chat, /\/assistant\/chat/);
});
