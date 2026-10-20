import assert from "node:assert/strict";
import test from "node:test";
import { customerHistory, hasDuplicateDocument, normalizeDocument, validateCustomerDraft } from "../app/modules/clientes/customerModel.ts";

const draft = { id: "", name: "Cliente de prueba", documentType: "DNI", documentNumber: "12.345.678", email: "cliente@example.com", phone: "", address: "", consentPromotions: false };
const customer = { ...draft, id: "customer-1", site: "Recoleta", documentNumber: "12345678", createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z", createdBy: "Prueba", active: true };

test("normaliza y valida documentos de clientes", () => { assert.equal(normalizeDocument("12.345.678"), "12345678"); assert.equal(validateCustomerDraft(draft), null); assert.match(validateCustomerDraft({ ...draft, name: "x" }) || "", /3 caracteres/); assert.match(validateCustomerDraft({ ...draft, documentType: "CUIT", documentNumber: "20-1" }) || "", /11 dígitos/); });
test("previene duplicados por documento dentro del mismo local", () => { assert.equal(hasDuplicateDocument([customer], "Recoleta", draft), true); assert.equal(hasDuplicateDocument([customer], "Maure", draft), false); assert.equal(hasDuplicateDocument([customer], "Recoleta", { ...draft, id: customer.id }), false); });
test("relaciona historial por id y no por nombre", () => { const sales = [{ id: "sale-1", site: "Recoleta", customerId: "customer-1" }, { id: "sale-2", site: "Recoleta", customer: "Cliente de prueba", customerDocumentNumber: "12345678" }]; const returns = [{ id: "return-1", saleId: "sale-1" }]; const history = customerHistory(customer, sales, returns); assert.equal(history.sales.length, 2); assert.equal(history.returns.length, 1); });
