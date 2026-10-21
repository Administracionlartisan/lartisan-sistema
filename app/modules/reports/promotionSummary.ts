/** Resumen de ventas confirmadas. La fecha debe venir en hora operativa local. */
export type PromotionSale = { id: string; site: string; date: string; promotion?: string | null; status: string };
export type PromotionSummaryRow = { site: string; promotion: string; count: number };

export function summarizePromotions(sales: PromotionSale[], from: string, to: string): PromotionSummaryRow[] {
  const rows = new Map<string, PromotionSummaryRow>();
  const seen = new Set<string>();
  for (const sale of sales) {
    const promotion = sale.promotion?.trim();
    if (!sale.id || !sale.site || !promotion || sale.status !== "activa" || sale.date < from || sale.date > to || seen.has(sale.id)) continue;
    seen.add(sale.id);
    const key = JSON.stringify([sale.site, promotion]);
    const row = rows.get(key) ?? { site: sale.site, promotion, count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.site.localeCompare(b.site, "es") || a.promotion.localeCompare(b.promotion, "es"));
}
