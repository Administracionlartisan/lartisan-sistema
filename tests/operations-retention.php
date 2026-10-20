<?php

// Reglas de recorte del estado operativo. No usa base de datos.
// Uso: LARTISAN_CONFIG=dev/config.dev.php php tests/operations-retention.php
declare(strict_types=1);

$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../donweb-api/bootstrap.php';

$failures = 0;
function check(string $label, bool $condition): void
{
    global $failures;
    echo ($condition ? 'ok   ' : 'FALLA') . " $label\n";
    if (!$condition) $failures++;
}

$now = mktime(12, 0, 0, 9, 30, 2026);
$old = gmdate('c', $now - 90 * 86400);
$recent = gmdate('c', $now - 2 * 86400);
$oldEsAr = date('j/n/Y, H:i:s', $now - 90 * 86400);
$state = [
    'activeShift' => ['id' => 'turno-abierto'],
    'sales' => [['id' => 'venta-vieja', 'createdAtISO' => $old], ['id' => 'venta-nueva', 'createdAtISO' => $recent], ['id' => 'venta-sin-fecha']],
    'payments' => [['saleId' => 'venta-vieja', 'method' => 'Efectivo', 'amount' => 1], ['saleId' => 'venta-nueva', 'method' => 'Efectivo', 'amount' => 2]],
    'cashLedger' => [['id' => 'caja-vieja', 'atISO' => $old], ['id' => 'caja-vieja-turno-abierto', 'atISO' => $old, 'shiftId' => 'turno-abierto']],
    'envelopeRecords' => [['id' => 'sobre-en-caja', 'at' => $oldEsAr, 'status' => 'En Caja Mayor'], ['id' => 'sobre-retirado', 'at' => $oldEsAr, 'status' => 'Retirado por Oscar']],
    'stockRequests' => [['id' => 'pedido-pendiente', 'requestedAt' => $oldEsAr, 'status' => 'Pendiente'], ['id' => 'pedido-entregado', 'requestedAt' => $oldEsAr, 'status' => 'Entregado']],
    'shiftLog' => [['id' => 'turno-cerrado-viejo', 'closedAtISO' => $old], ['id' => 'turno-sin-cierre', 'openedAt' => $old]],
    'stock' => [1 => 10],
];
$ids = static fn (array $list): array => array_map(static fn (array $item): string => (string) ($item['id'] ?? $item['saleId']), $list);
[$trimmed, $days] = compact_operational_state($state, ['operations' => ['retention_days' => 60]], $now);

check('conserva 60 días cuando el estado es chico', $days === 60);
check('recorta ventas viejas y conserva recientes y sin fecha', $ids($trimmed['sales']) === ['venta-nueva', 'venta-sin-fecha']);
check('los pagos siguen a su venta', $ids($trimmed['payments']) === ['venta-nueva']);
check('conserva la caja del turno abierto aunque sea vieja', $ids($trimmed['cashLedger']) === ['caja-vieja-turno-abierto']);
check('conserva el sobre que sigue en Caja Mayor', $ids($trimmed['envelopeRecords']) === ['sobre-en-caja']);
check('conserva el pedido pendiente viejo', $ids($trimmed['stockRequests']) === ['pedido-pendiente']);
check('conserva el turno sin cierre', $ids($trimmed['shiftLog']) === ['turno-sin-cierre']);
check('no toca el stock', $trimmed['stock'] === $state['stock']);
check('la fecha es-AR d/m/aaaa se interpreta como día/mes', operational_item_time(['at' => '5/9/2026, 10:00:00'], ['at']) === mktime(12, 0, 0, 9, 5, 2026));
check('la retención configurada tiene un mínimo de 7 días', compact_operational_state($state, ['operations' => ['retention_days' => 1]], $now)[1] === OPERATIONS_RETENTION_MIN_DAYS);

// Estado grande: se achica por debajo del objetivo sin bajar del mínimo.
$big = ['sales' => []];
for ($i = 0; $i < 4000; $i++) {
    $big['sales'][] = ['id' => "v$i", 'createdAtISO' => gmdate('c', $now - (int) ($i / 100) * 86400), 'items' => str_repeat('x', 1000)];
}
[$bigTrimmed, $bigDays] = compact_operational_state($big, [], $now);
check('un estado grande queda por debajo del objetivo', strlen((string) json_encode($bigTrimmed)) <= OPERATIONS_TARGET_STATE_BYTES);
check('la ventana nunca baja del mínimo', $bigDays >= OPERATIONS_RETENTION_MIN_DAYS);

echo $failures === 0 ? "\nTodas las reglas se cumplen.\n" : "\n$failures reglas fallaron.\n";
exit($failures === 0 ? 0 : 1);
