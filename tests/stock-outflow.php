<?php
declare(strict_types=1);
require __DIR__ . '/../donweb-api/stock_outflow.php';
$request = ['id' => '33333333-3333-4333-a333-333333333333', 'site' => 'Maure', 'status' => 'Pendiente', 'lines' => [['productId' => 2, 'quantity' => 2], ['productId' => 5, 'quantity' => 1]]];
$created = make_stock_outflow_request($request + ['destination' => 'Restaurante', 'carrier' => 'Óscar', 'reason' => 'Entrega'], 'Maure', 'Vendedora', '2026-10-20T12:00:00Z');
if ($created['status'] !== 'Pendiente' || $created['requestedBy'] !== 'Vendedora') throw new RuntimeException('Incorrect request');
$rejected = reject_stock_outflow($created, 'Supervisora', '2026-10-20T12:01:00Z', 'No corresponde');
if ($rejected['status'] !== 'Rechazado') throw new RuntimeException('Incorrect rejection');
try { reject_stock_outflow($created, 'Supervisora', '2026-10-20T12:01:00Z', ''); throw new RuntimeException('Missing reason accepted'); } catch (DomainException $expected) {}
$stock = [2 => 3, 5 => 1];
$approved = plan_stock_outflow_approval($request, $stock, 'Maure', 'Supervisora', '2026-10-20T12:00:00Z');
if ($approved['stock'][2] != 1 || $approved['stock'][5] != 0 || count($approved['movements']) !== 2) throw new RuntimeException('Incorrect stock plan');
if ($approved['movements'][0]['id'] !== plan_stock_outflow_approval($request, $stock, 'Maure', 'Supervisora', '2026-10-20T12:00:00Z')['movements'][0]['id']) throw new RuntimeException('Movement ID not deterministic');
foreach ([[$approved['request'], $stock, 'Maure'], [$request, [2 => 1, 5 => 1], 'Maure'], [$request, $stock, 'Otro']] as [$candidate, $balance, $site]) {
    try { plan_stock_outflow_approval($candidate, $balance, $site, 'Supervisora', '2026-10-20T12:00:00Z'); throw new RuntimeException('Invalid approval accepted'); }
    catch (DomainException $expected) {}
}
$duplicate = $request;
$duplicate['lines'][] = ['productId' => 2, 'quantity' => 1];
try { plan_stock_outflow_approval($duplicate, $stock, 'Maure', 'Supervisora', '2026-10-20T12:00:00Z'); throw new RuntimeException('Duplicate product accepted'); } catch (DomainException $expected) {}
if ($stock !== [2 => 3, 5 => 1]) throw new RuntimeException('Input balance was modified');
echo "stock outflow approval plan: ok\n";
