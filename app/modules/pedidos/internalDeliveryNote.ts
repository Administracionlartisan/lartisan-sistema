import type { Product, StockRequest } from "../shared/types";

const escapeHtml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

/** Documento A4 no fiscal que acompaña el despacho entre locales. */
export const internalDeliveryNoteHtml = (request: StockRequest, products: Product[]) => {
  const remitoNumber = `RI-${request.id.slice(0, 8).toUpperCase()}`;
  const lines = request.lines.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    return {
      name: line.productName || product?.name || "Artículo sin nombre",
      presentation: line.presentation || product?.detail || "Presentación estándar",
      requested: Math.max(0, Number(line.quantity) || 0),
      sent: Math.max(0, Number(line.preparedQuantity ?? line.quantity) || 0),
      missingReason: line.missingReason || "",
    };
  }).filter((line) => line.sent > 0);
  const totalUnits = lines.reduce((total, line) => total + line.sent, 0);
  const isPartial = request.status === "Despachado parcial";
  const printedAt = new Date().toLocaleString("es-AR");
  const rows = lines.length ? lines.map((line) => `<tr><td><strong>${escapeHtml(line.name)}</strong>${line.missingReason ? `<small>Faltante informado: ${escapeHtml(line.missingReason)}</small>` : ""}</td><td>${escapeHtml(line.presentation)}</td><td class="quantity">${line.requested}</td><td class="quantity sent">${line.sent}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">No hay unidades confirmadas en este despacho.</td></tr>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Remito interno ${remitoNumber}</title><style>
@page{size:A4;margin:15mm}*{box-sizing:border-box}body{color:#172b4d;font-family:Arial,Helvetica,sans-serif;font-size:12px;margin:0}.header{align-items:flex-start;border-bottom:3px solid #183a67;display:flex;justify-content:space-between;padding-bottom:13px}h1{font-family:Georgia,serif;font-size:27px;letter-spacing:.5px;margin:0}h2{color:#ec3a35;font-size:18px;letter-spacing:.4px;margin:7px 0 0}.non-fiscal{color:#6b7280;font-size:10px;font-weight:bold;margin-top:4px;text-transform:uppercase}.number{border:1px solid #183a67;border-radius:5px;padding:9px 12px;text-align:right}.number b{display:block;font-size:15px}.meta{display:grid;gap:10px 18px;grid-template-columns:repeat(2,1fr);margin:18px 0}.meta div{border-bottom:1px solid #d8e0ea;padding-bottom:6px}.label{color:#64748b;display:block;font-size:10px;font-weight:bold;margin-bottom:2px;text-transform:uppercase}table{border-collapse:collapse;margin-top:15px;width:100%}th{background:#183a67;color:#fff;font-size:10px;padding:9px;text-align:left;text-transform:uppercase}td{border-bottom:1px solid #d8e0ea;padding:10px 9px;vertical-align:top}td small{color:#b42318;display:block;margin-top:3px}.quantity{text-align:center;width:13%}.sent{color:#087443;font-size:14px;font-weight:bold}.empty{color:#64748b;padding:22px;text-align:center}.summary{background:#eef5ef;border-radius:5px;margin-top:16px;padding:11px;text-align:right}.notice{border:1px solid #e9c46a;color:#6b5200;font-size:10px;line-height:1.45;margin-top:22px;padding:10px 12px}.signatures{display:grid;gap:42px;grid-template-columns:1fr 1fr;margin-top:70px}.signature{border-top:1px solid #172b4d;color:#475569;padding-top:7px}.signature b{color:#172b4d;display:block;margin-bottom:18px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><section class="header"><div><h1>L'ARTISAN</h1><h2>REMITO INTERNO</h2><div class="non-fiscal">Documento interno · no fiscal · no declara ante ARCA</div></div><div class="number"><span class="label">Número de remito</span><b>${remitoNumber}</b></div></section><section class="meta"><div><span class="label">Origen</span>Central de pedidos · Villa Mitre</div><div><span class="label">Destino</span>${escapeHtml(request.site)}</div><div><span class="label">Estado</span>${isPartial ? "Despacho parcial" : "Despacho confirmado"}</div><div><span class="label">Fecha de despacho</span>${escapeHtml(request.dispatchedAt || "No registrada (despacho anterior)")}</div><div><span class="label">Solicitado por</span>${escapeHtml(request.requestedBy)}</div><div><span class="label">Preparó / despachó</span>${escapeHtml(request.dispatchedBy || "Central Villa Mitre")}</div></section><table><thead><tr><th>Artículo</th><th>Presentación</th><th class="quantity">Solicitado</th><th class="quantity">Enviado</th></tr></thead><tbody>${rows}</tbody></table><div class="summary"><b>Total enviado: ${totalUnits} unidad${totalUnits === 1 ? "" : "es"}</b></div>${request.notes ? `<div class="notice"><b>Observaciones del pedido:</b> ${escapeHtml(request.notes)}</div>` : ""}<div class="notice">Este remito respalda el traslado interno de mercadería entre locales. La recepción debe confirmarse en el sistema. No reemplaza una factura ni un remito fiscal.</div><section class="signatures"><div class="signature"><b>Entregó (Central Villa Mitre)</b>Nombre, firma y fecha/hora</div><div class="signature"><b>Recibió (${escapeHtml(request.site)})</b>Nombre, firma y fecha/hora</div></section><p style="color:#64748b;font-size:9px;margin-top:28px;text-align:right">Emitido desde L'ARTISAN: ${escapeHtml(printedAt)}</p></body></html>`;
};

