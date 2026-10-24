import type { Payment, Product, Sale } from "../shared/types";

const THERMAL_COLUMNS = 32;

const thermalSafe = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[–—·]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();

const thermalCenter = (value: string) => {
  const text = thermalSafe(value).slice(0, THERMAL_COLUMNS);
  return text.padStart(text.length + Math.floor((THERMAL_COLUMNS - text.length) / 2));
};

const thermalPair = (label: string, value: string) => {
  const left = thermalSafe(label);
  const right = thermalSafe(value);
  const spaces = THERMAL_COLUMNS - left.length - right.length;
  return spaces > 0 ? `${left}${" ".repeat(spaces)}${right}` : `${left}\n${right.padStart(THERMAL_COLUMNS)}`;
};

const thermalWrap = (value: string) => {
  const words = thermalSafe(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const previous = lines.at(-1) || "";
    if (!previous || previous.length + word.length + 1 > THERMAL_COLUMNS) lines.push(word.slice(0, THERMAL_COLUMNS));
    else lines[lines.length - 1] = `${previous} ${word}`;
  }
  return lines.length ? lines : [""];
};

const thermalMoney = (value: number) => `$ ${Math.round(value).toLocaleString("es-AR")}`;

export function buildThermalReceipt(sale: Sale, salePayments: Payment[], servedBy: string) {
  const divider = "-".repeat(THERMAL_COLUMNS);
  const grouped = Array.from(
    sale.items.reduce<Map<number, { product: Product; quantity: number }>>((rows, product) => {
      const current = rows.get(product.id);
      rows.set(product.id, { product, quantity: (current?.quantity || 0) + 1 });
      return rows;
    }, new Map()).values(),
  );
  const lines = [
    "", thermalCenter("L'ARTISAN"), thermalCenter("TICKET DE VENTA"),
    thermalCenter("COMPROBANTE INTERNO"), thermalCenter("NO FISCAL"), divider,
    ...thermalWrap(`Local: ${sale.site}`), ...thermalWrap(`Fecha: ${sale.createdAt}`),
    `Operacion: ${sale.id.slice(0, 8).toUpperCase()}`,
    ...thermalWrap(`Atendio: ${servedBy}`), ...thermalWrap(`Cliente: ${sale.customer}`),
    `Canal: ${thermalSafe(sale.channel)}`, divider,
  ];
  if (sale.promotion) lines.push(...thermalWrap(`Promocion: ${sale.promotion}`));
  let invitationDiscount = 0;
  grouped.forEach(({ product, quantity }) => {
    lines.push(...thermalWrap(`${quantity} x ${product.name}`));
    const invited = sale.invitedQuantities?.[product.id] || 0;
    if (invited) {
      const amount = product.price * Math.min(quantity, invited);
      invitationDiscount += amount;
      lines.push(...thermalWrap(`  INVITACION: ${invited} x ${product.name}`));
      lines.push(thermalPair("  Bonificacion", `-${thermalMoney(amount)}`));
    }
  });
  const manualDiscount = Math.max(0, sale.discount - invitationDiscount);
  lines.push(
    divider,
    thermalPair("Bruto", thermalMoney(sale.gross)),
  );
  if (invitationDiscount) lines.push(thermalPair("Invitaciones", `-${thermalMoney(invitationDiscount)}`));
  if (manualDiscount) lines.push(thermalPair("Descuento", `-${thermalMoney(manualDiscount)}`));
  lines.push(
    thermalPair("TOTAL", thermalMoney(sale.net)),
  );
  salePayments.forEach((payment) => lines.push(thermalPair(payment.method, thermalMoney(payment.amount))));
  lines.push(
    divider, thermalCenter(sale.invoiceType), "",
    ...thermalWrap("Este ticket no reemplaza una factura fiscal con CAE."), "",
    thermalCenter("Gracias por tu compra"), "",
  );
  return lines.join("\n");
}
