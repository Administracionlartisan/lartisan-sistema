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
    if (($user['action_permissions'] ?? null) !== null) {
        $result['actionPermissions'] = json_decode((string) $user['action_permissions'], true) ?: [];
    }
    return $result;
}

function ensure_user_locations_schema(PDO $pdo): void
{
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
    if (!user_can_action($user, 'stock')) unset($state['realStock'], $state['stockAdjustments']);
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
    ensure_normalized_operations_schema($pdo);
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
            synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lartisan_cash_sessions_site_opened (site, opened_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
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

function sync_normalized_operations(PDO $pdo, string $site, array $state, int $userId): void
{
    $saleStatement = $pdo->prepare(
        "INSERT INTO lartisan_sales
        (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, channel, status, invitation, synced_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE site=VALUES(site), occurred_at=VALUES(occurred_at), gross_amount=VALUES(gross_amount),
        discount_amount=VALUES(discount_amount), net_amount=VALUES(net_amount), payment_method=VALUES(payment_method),
        invoice_type=VALUES(invoice_type), customer_name=VALUES(customer_name), channel=VALUES(channel), status=VALUES(status),
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
            (string) ($sale['invoiceType'] ?? ''), (string) ($sale['customer'] ?? ''), (string) ($sale['channel'] ?? ''),
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
        "INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE opened_at=VALUES(opened_at), opened_by=VALUES(opened_by), initial_fund=VALUES(initial_fund),
        closed_at=VALUES(closed_at), closed_by=VALUES(closed_by)"
    );
    $sessions = [];
    foreach (($state['shiftLog'] ?? []) as $session) if (is_array($session) && !empty($session['id'])) $sessions[$session['id']] = $session;
    if (!empty($state['activeShift']['id'])) $sessions[$state['activeShift']['id']] = $state['activeShift'];
    foreach ($sessions as $session) {
        $sessionStatement->execute([
            (string) $session['id'], $site, iso_datetime($session['openedAt'] ?? null), (string) ($session['openedBy'] ?? ''),
            (float) ($session['initialFund'] ?? 0), iso_datetime($session['closedAt'] ?? null), (string) ($session['closedBy'] ?? ''),
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
