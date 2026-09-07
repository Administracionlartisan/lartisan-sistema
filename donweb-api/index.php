<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

configure_cors($config);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string) ($_GET['route'] ?? ''), '/');
$pdo = db($config);
ensure_user_locations_schema($pdo);
// Mantiene listas las tablas operativas aun antes de la primera venta.
ensure_operations_schema($pdo);
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

if ($method === 'GET' && ($route === '' || $route === 'health')) {
    $pdo->query('SELECT 1');
    json_response(['ok' => true, 'service' => 'lartisan-api']);
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
    json_response(['ok' => true, 'user' => public_user($user)]);
}

if ($method === 'POST' && $route === 'auth/logout') {
    $user = current_user($pdo);
    clear_session($pdo, $config);
    audit($pdo, $user ? (int) $user['id'] : null, 'logout');
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'auth/me') {
    $user = require_user($pdo);
    json_response(['ok' => true, 'user' => public_user($user)]);
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
        $destination = (string) ($config['admin_recovery_email'] ?? 'administracion@lartisantaller.com');
        $from = (string) ($config['recovery_from_email'] ?? 'no-reply@lartisantaller.com');
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
                'state' => $state,
                'revision' => (int) $row['revision'],
                'updatedAt' => $row['updated_at'],
            ];
        }
    }
    json_response(['ok' => true, 'states' => $states]);
}

if ($method === 'PUT' && preg_match('#^operations/states/([^/]+)$#', $route, $matches)) {
    $user = require_user($pdo);
    ensure_operations_schema($pdo);
    $site = rawurldecode($matches[1]);
    if (!user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a este local'], 403);
    }
    $body = request_body();
    $state = $body['state'] ?? null;
    $eventType = trim((string) ($body['eventType'] ?? 'actualizacion_operativa'));
    $event = $body['event'] ?? [];
    if (!is_array($state) || !is_array($event) || $eventType === '' || strlen($eventType) > 80) {
        json_response(['ok' => false, 'error' => 'Datos operativos inválidos'], 422);
    }
    $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $eventJson = json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($stateJson === false || $eventJson === false || strlen($stateJson) > 4_000_000) {
        json_response(['ok' => false, 'error' => 'La operación supera el tamaño permitido'], 422);
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            "INSERT INTO operation_site_states (site, state_json, revision, updated_by)
             VALUES (?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), revision = revision + 1,
                 updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP"
        )->execute([$site, $stateJson, $user['id']]);
        $pdo->prepare(
            'INSERT INTO operation_events (site, user_id, event_type, event_json) VALUES (?, ?, ?, ?)'
        )->execute([$site, $user['id'], $eventType, $eventJson]);
        sync_normalized_operations($pdo, $site, $state, (int) $user['id']);
        audit($pdo, (int) $user['id'], 'operational_' . substr($eventType, 0, 48), $site);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    $revision = (int) $pdo->query("SELECT revision FROM operation_site_states WHERE site = " . $pdo->quote($site))->fetchColumn();
    json_response(['ok' => true, 'revision' => $revision]);
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

if ($method === 'PATCH' && preg_match('#^admin/users/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $body = request_body();
    $stmt = $pdo->prepare('SELECT username, role, assigned_location, assigned_locations, access_all_locations, active FROM users WHERE id = ?');
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
    if (!in_array($role, ['vendedora', 'supervisora', 'administracion'], true)) {
        json_response(['ok' => false, 'error' => 'Cargo inválido'], 422);
    }
    if (!valid_username($username)) {
        json_response(['ok' => false, 'error' => 'Usuario o correo laboral inválido'], 422);
    }
    if (in_array($existing['username'], ['administracion', 'administracion@lartisantaller.com'], true)
        && ($role !== 'administracion' || !$active)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal no puede bloquearse ni cambiar de cargo'], 422);
    }
    if ($allLocations) {
        $locations = operational_sites();
    } elseif (!$locations) {
        json_response(['ok' => false, 'error' => 'Seleccioná al menos un local o Todos los locales'], 422);
    }
    $location = $locations[0] ?? $location;
    $pdo->prepare(
        'UPDATE users SET username = ?, role = ?, assigned_location = ?, assigned_locations = ?, access_all_locations = ?, active = ? WHERE id = ?'
    )->execute([$username, $role, $location, json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $active, $userId]);
    audit($pdo, (int) $admin['id'], 'user_updated', 'user_id=' . $userId);
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'admin/users') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        'SELECT id, username, full_name, role, assigned_location, assigned_locations, access_all_locations, active, must_change_password, created_at
         FROM users ORDER BY full_name'
    )->fetchAll();
    json_response(['ok' => true, 'users' => $rows]);
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
    if (!valid_username($username)
        || $fullName === ''
        || !in_array($role, ['vendedora', 'supervisora', 'administracion'], true)
        || !valid_password($temporaryPassword) || !$locations) {
        json_response(['ok' => false, 'error' => 'Los datos del usuario no son válidos'], 422);
    }
    $stmt = $pdo->prepare(
        'INSERT INTO users (username, full_name, password_hash, role, assigned_location, assigned_locations, access_all_locations)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    try {
        $stmt->execute([$username, $fullName, password_hash($temporaryPassword, PASSWORD_DEFAULT), $role, $locations[0], json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations]);
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
