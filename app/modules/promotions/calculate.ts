/** Cálculo independiente de una promoción porcentual sobre unidades elegibles.
 * El resultado no autoriza una venta: la promoción y el límite deben validarse
 * también en el servidor antes de conectar esta función con la caja.
 */
export function promotionDiscount(
  items: ReadonlyArray<{ id: number; price: number }>,
  invitedQuantities: Readonly<Record<number, number>>,
  productIds: readonly number[] | null,
  percentage: number,
): number {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new RangeError("Porcentaje de promoción inválido");
  const eligible = productIds === null ? null : new Set(productIds);
  const remainingInvitations = { ...invitedQuantities };
  let subtotal = 0;
  for (const item of items) {
    if (!Number.isFinite(item.price) || item.price < 0) throw new RangeError("Precio inválido");
    if ((remainingInvitations[item.id] ?? 0) > 0) {
      remainingInvitations[item.id] -= 1;
    } else if (eligible === null || eligible.has(item.id)) {
      subtotal += item.price;
    }
  }
  return Math.round(subtotal * percentage / 100);
}
