<?php
declare(strict_types=1);

// Las revisiones son independientes del estado operativo: nunca modifican stock.
function ensure_stock_receipt_review_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS stock_receipt_review_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        movement_id CHAR(36) NOT NULL, site VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL, observation VARCHAR(500) NOT NULL,
        reviewer_id INT NOT NULL, reviewer_name VARCHAR(190) NOT NULL,
        reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_receipt_review_movement (movement_id, id),
        INDEX idx_receipt_review_site (site, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

/**
 * Ingresos de mercadería con su última revisión. La collation va explícita en
 * el cruce: en producción las dos tablas quedaron con collations distintas
 * (unicode_ci y general_ci) y la comparación implícita fallaba siempre con
 * SQLSTATE 1267, dejando el listado vacío.
 */
function list_stock_receipt_movements(PDO $pdo, string $site, int $offset): array
{
    $query = $pdo->prepare("SELECT m.id, m.site, m.product_id, m.movement_type, m.quantity, m.remito, m.detail, m.occurred_at, m.created_by, r.status AS review_status, r.observation, r.reviewer_name, r.reviewed_at FROM lartisan_stock_movements m LEFT JOIN stock_receipt_review_events r ON r.id = (SELECT MAX(e.id) FROM stock_receipt_review_events e WHERE e.movement_id = m.id COLLATE utf8mb4_unicode_ci AND e.site = m.site COLLATE utf8mb4_unicode_ci) WHERE m.site = ? AND m.movement_type IN ('Ingreso por remito', 'Ingreso manual', 'Recepción de pedido') ORDER BY m.occurred_at DESC, m.id DESC LIMIT 101 OFFSET " . $offset);
    $query->execute([$site]);
    return $query->fetchAll();
}
