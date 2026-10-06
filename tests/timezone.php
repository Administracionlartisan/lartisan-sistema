<?php

// Zona horaria única entre navegador (UTC), PHP y MySQL.
// Uso: LARTISAN_CONFIG=dev/config.dev.php php tests/timezone.php
declare(strict_types=1);

$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../donweb-api/bootstrap.php';

$failures = 0;
function check(string $label, bool $condition, string $detail = ''): void
{
    global $failures;
    echo ($condition ? 'ok   ' : 'FALLA') . " $label" . ($detail !== '' ? " ($detail)" : '') . "\n";
    if (!$condition) $failures++;
}

check('PHP usa la hora de Argentina por defecto', date_default_timezone_get() === ($config['timezone'] ?? 'America/Argentina/Buenos_Aires'), date_default_timezone_get());
$night = iso_datetime('2026-10-01T00:30:00.000Z');
check('una venta de las 21:30 (00:30 UTC) queda en su día', $night === '2026-09-30 21:30:00', (string) $night);
check('una fecha ISO con offset se respeta', iso_datetime('2026-09-30T21:30:00-03:00') === '2026-09-30 21:30:00');

try {
    $pdo = db($config);
    $databaseNow = strtotime((string) $pdo->query('SELECT NOW()')->fetchColumn());
    check('MySQL y PHP marcan la misma hora', abs($databaseNow - time()) < 5, 'diferencia ' . ($databaseNow - time()) . ' s');
} catch (Throwable $error) {
    echo "omitido: sin base de datos ({$error->getMessage()})\n";
}

echo $failures === 0 ? "\nTodas las reglas se cumplen.\n" : "\n$failures reglas fallaron.\n";
exit($failures === 0 ? 0 : 1);
