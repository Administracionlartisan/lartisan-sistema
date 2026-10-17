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
try { enforce_strict_cash_snapshot($closed, ['cashOpen' => true, 'activeShift' => ['id' => 'shift-b', 'site' => 'Recoleta', 'openedBy' => 'Otra'], 'shiftLog' => []], $user, 'Recoleta'); throw new RuntimeException('permitió suplantar responsable'); } catch (RuntimeException $expected) { check_presence('bloquea responsable distinta', str_contains($expected->getMessage(), 'responsable')); }
try { enforce_strict_cash_snapshot($opening, ['cashOpen' => false, 'activeShift' => null, 'shiftLog' => []], $user, 'Recoleta'); throw new RuntimeException('permitió cierre sin arqueo'); } catch (RuntimeException $expected) { check_presence('exige cierre completo', str_contains($expected->getMessage(), 'arqueo')); }
