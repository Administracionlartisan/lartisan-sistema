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

function public_user(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'fullName' => $user['full_name'],
        'role' => $user['role'],
        'assignedLocation' => $user['assigned_location'],
        'accessAllLocations' => (bool) $user['access_all_locations'],
        'mustChangePassword' => (bool) $user['must_change_password'],
    ];
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
    return $user['role'] !== 'vendedora'
        || (bool) $user['access_all_locations']
        || $user['assigned_location'] === $site;
}

function ensure_operations_schema(PDO $pdo): void
{
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
