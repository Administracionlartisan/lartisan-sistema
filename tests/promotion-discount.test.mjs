import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promotionDiscount } from '../app/modules/promotions/calculate.ts';

const cart = [{ id: 1, price: 1000 }, { id: 1, price: 1000 }, { id: 2, price: 2000 }];

test('descuento en toda la venta y en productos seleccionados', () => {
  assert.equal(promotionDiscount(cart, {}, null, 15), 600);
  assert.equal(promotionDiscount(cart, {}, [1], 15), 300);
  assert.equal(promotionDiscount(cart, {}, [3], 15), 0);
});

test('las unidades invitadas no reciben un segundo descuento', () => {
  assert.equal(promotionDiscount(cart, { 1: 1 }, [1], 15), 150);
  assert.equal(promotionDiscount(cart, { 1: 9 }, [1], 15), 0);
});

test('redondea a pesos y rechaza porcentajes y precios inválidos', () => {
  assert.equal(promotionDiscount([{ id: 1, price: 99 }], {}, null, 15), 15);
  assert.throws(() => promotionDiscount(cart, {}, null, 101));
  assert.throws(() => promotionDiscount(cart, {}, null, -1));
  assert.throws(() => promotionDiscount([{ id: 1, price: -1 }], {}, null, 15));
});
