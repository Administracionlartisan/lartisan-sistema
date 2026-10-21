<?php
declare(strict_types=1);
putenv('LARTISAN_CONFIG=' . __DIR__ . '/../dev/config.dev.php');
require __DIR__ . '/../donweb-api/bootstrap.php';
require_once __DIR__ . '/../donweb-api/attendance_presence.php';

$base = [['saleId' => 'sale-1', 'method' => 'Efectivo', 'amount' => 100]];
$first = [['saleId' => 'sale-1', 'method' => 'Tarjeta', 'amount' => 60], ['saleId' => 'sale-1', 'method' => 'Efectivo', 'amount' => 40]];
$second = [['saleId' => 'sale-1', 'method' => 'Transferencia', 'amount' => 100]];
if (count(merge_operational_list('payments', $base, $base, $first)) !== 2) throw new RuntimeException('No se conservó el pago dividido.');
if (merge_operational_list('payments', $base, $first, $base) !== $first) throw new RuntimeException('Una instantánea sin cambios modificó pagos.');
foreach ([$first, $second] as $concurrent) {
    try {
        merge_operational_list('payments', $base, $first, $concurrent);
        throw new RuntimeException('Se aceptó una corrección concurrente.');
    } catch (OperationalSyncRejected $expected) {
        if (!str_contains($expected->getMessage(), 'conciliación')) throw $expected;
    }
}
echo "✓ Pagos divididos y correcciones concurrentes\n";
