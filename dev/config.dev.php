<?php

// Configuración EXCLUSIVA del entorno local de pruebas. No contiene secretos
// reales: base local en 127.0.0.1:3313 y sin integraciones externas.
// Nunca copiar este archivo al servidor.
return [
    'database' => [
        'host' => '127.0.0.1;port=3313',
        'name' => 'lartisan_dev',
        'user' => 'lartisan_dev',
        'password' => 'dev-local-only',
    ],
    'allowed_origins' => [
        'http://localhost:3000',
        'http://localhost:3210',
        'http://localhost:5173',
    ],
    // Cookie solo para el host actual (localhost).
    'cookie_domain' => '',
    'cookie_secure' => false,
    'session_hours' => 12,
    'primary_admin_username' => 'admin.pruebas',
    'admin_recovery_email' => '',
    'recovery_from_email' => '',
    'monitoring' => ['alert_email' => '', 'cooldown_hours' => 6],
    'backup' => ['local_retention_days' => 30, 'drive' => []],
    'pnl_sync' => ['spreadsheet_id' => ''],
    'expense_sync' => [],
    'openai' => ['api_key' => ''],
    'arca' => [
        'enabled' => false,
        'issuance_enabled' => false,
        'issuance_start_at' => '2026-09-30 00:00:00',
        'environment' => 'homologacion',
        'cuit' => '30716293471',
        'certificate_path' => '',
        'private_key_path' => '',
        'points_of_sale' => ['Recoleta' => 20, 'Congreso' => 21, 'Maure' => 8, 'Villa Mitre' => 6],
    ],
];
