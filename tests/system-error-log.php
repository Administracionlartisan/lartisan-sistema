<?php
declare(strict_types=1);
// Exclusively the disposable local development database, never production.
$configPath = realpath(__DIR__ . '/../dev/config.dev.php');
putenv('LARTISAN_CONFIG=' . $configPath);
require __DIR__ . '/../donweb-api/bootstrap.php';
$config = require $configPath;
if ($config['database']['name'] !== 'lartisan_dev' || $config['database']['host'] !== '127.0.0.1;port=3313') throw new RuntimeException('Refusing non-test database');
$pdo = db($config);
ensure_system_error_log_schema($pdo);

function check_log(string $label, bool $value): void { if (!$value) throw new RuntimeException($label); echo "✓ $label\n"; }

$marker = 'PRUEBA-REGISTRO-' . bin2hex(random_bytes(6));
check_log('recorta rutas absolutas del servidor', system_error_message("fallo @ /home/u123/public_html/sistema-api/bootstrap.php:42 y C:\\srv\\api\\index.php:7") === 'fallo @ bootstrap.php:42 y index.php:7');

// Dentro de una transacción (como en /sync) registra sin cerrarla.
$pdo->beginTransaction();
system_error($pdo, 'prueba registro', $marker . ' dentro de transacción', 'Maure');
check_log('registrar no cierra la transacción de /sync', $pdo->inTransaction());
$pdo->commit();
$row = $pdo->query("SELECT source, site, message, fingerprint FROM system_error_log WHERE message LIKE " . $pdo->quote($marker . '%') . " ORDER BY id DESC LIMIT 1")->fetch();
check_log('guarda origen, local y mensaje', ($row['source'] ?? '') === 'prueba registro' && ($row['site'] ?? '') === 'Maure' && strlen((string) ($row['fingerprint'] ?? '')) === 40);

system_error($pdo, 'prueba registro', $marker . ' dentro de transacción', 'Maure');
$fingerprints = $pdo->query("SELECT COUNT(DISTINCT fingerprint) FROM system_error_log WHERE message LIKE " . $pdo->quote($marker . '%'))->fetchColumn();
check_log('repeticiones del mismo error comparten huella', (int) $fingerprints === 1);

check_log('mensaje largo truncado a 1000 caracteres', mb_strlen(system_error_message(str_repeat('x', 3000))) === 1000);
system_error(null, 'prueba registro', 'sin base disponible');
check_log('sin base de datos no interrumpe la operación', true);
