<?php
declare(strict_types=1);

/** Campañas inmutables: desactivar no elimina la evidencia para ventas offline. */
function ensure_promotions_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_promotions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        percentage DECIMAL(5,2) NOT NULL,
        starts_on DATE NOT NULL,
        ends_on DATE NOT NULL,
        sites_json TEXT NOT NULL,
        product_ids_json TEXT NULL,
        created_by BIGINT NOT NULL,
        created_at DATETIME NOT NULL,
        disabled_at DATETIME NULL,
        disabled_by BIGINT NULL,
        INDEX promotion_dates (starts_on, ends_on)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** Rechaza entradas inválidas antes de intentar guardarlas. */
function validate_promotion_draft(array $body): array
{
    $name = trim((string) ($body['name'] ?? ''));
    $percentage = $body['percentage'] ?? null;
    $start = (string) ($body['startsOn'] ?? '');
    $end = (string) ($body['endsOn'] ?? '');
    $validDate = static function (string $value): bool {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $date !== false && $date->format('Y-m-d') === $value;
    };
    $sites = $body['sites'] ?? null;
    $ids = $body['productIds'] ?? null;
    if ($name === '' || mb_strlen($name) > 120 || !is_numeric($percentage) || (float) $percentage < 0.01 || (float) $percentage > 100 || !$validDate($start) || !$validDate($end) || $end < $start || !is_array($sites) || !$sites) throw new InvalidArgumentException('Datos de promoción inválidos.');
    foreach ($sites as $site) if (!is_string($site) || trim($site) !== $site || $site === '') throw new InvalidArgumentException('Local inválido.');
    if (count($sites) !== count(array_unique($sites))) throw new InvalidArgumentException('Locales duplicados.');
    if ($ids !== null) {
        if (!is_array($ids) || !$ids) throw new InvalidArgumentException('Elegí al menos un producto.');
        foreach ($ids as $id) if (!is_int($id) || $id <= 0) throw new InvalidArgumentException('Producto inválido.');
        if (count($ids) !== count(array_unique($ids))) throw new InvalidArgumentException('Productos duplicados.');
    }
    return ['name' => $name, 'percentage' => round((float) $percentage, 2), 'startsOn' => $start, 'endsOn' => $end, 'sites' => array_values($sites), 'productIds' => $ids];
}

/** Comprueba campañas contra la definición persistida, incluso al sincronizar más tarde. */
function promotion_sale_findings(PDO $pdo, array $previous, array $state, string $site): array
{
    $prior = operational_items_by_id($previous['sales'] ?? []);
    $query = null;
    $findings = [];
    foreach (operational_items_by_id($state['sales'] ?? []) as $id => $sale) {
        if (isset($prior[$id]) || empty($sale['promotionId'])) continue;
        $query ??= $pdo->prepare('SELECT name, percentage, starts_on, ends_on, sites_json, product_ids_json, created_at, disabled_at FROM lartisan_promotions WHERE id = ?');
        $query->execute([(string) $sale['promotionId']]);
        $campaign = $query->fetch();
        $time = strtotime((string) ($sale['createdAtISO'] ?? ''));
        $date = $time === false ? '' : date('Y-m-d', $time);
        $sites = $campaign ? json_decode((string) $campaign['sites_json'], true) : null;
        $valid = $campaign && $time !== false && is_array($sites) && in_array($site, $sites, true)
            && $date >= $campaign['starts_on'] && $date <= $campaign['ends_on']
            && $time >= strtotime((string) $campaign['created_at'])
            && ($campaign['disabled_at'] === null || $time < strtotime((string) $campaign['disabled_at']))
            && ($sale['promotion'] ?? '') === $campaign['name'];
        if (!$valid) {
            $findings[] = [$id, 'inconsistencia', 'promocion_invalida', 'La promoción no coincide con una campaña vigente para este local.'];
            continue;
        }
        $ids = $campaign['product_ids_json'] === null ? null : json_decode((string) $campaign['product_ids_json'], true);
        if ($campaign['product_ids_json'] !== null && !is_array($ids)) {
            $findings[] = [$id, 'inconsistencia', 'promocion_invalida', 'No se pudo validar la lista de productos de la promoción.'];
            continue;
        }
        $expected = promotion_discount_amount($sale['items'] ?? [], $sale['invitedQuantities'] ?? [], $ids, (float) $campaign['percentage']);
        $items = $sale['items'] ?? [];
        $counts = [];
        $invitedAmount = 0.0;
        foreach ($items as $item) {
            $productId = (int) ($item['id'] ?? 0);
            $counts[$productId] = ($counts[$productId] ?? 0) + 1;
            if ($counts[$productId] <= (int) ($sale['invitedQuantities'][$productId] ?? 0)) $invitedAmount += (float) ($item['price'] ?? 0);
        }
        if (abs(((float) ($sale['gross'] ?? 0) - (float) ($sale['net'] ?? 0) - $invitedAmount) - $expected) > 1) {
            $findings[] = [$id, 'inconsistencia', 'promocion_descuento', 'El descuento no coincide con la promoción registrada.'];
        }
    }
    return $findings;
}
