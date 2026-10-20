<?php
declare(strict_types=1);
require __DIR__ . '/../donweb-api/attendance_presence.php';

function check_presence(string $label, bool $value): void { if (!$value) throw new RuntimeException($label); echo "✓ $label\n"; }

check_presence('distancia cero', presence_distance_meters(-34.6037, -58.3816, -34.6037, -58.3816) < 0.01);
check_presence('distancia geográfica positiva', presence_distance_meters(-34.6037, -58.3816, -34.6047, -58.3816) > 100);
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
check_presence('computadora no requiere geocerca', !attendance_request_is_mobile());
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Linux; Android 14; Mobile)';
check_presence('celular conserva geocerca', attendance_request_is_mobile());
$user = ['full_name' => 'Vendedora de prueba'];
$closed = ['cashOpen' => false, 'activeShift' => null, 'shiftLog' => []];
$opening = ['cashOpen' => true, 'activeShift' => ['id' => 'shift-a', 'site' => 'Recoleta', 'openedBy' => 'Vendedora de prueba'], 'shiftLog' => [['id' => 'shift-a', 'site' => 'Recoleta', 'openedBy' => 'Vendedora de prueba']]];
enforce_strict_cash_snapshot($closed, $opening, $user, 'Recoleta'); check_presence('primera apertura autorizada', true);
try { enforce_strict_cash_snapshot($opening, ['cashOpen' => true, 'activeShift' => ['id' => 'shift-b', 'site' => 'Recoleta', 'openedBy' => 'Otra'], 'shiftLog' => []], $user, 'Recoleta'); throw new RuntimeException('permitió relevo abierto'); } catch (RuntimeException $expected) { check_presence('bloquea relevo con caja abierta', str_contains($expected->getMessage(), 'cierre completo')); }
$conflict = new RuntimeException('La caja ya está abierta por Responsable de prueba. Debe realizarse el cierre completo antes del relevo.');
check_presence('conflicto de cajas requiere conciliación sin reintentos automáticos', str_contains(operational_cash_conflict_response($conflict, 'autorizar')['error'] ?? '', 'conciliarlas'));
check_presence('otros errores no exponen detalles como conflicto de caja', operational_cash_conflict_response(new RuntimeException('error privado'), 'autorizar') === null && operational_cash_conflict_response($conflict, 'guardar_estado') === null);
try { enforce_strict_cash_snapshot($closed, ['cashOpen' => true, 'activeShift' => ['id' => 'shift-b', 'site' => 'Recoleta', 'openedBy' => 'Otra'], 'shiftLog' => []], $user, 'Recoleta'); throw new RuntimeException('permitió suplantar responsable'); } catch (RuntimeException $expected) { check_presence('bloquea responsable distinta', str_contains($expected->getMessage(), 'responsable')); }
try { enforce_strict_cash_snapshot($opening, ['cashOpen' => false, 'activeShift' => null, 'shiftLog' => []], $user, 'Recoleta'); throw new RuntimeException('permitió cierre sin arqueo'); } catch (RuntimeException $expected) { check_presence('exige cierre completo', str_contains($expected->getMessage(), 'arqueo')); }

$currentCash = [
    'cashOpen' => true,
    'activeShift' => ['id' => 'turno-vigente', 'site' => 'Recoleta', 'openedBy' => 'Vendedora de prueba'],
    'shiftLog' => [['id' => 'turno-anterior', 'closedAtISO' => '2026-10-16T18:00:00.000Z']],
    'cashLedger' => [['id' => 'apertura-vigente', 'shiftId' => 'turno-vigente']],
    'envelopeRecords' => [['id' => 'sobre-anterior', 'status' => 'En Caja Mayor']],
];
$staleClose = [
    'cashOpen' => false,
    'activeShift' => null,
    'shiftLog' => array_merge($currentCash['shiftLog'], [['id' => 'turno-antiguo', 'closedAtISO' => '2026-10-17T18:00:00.000Z']]),
    'cashLedger' => array_merge($currentCash['cashLedger'], [
        ['id' => 'venta-vigente', 'shiftId' => 'turno-vigente'],
        ['id' => 'cierre-obsoleto', 'shiftId' => 'turno-antiguo'],
    ]),
    'envelopeRecords' => array_merge($currentCash['envelopeRecords'], [['id' => 'sobre-obsoleto', 'status' => 'En Caja Mayor']]),
];
$recovered = preserve_current_cash_after_rejected_stale_close($currentCash, $staleClose);
check_presence('recupera caja vigente ante cierre obsoleto', $recovered['cashOpen'] === true && ($recovered['activeShift']['id'] ?? '') === 'turno-vigente');
check_presence('conserva venta del turno vigente', array_column($recovered['cashLedger'], 'id') === ['apertura-vigente', 'venta-vigente']);
check_presence('descarta sobre de cierre obsoleto', array_column($recovered['envelopeRecords'], 'id') === ['sobre-anterior']);
