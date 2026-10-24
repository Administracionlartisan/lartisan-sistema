import assert from "node:assert/strict";
import test from "node:test";
import { buildThermalReceipt } from "../app/modules/ventas/thermalReceipt.ts";

test("el ticket discrimina la invitación con producto, cantidad e importe", () => {
  const raviolon = { id: 31, name: "Raviolón de calabaza", detail: "", category: "Pastas", price: 13_700, code: "RAV", barcode: "31" };
  const receipt = buildThermalReceipt({
    id: "sale-12345678",
    site: "Maure",
    createdAt: "24/10/2026, 12:00:00",
    createdAtISO: "2026-10-24T15:00:00.000Z",
    items: [raviolon, raviolon, raviolon],
    gross: 41_100,
    discount: 13_700,
    net: 27_400,
    method: "Tarjeta",
    invoiceType: "Ticket",
    customer: "Consumidor final",
    invitation: true,
    invitedQuantities: { 31: 1 },
    channel: "Mostrador",
    status: "activa",
  }, [{ method: "Tarjeta", amount: 27_400 }], "Vendedora");

  assert.match(receipt, /INVITACION: 1 x Raviolon de/);
  assert.match(receipt, /Bonificacion\s+-\$ 13\.700/);
  assert.match(receipt, /Invitaciones\s+-\$ 13\.700/);
  assert.match(receipt, /TOTAL\s+\$ 27\.400/);
});
