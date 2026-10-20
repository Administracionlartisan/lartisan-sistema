<?php

// Crea las tablas base y usuarios de prueba en la base LOCAL.
// Uso: php dev/seed.php   (se niega a correr si la base no es lartisan_dev)
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);
$configPath = getenv('LARTISAN_CONFIG') ?: __DIR__ . '/config.dev.php';
$config = require $configPath;
$database = $config['database'];
if ($database['name'] !== 'lartisan_dev') {
    fwrite(STDERR, "Este script solo puede usarse con la base local lartisan_dev.\n");
    exit(1);
}
$pdo = new PDO(
    sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $database['host'], $database['name']),
    $database['user'],
    $database['password'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$schemaLines = array_filter(
    explode("\n", (string) file_get_contents(__DIR__ . '/schema-base.sql')),
    static fn (string $line): bool => !str_starts_with(trim($line), '--')
);
foreach (array_filter(array_map('trim', explode(';', implode("\n", $schemaLines)))) as $statement) {
    $pdo->exec($statement);
}

$password = 'Pruebas2026!';
$sites = ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure', 'Novo Pacheco'];
$users = [
    ['admin.pruebas', 'Administración de Prueba', 'administracion', $sites, 1, null],
    ['supervisora.pruebas', 'Supervisora de Prueba', 'supervisora', ['Recoleta', 'Congreso'], 0, ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'transferirCaja', 'exportar', 'aprobarEgresoMercaderia']],
    ['vendedora.pruebas', 'Vendedora de Prueba', 'vendedora', ['Recoleta'], 0, null],
    ['compras.pruebas', 'Compras de Prueba', 'compras', ['Villa Mitre'], 0, ['mrp']],
];
$insert = $pdo->prepare(
    'INSERT INTO users (username, full_name, password_hash, role, assigned_location, assigned_locations, access_all_locations, action_permissions, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), failed_attempts = 0, locked_until = NULL, active = 1, action_permissions = VALUES(action_permissions)'
);
foreach ($users as [$username, $name, $role, $locations, $all, $actions]) {
    $insert->execute([
        $username, $name, password_hash($password, PASSWORD_DEFAULT), $role, $locations[0],
        json_encode($locations, JSON_UNESCAPED_UNICODE), $all, $actions === null ? null : json_encode($actions),
    ]);
}
echo "Listo. Usuarios de prueba (clave $password):\n";
foreach ($users as [$username, , $role]) echo "  - $username ($role)\n";
