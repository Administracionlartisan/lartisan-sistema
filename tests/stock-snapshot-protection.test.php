<?php

declare(strict_types=1);

// bootstrap.php only needs a configuration array in order to load its pure
// snapshot helpers. The temporary file is outside the project and is removed
// before the test exits.
$configPath = tempnam(sys_get_temp_dir(), 'lartisan-stock-test-');
if ($configPath === false) throw new RuntimeException('No se pudo crear configuración temporal.');
file_put_contents($configPath, "<?php return ['timezone' => 'UTC'];\n");
putenv('LARTISAN_CONFIG=' . $configPath);
require __DIR__ . '/../donweb-api/bootstrap.php';
unlink($configPath);

$previous = [
    'stock' => [88 => 7],
    'stockMovements' => [[
        'id' => '11111111-1111-4111-a111-111111111111',
        'productId' => 88,
        'quantity' => 7,
    ]],
    'initialStockLoad' => ['site' => 'Maure', 'completedBy' => 'Carga inicial'],
];

// A stale browser trying to replace the balance with zero cannot erase stock.
[$protected, $repaired] = protect_stock_snapshot_integrity($previous, [
    'stock' => [88 => 0],
    'stockMovements' => [],
]);
if ((float) ($protected['stock'][88] ?? -1) !== 7.0 || $repaired !== [88]) {
    throw new RuntimeException('No se protegió el stock frente a un snapshot desactualizado.');
}
if (count($protected['stockMovements']) !== 1 || ($protected['initialStockLoad']['site'] ?? '') !== 'Maure') {
    throw new RuntimeException('No se preservó el historial o la marca de carga inicial.');
}

// A normal sale/receipt includes its movement and remains fully valid.
[$updated, $repaired] = protect_stock_snapshot_integrity($previous, [
    'stock' => [88 => 5],
    'stockMovements' => [
        $previous['stockMovements'][0],
        ['id' => '22222222-2222-4222-a222-222222222222', 'productId' => 88, 'quantity' => -2],
    ],
]);
if ((float) ($updated['stock'][88] ?? -1) !== 5.0 || $repaired !== []) {
    throw new RuntimeException('Se rechazó una variación de stock correctamente auditada.');
}

// Replaying a stale queue containing a movement already applied by ID must
// not subtract that movement a second time from the current server balance.
$replayBase = ['stock' => [88 => 7], 'stockMovements' => []];
$recovered = ['stock' => [88 => 5], 'stockMovements' => [
    ['id' => '33333333-3333-4333-a333-333333333333', 'productId' => 88, 'quantity' => -2],
]];
$stale = ['stock' => [88 => 5], 'stockMovements' => $recovered['stockMovements']];
$mergedReplay = merge_operational_snapshot($replayBase, $recovered, $stale);
[$replayed] = protect_stock_snapshot_integrity($recovered, $mergedReplay);
if ((float) ($replayed['stock'][88] ?? -1) !== 5.0 || count($replayed['stockMovements']) !== 1) {
    throw new RuntimeException('Un reintento duplicó el descuento de stock ya registrado.');
}

echo "stock snapshot protection: ok\n";
