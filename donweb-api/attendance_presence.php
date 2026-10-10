<?php

declare(strict_types=1);

/** Presence is deliberately server-side. Browser coordinates are evidence, not
 * proof of identity, so uncertain readings always become an exception rather
 * than a fraud accusation. */
function ensure_attendance_presence_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_site_presence_settings (
        site VARCHAR(80) NOT NULL PRIMARY KEY,
        latitude DECIMAL(10,7) NULL,
        longitude DECIMAL(10,7) NULL,
        radius_meters SMALLINT UNSIGNED NOT NULL DEFAULT 100,
        max_accuracy_meters SMALLINT UNSIGNED NOT NULL DEFAULT 75,
        updated_by BIGINT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_attendance_exceptions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        site VARCHAR(80) NOT NULL,
        kind ENUM('Entrada','Salida') NOT NULL,
        status ENUM('Pendiente','Aprobada','Rechazada') NOT NULL DEFAULT 'Pendiente',
        reason VARCHAR(80) NOT NULL,
        evidence_json TEXT NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME NULL,
        resolved_by BIGINT UNSIGNED NULL,
        resolution_note VARCHAR(500) NULL,
        INDEX idx_lartisan_attendance_exceptions_site_status (site, status),
        INDEX idx_lartisan_attendance_exceptions_user_status (user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function presence_settings(PDO $pdo, string $site): ?array
{
    $statement = $pdo->prepare('SELECT site, latitude, longitude, radius_meters, max_accuracy_meters FROM lartisan_site_presence_settings WHERE site = ?');
    $statement->execute([$site]);
    $row = $statement->fetch();
    if (!$row || $row['latitude'] === null || $row['longitude'] === null) return null;
    return ['site' => (string) $row['site'], 'latitude' => (float) $row['latitude'], 'longitude' => (float) $row['longitude'], 'radiusMeters' => (int) $row['radius_meters'], 'maxAccuracyMeters' => (int) $row['max_accuracy_meters']];
}

function presence_distance_meters(float $aLat, float $aLon, float $bLat, float $bLon): float
{
    $earth = 6371000.0;
    $dLat = deg2rad($bLat - $aLat); $dLon = deg2rad($bLon - $aLon);
    $x = sin($dLat / 2) ** 2 + cos(deg2rad($aLat)) * cos(deg2rad($bLat)) * sin($dLon / 2) ** 2;
    return 2 * $earth * atan2(sqrt($x), sqrt(1 - $x));
}

function presence_uuid(): string
{
    $bytes = bin2hex(random_bytes(16));
    return substr($bytes, 0, 8) . '-' . substr($bytes, 8, 4) . '-4' . substr($bytes, 13, 3) . '-a' . substr($bytes, 17, 3) . '-' . substr($bytes, 20, 12);
}

function presence_evaluate(PDO $pdo, string $site, array $geo): array
{
    $settings = presence_settings($pdo, $site);
    if ($settings === null) return ['ok' => false, 'reason' => 'Local sin geocerca configurada', 'settings' => null];
    $lat = filter_var($geo['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $lon = filter_var($geo['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $accuracy = filter_var($geo['accuracy'] ?? null, FILTER_VALIDATE_FLOAT);
    $capturedAt = strtotime((string) ($geo['capturedAt'] ?? ''));
    if ($lat === false || $lon === false || $accuracy === false || $capturedAt === false) return ['ok' => false, 'reason' => 'Ubicación no disponible', 'settings' => $settings];
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 || $accuracy < 0) return ['ok' => false, 'reason' => 'Ubicación sospechosa', 'settings' => $settings];
    if (abs(time() - $capturedAt) > 600) return ['ok' => false, 'reason' => 'Ubicación vencida', 'settings' => $settings];
    if ($accuracy > $settings['maxAccuracyMeters']) return ['ok' => false, 'reason' => 'Precisión insuficiente', 'settings' => $settings, 'accuracy' => $accuracy];
    $distance = presence_distance_meters((float) $lat, (float) $lon, $settings['latitude'], $settings['longitude']);
    if ($distance > $settings['radiusMeters']) return ['ok' => false, 'reason' => 'Fuera de zona', 'settings' => $settings, 'distance' => $distance, 'accuracy' => $accuracy];
    return ['ok' => true, 'reason' => 'Dentro de zona', 'settings' => $settings, 'distance' => $distance, 'accuracy' => $accuracy];
}

function attendance_append_to_locked_state(PDO $pdo, string $site, array $user, string $kind, array $extra = []): array
{
    $lookup = $pdo->prepare('SELECT state_json, revision FROM operation_site_states WHERE site = ? FOR UPDATE');
    $lookup->execute([$site]); $row = $lookup->fetch();
    $state = $row ? json_decode((string) $row['state_json'], true) : [];
    if (!is_array($state)) $state = [];
    $records = is_array($state['attendanceRecords'] ?? null) ? $state['attendanceRecords'] : [];
    $mine = array_values(array_filter($records, static fn ($record): bool => is_array($record) && ($record['userId'] ?? null) === (int) $user['id']));
    usort($mine, static fn ($a, $b) => strcmp((string) ($b['atISO'] ?? ''), (string) ($a['atISO'] ?? '')));
    $last = $mine[0] ?? null;
    if ($kind === 'Entrada' && ($last['kind'] ?? null) === 'Entrada') throw new RuntimeException('Ya existe una entrada abierta para este usuario.');
    if ($kind === 'Salida' && ($last['kind'] ?? null) !== 'Entrada') throw new RuntimeException('Primero debe registrarse una entrada.');
    $now = new DateTimeImmutable('now');
    $record = array_merge(['id' => presence_uuid(), 'userId' => (int) $user['id'], 'userName' => (string) $user['full_name'], 'site' => $site, 'kind' => $kind, 'at' => $now->format('j/n/Y, H:i:s'), 'atISO' => $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s.v\\Z')], $extra);
    array_unshift($records, $record); $state['attendanceRecords'] = $records;
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($row) $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ? WHERE site = ?')->execute([$json, $user['id'], $site]);
    else $pdo->prepare('INSERT INTO operation_site_states (site, state_json, revision, updated_by) VALUES (?, ?, 1, ?)')->execute([$site, $json, $user['id']]);
    return $record;
}

function enforce_strict_cash_snapshot(array $previous, array $next, array $user, string $site): void
{
    $wasOpen = !empty($previous['cashOpen']); $isOpen = !empty($next['cashOpen']);
    $wasShift = is_array($previous['activeShift'] ?? null) ? $previous['activeShift'] : null;
    $shift = is_array($next['activeShift'] ?? null) ? $next['activeShift'] : null;
    if ($wasOpen && $isOpen && $wasShift !== null && (!$shift || ($shift['id'] ?? '') !== ($wasShift['id'] ?? ''))) {
        throw new RuntimeException('La caja ya está abierta por ' . ($wasShift['openedBy'] ?? 'otra responsable') . '. Debe realizarse el cierre completo antes del relevo.');
    }
    if ($wasOpen && $isOpen && $wasShift !== null && $shift === null) throw new RuntimeException('No se permite cerrar un turno dejando la caja abierta.');
    if (!$wasOpen && $isOpen) {
        if (!$shift || empty($shift['id']) || ($shift['site'] ?? '') !== $site) throw new RuntimeException('La apertura debe crear una responsable activa.');
        if (($shift['openedBy'] ?? '') !== (string) $user['full_name']) throw new RuntimeException('La caja solo puede ser abierta por la responsable de la sesión.');
    }
    if ($wasOpen && !$isOpen && $wasShift !== null) {
        $closed = false;
        foreach (is_array($next['shiftLog'] ?? null) ? $next['shiftLog'] : [] as $item) if (is_array($item) && ($item['id'] ?? '') === ($wasShift['id'] ?? '') && (!empty($item['closedAtISO']) || !empty($item['closedAt']))) { $closed = true; break; }
        if (!$closed) throw new RuntimeException('El cierre completo debe registrar arqueo y responsable saliente antes de abrir otra caja.');
    }
}
