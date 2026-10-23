<?php

// Control de importes de ventas en el servidor. No usa base de datos.
// Uso: LARTISAN_CONFIG=dev/config.dev.php php tests/sale-validation.php
declare(strict_types=1);

$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../donweb-api/bootstrap.php';
if (!class_exists('OperationalSyncRejected')) {
    class OperationalSyncRejected extends RuntimeException {}
}

$failures = 0;
function check(string $label, bool $condition): void
{
    global $failures;
    echo ($condition ? 'ok   ' : 'FALLA') . " $label\n";
    if (!$condition) $failures++;
}

$catalog = [1 => ['Mostrador' => 8200.0, 'Online' => 10250.0], 2 => ['Mostrador' => 23000.0, 'Online' => 28750.0]];
$item = static fn (int $id, string $channel = 'Mostrador'): array => ['id' => $id, 'price' => $catalog[$id][$channel]];
// Misma fórmula que app/page.tsx: neto = (bruto - invitaciones) - round((bruto - invitaciones) * % / 100).
$sale = static function (string $id, array $items, int $percent = 0, array $invited = [], string $channel = 'Mostrador'): array {
    $gross = array_sum(array_column($items, 'price'));
    $invitation = 0.0;
    foreach ($invited as $productId => $quantity) {
        foreach ($items as $line) if ($line['id'] === $productId && $quantity-- > 0) $invitation += $line['price'];
    }
    $net = ($gross - $invitation) - round(($gross - $invitation) * $percent / 100);
    return ['id' => $id, 'items' => $items, 'gross' => $gross, 'discount' => $gross - $net, 'net' => $net, 'invitedQuantities' => $invited, 'channel' => $channel, 'status' => 'activa'];
};
$pay = static fn (array $s, ?float $amount = null, string $method = 'Efectivo'): array => ['saleId' => $s['id'], 'method' => $method, 'amount' => $amount ?? $s['net']];
$rules = static fn (array $findings): array => array_map(static fn (array $f): string => $f[2], $findings);
$run = static fn (array $previous, array $state): array => validate_operational_sales($previous, $state + ['limitsBySite' => ['Recoleta' => ['maxDiscount' => 10]]], 'Recoleta', $catalog);

$normal = [
    $sale('a', [$item(1), $item(1), $item(2)]),
    $sale('b', [$item(1), $item(2)], 10),
    $sale('c', [$item(1), $item(1), $item(2)], 5, [1 => 1]),
    $sale('d', [$item(2, 'Online')], 0, [], 'Online'),
];
$payments = array_map($pay, $normal);
check('ventas normales (descuento al límite, invitación, online) sin hallazgos', $run([], ['sales' => $normal, 'payments' => $payments]) === []);

$split = $sale('e', [$item(2)]);
check('pago dividido que suma el neto sin hallazgos', $run([], ['sales' => [$split], 'payments' => [$pay($split, 10000), $pay($split, $split['net'] - 10000, 'Transferencia')]]) === []);

$base = ['sales' => $normal, 'payments' => $payments];
$cancelled = $base;
$cancelled['sales'][0]['status'] = 'anulada';
$cancelled['payments'] = array_values(array_filter($payments, static fn (array $p): bool => $p['saleId'] !== 'a'));
check('anular una venta no es una modificación', $run($base, $cancelled) === []);

$corrected = $base;
$corrected['payments'][1]['method'] = 'Transferencia';
check('corregir el medio de pago no es una modificación', $run($base, $corrected) === []);

$cheap = $sale('f', [$item(2)]);
$cheap['net'] = $cheap['gross'] / 2; $cheap['discount'] = $cheap['gross'] / 2;
check('descuento por encima del límite', in_array('descuento_excede', $rules($run([], ['sales' => [$cheap], 'payments' => [$pay($cheap)]])), true));

$altered = $sale('g', [['id' => 2, 'price' => 100.0]]);
check('precio distinto al catálogo', in_array('precio_distinto', $rules($run([], ['sales' => [$altered], 'payments' => [$pay($altered)]])), true));

$short = $sale('h', [$item(1)]);
check('pagos que no suman el neto', in_array('pagos_distintos', $rules($run([], ['sales' => [$short], 'payments' => [$pay($short, 100)]])), true));

$modified = $base;
$modified['sales'][1]['net'] -= 2000; $modified['sales'][1]['discount'] += 2000;
check('bajar el neto de una venta ya registrada', in_array('venta_modificada', $rules($run($base, $modified)), true));

$credit = $sale('credito', [$item(1)]);
$credit['customerId'] = 'cliente-restaurante';
$credit['customerGroup'] = 'Restaurante';
$credit['paymentStatus'] = 'Pendiente';
$creditState = enforce_credit_sale_transitions([], ['sales' => [$credit], 'payments' => []], 'Recoleta');
check('venta de restaurante a cuenta se acepta sin pago', ($creditState['sales'][0]['paymentStatus'] ?? null) === 'Pendiente');
try {
    enforce_credit_sale_transitions([], ['sales' => [$credit], 'payments' => [$pay($credit)]], 'Recoleta');
    check('rechaza pago junto con venta a cuenta', false);
} catch (OperationalSyncRejected $expected) {
    check('rechaza pago junto con venta a cuenta', str_contains($expected->getMessage(), 'no puede registrar un pago'));
}
$paidCredit = $credit;
$paidCredit['paymentStatus'] = 'Pagada';
$paidCredit['paidAtISO'] = '2026-10-23T12:00:00.000Z';
$collected = enforce_credit_sale_transitions(['sales' => [$credit], 'payments' => []], ['sales' => [$paidCredit], 'payments' => [$pay($credit, $credit['net'], 'Transferencia')]], 'Recoleta');
check('cobranza posterior cambia una venta pendiente a pagada', ($collected['sales'][0]['paymentStatus'] ?? null) === 'Pagada');
try {
    $invalid = $paidCredit; $invalid['paymentStatus'] = 'Pendiente';
    enforce_credit_sale_transitions(['sales' => [$paidCredit], 'payments' => [$pay($credit)]], ['sales' => [$invalid], 'payments' => []], 'Recoleta');
    check('rechaza volver una venta cobrada a pendiente', false);
} catch (OperationalSyncRejected $expected) {
    check('rechaza volver una venta cobrada a pendiente', str_contains($expected->getMessage(), 'ya cobrada'));
}

echo $failures === 0 ? "\nTodas las reglas se cumplen.\n" : "\n$failures reglas fallaron.\n";
exit($failures === 0 ? 0 : 1);
