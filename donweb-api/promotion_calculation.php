<?php
declare(strict_types=1);

/** Calcula el beneficio aplicable a unidades no invitadas; null significa todos los productos. */
function promotion_discount_amount(array $items, array $invitedQuantities, ?array $productIds, float $percentage): int
{
    if (!is_finite($percentage) || $percentage < 0 || $percentage > 100) {
        throw new InvalidArgumentException('Porcentaje de promoción inválido');
    }
    $eligible = $productIds === null ? null : array_fill_keys(array_map('intval', $productIds), true);
    $remaining = $invitedQuantities;
    $subtotal = 0.0;
    foreach ($items as $item) {
        $id = (int) ($item['id'] ?? 0);
        $price = (float) ($item['price'] ?? -1);
        if ($id <= 0 || !is_finite($price) || $price < 0) throw new InvalidArgumentException('Producto o precio inválido');
        if ((int) ($remaining[$id] ?? 0) > 0) {
            $remaining[$id] = (int) $remaining[$id] - 1;
        } elseif ($eligible === null || isset($eligible[$id])) {
            $subtotal += $price;
        }
    }
    return (int) round($subtotal * $percentage / 100);
}
