<?php

declare(strict_types=1);

const SESSION_COOKIE = 'lartisan_session';

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Servicio no configurado']);
    exit;
}

$config = require $configPath;

// Las credenciales de Google se mantienen fuera de public_html. El archivo
// privado ya se usa para los respaldos y comparte la conexión de solo lectura
// con los informes, sin exponer secretos desde la API.
$privateIntegrationPath = dirname(__DIR__, 2) . '/lartisan-backup-config.php';
if (is_file($privateIntegrationPath)) {
    $privateIntegrationConfig = require $privateIntegrationPath;
    if (is_array($privateIntegrationConfig)) {
        $config['backup'] = array_replace_recursive($config['backup'] ?? [], $privateIntegrationConfig);
    }
}

// La clave de OpenAI vive fuera de public_html y nunca se envía al navegador.
$privateAiPath = dirname(__DIR__, 2) . '/lartisan-ai-config.php';
if (is_file($privateAiPath)) {
    $privateAiConfig = require $privateAiPath;
    if (is_array($privateAiConfig)) {
        $config['openai'] = array_replace_recursive($config['openai'] ?? [], $privateAiConfig);
    }
}

// La integración fiscal se configura exclusivamente fuera de public_html.
// Este archivo puede contener únicamente rutas a certificado/clave y parámetros
// operativos; nunca se devuelve por la API ni queda versionado en el proyecto.
$privateArcaPath = dirname(__DIR__, 2) . '/lartisan-arca-config.php';
if (is_file($privateArcaPath)) {
    $privateArcaConfig = require $privateArcaPath;
    if (is_array($privateArcaConfig)) {
        $config['arca'] = array_replace_recursive($config['arca'] ?? [], $privateArcaConfig);
    }
}

// Villa Mitre (Tres Arroyos 1902) opera con el punto RECE Web Services 00006.
// Se incorpora como valor seguro por defecto sin reemplazar una eventual
// configuración específica guardada en el archivo privado del servidor.
if (is_array($config['arca'] ?? null)) {
    $config['arca']['points_of_sale'] ??= [];
    if (is_array($config['arca']['points_of_sale']) && !array_key_exists('Villa Mitre', $config['arca']['points_of_sale'])) {
        $config['arca']['points_of_sale']['Villa Mitre'] = 6;
    }
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_response(['ok' => false, 'error' => 'JSON inválido'], 400);
    }
    return $data;
}

function configure_cors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, $config['allowed_origins'], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');
        header('Vary: Origin');
    }
    header('X-Content-Type-Options: nosniff');
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
}

function db(array $config): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $database = $config['database'];
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $database['host'], $database['name']);
    $pdo = new PDO($dsn, $database['user'], $database['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
}

function audit(PDO $pdo, ?int $userId, string $type, ?string $detail = null): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO audit_log (user_id, event_type, event_detail, ip_address) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$userId, $type, $detail, client_ip()]);
}

function is_primary_user(array $user, array $config): bool
{
    $primary = mb_strtolower(trim((string) ($config['primary_admin_username'] ?? $config['admin_recovery_email'] ?? '')), 'UTF-8');
    return $primary !== '' && hash_equals($primary, mb_strtolower((string) ($user['username'] ?? ''), 'UTF-8'));
}

function public_user(array $user, array $config): array
{
    $result = [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'fullName' => $user['full_name'],
        'role' => $user['role'],
        'assignedLocation' => $user['assigned_location'],
        'assignedLocations' => assigned_locations($user),
        'accessAllLocations' => (bool) $user['access_all_locations'],
        'mustChangePassword' => (bool) $user['must_change_password'],
        'primary' => is_primary_user($user, $config),
    ];
    if (($user['report_permissions'] ?? null) !== null) {
        $result['reportPermissions'] = json_decode((string) $user['report_permissions'], true) ?: [];
    }
    $result['actionPermissions'] = user_action_permissions($user);
    // Habilitación operativa acotada: las compras de producción se cargan
    // únicamente desde Villa Mitre por las dos responsables designadas.
    if (is_production_purchase_loader($user)) $result['actionPermissions'][] = 'comprasProduccion';
    $result['actionPermissions'] = array_values(array_unique($result['actionPermissions']));
    return $result;
}

function ensure_user_locations_schema(PDO $pdo): void
{
    // Algunas instalaciones iniciales definieron el cargo como ENUM sin el
    // perfil de Compras. MySQL lo convertía silenciosamente en un valor vacío,
    // que la interfaz mostraba como Vendedora. Se amplía el catálogo una vez
    // para que el perfil MRP se conserve correctamente.
    $roleColumn = $pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
    $roleType = strtolower((string) ($roleColumn['Type'] ?? ''));
    if (str_starts_with($roleType, 'enum(') && !str_contains($roleType, "'compras'")) {
        $pdo->exec("ALTER TABLE users MODIFY role ENUM('vendedora','supervisora','compras','administracion') NOT NULL DEFAULT 'vendedora'");
    }
    $column = $pdo->query("SHOW COLUMNS FROM users LIKE 'assigned_locations'")->fetch();
    if (!$column) {
        $pdo->exec('ALTER TABLE users ADD COLUMN assigned_locations TEXT NULL AFTER assigned_location');
    }
    foreach ([
        'report_permissions' => 'TEXT NULL',
        'action_permissions' => 'TEXT NULL',
        'mfa_required' => 'TINYINT(1) NULL',
    ] as $name => $definition) {
        $existing = $pdo->query("SHOW COLUMNS FROM users LIKE " . $pdo->quote($name))->fetch();
        if (!$existing) $pdo->exec("ALTER TABLE users ADD COLUMN $name $definition");
    }
}

function table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
    return (bool) $statement->fetchColumn();
}

function assigned_locations(array $user): array
{
    $raw = $user['assigned_locations'] ?? null;
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    $locations = is_array($decoded) ? $decoded : [];
    $locations = array_values(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true)));
    if (!$locations && !empty($user['assigned_location']) && in_array($user['assigned_location'], operational_sites(), true)) {
        $locations = [$user['assigned_location']];
    }
    return $locations;
}

function current_user(PDO $pdo): ?array
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || strlen($token) < 32) {
        return null;
    }
    $sessionId = hash('sha256', $token);
    $stmt = $pdo->prepare(
        "SELECT u.* FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > NOW() AND u.active = 1"
    );
    $stmt->execute([$sessionId]);
    $user = $stmt->fetch();
    if (!$user) {
        return null;
    }
    $pdo->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = ?')->execute([$sessionId]);
    return $user;
}

function require_user(PDO $pdo, ?array $roles = null): array
{
    $user = current_user($pdo);
    if (!$user) {
        json_response(['ok' => false, 'error' => 'Sesión requerida'], 401);
    }
    if ($roles !== null && !in_array($user['role'], $roles, true)) {
        json_response(['ok' => false, 'error' => 'Acceso no autorizado'], 403);
    }
    return $user;
}

function set_session_cookie(string $token, array $config, int $expires): void
{
    setcookie(SESSION_COOKIE, $token, [
        'expires' => $expires,
        'path' => '/',
        'domain' => $config['cookie_domain'],
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function create_session(PDO $pdo, int $userId, array $config): void
{
    $token = bin2hex(random_bytes(32));
    $sessionId = hash('sha256', $token);
    $hours = max(1, min(48, (int) ($config['session_hours'] ?? 12)));
    $expiresAt = (new DateTimeImmutable())->modify('+' . $hours . ' hours');
    $stmt = $pdo->prepare('INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
    $stmt->execute([$sessionId, $userId, $expiresAt->format('Y-m-d H:i:s')]);
    set_session_cookie($token, $config, $expiresAt->getTimestamp());
}

function clear_session(PDO $pdo, array $config): void
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($token) && $token !== '') {
        $pdo->prepare('DELETE FROM user_sessions WHERE id = ?')->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', $config, time() - 3600);
}

function valid_password(string $password): bool
{
    return strlen($password) >= 8
        && preg_match('/[a-z]/', $password)
        && preg_match('/[A-Z]/', $password)
        && preg_match('/\d/', $password)
        && preg_match('/[^a-zA-Z0-9]/', $password);
}

function valid_username(string $username): bool
{
    if (preg_match('/^[a-záéíóúüñ0-9]+(?:\.[a-záéíóúüñ0-9]+)+$/u', $username)) {
        return true;
    }
    if (!filter_var($username, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    return str_ends_with(mb_strtolower($username, 'UTF-8'), '@lartisantaller.com');
}

function operational_sites(): array
{
    return ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure', 'Novo Pacheco'];
}

function user_can_access_site(array $user, string $site): bool
{
    if (!in_array($site, operational_sites(), true)) {
        return false;
    }
    return (bool) $user['access_all_locations']
        || in_array($site, assigned_locations($user), true);
}

function user_action_permissions(array $user): array
{
    if (($user['action_permissions'] ?? null) === null) {
        if ($user['role'] === 'compras') return ['mrp'];
        return $user['role'] === 'supervisora'
            ? ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'transferirCaja', 'exportar']
            : ['cobrar', 'egresos', 'pedidos', 'incidencias', 'transferirCaja'];
    }
    $decoded = json_decode((string) ($user['action_permissions'] ?? '[]'), true);
    return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
}

function user_can_action(array $user, string $permission): bool
{
    return $user['role'] === 'administracion' || in_array($permission, user_action_permissions($user), true);
}

function is_production_purchase_loader(array $user): bool
{
    $username = strtolower(trim((string) ($user['username'] ?? '')));
    return in_array($username, ['yamila.palavecino', 'valentina.parra'], true)
        && user_can_access_site($user, 'Villa Mitre');
}

function user_can_report(array $user, string $report): bool
{
    if ($user['role'] === 'administracion') return true;
    $decoded = json_decode((string) ($user['report_permissions'] ?? '[]'), true);
    return is_array($decoded) && in_array($report, $decoded, true);
}

/**
 * A browser always sends a complete snapshot. The server accepts only the
 * portions authorized for the authenticated account and preserves everything
 * else, so a forged request cannot bypass a hidden/disabled control.
 */
function authorize_operational_snapshot(array $user, array $previous, array $incoming): array
{
    if ($user['role'] === 'administracion') {
        unset($incoming['audit']);
        $incoming['audit'] = $previous['audit'] ?? [];
        return $incoming;
    }

    $rules = [
        'sales' => ['cobrar', 'anular'],
        'payments' => ['cobrar', 'anular'],
        'savedOrders' => ['cobrar'],
        'returnsLog' => ['anular'],
        'expensesLog' => ['egresos'],
        'cashAdjustments' => ['egresos'],
        'stockRequests' => ['pedidos'],
        'incidents' => ['incidencias'],
        'stockAdjustments' => ['stock'],
        'realStock' => ['stock'],
        'stockCountComments' => ['stock'],
        'minimumStock' => ['stock'],
        'cashTransfers' => ['transferirCaja'],
        'stock' => ['cobrar', 'anular', 'pedidos', 'stock'],
        'stockMovements' => ['cobrar', 'anular', 'pedidos', 'stock'],
        'cash' => ['cobrar', 'egresos', 'transferirCaja'],
        'cashOpen' => ['cobrar'],
        'activeShift' => ['cobrar'],
        'shiftLog' => ['cobrar'],
        'envelopeRecords' => ['cobrar'],
        'cashLedger' => ['cobrar', 'egresos', 'transferirCaja'],
        'attendanceRecords' => ['cobrar', 'pedidos', 'incidencias'],
    ];
    $serverOnly = ['prices', 'onlinePrices', 'limitsBySite', 'priceChanges', 'audit'];
    $result = $previous;
    foreach ($incoming as $key => $value) {
        if (!is_string($key) || in_array($key, $serverOnly, true)) continue;
        $required = $rules[$key] ?? [];
        if (!$required) continue;
        foreach ($required as $permission) {
            if (user_can_action($user, $permission)) {
                $result[$key] = $value;
                break;
            }
        }
    }
    if (array_key_exists('schedules', $incoming) && user_can_report($user, 'Personal')) {
        $result['schedules'] = $incoming['schedules'];
    }
    return $result;
}

function operational_snapshot_for_user(array $user, array $state): array
{
    if ($user['role'] === 'administracion') return $state;
    unset($state['audit'], $state['priceChanges'], $state['limitsBySite']);
    if (!user_can_report($user, 'Personal')) unset($state['schedules']);
    if (!user_can_action($user, 'egresos')) unset($state['expensesLog'], $state['cashAdjustments']);
    if (!user_can_action($user, 'transferirCaja')) unset($state['cashTransfers']);
    if (!user_can_action($user, 'stock')) unset($state['realStock'], $state['stockCountComments'], $state['stockAdjustments']);
    if (!user_can_action($user, 'anular')) unset($state['returnsLog']);
    if (!user_can_action($user, 'incidencias')) unset($state['incidents']);
    return $state;
}

function ensure_operations_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'operation_site_states')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_site_states (
            site VARCHAR(80) NOT NULL PRIMARY KEY,
            state_json LONGTEXT NOT NULL,
            revision INT UNSIGNED NOT NULL DEFAULT 1,
            updated_by BIGINT UNSIGNED NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_operation_states_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'operation_events')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_events (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            event_type VARCHAR(80) NOT NULL,
            event_json LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_events_site_date (site, created_at),
            INDEX idx_operation_events_user_date (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'operation_requests')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_requests (
            request_id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            revision INT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_requests_site_date (site, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    ensure_normalized_operations_schema($pdo);
}

function operational_item_key(string $field, array $item, int $index): string
{
    if ($field === 'payments') {
        return (string) ($item['saleId'] ?? '') . '|' . (string) ($item['method'] ?? '') . '|' . (string) ($item['amount'] ?? '');
    }
    return isset($item['id']) && is_scalar($item['id']) ? (string) $item['id'] : '__row_' . $index;
}

/** Three-way list merge: apply only this browser's changes over the latest server list. */
function merge_operational_list(string $field, array $base, array $current, array $incoming): array
{
    $map = [];
    $order = [];
    foreach ($current as $index => $item) {
        if (!is_array($item)) continue;
        $key = operational_item_key($field, $item, (int) $index);
        $map[$key] = $item;
        $order[] = $key;
    }
    $baseMap = [];
    foreach ($base as $index => $item) {
        if (!is_array($item)) continue;
        $baseMap[operational_item_key($field, $item, (int) $index)] = $item;
    }
    $incomingMap = [];
    foreach ($incoming as $index => $item) {
        if (!is_array($item)) continue;
        $key = operational_item_key($field, $item, (int) $index);
        $incomingMap[$key] = $item;
        if (!array_key_exists($key, $baseMap) || $baseMap[$key] !== $item) {
            $map[$key] = $item;
            if (!in_array($key, $order, true)) array_unshift($order, $key);
        }
    }
    foreach ($baseMap as $key => $item) {
        if (!array_key_exists($key, $incomingMap) && array_key_exists($key, $map) && $map[$key] === $item) {
            unset($map[$key]);
        }
    }
    $result = [];
    foreach (array_values(array_unique($order)) as $key) if (array_key_exists($key, $map)) $result[] = $map[$key];
    return $result;
}

function merge_operational_snapshot(array $base, array $current, array $incoming): array
{
    $result = $current;
    $listFields = ['sales', 'payments', 'stockRequests', 'savedOrders', 'cashAdjustments', 'cashLedger', 'shiftLog', 'envelopeRecords', 'stockMovements', 'expensesLog', 'returnsLog', 'cashTransfers', 'attendanceRecords', 'incidents', 'stockAdjustments', 'schedules', 'priceChanges'];
    foreach ($incoming as $field => $value) {
        if (!is_string($field)) continue;
        $baseValue = $base[$field] ?? null;
        if ($value === $baseValue) continue;
        if (in_array($field, $listFields, true) && is_array($value)) {
            $result[$field] = merge_operational_list($field, is_array($baseValue) ? $baseValue : [], is_array($current[$field] ?? null) ? $current[$field] : [], $value);
            continue;
        }
        if ($field === 'stock' && is_array($value)) {
            $stock = is_array($current[$field] ?? null) ? $current[$field] : [];
            $baseStock = is_array($baseValue) ? $baseValue : [];
            foreach ($value as $productId => $quantity) {
                $baseQuantity = (float) ($baseStock[$productId] ?? 0);
                if ((float) $quantity === $baseQuantity) continue;
                $stock[$productId] = max(0, (float) ($stock[$productId] ?? 0) + ((float) $quantity - $baseQuantity));
            }
            $result[$field] = $stock;
            continue;
        }
        $result[$field] = $value;
    }
    return $result;
}

function ensure_monitoring_notification_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'monitoring_notifications')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS monitoring_notifications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            alert_hash CHAR(64) NOT NULL,
            status VARCHAR(30) NOT NULL,
            recipient VARCHAR(190) NULL,
            error_message VARCHAR(500) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_monitoring_notifications_hash_date (alert_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
}

function active_monitoring_alerts(PDO $pdo): array
{
    ensure_pnl_sync_schema($pdo);
    ensure_expense_sync_schema($pdo);
    ensure_mrp_schema($pdo);
    $failedPnl = (int) $pdo->query("SELECT COUNT(*) FROM pnl_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedExpenses = (int) $pdo->query("SELECT COUNT(*) FROM expense_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedMrp = (int) $pdo->query("SELECT COUNT(*) FROM mrp_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $lastBackup = table_exists($pdo, 'backup_runs') ? $pdo->query('SELECT finished_at, status FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch() : null;
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    $alerts = [];
    if (($failedPnl + $failedExpenses + $failedMrp) > 0) $alerts[] = 'Hubo sincronizaciones fallidas en las últimas 24 horas.';
    if (!$lastBackup || ($lastBackup['status'] ?? '') !== 'verified') $alerts[] = 'No hay un respaldo externo verificado.';
    if ($freeBytes !== false && $freeBytes < 512 * 1024 * 1024) $alerts[] = 'El servidor tiene menos de 512 MB libres.';
    return $alerts;
}

function notify_monitoring_alerts(PDO $pdo, array $config): array
{
    ensure_monitoring_notification_schema($pdo);
    $alerts = active_monitoring_alerts($pdo);
    if (!$alerts) return ['status' => 'unchanged', 'sentAt' => null];
    $recipient = trim((string) ($config['monitoring']['alert_email'] ?? $config['admin_recovery_email'] ?? ''));
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) return ['status' => 'disabled', 'sentAt' => null];
    sort($alerts);
    $hash = hash('sha256', implode('|', $alerts));
    $cooldownHours = max(1, min(24, (int) ($config['monitoring']['cooldown_hours'] ?? 6)));
    $recent = $pdo->prepare("SELECT created_at FROM monitoring_notifications WHERE alert_hash = ? AND status = 'sent' AND created_at >= DATE_SUB(NOW(), INTERVAL $cooldownHours HOUR) ORDER BY id DESC LIMIT 1");
    $recent->execute([$hash]);
    $sentAt = $recent->fetchColumn();
    if ($sentAt) return ['status' => 'unchanged', 'sentAt' => $sentAt];
    $subject = "L'ARTISAN - alerta del sistema";
    $body = "El monitoreo detectó condiciones que requieren revisión:\n\n- " . implode("\n- ", $alerts) . "\n\nIngresá a Administración > Protección de datos para revisar el detalle.";
    $from = trim((string) ($config['recovery_from_email'] ?? ''));
    $headers = $from !== '' ? ['From: ' . $from, 'Content-Type: text/plain; charset=UTF-8'] : ['Content-Type: text/plain; charset=UTF-8'];
    $sent = @mail($recipient, $subject, $body, implode("\r\n", $headers));
    $statement = $pdo->prepare('INSERT INTO monitoring_notifications (alert_hash, status, recipient, error_message) VALUES (?, ?, ?, ?)');
    $statement->execute([$hash, $sent ? 'sent' : 'failed', $recipient, $sent ? null : 'El servidor de correo rechazó el envío.']);
    return ['status' => $sent ? 'sent' : 'failed', 'sentAt' => $sent ? date('Y-m-d H:i:s') : null];
}

function ensure_normalized_operations_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'lartisan_sales')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sales (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            occurred_at DATETIME NULL,
            gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(120) NULL,
            invoice_type VARCHAR(80) NULL,
            customer_name VARCHAR(180) NULL,
            channel VARCHAR(40) NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'activa',
            invitation TINYINT(1) NOT NULL DEFAULT 0,
            synced_by BIGINT UNSIGNED NULL,
            synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lartisan_sales_site_date (site, occurred_at),
            INDEX idx_lartisan_sales_status (site, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_sale_items')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sale_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sale_id CHAR(36) NOT NULL,
            line_number SMALLINT UNSIGNED NOT NULL,
            product_id INT UNSIGNED NOT NULL,
            product_name VARCHAR(190) NOT NULL,
            presentation VARCHAR(190) NULL,
            quantity INT UNSIGNED NOT NULL,
            invited_quantity INT UNSIGNED NOT NULL DEFAULT 0,
            unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
            UNIQUE KEY uq_lartisan_sale_item_line (sale_id, line_number),
            INDEX idx_lartisan_sale_items_product (product_id),
            CONSTRAINT fk_lartisan_sale_items_sale FOREIGN KEY (sale_id) REFERENCES lartisan_sales(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    // Datos de identificación fiscal. Se mantienen junto a la venta para que
    // una futura factura no dependa de datos que puedan cambiar luego en la UI.
    ensure_column($pdo, 'lartisan_sales', 'customer_document_type', 'VARCHAR(30) NULL AFTER customer_name');
    ensure_column($pdo, 'lartisan_sales', 'customer_document_number', 'VARCHAR(30) NULL AFTER customer_document_type');
    ensure_column($pdo, 'lartisan_sales', 'customer_tax_condition', 'VARCHAR(80) NULL AFTER customer_document_number');
    ensure_column($pdo, 'lartisan_sales', 'customer_address', 'VARCHAR(220) NULL AFTER customer_tax_condition');
    if (!table_exists($pdo, 'lartisan_sale_payments')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sale_payments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sale_id CHAR(36) NOT NULL,
            payment_method VARCHAR(120) NOT NULL,
            amount DECIMAL(14,2) NOT NULL,
            corrected_at DATETIME NULL,
            UNIQUE KEY uq_lartisan_sale_payment_method (sale_id, payment_method),
            CONSTRAINT fk_lartisan_sale_payments_sale FOREIGN KEY (sale_id) REFERENCES lartisan_sales(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_cash_sessions')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_cash_sessions (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            opened_at DATETIME NULL,
            opened_by VARCHAR(190) NULL,
            initial_fund DECIMAL(14,2) NOT NULL DEFAULT 0,
            closed_at DATETIME NULL,
            closed_by VARCHAR(190) NULL,
            expected_cash DECIMAL(14,2) NULL,
            counted_cash DECIMAL(14,2) NULL,
            difference_amount DECIMAL(14,2) NULL,
            envelope_amount DECIMAL(14,2) NULL,
            synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lartisan_cash_sessions_site_opened (site, opened_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    ensure_column($pdo, 'lartisan_cash_sessions', 'expected_cash', 'DECIMAL(14,2) NULL AFTER closed_by');
    ensure_column($pdo, 'lartisan_cash_sessions', 'counted_cash', 'DECIMAL(14,2) NULL AFTER expected_cash');
    ensure_column($pdo, 'lartisan_cash_sessions', 'difference_amount', 'DECIMAL(14,2) NULL AFTER counted_cash');
    ensure_column($pdo, 'lartisan_cash_sessions', 'envelope_amount', 'DECIMAL(14,2) NULL AFTER difference_amount');
    if (!table_exists($pdo, 'lartisan_cash_movements')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_cash_movements (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            session_id CHAR(36) NULL,
            occurred_at DATETIME NULL,
            kind VARCHAR(120) NOT NULL,
            direction VARCHAR(20) NOT NULL,
            amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            cash_impact DECIMAL(14,2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(120) NULL,
            reference_id CHAR(36) NULL,
            detail VARCHAR(500) NULL,
            created_by VARCHAR(190) NULL,
            INDEX idx_lartisan_cash_movements_site_date (site, occurred_at),
            INDEX idx_lartisan_cash_movements_session (session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_stock_movements')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_stock_movements (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            product_id INT UNSIGNED NOT NULL,
            movement_type VARCHAR(40) NOT NULL,
            quantity INT NOT NULL,
            remito VARCHAR(180) NULL,
            source_reference CHAR(36) NULL,
            detail VARCHAR(500) NULL,
            occurred_at DATETIME NULL,
            created_by VARCHAR(190) NULL,
            INDEX idx_lartisan_stock_movements_site_product_date (site, product_id, occurred_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    ensure_column($pdo, 'lartisan_stock_movements', 'source_reference', 'CHAR(36) NULL AFTER remito');
}

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column));
    if (!$statement->fetch()) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
}

function iso_datetime(?string $value): ?string
{
    if (!$value) return null;
    try {
        return (new DateTimeImmutable($value))->format('Y-m-d H:i:s');
    } catch (Throwable $error) {
        return null;
    }
}

function historical_datetime(mixed $value): ?string
{
    $text = trim((string) $value);
    if ($text === '') return null;
    foreach (['d/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d'] as $format) {
        $date = DateTimeImmutable::createFromFormat('!' . $format, $text);
        if ($date !== false && $date->format($format) === $text) return $date->format('Y-m-d H:i:s');
    }
    return iso_datetime($text);
}

function historical_number(mixed $value): float
{
    if (is_int($value) || is_float($value)) return (float) $value;
    $text = preg_replace('/[^0-9,.-]/u', '', trim((string) $value)) ?? '';
    if ($text === '') return 0.0;
    $comma = strrpos($text, ',');
    $dot = strrpos($text, '.');
    if ($comma !== false && $dot !== false) {
        $decimal = $comma > $dot ? ',' : '.';
        $thousands = $decimal === ',' ? '.' : ',';
        $text = str_replace($thousands, '', $text);
        $text = str_replace($decimal, '.', $text);
    } elseif ($comma !== false) {
        $text = preg_match('/,\d{1,2}$/', $text) ? str_replace(',', '.', $text) : str_replace(',', '', $text);
    } elseif ($dot !== false && preg_match('/^-?\d{1,3}(\.\d{3})+$/', $text)) {
        $text = str_replace('.', '', $text);
    }
    return is_numeric($text) ? (float) $text : 0.0;
}

function sync_normalized_operations(PDO $pdo, string $site, array $state, int $userId): void
{
    $saleStatement = $pdo->prepare(
        "INSERT INTO lartisan_sales
        (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, customer_document_type, customer_document_number, customer_tax_condition, customer_address, channel, status, invitation, synced_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE site=VALUES(site), occurred_at=VALUES(occurred_at), gross_amount=VALUES(gross_amount),
        discount_amount=VALUES(discount_amount), net_amount=VALUES(net_amount), payment_method=VALUES(payment_method),
        invoice_type=VALUES(invoice_type), customer_name=VALUES(customer_name),
        customer_document_type=COALESCE(VALUES(customer_document_type), customer_document_type),
        customer_document_number=COALESCE(VALUES(customer_document_number), customer_document_number),
        customer_tax_condition=COALESCE(VALUES(customer_tax_condition), customer_tax_condition),
        customer_address=COALESCE(VALUES(customer_address), customer_address), channel=VALUES(channel), status=VALUES(status),
        invitation=VALUES(invitation), synced_by=VALUES(synced_by)"
    );
    $deleteItems = $pdo->prepare('DELETE FROM lartisan_sale_items WHERE sale_id = ?');
    $insertItem = $pdo->prepare(
        'INSERT INTO lartisan_sale_items (sale_id, line_number, product_id, product_name, presentation, quantity, invited_quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $deletePayments = $pdo->prepare('DELETE FROM lartisan_sale_payments WHERE sale_id = ?');
    $insertPayment = $pdo->prepare('INSERT INTO lartisan_sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)');

    foreach (($state['sales'] ?? []) as $sale) {
        if (!is_array($sale) || empty($sale['id'])) continue;
        $saleStatement->execute([
            (string) $sale['id'], $site, iso_datetime($sale['createdAtISO'] ?? null), (float) ($sale['gross'] ?? 0),
            (float) ($sale['discount'] ?? 0), (float) ($sale['net'] ?? 0), (string) ($sale['method'] ?? ''),
            (string) ($sale['invoiceType'] ?? ''), (string) ($sale['customer'] ?? ''),
            trim((string) ($sale['customerDocumentType'] ?? '')) ?: null,
            trim((string) ($sale['customerDocumentNumber'] ?? '')) ?: null,
            trim((string) ($sale['customerTaxCondition'] ?? '')) ?: null,
            trim((string) ($sale['customerAddress'] ?? '')) ?: null,
            (string) ($sale['channel'] ?? ''),
            (string) ($sale['status'] ?? 'activa'), !empty($sale['invitation']) ? 1 : 0, $userId,
        ]);
        $deleteItems->execute([(string) $sale['id']]);
        $lines = [];
        foreach (($sale['items'] ?? []) as $item) {
            if (!is_array($item) || !isset($item['id'])) continue;
            $productId = (int) $item['id'];
            if (!isset($lines[$productId])) $lines[$productId] = ['item' => $item, 'quantity' => 0];
            $lines[$productId]['quantity']++;
        }
        $lineNumber = 1;
        foreach ($lines as $productId => $line) {
            $item = $line['item'];
            $invited = min((int) $line['quantity'], (int) (($sale['invitedQuantities'] ?? [])[$productId] ?? 0));
            $insertItem->execute([
                (string) $sale['id'], $lineNumber++, $productId, (string) ($item['name'] ?? ''),
                (string) ($item['detail'] ?? ''), (int) $line['quantity'], $invited, (float) ($item['price'] ?? 0),
            ]);
        }
        $deletePayments->execute([(string) $sale['id']]);
        foreach (($state['payments'] ?? []) as $payment) {
            if (!is_array($payment) || ($payment['saleId'] ?? null) !== $sale['id']) continue;
            $insertPayment->execute([(string) $sale['id'], (string) ($payment['method'] ?? ''), (float) ($payment['amount'] ?? 0)]);
        }
    }

    $sessionStatement = $pdo->prepare(
        "INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE opened_at=VALUES(opened_at), opened_by=VALUES(opened_by), initial_fund=VALUES(initial_fund),
        closed_at=VALUES(closed_at), closed_by=VALUES(closed_by), expected_cash=VALUES(expected_cash), counted_cash=VALUES(counted_cash),
        difference_amount=VALUES(difference_amount), envelope_amount=VALUES(envelope_amount)"
    );
    $sessions = [];
    foreach (($state['shiftLog'] ?? []) as $session) if (is_array($session) && !empty($session['id'])) $sessions[$session['id']] = $session;
    if (!empty($state['activeShift']['id'])) $sessions[$state['activeShift']['id']] = $state['activeShift'];
    foreach ($sessions as $session) {
        $sessionStatement->execute([
            (string) $session['id'], $site, iso_datetime($session['openedAt'] ?? null), (string) ($session['openedBy'] ?? ''),
            (float) ($session['initialFund'] ?? 0), iso_datetime($session['closedAtISO'] ?? $session['closedAt'] ?? null), (string) ($session['closedBy'] ?? ''),
            isset($session['expectedCash']) ? (float) $session['expectedCash'] : null,
            isset($session['countedCash']) ? (float) $session['countedCash'] : null,
            isset($session['differenceAmount']) ? (float) $session['differenceAmount'] : null,
            isset($session['envelopeAmount']) ? (float) $session['envelopeAmount'] : null,
        ]);
    }

    $cashStatement = $pdo->prepare(
        "INSERT INTO lartisan_cash_movements
        (id, site, session_id, occurred_at, kind, direction, amount, cash_impact, payment_method, reference_id, detail, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE session_id=VALUES(session_id), occurred_at=VALUES(occurred_at), kind=VALUES(kind),
        direction=VALUES(direction), amount=VALUES(amount), cash_impact=VALUES(cash_impact), payment_method=VALUES(payment_method),
        reference_id=VALUES(reference_id), detail=VALUES(detail), created_by=VALUES(created_by)"
    );
    foreach (($state['cashLedger'] ?? []) as $movement) {
        if (!is_array($movement) || empty($movement['id'])) continue;
        $cashStatement->execute([
            (string) $movement['id'], $site, $movement['shiftId'] ?? null, iso_datetime($movement['atISO'] ?? null),
            (string) ($movement['kind'] ?? ''), (string) ($movement['direction'] ?? 'Informativo'),
            (float) ($movement['amount'] ?? 0), (float) ($movement['cashImpact'] ?? 0),
            $movement['paymentMethod'] ?? null, $movement['reference'] ?? null, (string) ($movement['detail'] ?? ''),
            (string) ($movement['createdBy'] ?? ''),
        ]);
    }

    $stockStatement = $pdo->prepare(
        "INSERT INTO lartisan_stock_movements (id, site, product_id, movement_type, quantity, remito, source_reference, detail, occurred_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE movement_type=VALUES(movement_type), quantity=VALUES(quantity), remito=VALUES(remito),
        source_reference=VALUES(source_reference), detail=VALUES(detail), occurred_at=VALUES(occurred_at), created_by=VALUES(created_by)"
    );
    foreach (($state['stockMovements'] ?? []) as $movement) {
        if (!is_array($movement) || empty($movement['id'])) continue;
        $stockStatement->execute([
            (string) $movement['id'], $site, (int) ($movement['productId'] ?? 0), (string) ($movement['kind'] ?? ''),
            (int) ($movement['quantity'] ?? 0), (string) ($movement['remito'] ?? ''), $movement['reference'] ?? null,
            (string) ($movement['detail'] ?? ''), iso_datetime($movement['atISO'] ?? null), (string) ($movement['createdBy'] ?? ''),
        ]);
    }
}
