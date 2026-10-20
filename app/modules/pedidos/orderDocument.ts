import type { Product, StockRequest } from "../shared/types";

export type OrderDocumentLine = {
  productId: number;
  productName: string;
  presentation: string;
  category: string;
  currentStock: number;
  idealStock: number;
  quantity: number;
};

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

/**
 * Conserva la foto operativa del pedido. Las solicitudes anteriores siguen
 * mostrando el producto aunque luego se modifique el catálogo o el ideal.
 */
export const orderDocumentLines = (request: StockRequest, products: Product[]): OrderDocumentLine[] =>
  request.lines.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    return {
      productId: line.productId,
      productName: line.productName || product?.name || `Producto #${line.productId}`,
      presentation: line.presentation || product?.detail || "—",
      category: line.category || product?.category || "Sin categoría",
      currentStock: safeNumber(line.currentStockAtRequest),
      idealStock: safeNumber(line.idealStockAtRequest),
      quantity: safeNumber(line.quantity),
    };
  });

export const orderDocumentHtml = (request: StockRequest, products: Product[]) => {
  const lines = orderDocumentLines(request, products);
  const groups = new Map<string, OrderDocumentLine[]>();
  lines.forEach((line) => groups.set(line.category, [...(groups.get(line.category) || []), line]));
  const rows = [...groups.entries()].map(([category, categoryLines]) => `
    <section>
      <h2>${escapeHtml(category)}</h2>
      <table>
        <thead><tr><th>Artículo</th><th>Presentación</th><th>Stock actual</th><th>Stock ideal</th><th>Pedido</th></tr></thead>
        <tbody>${categoryLines.map((line) => `<tr>
          <td>${escapeHtml(line.productName)}</td><td>${escapeHtml(line.presentation)}</td>
          <td>${line.currentStock}</td><td>${line.idealStock}</td><td><strong>${line.quantity}</strong></td>
        </tr>`).join("")}</tbody>
      </table>
    </section>`).join("");
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  const number = request.id.slice(0, 8).toUpperCase();
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedido ${number} - ${escapeHtml(request.site)}</title>
    <style>
      @page { size: A4; margin: 16mm; } * { box-sizing: border-box; } body { color: #17365f; font-family: Arial, sans-serif; font-size: 11px; }
      header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; border-bottom:2px solid #17365f; padding-bottom:12px; } h1 { margin:0; font-family: Georgia, serif; font-size:26px; } h2 { color:#e23c35; font-size:12px; letter-spacing:.04em; margin:20px 0 7px; text-transform:uppercase; } .eyebrow { color:#e23c35; font-weight:700; letter-spacing:.08em; margin:0 0 5px; } .meta { text-align:right; line-height:1.65; } .meta b { color:#17365f; } .notice { margin:14px 0; padding:9px 11px; background:#fff5d8; border-left:4px solid #efbd4e; color:#5f4a16; } table { width:100%; border-collapse:collapse; page-break-inside:avoid; } th { background:#17365f; color:#fff; font-size:10px; text-align:left; padding:8px; } th:nth-child(n+3), td:nth-child(n+3) { text-align:center; } td { padding:8px; border-bottom:1px solid #d9d4c9; vertical-align:top; } tr:nth-child(even) td { background:#f8f5ef; } footer { border-top:1px solid #d9d4c9; margin-top:20px; padding-top:9px; display:flex; justify-content:space-between; font-size:10px; color:#52657d; } @media print { .no-print { display:none; } }
    </style></head><body>
    <header><div><p class="eyebrow">L'ARTISAN · SOLICITUD DE MERCADERÍA</p><h1>Pedido de mercadería</h1><p>Reposición calculada a partir del stock del local y su stock ideal.</p></div>
    <div class="meta"><b>Pedido #${number}</b><br>Local: ${escapeHtml(request.site)}<br>Solicitado por: ${escapeHtml(request.requestedBy)}<br>Fecha: ${escapeHtml(request.requestedAt)}</div></header>
    <p class="notice"><b>Control de preparación:</b> las cantidades reflejan la solicitud al momento de enviarla. La recepción en el local es la única acción que ingresa stock.</p>
    ${rows || "<p>No hay productos en esta solicitud.</p>"}
    <footer><span>Observaciones: ${escapeHtml(request.notes || "Sin observaciones")}</span><strong>Total solicitado: ${total} unidades</strong></footer>
    </body></html>`;
};
