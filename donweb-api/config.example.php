<?php

return [
    'database' => [
        'host' => 'localhost',
        'name' => 'c2451504_sistema',
        'user' => 'c2451504_sistema',
        'password' => 'REEMPLAZAR_EN_EL_SERVIDOR',
    ],
    'allowed_origins' => [
        'https://ventas.lartisantaller.com',
        'https://admin.lartisantaller.com',
    ],
    'cookie_domain' => '.lartisantaller.com',
    'session_hours' => 12,
    'admin_recovery_email' => 'administracion@lartisantaller.com',
    'recovery_from_email' => 'no-reply@lartisantaller.com',
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
        'spreadsheet_id' => '1K-MQnFGyr1MN_HRtTyXdDrjai8l2-gAPetSmPx11viA',
        'range' => "'P&L Consolidado 2026 COPIA'!A1:AN220",
        'redirect_uri' => 'https://www.lartisantaller.com/sistema-api/admin/pnl/google-callback',
    ],
];
