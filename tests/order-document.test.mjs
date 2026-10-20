import assert from "node:assert/strict";
import test from "node:test";
import { orderDocumentHtml, orderDocumentLines } from "../app/modules/pedidos/orderDocument.ts";

const products = [{ id: 7, name: "Ravioles de ricota", detail: "Bandeja 500 g", category: "Ravioles", price: 1, code: "R7", barcode: "R7" }];
const request = { id: "a1b2c3d4-e5f6-4a3b-9c9d-111111111111", site: "Maure", requestedBy: "Supervisión", requestedAt: "14/10/2026, 10:00", notes: "Sin sustituciones", status: "Pendiente", lines: [{ productId: 7, quantity: 6, productName: "Ravioles de ricota", presentation: "Bandeja 500 g", category: "Ravioles", currentStockAtRequest: 2, idealStockAtRequest: 8 }] };

test("el PDF de pedido conserva la foto de stock ideal y actual", () => {
  const [line] = orderDocumentLines(request, products);
  assert.deepEqual(line, { productId: 7, productName: "Ravioles de ricota", presentation: "Bandeja 500 g", category: "Ravioles", currentStock: 2, idealStock: 8, quantity: 6 });
  const html = orderDocumentHtml(request, products);
  assert.match(html, /Stock ideal/);
  assert.match(html, /Ravioles de ricota/);
  assert.match(html, /Total solicitado: 6 unidades/);
});

test("el documento no permite inyectar HTML desde observaciones", () => {
  const html = orderDocumentHtml({ ...request, notes: "<script>alert(1)</script>" }, products);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
