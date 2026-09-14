<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/pnl_sync.php';
require __DIR__ . '/mrp_sync.php';
require __DIR__ . '/assistant.php';

configure_cors($config);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string) ($_GET['route'] ?? ''), '/');
try {
    $pdo = db($config);
} catch (Throwable $error) {
    error_log('LARTISAN API database initialization failed: ' . $error->getMessage());
    json_response(['ok' => false, 'error' => 'database_initialization_failed', 'type' => get_class($error)], 503);
}
if ($method === 'GET' && ($route === '' || $route === 'health')) {
    $pdo->query('SELECT 1');
    json_response(['ok' => true, 'service' => 'lartisan-api']);
}
try {
    ensure_user_locations_schema($pdo);
    // Mantiene listas las tablas operativas aun antes de la primera venta.
    ensure_operations_schema($pdo);
    ensure_mrp_schema($pdo);
} catch (Throwable $error) {
    error_log('LARTISAN API schema initialization failed: ' . $error->getMessage());
    json_response(['ok' => false, 'error' => 'schema_initialization_failed', 'type' => get_class($error)], 503);
}
$pdo->exec(
    "CREATE TABLE IF NOT EXISTS password_recovery_codes (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        requested_ip VARCHAR(45) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recovery_user_created (user_id, created_at),
        INDEX idx_recovery_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
);

if ($method === 'GET' && $route === 'admin/pnl/google-callback') {
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    $stateHash = hash('sha256', $state);
    ensure_pnl_sync_schema($pdo);
    $lookup = $pdo->prepare('SELECT user_id FROM pnl_oauth_states WHERE state_hash = ? AND expires_at > NOW() LIMIT 1');
    $lookup->execute([$stateHash]);
    $userId = $lookup->fetchColumn();
    $pdo->prepare('DELETE FROM pnl_oauth_states WHERE state_hash = ?')->execute([$stateHash]);
    $success = false;
    $message = 'No se pudo validar la autorización de Google.';
    try {
        if (!$userId || $code === '') throw new RuntimeException($message);
        pnl_exchange_authorization_code($config, $code);
        audit($pdo, (int) $userId, 'pnl_google_connected', 'lectura_solo');
        $success = true;
        $message = 'Google quedó conectado con permiso de solo lectura. Ya podés volver a Administración y actualizar el P&L.';
    } catch (Throwable $error) {
        $message = 'No se pudo conectar Google: ' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8');
    }
    http_response_code($success ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’ARTISAN · P&L</title><body style="font-family:Arial,sans-serif;padding:40px;color:#183a67"><h1>' . ($success ? 'Conexión lista' : 'No se pudo completar') . '</h1><p>' . $message . '</p><p><a href="https://admin.lartisantaller.com/">Volver a Administración</a></p></body></html>';
    exit;
}

if ($method === 'GET' && $route === 'admin/pnl/authorization-url') {
    $admin = require_user($pdo, ['administracion']);
    json_response(['ok' => true, 'authorizationUrl' => pnl_authorization_url($pdo, $config, (int) $admin['id'])]);
}

if ($method === 'GET' && $route === 'admin/pnl/latest') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM pnl_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = is_file(pnl_private_token_path());
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'rows' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/pnl/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM pnl_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['pnl_sync']['range'] ?? "'P&L Consolidado 2026 COPIA'!A1:AN220");
    if ($sheetId === '') json_response(['ok' => false, 'error' => 'La fuente financiera no está configurada en el servidor'], 503);
    $pdo->prepare("INSERT INTO pnl_sync_runs (status, source_spreadsheet_id, source_range, triggered_by, started_at) VALUES ('running', ?, ?, ?, NOW())")
        ->execute([$sheetId, $range, $admin['id']]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $rows = pnl_fetch_sheet_values($config);
        $payload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia de lectura del P&L.');
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'verified', rows_imported = ?, payload_json = ?, payload_hash = ?, finished_at = NOW() WHERE id = ?")
            ->execute([count($rows), $payload, hash('sha256', $payload), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_synced_from_google', 'filas=' . count($rows));
        json_response(['ok' => true, 'snapshot' => ['rows' => $rows, 'rowsImported' => count($rows), 'updatedAt' => date('Y-m-d H:i:s')]]);
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_sync_failed');
        json_response(['ok' => false, 'error' => 'No se pudo actualizar el P&L. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'admin/expenses/latest') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = is_file(pnl_private_token_path());
    $lastUpdate = $latest ? ($latest['finished_at'] ?: $latest['started_at']) : null;
    $stale = !$lastUpdate || strtotime((string) $lastUpdate) < (time() - 15 * 60);
    // Evita lecturas simultáneas desde varias pestañas y reintentos continuos
    // si Drive devuelve un error. Administración conserva "Actualizar ahora".
    $recentAttempt = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($connected && $stale && !$recentAttempt) {
        try {
            expense_sync_from_google($pdo, $config, (int) $admin['id']);
            $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
        } catch (Throwable $error) {
            error_log('LARTISAN automatic expense sync failed: ' . $error->getMessage());
        }
    }
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'data' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/expenses/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    try {
        json_response(['ok' => true, 'snapshot' => expense_sync_from_google($pdo, $config, (int) $admin['id'])]);
    } catch (Throwable $error) {
        json_response(['ok' => false, 'error' => 'No se pudieron actualizar gastos y cuentas por pagar. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'mrp/latest') {
    $mrpUser = require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $latest = $pdo->query("SELECT payload_json, rows_imported, started_at, finished_at FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetch();
    $lastUpdate = $latest ? ($latest['finished_at'] ?: $latest['started_at']) : null;
    $stale = !$lastUpdate || strtotime((string) $lastUpdate) < time() - 10 * 60;
    $recentAttempt = $pdo->query("SELECT started_at FROM mrp_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if (is_file(pnl_private_token_path()) && $stale && !$recentAttempt) {
        try {
            mrp_sync_from_google($pdo, $config, (int) $mrpUser['id']);
            $latest = $pdo->query("SELECT payload_json, rows_imported, started_at, finished_at FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetch();
        } catch (Throwable $error) {
            error_log('LARTISAN automatic MRP sync failed: ' . $error->getMessage());
        }
    }
    json_response(['ok' => true, 'connected' => is_file(pnl_private_token_path()), 'snapshot' => $latest ? [
        'data' => json_decode((string) $latest['payload_json'], true) ?: [],
        'rowsImported' => (int) $latest['rows_imported'],
        'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
    ] : null]);
}

if ($method === 'POST' && $route === 'mrp/sync') {
    $mrpUser = require_mrp_user($pdo);
    $last = $pdo->query("SELECT started_at FROM mrp_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'La lectura MRP ya se actualizó recientemente.'], 429);
    try {
        json_response(['ok' => true, 'snapshot' => mrp_sync_from_google($pdo, $config, (int) $mrpUser['id'])]);
    } catch (Throwable $error) {
        json_response(['ok' => false, 'error' => 'No se pudo actualizar el MRP. Se conserva la última copia válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'mrp/operations') {
    require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $orders = $pdo->query("SELECT o.*, COALESCE(SUM(r.quantity_received),0) AS received_quantity FROM mrp_purchase_orders o LEFT JOIN mrp_receipts r ON r.purchase_order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200")->fetchAll();
    $controls = $pdo->query("SELECT * FROM mrp_weekly_controls ORDER BY updated_at DESC LIMIT 200")->fetchAll();
    json_response(['ok' => true, 'orders' => $orders, 'controls' => $controls]);
}

if ($method === 'POST' && $route === 'mrp/orders') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $provider = mrp_clean_text($body['providerName'] ?? '', 190);
    $unit = mrp_clean_text($body['unit'] ?? '', 40);
    $quantity = (float) ($body['quantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if ($item === '' || $unit === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Completá insumo, unidad y una cantidad válida.'], 422);
    $pdo->prepare('INSERT INTO mrp_purchase_orders (item_name, provider_name, unit, quantity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$item, $provider ?: null, $unit, $quantity, $notes ?: null, $mrpUser['id']]);
    $id = (int) $pdo->lastInsertId();
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_created', 'order_id=' . $id);
    json_response(['ok' => true, 'id' => $id], 201);
}

if ($method === 'PATCH' && preg_match('#^mrp/orders/(\d+)$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $id = (int) $matches[1];
    $version = (int) ($body['rowVersion'] ?? 0);
    $status = mrp_clean_text($body['status'] ?? '', 30);
    if (!in_array($status, ['Por pedir', 'Pedido', 'Recibido', 'Cancelado'], true) || $version < 1) json_response(['ok' => false, 'error' => 'Estado o versión inválida.'], 422);
    $stmt = $pdo->prepare('UPDATE mrp_purchase_orders SET status=?, row_version=row_version+1 WHERE id=? AND row_version=?');
    $stmt->execute([$status, $id, $version]);
    if ($stmt->rowCount() !== 1) json_response(['ok' => false, 'error' => 'Otro usuario actualizó esta orden. Volvé a cargarla.'], 409);
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_updated', 'order_id=' . $id);
    json_response(['ok' => true, 'rowVersion' => $version + 1]);
}

if ($method === 'POST' && preg_match('#^mrp/orders/(\d+)/receipts$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $orderId = (int) $matches[1];
    $body = request_body();
    $quantity = (float) ($body['quantityReceived'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Indicá una cantidad recibida válida.'], 422);
    $exists = $pdo->prepare('SELECT id FROM mrp_purchase_orders WHERE id=?');
    $exists->execute([$orderId]);
    if (!$exists->fetchColumn()) json_response(['ok' => false, 'error' => 'Orden no encontrada.'], 404);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO mrp_receipts (purchase_order_id, quantity_received, notes, received_by) VALUES (?, ?, ?, ?)')
            ->execute([$orderId, $quantity, $notes ?: null, $mrpUser['id']]);
        $pdo->prepare("UPDATE mrp_purchase_orders o SET status=IF((SELECT COALESCE(SUM(quantity_received),0) FROM mrp_receipts WHERE purchase_order_id=o.id)>=o.quantity,'Recibido','Pedido'), row_version=row_version+1 WHERE id=?")
            ->execute([$orderId]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_receipt_recorded', 'order_id=' . $orderId);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true], 201);
}

if ($method === 'POST' && $route === 'mrp/controls') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $week = mrp_clean_text($body['weekKey'] ?? '', 20);
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $expected = (float) ($body['expectedQuantity'] ?? 0);
    $actual = (float) ($body['actualQuantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!preg_match('/^\d{4}-S\d{1,2}$/', $week) || $item === '' || !is_finite($expected) || !is_finite($actual) || $expected < 0 || $actual < 0) json_response(['ok' => false, 'error' => 'Control semanal inválido.'], 422);
    $difference = $actual - $expected;
    $status = abs($difference) < 0.0001 ? 'OK' : ($difference > 0 ? 'Comprado de más' : 'Comprado de menos');
    $pdo->prepare("INSERT INTO mrp_weekly_controls (week_key,item_name,expected_quantity,actual_quantity,status,notes,updated_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE expected_quantity=VALUES(expected_quantity),actual_quantity=VALUES(actual_quantity),status=VALUES(status),notes=VALUES(notes),updated_by=VALUES(updated_by),row_version=row_version+1")
        ->execute([$week, $item, $expected, $actual, $status, $notes ?: null, $mrpUser['id']]);
    audit($pdo, (int) $mrpUser['id'], 'mrp_weekly_control_updated', $week . ' ' . $item);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'POST' && $route === 'auth/login') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        json_response(['ok' => false, 'error' => 'Usuario y contraseña son obligatorios'], 422);
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    $locked = $user && $user['locked_until'] && strtotime($user['locked_until']) > time();
    if (!$user || !(bool) $user['active'] || $locked || !password_verify($password, $user['password_hash'])) {
        if ($user && !$locked) {
            $attempts = (int) $user['failed_attempts'] + 1;
            $lockUntil = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 15 * 60) : null;
            $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
                ->execute([$attempts, $lockUntil, $user['id']]);
            audit($pdo, (int) $user['id'], 'login_failed');
        } else {
            audit($pdo, null, 'login_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'Credenciales inválidas'], 401);
    }

    $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$user['id']]);
    create_session($pdo, (int) $user['id'], $config);
    audit($pdo, (int) $user['id'], 'login_success');
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

if ($method === 'POST' && $route === 'auth/logout') {
    $user = current_user($pdo);
    clear_session($pdo, $config);
    audit($pdo, $user ? (int) $user['id'] : null, 'logout');
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'auth/me') {
    $user = require_user($pdo);
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

if ($method === 'POST' && $route === 'assistant/chat') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'Escribí una pregunta para consultar al asistente.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_chat_messages WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 12) {
        json_response(['ok' => false, 'error' => 'Alcanzaste el límite momentáneo. Esperá unos minutos antes de volver a consultar.'], 429);
    }
    $insert = $pdo->prepare("INSERT INTO ai_chat_messages (user_id, role_snapshot, site, section_name, question, status) VALUES (?, ?, ?, ?, ?, 'processing')");
    $insert->execute([(int) $user['id'], $user['role'], $site ?: null, $section ?: null, $question]);
    $messageId = (int) $pdo->lastInsertId();
    try {
        $result = assistant_openai_response($config, $user, $site, $section, $question, $history);
        $pdo->prepare("UPDATE ai_chat_messages SET answer = ?, status = 'answered', request_id = ? WHERE id = ?")
            ->execute([$result['answer'], $result['requestId'] ?: null, $messageId]);
        audit($pdo, (int) $user['id'], 'ai_assistant_question', 'message_id=' . $messageId);
        json_response(['ok' => true, 'messageId' => $messageId, 'answer' => $result['answer']]);
    } catch (Throwable $error) {
        error_log('LARTISAN assistant failed: ' . $error->getMessage());
        $pdo->prepare("UPDATE ai_chat_messages SET status = 'failed' WHERE id = ?")->execute([$messageId]);
        $notConfigured = $error->getMessage() === 'assistant_not_configured';
        json_response([
            'ok' => false,
            'messageId' => $messageId,
            'error' => $notConfigured
                ? 'El asistente está instalado y pendiente de activar por Administración.'
                : 'El asistente no pudo responder ahora. Podés enviar la consulta a Administración.',
        ], 503);
    }
}

if ($method === 'POST' && $route === 'assistant/escalate') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $chatMessageId = filter_var($body['messageId'] ?? null, FILTER_VALIDATE_INT) ?: null;
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'No hay una consulta para enviar.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_support_requests WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 5) {
        json_response(['ok' => false, 'error' => 'Ya enviaste varias consultas hoy. Administración las revisará desde su bandeja.'], 429);
    }
    $stmt = $pdo->prepare("INSERT INTO ai_support_requests (chat_message_id, user_id, username_snapshot, role_snapshot, site, section_name, question) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$chatMessageId, (int) $user['id'], $user['full_name'], $user['role'], $site ?: null, $section ?: null, $question]);
    $requestId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $user['id'], 'ai_support_requested', 'request_id=' . $requestId);
    json_response(['ok' => true, 'requestId' => $requestId, 'message' => 'Consulta enviada a Administración.']);
}

if ($method === 'GET' && $route === 'admin/assistant-requests') {
    require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $rows = $pdo->query("SELECT id, username_snapshot, role_snapshot, site, section_name, question, status, created_at, resolved_at FROM ai_support_requests ORDER BY (status = 'pendiente') DESC, created_at DESC LIMIT 100")->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'PATCH' && preg_match('#^admin/assistant-requests/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $requestId = (int) $matches[1];
    $pdo->prepare("UPDATE ai_support_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ? AND status = 'pendiente'")
        ->execute([(int) $admin['id'], $requestId]);
    audit($pdo, (int) $admin['id'], 'ai_support_resolved', 'request_id=' . $requestId);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/change-password') {
    $user = require_user($pdo);
    $body = request_body();
    $currentPassword = (string) ($body['currentPassword'] ?? '');
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!password_verify($currentPassword, $user['password_hash'])) {
        json_response(['ok' => false, 'error' => 'La contraseña actual no es correcta'], 422);
    }
    if (!valid_password($newPassword)) {
        json_response(['ok' => false, 'error' => 'La nueva contraseña no cumple los requisitos'], 422);
    }
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        ->execute([$hash, $user['id']]);
    $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$user['id']]);
    audit($pdo, (int) $user['id'], 'password_changed');
    clear_session($pdo, $config);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/request-reset') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $stmt = $pdo->prepare('SELECT id, role FROM users WHERE username = ? AND active = 1 LIMIT 1');
    $stmt->execute([$username]);
    $resetUser = $stmt->fetch();

    if ($resetUser && $resetUser['role'] === 'administracion') {
        $userId = (int) $resetUser['id'];
        $recent = $pdo->prepare(
            'SELECT created_at FROM password_recovery_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1'
        );
        $recent->execute([$userId]);
        $lastCreated = $recent->fetchColumn();
        if ($lastCreated && strtotime((string) $lastCreated) > time() - 60) {
            json_response([
                'ok' => false,
                'error' => 'Esperá un minuto antes de solicitar otro código.',
            ], 429);
        }
        $hourly = $pdo->prepare(
            'SELECT COUNT(*) FROM password_recovery_codes
             WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
        );
        $hourly->execute([$userId]);
        if ((int) $hourly->fetchColumn() >= 5) {
            json_response([
                'ok' => false,
                'error' => 'Se alcanzó el límite de códigos. Intentá nuevamente dentro de una hora.',
            ], 429);
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 15 * 60);
        $pdo->prepare(
            'INSERT INTO password_recovery_codes
             (user_id, code_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?)'
        )->execute([$userId, password_hash($code, PASSWORD_DEFAULT), $expiresAt, client_ip()]);
        $recoveryId = (int) $pdo->lastInsertId();
        $destination = trim((string) ($config['admin_recovery_email'] ?? ''));
        if ($destination === '') {
            audit($pdo, (int) $user['id'], 'password_recovery_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $from = trim((string) ($config['recovery_from_email'] ?? ''));
        if ($from === '') {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_sender_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $subject = "Codigo de recuperacion - L'ARTISAN";
        $emailBody = "Se solicito recuperar el acceso de Administracion.\n\n"
            . "Codigo: {$code}\n\n"
            . "El codigo vence en 15 minutos y solo puede usarse una vez.\n"
            . "Si no solicitaste este cambio, ignora este correo.";
        $headers = [
            'From: Sistema LARTISAN <' . $from . '>',
            'Reply-To: ' . $destination,
            'Content-Type: text/plain; charset=UTF-8',
            'X-Mailer: PHP/' . PHP_VERSION,
        ];
        if (!mail($destination, $subject, $emailBody, implode("\r\n", $headers))) {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_email_failed');
            json_response([
                'ok' => false,
                'error' => 'No pudimos enviar el código. Intentá nuevamente en unos minutos.',
            ], 503);
        }
        audit($pdo, $userId, 'password_recovery_code_sent');
        json_response([
            'ok' => true,
            'delivery' => 'email_code',
            'message' => 'Enviamos un código de 6 dígitos al correo de Administración.',
        ]);
    }

    if ($resetUser) {
        $userId = (int) $resetUser['id'];
        $pending = $pdo->prepare(
            "SELECT id FROM password_reset_requests
             WHERE user_id = ? AND status = 'pendiente' AND requested_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)"
        );
        $pending->execute([$userId]);
        if (!$pending->fetchColumn()) {
            $pdo->prepare('INSERT INTO password_reset_requests (user_id) VALUES (?)')->execute([$userId]);
            audit($pdo, (int) $userId, 'password_reset_requested');
        }
    }
    json_response(['ok' => true, 'message' => 'Si el usuario existe, Administración recibirá la solicitud.']);
}

if ($method === 'POST' && $route === 'auth/confirm-reset-code') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $code = trim((string) ($body['code'] ?? ''));
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!preg_match('/^\d{6}$/', $code) || !valid_password($newPassword)) {
        json_response([
            'ok' => false,
            'error' => 'Revisá el código y usá una contraseña segura de al menos 8 caracteres.',
        ], 422);
    }
    $stmt = $pdo->prepare(
        "SELECT c.*, u.id AS account_id
         FROM password_recovery_codes c
         JOIN users u ON u.id = c.user_id
         WHERE u.username = ? AND u.role = 'administracion' AND u.active = 1
           AND c.used_at IS NULL AND c.expires_at > NOW() AND c.attempts < 5
         ORDER BY c.id DESC LIMIT 1"
    );
    $stmt->execute([$username]);
    $recovery = $stmt->fetch();
    if (!$recovery || !password_verify($code, $recovery['code_hash'])) {
        if ($recovery) {
            $pdo->prepare('UPDATE password_recovery_codes SET attempts = attempts + 1 WHERE id = ?')
                ->execute([$recovery['id']]);
            audit($pdo, (int) $recovery['account_id'], 'password_recovery_code_failed');
        } else {
            audit($pdo, null, 'password_recovery_code_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'El código es incorrecto o venció.'], 422);
    }

    $userId = (int) $recovery['account_id'];
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE users SET password_hash = ?, must_change_password = 0,
             failed_attempts = 0, locked_until = NULL WHERE id = ?'
        )->execute([password_hash($newPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare('UPDATE password_recovery_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')
            ->execute([$userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, $userId, 'password_recovered_by_email');
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    clear_session($pdo, $config);
    json_response(['ok' => true, 'message' => 'Contraseña actualizada. Ya podés ingresar.']);
}

if ($method === 'GET' && $route === 'operations/states') {
    $user = require_user($pdo);
    ensure_operations_schema($pdo);
    $allowedSites = array_values(array_filter(
        operational_sites(),
        static fn (string $site): bool => user_can_access_site($user, $site)
    ));
    if (!$allowedSites) {
        json_response(['ok' => true, 'states' => []]);
    }
    $placeholders = implode(',', array_fill(0, count($allowedSites), '?'));
    $stmt = $pdo->prepare(
        "SELECT site, state_json, revision, updated_at FROM operation_site_states WHERE site IN ($placeholders)"
    );
    $stmt->execute($allowedSites);
    $states = [];
    foreach ($stmt->fetchAll() as $row) {
        $state = json_decode((string) $row['state_json'], true);
        if (is_array($state)) {
            $states[$row['site']] = [
                'state' => operational_snapshot_for_user($user, $state),
                'revision' => (int) $row['revision'],
                'updatedAt' => $row['updated_at'],
            ];
        }
    }
    json_response(['ok' => true, 'states' => $states]);
}

if ($method === 'PUT' && preg_match('#^operations/states/([^/]+)$#', $route, $matches)) {
    $user = require_user($pdo);
    if (!empty($user['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal'], 403);
    }
    ensure_operations_schema($pdo);
    $site = rawurldecode($matches[1]);
    if (!user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a este local'], 403);
    }
    $body = request_body();
    $baseRevision = max(0, (int) ($body['baseRevision'] ?? 0));
    $requestId = trim((string) ($body['requestId'] ?? ''));
    $baseState = $body['baseState'] ?? null;
    $state = $body['state'] ?? null;
    if (!is_array($state) || !preg_match('/^[a-f0-9-]{36}$/i', $requestId)) {
        json_response(['ok' => false, 'error' => 'Datos operativos inválidos'], 422);
    }
    $pdo->beginTransaction();
    try {
        $requestLookup = $pdo->prepare('SELECT revision FROM operation_requests WHERE request_id = ? AND site = ? LIMIT 1');
        $requestLookup->execute([$requestId, $site]);
        $processedRevision = $requestLookup->fetchColumn();
        if ($processedRevision !== false) {
            $pdo->commit();
            json_response(['ok' => true, 'revision' => (int) $processedRevision, 'alreadyProcessed' => true]);
        }
        $revisionStatement = $pdo->prepare('SELECT revision, state_json FROM operation_site_states WHERE site = ? FOR UPDATE');
        $revisionStatement->execute([$site]);
        $currentRow = $revisionStatement->fetch();
        $currentRevision = $currentRow === false ? false : (int) $currentRow['revision'];
        $previousState = $currentRow === false ? [] : (json_decode((string) $currentRow['state_json'], true) ?: []);
        $authorizedIncoming = authorize_operational_snapshot($user, $previousState, $state);
        $merged = false;
        if ($currentRow !== false && (int) $currentRevision !== $baseRevision) {
            if (!is_array($baseState)) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'Otro equipo actualizó este local', 'currentRevision' => (int) $currentRevision], 409);
            }
            $state = merge_operational_snapshot($baseState, $previousState, $authorizedIncoming);
            $merged = true;
        } else {
            $state = $authorizedIncoming;
        }
        $changedKeys = array_values(array_filter(array_unique(array_merge(array_keys($previousState), array_keys($state))), static function ($key) use ($previousState, $state): bool {
            return ($previousState[$key] ?? null) !== ($state[$key] ?? null);
        }));
        $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $clientEvent = is_array($body['event'] ?? null) ? $body['event'] : [];
        $eventJson = json_encode([
            'changedKeys' => $changedKeys,
            'recordedAt' => gmdate('c'),
            'requestId' => $requestId,
            'mergedConcurrentChanges' => $merged,
            'event' => [
                'action' => substr((string) ($clientEvent['action'] ?? 'Actualización operativa'), 0, 160),
                'detail' => substr((string) ($clientEvent['detail'] ?? ''), 0, 800),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($stateJson === false || $eventJson === false || strlen($stateJson) > 4_000_000) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'La operación supera el tamaño permitido'], 422);
        }
        if ($currentRow === false) {
            if ($baseRevision !== 0) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'La versión del local cambió', 'currentRevision' => 0], 409);
            }
            $pdo->prepare('INSERT INTO operation_site_states (site, state_json, revision, updated_by) VALUES (?, ?, 1, ?)')
                ->execute([$site, $stateJson, $user['id']]);
        } else {
            $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE site = ?')
                ->execute([$stateJson, $user['id'], $site]);
        }
        $pdo->prepare(
            'INSERT INTO operation_events (site, user_id, event_type, event_json) VALUES (?, ?, ?, ?)'
        )->execute([$site, $user['id'], 'operacion_actualizada', $eventJson]);
        sync_normalized_operations($pdo, $site, $state, (int) $user['id']);
        audit($pdo, (int) $user['id'], 'operational_state_updated', $site);
        $nextRevision = $currentRow === false ? 1 : ((int) $currentRevision + 1);
        $pdo->prepare('INSERT INTO operation_requests (request_id, site, user_id, revision) VALUES (?, ?, ?, ?)')
            ->execute([$requestId, $site, $user['id'], $nextRevision]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    $revision = (int) $pdo->query("SELECT revision FROM operation_site_states WHERE site = " . $pdo->quote($site))->fetchColumn();
    json_response(['ok' => true, 'revision' => $revision, 'merged' => $merged ?? false, 'state' => ($merged ?? false) ? operational_snapshot_for_user($user, $state) : null]);
}

if ($method === 'POST' && $route === 'monitoring/heartbeat') {
    require_user($pdo);
    $result = notify_monitoring_alerts($pdo, $config);
    json_response(['ok' => true, 'notification' => $result]);
}

if ($method === 'GET' && $route === 'admin/audit') {
    require_user($pdo, ['administracion']);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $userFilter = trim((string) ($_GET['user'] ?? ''));
    $actionFilter = trim((string) ($_GET['action'] ?? ''));
    $sql = "SELECT e.id, e.site, e.event_json, e.created_at, COALESCE(u.full_name, 'Sistema') AS user_name
            FROM operation_events e LEFT JOIN users u ON u.id = e.user_id
            WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND e.site = ?'; $params[] = $siteFilter; }
    if ($userFilter !== '') { $sql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $params[] = 'Sistema'; $params[] = '%' . $userFilter . '%'; }
    if ($actionFilter !== '') { $sql .= ' AND e.event_json LIKE ?'; $params[] = '%' . $actionFilter . '%'; }
    $sql .= ' ORDER BY e.created_at DESC, e.id DESC LIMIT 1000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $events = [];
    foreach ($statement->fetchAll() as $row) {
        $payload = json_decode((string) $row['event_json'], true) ?: [];
        $event = is_array($payload['event'] ?? null) ? $payload['event'] : [];
        $events[] = [
            'id' => 'operation-' . $row['id'], 'at' => $row['created_at'], 'site' => $row['site'],
            'userName' => $row['user_name'], 'action' => (string) ($event['action'] ?? $payload['eventType'] ?? 'Actualización operativa'),
            'detail' => (string) ($event['detail'] ?? implode(', ', $payload['changedKeys'] ?? [])),
        ];
    }
    if ($siteFilter === '') {
        $auditSql = "SELECT a.id, a.event_type, a.event_detail, a.created_at, COALESCE(u.full_name, 'Sistema') AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
        $auditParams = [$from, $to];
        if ($userFilter !== '') { $auditSql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $auditParams[] = 'Sistema'; $auditParams[] = '%' . $userFilter . '%'; }
        if ($actionFilter !== '') { $auditSql .= ' AND (a.event_type LIKE ? OR a.event_detail LIKE ?)'; $auditParams[] = '%' . $actionFilter . '%'; $auditParams[] = '%' . $actionFilter . '%'; }
        $auditSql .= ' ORDER BY a.created_at DESC LIMIT 1000';
        $auditStatement = $pdo->prepare($auditSql); $auditStatement->execute($auditParams);
        foreach ($auditStatement->fetchAll() as $row) $events[] = [
            'id' => 'security-' . $row['id'], 'at' => $row['created_at'], 'site' => 'General', 'userName' => $row['user_name'],
            'action' => str_replace('_', ' ', (string) $row['event_type']), 'detail' => (string) ($row['event_detail'] ?? ''),
        ];
        usort($events, static fn (array $left, array $right): int => strcmp((string) $right['at'], (string) $left['at']));
        $events = array_slice($events, 0, 1000);
    }
    json_response(['ok' => true, 'events' => $events]);
}

if ($method === 'GET' && $route === 'admin/cash-history') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount FROM lartisan_cash_sessions WHERE opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY opened_at DESC LIMIT 2000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    json_response(['ok' => true, 'sessions' => array_map(static fn (array $row): array => [
        'id' => $row['id'], 'site' => $row['site'], 'openedAt' => $row['opened_at'], 'openedBy' => $row['opened_by'],
        'initialFund' => (float) $row['initial_fund'], 'closedAt' => $row['closed_at'], 'closedBy' => $row['closed_by'],
        'expectedCash' => $row['expected_cash'] === null ? null : (float) $row['expected_cash'],
        'countedCash' => $row['counted_cash'] === null ? null : (float) $row['counted_cash'],
        'differenceAmount' => $row['difference_amount'] === null ? null : (float) $row['difference_amount'],
        'envelopeAmount' => $row['envelope_amount'] === null ? null : (float) $row['envelope_amount'],
    ], $statement->fetchAll())]);
}

if ($method === 'GET' && $route === 'admin/report-sales') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT * FROM lartisan_sales WHERE occurred_at >= ? AND occurred_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY occurred_at DESC LIMIT 10000';
    $statement = $pdo->prepare($sql); $statement->execute($params); $saleRows = $statement->fetchAll();
    $ids = array_column($saleRows, 'id'); $itemsBySale = []; $paymentsBySale = [];
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $itemStatement = $pdo->prepare("SELECT * FROM lartisan_sale_items WHERE sale_id IN ($placeholders) ORDER BY sale_id, line_number");
        $itemStatement->execute($ids);
        foreach ($itemStatement->fetchAll() as $item) $itemsBySale[$item['sale_id']][] = $item;
        $paymentStatement = $pdo->prepare("SELECT * FROM lartisan_sale_payments WHERE sale_id IN ($placeholders)");
        $paymentStatement->execute($ids);
        foreach ($paymentStatement->fetchAll() as $paymentRow) $paymentsBySale[$paymentRow['sale_id']][] = ['method' => $paymentRow['payment_method'], 'amount' => (float) $paymentRow['amount'], 'saleId' => $paymentRow['sale_id']];
    }
    $sales = [];
    foreach ($saleRows as $row) {
        $items = [];
        foreach ($itemsBySale[$row['id']] ?? [] as $item) for ($count = 0; $count < (int) $item['quantity']; $count++) $items[] = [
            'id' => (int) $item['product_id'], 'name' => $item['product_name'], 'detail' => $item['presentation'] ?? '', 'category' => 'Histórico', 'price' => (float) $item['unit_price'],
        ];
        $sales[] = [
            'id' => $row['id'], 'site' => $row['site'], 'createdAt' => $row['occurred_at'], 'createdAtISO' => str_replace(' ', 'T', (string) $row['occurred_at']),
            'items' => $items, 'gross' => (float) $row['gross_amount'], 'discount' => (float) $row['discount_amount'], 'net' => (float) $row['net_amount'],
            'method' => $row['payment_method'] ?: 'Sin informar', 'invoiceType' => $row['invoice_type'] ?: 'Remito interno', 'customer' => $row['customer_name'] ?: 'Consumidor final',
            'invitation' => (bool) $row['invitation'], 'channel' => $row['channel'] ?: 'Mostrador', 'status' => $row['status'] ?: 'activa',
        ];
    }
    json_response(['ok' => true, 'sales' => $sales, 'payments' => array_values(array_merge(...array_values($paymentsBySale ?: [[]]))), 'truncated' => count($sales) >= 10000]);
}

if ($method === 'POST' && $route === 'admin/history/import') {
    $admin = require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $body = request_body(); $kind = (string) ($body['kind'] ?? 'sales'); $rows = $body['rows'] ?? [];
    if (!in_array($kind, ['sales', 'cash'], true) || !is_array($rows) || !$rows || count($rows) > 5000) json_response(['ok' => false, 'error' => 'Archivo histórico inválido o demasiado grande'], 422);
    $batchHash = hash('sha256', json_encode([$kind, $rows], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $uuid = static function (string $seed): string { $hex = substr(hash('sha256', $seed), 0, 32); return substr($hex,0,8).'-'.substr($hex,8,4).'-4'.substr($hex,13,3).'-a'.substr($hex,17,3).'-'.substr($hex,20,12); };
    $imported = 0; $rejected = 0; $pdo->beginTransaction();
    try {
        if ($kind === 'sales') {
            $insert = $pdo->prepare("INSERT INTO lartisan_sales (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, channel, status, invitation, synced_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE id=id");
            $paymentInsert = $pdo->prepare('INSERT INTO lartisan_sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)');
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $at = historical_datetime($row['fecha'] ?? ''); $net = historical_number($row['neto'] ?? 0);
                if (!in_array($siteName, operational_sites(), true) || !$at || $net < 0) { $rejected++; continue; }
                $saleId = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['operacion'] ?? '')) ? (string) $row['operacion'] : $uuid($batchHash . '|' . $index);
                $gross = historical_number($row['bruto'] ?? $net); $discount = historical_number($row['descuento'] ?? max(0, $gross - $net)); $methodName = trim((string) ($row['medio_pago'] ?? 'Sin informar'));
                $insert->execute([$saleId, $siteName, $at, $gross, $discount, $net, $methodName, (string) ($row['comprobante'] ?? 'Remito interno'), (string) ($row['cliente'] ?? 'Consumidor final'), (string) ($row['canal'] ?? 'Mostrador'), (string) ($row['estado'] ?? 'activa'), $admin['id']]);
                $paymentInsert->execute([$saleId, $methodName, $net]); $imported++;
            }
        } else {
            $insert = $pdo->prepare("INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id");
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $opened = historical_datetime($row['apertura'] ?? '');
                if (!in_array($siteName, operational_sites(), true) || !$opened) { $rejected++; continue; }
                $id = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['turno'] ?? '')) ? (string) $row['turno'] : $uuid($batchHash . '|cash|' . $index);
                $expectedValue = historical_number($row['esperado'] ?? 0); $countedValue = historical_number($row['contado'] ?? 0);
                $insert->execute([$id, $siteName, $opened, (string) ($row['abrió'] ?? $row['abrio'] ?? 'Histórico'), historical_number($row['fondo_inicial'] ?? 0), historical_datetime($row['cierre'] ?? ''), (string) ($row['cerró'] ?? $row['cerro'] ?? ''), $expectedValue, $countedValue, historical_number($row['diferencia'] ?? ($countedValue - $expectedValue)), historical_number($row['sobre'] ?? 0)]); $imported++;
            }
        }
        audit($pdo, (int) $admin['id'], 'historical_import', $kind . ': importados=' . $imported . ', rechazados=' . $rejected);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true, 'imported' => $imported, 'rejected' => $rejected]);
}

if ($method === 'GET' && $route === 'admin/reset-requests') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        "SELECT r.id, r.status, r.requested_at, r.resolved_at,
                u.id AS user_id, u.username, u.full_name, u.role, u.assigned_location
         FROM password_reset_requests r
         JOIN users u ON u.id = r.user_id
         ORDER BY (r.status = 'pendiente') DESC, r.requested_at DESC
         LIMIT 100"
    )->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'POST' && $route === 'admin/reset-password') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $requestId = (int) ($body['requestId'] ?? 0);
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    if ($requestId < 1 || !valid_password($temporaryPassword)) {
        json_response(['ok' => false, 'error' => 'Solicitud o contraseña provisoria inválida'], 422);
    }
    $stmt = $pdo->prepare("SELECT user_id FROM password_reset_requests WHERE id = ? AND status = 'pendiente'");
    $stmt->execute([$requestId]);
    $userId = $stmt->fetchColumn();
    if (!$userId) {
        json_response(['ok' => false, 'error' => 'La solicitud ya no está pendiente'], 409);
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ?")
            ->execute([$admin['id'], $requestId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'temporary_password_generated', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response(['ok' => true]);
}

if ($method === 'POST' && preg_match('#^admin/users/(\d+)/reset-password$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $stmt = $pdo->prepare('SELECT id, username, full_name FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    if (is_primary_user($target, $config)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal se recupera desde el acceso administrativo'], 422);
    }

    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $randomPart = '';
    for ($index = 0; $index < 8; $index++) {
        $randomPart .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    $temporaryPassword = 'Lar!' . $randomPart . '7a';

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE user_id = ? AND status = 'pendiente'")
            ->execute([$admin['id'], $userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'password_reset_by_admin', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response([
        'ok' => true,
        'username' => $target['username'],
        'temporaryPassword' => $temporaryPassword,
    ]);
}

if ($method === 'PATCH' && preg_match('#^admin/users/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $body = request_body();
    $stmt = $pdo->prepare('SELECT username, role, assigned_location, assigned_locations, access_all_locations, active, report_permissions, action_permissions, mfa_required FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();
    if (!$existing) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    $username = array_key_exists('username', $body)
        ? mb_strtolower(trim((string) $body['username']), 'UTF-8')
        : $existing['username'];
    $role = (string) ($body['role'] ?? $existing['role']);
    $location = array_key_exists('assignedLocation', $body)
        ? (trim((string) $body['assignedLocation']) ?: null)
        : $existing['assigned_location'];
    $allLocations = array_key_exists('accessAllLocations', $body)
        ? (!empty($body['accessAllLocations']) ? 1 : 0)
        : (int) $existing['access_all_locations'];
    $locations = array_key_exists('assignedLocations', $body)
        ? $body['assignedLocations']
        : assigned_locations($existing);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    $active = array_key_exists('active', $body)
        ? (!empty($body['active']) ? 1 : 0)
        : (int) $existing['active'];
    $reportPermissions = array_key_exists('reportPermissions', $body) ? $body['reportPermissions'] : json_decode((string) ($existing['report_permissions'] ?? '[]'), true);
    $actionPermissions = array_key_exists('actionPermissions', $body) ? $body['actionPermissions'] : json_decode((string) ($existing['action_permissions'] ?? '[]'), true);
    if (!is_array($reportPermissions)) $reportPermissions = [];
    if (!is_array($actionPermissions)) $actionPermissions = [];
    $reportPermissions = array_values(array_unique(array_filter($reportPermissions, 'is_string')));
    $actionPermissions = array_values(array_unique(array_filter($actionPermissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'transferirCaja', 'exportar', 'mrp'], true))));
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : $existing['mfa_required'];
    if (!in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)) {
        json_response(['ok' => false, 'error' => 'Cargo inválido'], 422);
    }
    if (!valid_username($username)) {
        json_response(['ok' => false, 'error' => 'Usuario o correo laboral inválido'], 422);
    }
    if (is_primary_user($existing, $config) && ($role !== 'administracion' || !$active)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal no puede bloquearse ni cambiar de cargo'], 422);
    }
    if ($allLocations) {
        $locations = operational_sites();
    } elseif (!$locations) {
        json_response(['ok' => false, 'error' => 'Seleccioná al menos un local o Todos los locales'], 422);
    }
    $location = $locations[0] ?? $location;
    $pdo->prepare(
        'UPDATE users SET username = ?, role = ?, assigned_location = ?, assigned_locations = ?, access_all_locations = ?, active = ?, report_permissions = ?, action_permissions = ?, mfa_required = ? WHERE id = ?'
    )->execute([$username, $role, $location, json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $active, json_encode($reportPermissions, JSON_UNESCAPED_UNICODE), json_encode($actionPermissions, JSON_UNESCAPED_UNICODE), $mfaRequired, $userId]);
    audit($pdo, (int) $admin['id'], 'user_updated', 'user_id=' . $userId);
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'admin/users') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        'SELECT id, username, full_name, role, assigned_location, assigned_locations, access_all_locations, active, must_change_password, report_permissions, action_permissions, mfa_required, created_at
         FROM users ORDER BY full_name'
    )->fetchAll();
    $users = array_map(static fn (array $row): array => public_user($row, $config) + [
        'active' => (bool) $row['active'],
        'created_at' => $row['created_at'],
    ], $rows);
    json_response(['ok' => true, 'users' => $users]);
}

if ($method === 'GET' && $route === 'admin/health') {
    require_user($pdo, ['administracion']);
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    json_response([
        'ok' => true,
        'database' => 'Disponible',
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/monitoring') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    ensure_expense_sync_schema($pdo);
    ensure_mrp_schema($pdo);

    $startedAt = microtime(true);
    $pdo->query('SELECT 1');
    $databaseLatencyMs = (int) round((microtime(true) - $startedAt) * 1000);
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $events24h = (int) $pdo->query("SELECT COUNT(*) FROM operation_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedPnl = (int) $pdo->query("SELECT COUNT(*) FROM pnl_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedExpenses = (int) $pdo->query("SELECT COUNT(*) FROM expense_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedMrp = (int) $pdo->query("SELECT COUNT(*) FROM mrp_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $lastPnl = $pdo->query("SELECT finished_at, status FROM pnl_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastExpenses = $pdo->query("SELECT finished_at, status FROM expense_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastMrp = $pdo->query("SELECT finished_at, status FROM mrp_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastBackup = null;
    if (table_exists($pdo, 'backup_runs')) {
        $lastBackup = $pdo->query('SELECT finished_at, status FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    }

    $alerts = [];
    if (($failedPnl + $failedExpenses + $failedMrp) > 0) {
        $alerts[] = ['level' => 'atencion', 'message' => 'Hubo sincronizaciones que no se completaron en las últimas 24 horas.'];
    }
    if (!$lastBackup || ($lastBackup['status'] ?? '') !== 'verified') {
        $alerts[] = ['level' => 'atencion', 'message' => 'No hay un respaldo externo verificado recientemente.'];
    }
    if ($freeBytes !== false && $freeBytes < 512 * 1024 * 1024) {
        $alerts[] = ['level' => 'critico', 'message' => 'El espacio disponible del servidor está por debajo de 512 MB.'];
    }

    json_response([
        'ok' => true,
        'api' => 'Disponible',
        'database' => 'Disponible',
        'database_latency_ms' => $databaseLatencyMs,
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'events_24h' => $events24h,
        'failed_syncs_24h' => $failedPnl + $failedExpenses + $failedMrp,
        'drive_connected' => is_file(pnl_private_token_path()),
        'last_pnl_sync' => $lastPnl ?: null,
        'last_expense_sync' => $lastExpenses ?: null,
        'last_mrp_sync' => $lastMrp ?: null,
        'last_backup' => $lastBackup ?: null,
        'alerts' => $alerts,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/backups/latest') {
    require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $latest = $pdo->query('SELECT started_at, finished_at, status, filename, size_bytes, error_message FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    json_response(['ok' => true, 'backup' => $latest ?: null]);
}

if ($method === 'POST' && $route === 'admin/backups/run') {
    $admin = require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $last = $pdo->query("SELECT started_at FROM backup_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Ya hay un respaldo iniciado hace menos de cinco minutos.'], 429);
    if (!function_exists('exec') || !defined('PHP_BINARY') || PHP_BINARY === '') {
        json_response(['ok' => false, 'error' => 'El hosting no permite iniciar respaldos bajo demanda.'], 503);
    }
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/backup.php') . ' run 2>&1';
    $output = [];
    $exitCode = 1;
    exec($command, $output, $exitCode);
    audit($pdo, (int) $admin['id'], 'backup_before_update', 'resultado=' . $exitCode);
    if ($exitCode !== 0) json_response(['ok' => false, 'error' => 'El respaldo previo no se pudo verificar. No publiques una actualización.', 'detail' => implode("\n", array_slice($output, -3))], 500);
    json_response(['ok' => true, 'message' => 'Respaldo previo verificado y enviado a Drive.']);
}

if ($method === 'POST' && $route === 'admin/users') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $fullName = trim((string) ($body['fullName'] ?? ''));
    $role = (string) ($body['role'] ?? '');
    $location = trim((string) ($body['assignedLocation'] ?? '')) ?: null;
    $allLocations = !empty($body['accessAllLocations']) ? 1 : 0;
    $locations = $body['assignedLocations'] ?? ($location ? [$location] : []);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    if ($allLocations) $locations = operational_sites();
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    $reportPermissions = is_array($body['reportPermissions'] ?? null) ? array_values(array_filter($body['reportPermissions'], 'is_string')) : null;
    $actionPermissions = is_array($body['actionPermissions'] ?? null) ? array_values(array_filter($body['actionPermissions'], 'is_string')) : null;
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : null;
    if (!valid_username($username)
        || $fullName === ''
        || !in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)
        || !valid_password($temporaryPassword) || !$locations) {
        json_response(['ok' => false, 'error' => 'Los datos del usuario no son válidos'], 422);
    }
    $stmt = $pdo->prepare(
        'INSERT INTO users (username, full_name, password_hash, role, assigned_location, assigned_locations, access_all_locations, report_permissions, action_permissions, mfa_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    try {
        $stmt->execute([$username, $fullName, password_hash($temporaryPassword, PASSWORD_DEFAULT), $role, $locations[0], json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $reportPermissions === null ? null : json_encode($reportPermissions, JSON_UNESCAPED_UNICODE), $actionPermissions === null ? null : json_encode($actionPermissions, JSON_UNESCAPED_UNICODE), $mfaRequired]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() === '23000') {
            json_response(['ok' => false, 'error' => 'Ese nombre de usuario ya existe'], 409);
        }
        throw $error;
    }
    $newId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $admin['id'], 'user_created', 'user_id=' . $newId);
    json_response(['ok' => true, 'id' => $newId], 201);
}

json_response(['ok' => false, 'error' => 'Ruta no encontrada'], 404);
