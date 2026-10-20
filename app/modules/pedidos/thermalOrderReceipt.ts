import type { Product, StockRequest } from "../shared/types";

const WIDTH = 32;
const divider = "-".repeat(WIDTH);
const clean = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const center = (value: string) => {
  const text = clean(value).slice(0, WIDTH);
  return text.padStart(text.length + Math.floor((WIDTH - text.length) / 2));
};
const wrap = (value: string) => {
  const words = clean(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    if (!line || line.length + word.length + 1 <= WIDTH) line = line ? `${line} ${word}` : word;
    else { lines.push(line); line = word.slice(0, WIDTH); }
  });
  if (line) lines.push(line);
  return lines;
};
const pair = (left: string, right: string) => {
  const label = clean(left);
  const value = clean(right);
  const gap = WIDTH - label.length - value.length;
  return gap > 0 ? `${label}${" ".repeat(gap)}${value}` : `${label}\n${value.padStart(WIDTH)}`;
};

/** Comprobante interno de preparación para imprimir en la misma térmica de 80 mm. */
export const buildThermalOrderReceipt = (request: StockRequest, products: Product[]) => {
  const lines = [
    "", center("L'ARTISAN"), center("PEDIDO DE MERCADERIA"),
    center("CENTRAL · VILLA MITRE"), divider,
    ...wrap(`Pedido: ${request.id.slice(0, 8).toUpperCase()}`),
    ...wrap(`Destino: ${request.site}`),
    ...wrap(`Solicito: ${request.requestedBy}`),
    ...wrap(`Fecha: ${request.requestedAt}`),
    divider,
  ];
  let total = 0;
  request.lines.forEach((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    const quantity = item.preparedQuantity ?? item.quantity;
    total += quantity;
    lines.push(...wrap(product?.name || item.productName || `Producto #${item.productId}`));
    if (product?.detail || item.presentation) lines.push(...wrap(product?.detail || item.presentation || ""));
    lines.push(pair("Cantidad", String(quantity)));
    if (item.missingReason) lines.push(...wrap(`Faltante: ${item.missingReason}`));
  });
  lines.push(divider, pair("TOTAL UNIDADES", String(total)));
  if (request.notes) lines.push(...wrap(`Obs.: ${request.notes}`));
  lines.push("", center("Control de preparacion"), "", "");
  return lines.join("\n");
};

