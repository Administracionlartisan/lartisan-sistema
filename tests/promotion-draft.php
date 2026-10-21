<?php
declare(strict_types=1);
require __DIR__ . '/../donweb-api/promotions.php';
$valid = ['name' => 'Semana ñoquis', 'percentage' => 15, 'startsOn' => '2026-10-21', 'endsOn' => '2026-10-27', 'sites' => ['Maure'], 'productIds' => [1, 2]];
if (validate_promotion_draft($valid)['percentage'] !== 15.0) throw new RuntimeException('Promoción válida rechazada');
foreach ([['percentage' => 101], ['startsOn' => '2026-02-30'], ['endsOn' => '2026-10-01'], ['sites' => []], ['productIds' => []], ['productIds' => [1, 1]]] as $invalid) {
    try { validate_promotion_draft(array_replace($valid, $invalid)); throw new RuntimeException('Datos inválidos aceptados'); }
    catch (InvalidArgumentException $expected) {}
}
echo "Validación de promociones: OK\n";
