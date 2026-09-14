<?php

declare(strict_types=1);

const MRP_SPREADSHEET_ID = '1o0bcoAJUdCQ7VLskOSEM94ieBb1KHcd5O_Rz7h972fY';

function ensure_mrp_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_sync_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(20) NOT NULL,
        source_spreadsheet_id VARCHAR(128) NOT NULL,
        payload_json LONGTEXT NULL,
        payload_hash CHAR(64) NULL,
        rows_imported INT UNSIGNED NOT NULL DEFAULT 0,
        triggered_by BIGINT UNSIGNED NULL,
        error_message VARCHAR(1000) NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        INDEX idx_mrp_sync_status_date (status, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_purchase_orders (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_order_id VARCHAR(100) NULL,
        item_name VARCHAR(190) NOT NULL,
        provider_name VARCHAR(190) NULL,
        unit VARCHAR(40) NOT NULL,
        quantity DECIMAL(14,4) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Por pedir',
        notes VARCHAR(1000) NULL,
        row_version INT UNSIGNED NOT NULL DEFAULT 1,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mrp_orders_status_date (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_receipts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        purchase_order_id BIGINT UNSIGNED NOT NULL,
        quantity_received DECIMAL(14,4) NOT NULL,
        notes VARCHAR(1000) NULL,
        received_by BIGINT UNSIGNED NOT NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mrp_receipts_order (purchase_order_id, received_at),
        CONSTRAINT fk_mrp_receipts_order FOREIGN KEY (purchase_order_id) REFERENCES mrp_purchase_orders(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_weekly_controls (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        week_key VARCHAR(20) NOT NULL,
        item_name VARCHAR(190) NOT NULL,
        expected_quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
        actual_quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
        status VARCHAR(60) NOT NULL DEFAULT 'Pendiente',
        notes VARCHAR(1000) NULL,
        row_version INT UNSIGNED NOT NULL DEFAULT 1,
        updated_by BIGINT UNSIGNED NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mrp_control_week_item (week_key, item_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function require_mrp_user(PDO $pdo): array
{
    $user = require_user($pdo, ['administracion', 'supervisora', 'compras']);
    if (!user_can_action($user, 'mrp')) json_response(['ok' => false, 'error' => 'No tenés permiso para consultar MRP'], 403);
    return $user;
}

function mrp_number($value): float
{
    $raw = trim((string) $value);
    if ($raw === '') return 0.0;
    $raw = preg_replace('/[^0-9,\.\-]/', '', $raw) ?? '';
    if (str_contains($raw, ',') && str_contains($raw, '.')) $raw = str_replace('.', '', $raw);
    if (str_contains($raw, ',')) $raw = str_replace(',', '.', $raw);
    return is_numeric($raw) ? (float) $raw : 0.0;
}

function mrp_fetch_ranges(array $config): array
{
    $token = pnl_access_token($config);
    $ranges = [
        "'00_Control_Semanal_MRP'!A1:D30",
        "'04_Plan_Produccion_Semanal'!A1:L500",
        "'05_Resumen_Compras_y_Produccion'!A1:U500",
        "'09_Lista_Compras_Operativa'!A1:U500",
    ];
    $query = implode('&', array_map(static fn (string $range): string => 'ranges=' . rawurlencode($range), $ranges));
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode(MRP_SPREADSHEET_ID) . '/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&' . $query;
    $response = pnl_http($url, ['headers' => ['Authorization: Bearer ' . $token]]);
    $valueRanges = $response['json']['valueRanges'] ?? null;
    if ($response['status'] !== 200 || !is_array($valueRanges) || count($valueRanges) !== count($ranges)) {
        throw new RuntimeException('Google no devolvió una copia válida del MRP.');
    }
    return array_map(static fn (array $range): array => is_array($range['values'] ?? null) ? $range['values'] : [], $valueRanges);
}

function mrp_rows(array $values, int $headerIndex, array $fields, int $limit = 300): array
{
    $header = $values[$headerIndex] ?? [];
    $positions = [];
    foreach ($fields as $key => $labels) {
        foreach ((array) $labels as $label) {
            $position = array_search($label, $header, true);
            if ($position !== false) { $positions[$key] = $position; break; }
        }
    }
    $rows = [];
    foreach (array_slice($values, $headerIndex + 1) as $row) {
        if (!is_array($row) || trim((string) ($row[0] ?? '')) === '') continue;
        $item = [];
        foreach ($positions as $key => $position) $item[$key] = $row[$position] ?? null;
        $rows[] = $item;
        if (count($rows) >= $limit) break;
    }
    return $rows;
}

function mrp_build_snapshot(array $ranges): array
{
    [$guide, $planValues, $summaryValues, $listValues] = $ranges;
    $plan = mrp_rows($planValues, 6, [
        'product' => 'Producto terminado', 'unit' => 'Unidad', 'stock' => 'Stock actual PT',
        'safetyStock' => 'Stock seguridad PT', 'confirmedOrder' => 'Pedido semanal confirmado',
        'suggestedProduction' => 'Producción sugerida', 'finalProduction' => 'Cantidad final a producir',
        'included' => 'Incluir en MRP', 'sentToMrp' => 'Cantidad enviada al MRP', 'status' => 'Estado', 'notes' => 'Observaciones',
    ]);
    $requirements = mrp_rows($summaryValues, 4, [
        'item' => 'Insumo / Subreceta', 'category' => 'Categoría', 'unit' => 'Unidad',
        'required' => 'Requerido Total', 'stock' => 'Stock Actual', 'safetyStock' => 'Stock Seguridad',
        'netNeed' => 'Necesidad Neta', 'unitCost' => 'Costo Unitario', 'estimatedCost' => 'Costo Necesidad',
        'action' => 'Acción', 'observation' => 'Observación', 'provider' => 'Proveedor',
        'directRequirement' => 'Requerido Nivel 0', 'subrecipeRequirement' => 'Requerido Subrecetas',
    ]);
    $operational = mrp_rows($listValues, 4, [
        'item' => ['Insumo / Subreceta', 'Insumo/Subreceta'], 'category' => 'Categoría', 'unit' => 'Unidad MRP',
        'required' => ['Requerido total', 'Requerido Total'], 'stock' => ['Stock actual', 'Stock Actual'],
        'safetyStock' => ['Stock seguridad', 'Stock Seguridad'], 'netNeed' => ['Necesidad neta', 'Necesidad Neta'],
        'action' => 'Acción MRP', 'provider' => 'Proveedor compra', 'suggestedQuantity' => 'Cantidad sugerida acción',
        'unitCost' => ['Costo unitario', 'Costo Unitario'], 'estimatedCost' => ['Costo estimado', 'Costo Estimado'],
        'status' => 'Estado operativo', 'notes' => 'Observaciones',
    ]);
    $buy = array_values(array_filter($operational, static fn (array $row): bool => mb_strtoupper(trim((string) ($row['action'] ?? '')), 'UTF-8') === 'COMPRAR' && mrp_number($row['netNeed'] ?? 0) > 0));
    $prepare = array_values(array_filter($operational, static fn (array $row): bool => mb_strtoupper(trim((string) ($row['action'] ?? '')), 'UTF-8') === 'PREPARAR' && mrp_number($row['netNeed'] ?? 0) > 0));
    $technicalChecks = [];
    foreach ($plan as $row) {
        $expected = max(0, mrp_number($row['safetyStock'] ?? 0) - mrp_number($row['stock'] ?? 0)) + mrp_number($row['confirmedOrder'] ?? 0);
        $actual = mrp_number($row['suggestedProduction'] ?? 0);
        if (abs($expected - $actual) > 0.001) $technicalChecks[] = ['item' => $row['product'] ?? '', 'expected' => $expected, 'actual' => $actual];
    }
    return [
        'source' => ['spreadsheetId' => MRP_SPREADSHEET_ID, 'title' => 'MRP LArtisan - OPERATIVO OPTIMIZADO', 'mode' => 'read_only'],
        'kpis' => ['estimatedNetCost' => mrp_number($summaryValues[2][1] ?? 0), 'buyItems' => count($buy), 'prepareItems' => count($prepare), 'alerts' => (int) mrp_number($summaryValues[2][7] ?? 0)],
        'weeklyGuide' => array_slice(array_values(array_filter(array_slice($guide, 4), static fn ($row): bool => is_array($row) && isset($row[0]) && is_numeric((string) $row[0]))), 0, 10),
        'plan' => $plan, 'requirements' => $requirements, 'buy' => $buy, 'prepare' => $prepare,
        'validation' => ['status' => count($technicalChecks) === 0 ? 'ok' : 'differences', 'checkedLines' => count($plan), 'differences' => array_slice($technicalChecks, 0, 20), 'managementApproval' => 'pending'],
    ];
}

function mrp_sync_from_google(PDO $pdo, array $config, int $userId): array
{
    ensure_mrp_schema($pdo);
    $pdo->prepare("INSERT INTO mrp_sync_runs (status, source_spreadsheet_id, triggered_by, started_at) VALUES ('running', ?, ?, NOW())")
        ->execute([MRP_SPREADSHEET_ID, $userId]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $snapshot = mrp_build_snapshot(mrp_fetch_ranges($config));
        $payload = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia MRP.');
        $rows = count($snapshot['plan']) + count($snapshot['requirements']);
        $pdo->prepare("UPDATE mrp_sync_runs SET status='verified', payload_json=?, payload_hash=?, rows_imported=?, finished_at=NOW() WHERE id=?")
            ->execute([$payload, hash('sha256', $payload), $rows, $runId]);
        audit($pdo, $userId, 'mrp_synced_read_only', 'filas=' . $rows);
        return ['data' => $snapshot, 'rowsImported' => $rows, 'updatedAt' => date('Y-m-d H:i:s')];
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE mrp_sync_runs SET status='failed', error_message=?, finished_at=NOW() WHERE id=?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, $userId, 'mrp_sync_failed');
        throw $error;
    }
}

function mrp_clean_text($value, int $max): string
{
    return mb_substr(trim((string) $value), 0, $max, 'UTF-8');
}
