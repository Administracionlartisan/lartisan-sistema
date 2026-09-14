<?php

declare(strict_types=1);

// Punto de entrada exclusivo para una tarea programada del servidor.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/pnl_sync.php';
require __DIR__ . '/mrp_sync.php';

try {
    $result = notify_monitoring_alerts(db($config), $config);
    fwrite(STDOUT, json_encode(['ok' => true, 'notification' => $result], JSON_UNESCAPED_UNICODE) . PHP_EOL);
    exit(($result['status'] ?? '') === 'failed' ? 1 : 0);
} catch (Throwable $error) {
    error_log('LARTISAN scheduled monitor failed: ' . $error->getMessage());
    fwrite(STDERR, "monitor_failed\n");
    exit(1);
}
