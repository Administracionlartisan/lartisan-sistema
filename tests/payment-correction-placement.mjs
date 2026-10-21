import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const start = source.indexOf('Buscar venta, corregir medio de pago o anular');
const list = source.slice(start, source.indexOf('tab === "Caja"', start));
const saleCard = list.indexOf('.map((sale) => (');
const correction = list.indexOf('paymentCorrectionSaleId === sale.id');
const nextCardBoundary = list.indexOf('No hay ventas de este local que coincidan', saleCard);
assert.ok(saleCard >= 0 && correction > saleCard && correction < nextCardBoundary, 'El formulario debe estar dentro de la venta seleccionada');
assert.ok(list.includes('Confirmar corrección') && list.includes('setPaymentCorrectionSaleId(null)'));
console.log('✓ Formulario de corrección dentro de la venta seleccionada');
