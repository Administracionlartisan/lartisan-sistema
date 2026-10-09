<?php

declare(strict_types=1);

/**
 * Chat operativo persistente. Las conversaciones se autorizan en el servidor:
 * el frontend solamente decide cómo mostrarlas, nunca quién puede verlas.
 */
function ensure_internal_chat_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS internal_chat_threads (
        id CHAR(36) PRIMARY KEY,
        kind VARCHAR(80) NOT NULL,
        title VARCHAR(140) NOT NULL,
        site_name VARCHAR(80) NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat_threads_site (site_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // La clave de un chat directo contiene ambos IDs; no debe truncarse cuando
    // la instalación ya tenga identificadores de usuario de varios dígitos.
    try { $pdo->exec('ALTER TABLE internal_chat_threads MODIFY kind VARCHAR(80) NOT NULL'); } catch (Throwable $ignored) { }
    $pdo->exec("CREATE TABLE IF NOT EXISTS internal_chat_participants (
        thread_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        last_read_at DATETIME NULL,
        joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, user_id),
        INDEX idx_chat_participant_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS internal_chat_messages (
        id CHAR(36) PRIMARY KEY,
        thread_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        client_message_id CHAR(36) NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        edited_at DATETIME NULL,
        deleted_at DATETIME NULL,
        UNIQUE KEY uq_chat_message_client (user_id, client_message_id),
        INDEX idx_chat_messages_thread (thread_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS internal_chat_attachments (
        id CHAR(36) PRIMARY KEY,
        message_id CHAR(36) NOT NULL,
        original_name VARCHAR(180) NOT NULL,
        mime_type VARCHAR(80) NOT NULL,
        byte_size INT NOT NULL,
        content MEDIUMBLOB NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat_attachments_message (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS internal_chat_settings (
        user_id INT PRIMARY KEY,
        sound_enabled TINYINT(1) NOT NULL DEFAULT 1,
        desktop_enabled TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function chat_id(): string { return bin2hex(random_bytes(16)); }
function chat_normalize_text($value, int $limit): string
{
    $text = trim((string) $value);
    if ($text === '' || mb_strlen($text, 'UTF-8') > $limit) throw new InvalidArgumentException('El mensaje no es válido o supera el límite permitido.');
    return $text;
}
function chat_role_label(array $user): string
{
    return $user['role'] === 'administracion' ? 'Administración' : ($user['role'] === 'supervisora' ? 'Supervisión' : 'Ventas');
}
function chat_can_contact(array $sender, array $recipient): bool
{
    if ((int) $sender['id'] === (int) $recipient['id'] || empty($recipient['active'])) return false;
    if ($sender['role'] === 'administracion' || $sender['role'] === 'supervisora') return true;
    // Las vendedoras sólo conversan individualmente con Supervisión o Administración.
    return in_array($recipient['role'], ['supervisora', 'administracion'], true);
}
function chat_thread_member(PDO $pdo, string $threadId, int $userId): bool
{
    $statement = $pdo->prepare('SELECT 1 FROM internal_chat_participants WHERE thread_id = ? AND user_id = ?');
    $statement->execute([$threadId, $userId]);
    return (bool) $statement->fetchColumn();
}
function chat_require_member(PDO $pdo, string $threadId, array $user): void
{
    if (!preg_match('/^[a-f0-9]{32}$/', $threadId) || !chat_thread_member($pdo, $threadId, (int) $user['id'])) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a esta conversación.'], 403);
    }
}
function chat_ensure_group(PDO $pdo, string $kind, string $title, ?string $site, array $participants): string
{
    $statement = $pdo->prepare('SELECT id FROM internal_chat_threads WHERE kind = ? AND ((site_name IS NULL AND ? IS NULL) OR site_name = ?) LIMIT 1');
    $statement->execute([$kind, $site, $site]);
    $id = (string) ($statement->fetchColumn() ?: '');
    if ($id === '') {
        $id = chat_id();
        $pdo->prepare('INSERT INTO internal_chat_threads (id, kind, title, site_name) VALUES (?, ?, ?, ?)')->execute([$id, $kind, $title, $site]);
    }
    $join = $pdo->prepare('INSERT IGNORE INTO internal_chat_participants (thread_id, user_id) VALUES (?, ?)');
    foreach (array_unique($participants) as $userId) $join->execute([$id, (int) $userId]);
    return $id;
}
function chat_ensure_default_groups(PDO $pdo): void
{
    $users = $pdo->query("SELECT id, role, access_all_locations, assigned_location, assigned_locations FROM users WHERE active = 1")->fetchAll();
    $operational = [];
    foreach ($users as $item) if (in_array($item['role'], ['vendedora', 'supervisora', 'administracion'], true)) $operational[] = (int) $item['id'];
    chat_ensure_group($pdo, 'operativo', 'Administración · Supervisión · Ventas', null, $operational);
    foreach (operational_sites() as $site) {
        $members = [];
        foreach ($users as $item) {
            if ($item['role'] === 'administracion' || $item['role'] === 'supervisora') { $members[] = (int) $item['id']; continue; }
            if (user_can_access_site($item, $site)) $members[] = (int) $item['id'];
        }
        chat_ensure_group($pdo, 'local', 'Equipo · ' . $site, $site, $members);
    }
}
function chat_attachment_payload(array $payload): array
{
    $name = trim((string) ($payload['name'] ?? 'imagen'));
    $mime = strtolower(trim((string) ($payload['mime'] ?? '')));
    $data = (string) ($payload['data'] ?? '');
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], true)) throw new InvalidArgumentException('El archivo debe ser JPG, PNG, WEBP o PDF.');
    if (!preg_match('#^data:[^;]+;base64,(.+)$#s', $data, $matches)) throw new InvalidArgumentException('Adjunto inválido.');
    $binary = base64_decode($matches[1], true);
    if ($binary === false || strlen($binary) === 0 || strlen($binary) > 4 * 1024 * 1024) throw new InvalidArgumentException('El adjunto debe pesar entre 1 byte y 4 MB.');
    $valid = ($mime === 'image/jpeg' && substr($binary, 0, 3) === "\xFF\xD8\xFF")
        || ($mime === 'image/png' && substr($binary, 0, 8) === "\x89PNG\r\n\x1A\n")
        || ($mime === 'image/webp' && substr($binary, 0, 4) === 'RIFF' && substr($binary, 8, 4) === 'WEBP')
        || ($mime === 'application/pdf' && substr($binary, 0, 5) === '%PDF-');
    if (!$valid) throw new InvalidArgumentException('El contenido no coincide con el formato declarado.');
    if (function_exists('finfo_open')) {
        $detector = finfo_open(FILEINFO_MIME_TYPE);
        $detected = $detector ? finfo_buffer($detector, $binary) : false;
        if ($detector) finfo_close($detector);
        // WEBP puede no estar identificado en instalaciones PHP antiguas; el
        // encabezado ya fue verificado arriba para ese único caso.
        if ($detected && $mime !== 'image/webp' && $detected !== $mime) throw new InvalidArgumentException('El tipo real del adjunto no coincide con el declarado.');
    }
    return ['id' => chat_id(), 'name' => mb_substr(preg_replace('/[^\pL\pN ._()-]/u', '_', $name) ?: 'archivo', 0, 180, 'UTF-8'), 'mime' => $mime, 'content' => $binary];
}
function chat_serialized_thread(PDO $pdo, string $id, int $userId): array
{
    $statement = $pdo->prepare("SELECT t.id,t.kind,t.title,t.site_name,t.created_at,
        (SELECT MAX(m.created_at) FROM internal_chat_messages m WHERE m.thread_id=t.id) AS last_at,
        (SELECT COUNT(*) FROM internal_chat_messages m WHERE m.thread_id=t.id AND m.user_id<>? AND m.deleted_at IS NULL AND (p.last_read_at IS NULL OR m.created_at>p.last_read_at)) AS unread
        FROM internal_chat_threads t JOIN internal_chat_participants p ON p.thread_id=t.id AND p.user_id=? WHERE t.id=?");
    $statement->execute([$userId, $userId, $id]);
    $row = $statement->fetch();
    if (!$row) throw new RuntimeException('Conversación no encontrada.');
    return ['id' => $row['id'], 'kind' => $row['kind'], 'title' => $row['title'], 'site' => $row['site_name'], 'createdAt' => $row['created_at'], 'lastAt' => $row['last_at'], 'unread' => (int) $row['unread']];
}
function chat_message_rows(PDO $pdo, string $threadId, int $userId, string $query = ''): array
{
    $sql = "SELECT m.id,m.user_id,m.client_message_id,m.body,m.created_at,m.edited_at,m.deleted_at,u.full_name,u.role,
        (SELECT COUNT(*) FROM internal_chat_participants cp WHERE cp.thread_id=m.thread_id AND cp.user_id<>m.user_id) AS delivered_count,
        (SELECT COUNT(*) FROM internal_chat_participants cp WHERE cp.thread_id=m.thread_id AND cp.user_id<>m.user_id AND cp.last_read_at IS NOT NULL AND cp.last_read_at>=m.created_at) AS read_count
        FROM internal_chat_messages m JOIN users u ON u.id=m.user_id WHERE m.thread_id=?";
    $params = [$threadId];
    if ($query !== '') { $sql .= ' AND m.body LIKE ?'; $params[] = '%' . mb_substr($query, 0, 100, 'UTF-8') . '%'; }
    $sql .= ' ORDER BY m.created_at ASC LIMIT 300';
    $statement = $pdo->prepare($sql); $statement->execute($params);
    $attachments = $pdo->prepare('SELECT id,original_name,mime_type,byte_size FROM internal_chat_attachments WHERE message_id=?');
    $result = [];
    foreach ($statement->fetchAll() as $row) {
        $attachments->execute([$row['id']]);
        $result[] = ['id' => $row['id'], 'clientId' => $row['client_message_id'], 'body' => $row['deleted_at'] ? 'Mensaje eliminado' : $row['body'], 'createdAt' => $row['created_at'], 'editedAt' => $row['edited_at'], 'deletedAt' => $row['deleted_at'], 'deliveredCount' => (int) $row['delivered_count'], 'readCount' => (int) $row['read_count'], 'sender' => ['name' => $row['full_name'], 'role' => chat_role_label(['role' => $row['role']]), 'id' => (string) $row['user_id']], 'own' => (int) $row['user_id'] === $userId, 'attachments' => array_map(static function ($file) { return ['id' => $file['id'], 'name' => $file['original_name'], 'mime' => $file['mime_type'], 'size' => (int) $file['byte_size']]; }, $attachments->fetchAll())];
    }
    return $result;
}
function chat_serve_attachment(PDO $pdo, array $user, string $attachmentId): void
{
    if (!preg_match('/^[a-f0-9]{32}$/', $attachmentId)) json_response(['ok' => false, 'error' => 'Adjunto inválido.'], 404);
    $statement = $pdo->prepare('SELECT a.original_name,a.mime_type,a.byte_size,a.content FROM internal_chat_attachments a JOIN internal_chat_messages m ON m.id=a.message_id JOIN internal_chat_participants p ON p.thread_id=m.thread_id WHERE a.id=? AND p.user_id=? LIMIT 1');
    $statement->execute([$attachmentId, (int) $user['id']]); $file = $statement->fetch();
    if (!$file) json_response(['ok' => false, 'error' => 'Adjunto no disponible.'], 404);
    $safeInline = in_array($file['mime_type'], ['image/jpeg', 'image/png', 'image/webp'], true);
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: ' . $file['mime_type']);
    header('Content-Length: ' . (int) $file['byte_size']);
    header('Content-Disposition: ' . ($safeInline ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $file['original_name']) . '"');
    echo $file['content']; exit;
}
