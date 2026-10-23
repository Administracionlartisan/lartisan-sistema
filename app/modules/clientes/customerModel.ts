import type { CustomerGroup, CustomerRecord, ReturnTransaction, Sale } from "../shared/types";

export type CustomerDraft = Omit<Pick<CustomerRecord, "id" | "name" | "documentType" | "documentNumber" | "customerGroup" | "creditTermDays" | "email" | "phone" | "address" | "consentPromotions">, "email" | "phone" | "address" | "customerGroup" | "creditTermDays"> & { customerGroup: CustomerGroup; creditTermDays: number; email: string; phone: string; address: string };

export const normalizeDocument = (value: string) => value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

export function validateCustomerDraft(draft: CustomerDraft): string | null {
  if (draft.name.trim().length < 3) return "El nombre o razón social debe tener al menos 3 caracteres.";
  if (!normalizeDocument(draft.documentNumber)) return "El documento es obligatorio.";
  if (draft.documentType === "CUIT" && !/^\d{11}$/.test(normalizeDocument(draft.documentNumber))) return "El CUIT debe tener 11 dígitos.";
  if (draft.creditTermDays !== undefined && (!Number.isInteger(draft.creditTermDays) || draft.creditTermDays < 0 || draft.creditTermDays > 365)) return "El plazo de cobro debe ser de 0 a 365 días.";
  if (draft.email && !/^\S+@\S+\.\S+$/.test(draft.email.trim())) return "El email no tiene un formato válido.";
  return null;
}

export function hasDuplicateDocument(customers: CustomerRecord[], site: string, draft: CustomerDraft): boolean {
  const documentNumber = normalizeDocument(draft.documentNumber);
  return customers.some(customer => customer.site === site && customer.id !== draft.id
    && customer.documentType === draft.documentType
    && normalizeDocument(customer.documentNumber) === documentNumber);
}

export function customerHistory(customer: CustomerRecord, sales: Sale[], returnsLog: ReturnTransaction[]) {
  const customerSales = sales.filter(sale => sale.customerId === customer.id
    || (!sale.customerId && sale.site === customer.site && normalizeDocument(sale.customerDocumentNumber || "") === normalizeDocument(customer.documentNumber)));
  const saleIds = new Set(customerSales.map(sale => sale.id));
  return { sales: customerSales, returns: returnsLog.filter(item => saleIds.has(item.saleId)) };
}
