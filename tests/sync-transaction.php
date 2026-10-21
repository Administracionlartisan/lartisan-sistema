<?php
declare(strict_types=1);
// Exclusively the disposable local development database, never production.
// Lo que /sync ejecuta dentro de su transacción no puede emitir DDL: MySQL hace
// un COMMIT implícito, libera el FOR UPDATE del local y deja sin efecto el
// rollback ante un error posterior.
$configPath = realpath(__DIR__ . '/../dev/config.dev.php');
putenv('LARTISAN_CONFIG=' . $configPath);
require __DIR__ . '/../donweb-api/bootstrap.php';
require __DIR__ . '/../donweb-api/test_operating_date.php';
require __DIR__ . '/../donweb-api/attendance_presence.php';
$config = require $configPath;
if ($config['database']['name'] !== 'lartisan_dev' || $config['database']['host'] !== '127.0.0.1;port=3313') throw new RuntimeException('Refusing non-test database');
$pdo = db($config);
ensure_operations_schema($pdo);
ensure_test_operating_date_schema($pdo);

function check_sync(string $label, bool $value): void { if (!$value) throw new RuntimeException($label); echo "✓ $label\n"; }

$pdo->beginTransaction();
$pdo->query("SELECT revision FROM operation_site_states WHERE site = 'Novo Pacheco' FOR UPDATE")->fetchAll();
validate_test_operating_snapshot($pdo, 'Novo Pacheco', [], [], []);
catalog_price_lists($pdo);
check_sync('la validación de /sync no cierra la transacción', $pdo->inTransaction());
$pdo->rollBack();

// Activar y desactivar la ventana más de una vez no puede chocar contra una
// fila ya desactivada de la misma fecha.
$admin = (int) $pdo->query('SELECT id FROM users ORDER BY id LIMIT 1')->fetchColumn();
$pdo->exec("UPDATE test_operating_date_runs SET status='disabled', disabled_at=NOW() WHERE status='active'");
for ($round = 1; $round <= 2; $round++) {
    $pdo->prepare("INSERT INTO test_operating_date_runs (site,business_date,label,purpose,status,enabled_by) VALUES ('Maure','2026-10-15','PRUEBA DE VALIDACIÓN','prueba automática','active',?)")->execute([$admin]);
    $active = active_test_operating_date($pdo);
    $pdo->prepare("UPDATE test_operating_date_runs SET status='disabled',disabled_by=?,disabled_at=NOW() WHERE id=? AND status='active'")->execute([$admin, (int) $active['id']]);
}
check_sync('la ventana de prueba se puede desactivar más de una vez', active_test_operating_date($pdo) === null);

// Una operación real enviada mientras la ventana está activa es un rechazo
// definitivo (422 en /sync), no una falla técnica que se reintenta a ciegas.
try {
    check_test_operating_snapshot(['site' => 'Maure', 'business_date' => '2026-10-15'], 'Maure', [], ['sales' => [['id' => 'venta-real', 'customer' => 'Cliente']]], ['action' => 'Venta']);
    throw new RuntimeException('aceptó una venta real durante la ventana de prueba');
} catch (OperationalSyncRejected $expected) {
    check_sync('la ventana de prueba rechaza ventas reales con un motivo explicable', str_contains($expected->getMessage(), 'ventana de prueba'));
}
check_test_operating_snapshot(null, 'Maure', [], ['sales' => [['id' => 'venta-real']]], []);
check_sync('sin ventana activa la venta real pasa', true);

try {
    enforce_strict_cash_snapshot(['cashOpen' => false], ['cashOpen' => true, 'activeShift' => ['id' => 't', 'site' => 'Recoleta', 'openedBy' => 'Otra']], ['full_name' => 'Vendedora'], 'Recoleta');
    throw new RuntimeException('permitió abrir la caja a otra responsable');
} catch (OperationalSyncRejected $expected) {
    check_sync('un rechazo de caja se informa para conciliar', str_contains($expected->getMessage(), 'responsable'));
}
