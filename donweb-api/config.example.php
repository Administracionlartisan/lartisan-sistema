<?php

return [
    'database' => [
        'host' => 'localhost',
        'name' => 'CONFIGURAR_EN_EL_SERVIDOR',
        'user' => 'CONFIGURAR_EN_EL_SERVIDOR',
        'password' => 'REEMPLAZAR_EN_EL_SERVIDOR',
    ],
    'allowed_origins' => [
        'https://ventas.lartisantaller.com',
        'https://admin.lartisantaller.com',
    ],
    'cookie_domain' => '.lartisantaller.com',
    'session_hours' => 12,
    'primary_admin_username' => 'CONFIGURAR_EN_EL_SERVIDOR',
    'admin_recovery_email' => 'CONFIGURAR_EN_EL_SERVIDOR',
    'recovery_from_email' => 'CONFIGURAR_EN_EL_SERVIDOR',
    'backup' => [
        'local_retention_days' => 30,
        'drive' => [
            'client_id' => 'CONFIGURAR_EN_EL_SERVIDOR',
            'client_secret' => 'CONFIGURAR_EN_EL_SERVIDOR',
            'refresh_token' => 'CONFIGURAR_EN_EL_SERVIDOR',
            'folder_id' => 'CONFIGURAR_EN_EL_SERVIDOR',
        ],
    ],
    'pnl_sync' => [
        'spreadsheet_id' => 'CONFIGURAR_EN_EL_SERVIDOR',
        'range' => "'P&L Consolidado 2026 COPIA'!A1:AN220",
        'redirect_uri' => 'https://www.lartisantaller.com/sistema-api/admin/pnl/google-callback',
    ],
    // En producción esta sección se guarda fuera de public_html en
    // lartisan-ai-config.php.
    'openai' => [
        'api_key' => 'CONFIGURAR_EN_ARCHIVO_PRIVADO',
        'model' => 'gpt-5.6-luna',
    ],
];
