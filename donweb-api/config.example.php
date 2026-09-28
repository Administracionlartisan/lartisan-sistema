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
    'monitoring' => [
        // Si se omite, usa admin_recovery_email. Repite una misma alerta
        // como máximo una vez dentro de este intervalo.
        'alert_email' => 'CONFIGURAR_EN_EL_SERVIDOR',
        'cooldown_hours' => 6,
    ],
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
    // Usa la misma autorización de lectura de Google que P&L. No escribe en Drive.
    'expense_sync' => [
        'range' => "'GASTOS OPERATIVOS'!A7:Z10000",
    ],
    // En producción esta sección se guarda fuera de public_html en
    // lartisan-ai-config.php.
    'openai' => [
        'api_key' => 'CONFIGURAR_EN_ARCHIVO_PRIVADO',
        'model' => 'gpt-5.6-luna',
    ],
    // Los archivos firmados de ARCA no van aquí ni dentro de public_html.
    // En producción se completan en lartisan-arca-config.php, fuera del webroot.
    'arca' => [
        'enabled' => false,
        // Sólo se cambia a true en el archivo privado cuando Administración
        // habilita formalmente la emisión real de CAE.
        'issuance_enabled' => false,
        // Fecha y hora desde la que este sistema toma ventas para emisión. Las
        // anteriores pertenecen al sistema fiscal previo y nunca se reenvían.
        'issuance_start_at' => '',
        'environment' => 'homologacion',
        'cuit' => '30716293471',
        'certificate_path' => '',
        'private_key_path' => '',
        'ticket_cache_path' => '',
        'points_of_sale' => [
            'Recoleta' => 20,
            'Congreso' => 21,
            'Maure' => 8,
            'Villa Mitre' => 6,
        ],
    ],
];
