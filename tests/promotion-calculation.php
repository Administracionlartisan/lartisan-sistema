<?php
declare(strict_types=1);
require __DIR__ . '/../donweb-api/promotion_calculation.php';
$cart = [['id' => 1, 'price' => 1000], ['id' => 1, 'price' => 1000], ['id' => 2, 'price' => 2000]];
foreach ([[[], null, 600], [[], [1], 300], [[1 => 1], [1], 150], [[], [3], 0]] as [$invited, $ids, $expected]) {
    if (promotion_discount_amount($cart, $invited, $ids, 15) !== $expected) throw new RuntimeException('Cálculo de promoción incorrecto');
}
try { promotion_discount_amount($cart, [], null, 101); throw new RuntimeException('Porcentaje inválido aceptado'); } catch (InvalidArgumentException $expected) {}
echo "Cálculo de promociones PHP: OK\n";
