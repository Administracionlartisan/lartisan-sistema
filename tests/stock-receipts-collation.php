<?php
declare(strict_types=1);
// Exclusively the disposable local development database, never production.
// Producción tenía lartisan_stock_movements y stock_receipt_review_events con
// collations distintas: el listado de ingresos fallaba con SQLSTATE 1267.
$configPath = realpath(__DIR__ . '/../dev/config.dev.php');
putenv('LARTISAN_CONFIG=' . $configPath);
require __DIR__ . '/../donweb-api/bootstrap.php';
require __DIR__ . '/../donweb-api/stock_receipts.php';
$config = require $configPath;
if ($config['database']['name'] !== 'lartisan_dev' || $config['database']['host'] !== '127.0.0.1;port=3313') throw new RuntimeException('Refusing non-test database');
$pdo = db($config);

// Se prueban las dos combinaciones: no se sabe cuál de las tablas quedó con general_ci.
foreach ([['utf8mb4_general_ci', 'utf8mb4_unicode_ci'], ['utf8mb4_unicode_ci', 'utf8mb4_general_ci']] as [$movementsCollation, $reviewsCollation]) {
    // Las tablas temporales tapan a las reales solo en esta conexión y se borran al terminar.
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS lartisan_stock_movements');
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS stock_receipt_review_events');
    $pdo->exec("CREATE TEMPORARY TABLE lartisan_stock_movements (
        id CHAR(36) NOT NULL PRIMARY KEY, site VARCHAR(80) NOT NULL, product_id INT UNSIGNED NOT NULL,
        movement_type VARCHAR(60) NOT NULL, quantity DECIMAL(14,3) NOT NULL, remito VARCHAR(120) NULL,
        detail VARCHAR(500) NULL, occurred_at DATETIME NULL, created_by VARCHAR(190) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=$movementsCollation");
    $pdo->exec("CREATE TEMPORARY TABLE stock_receipt_review_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, movement_id CHAR(36) NOT NULL, site VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL, observation VARCHAR(500) NOT NULL, reviewer_id INT NOT NULL, reviewer_name VARCHAR(190) NOT NULL,
        reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=$reviewsCollation");
    $movementId = '11111111-2222-4333-a444-555555555555';
    $pdo->prepare("INSERT INTO lartisan_stock_movements (id, site, product_id, movement_type, quantity, occurred_at) VALUES (?, 'Maure', 1, 'Ingreso por remito', 5, NOW())")->execute([$movementId]);
    $pdo->prepare("INSERT INTO stock_receipt_review_events (movement_id, site, status, observation, reviewer_id, reviewer_name) VALUES (?, 'Maure', 'revisado', '', 1, 'Prueba')")->execute([$movementId]);

    $movements = list_stock_receipt_movements($pdo, 'Maure', 0);
    if (count($movements) !== 1 || $movements[0]['id'] !== $movementId || $movements[0]['review_status'] !== 'revisado') {
        throw new RuntimeException('El listado de ingresos no devolvió el ingreso revisado: ' . json_encode($movements));
    }
    echo "OK ingresos con movimientos $movementsCollation y revisiones $reviewsCollation\n";
}
