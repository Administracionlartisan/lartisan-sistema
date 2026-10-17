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
    // Cierra la sesión en equipos compartidos tras este tiempo sin actividad.
    // Entre 5 y 240 minutos; la expiración absoluta se mantiene en session_hours.
    'session_idle_minutes' => 30,
    'session_hours' => 12,
    // Zona horaria de PHP y de la conexión MySQL (fechas de ventas, cajas,
    // vencimiento de sesiones y de códigos de recuperación).
    'timezone' => 'America/Argentina/Buenos_Aires',
    'operations' => [
        // Días de operaciones cerradas que conserva el estado de cada local
        // (mínimo 7). Si el estado supera 2 MB se acorta automáticamente.
        // Lo recortado sigue en lartisan_sales y operation_archive.
        'retention_days' => 60,
    ],
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
        // Incluye adjuntos y configuraciones de recuperación, siempre cifrados.
        // La clave de cifrado va en lartisan-backup-encryption.php fuera del webroot.
        'asset_paths' => ['public_html/documents', 'public_html/images', 'public_html/carga', 'public_html/capacitacion-media', 'lartisan-backup-config.php', 'lartisan-arca-config.php', 'lartisan-cash-sheet-config.php'],
        'restore_test' => [
            // Base MySQL separada y aislada. Nunca usar las credenciales de producción aquí.
            'database' => ['host' => '', 'name' => '', 'user' => '', 'password' => ''],
        ],
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
    // Cierres diarios: Apps Script escribe sólo las celdas configuradas de la
    // fila ya existente para la fecha. Se ejecuta con la cuenta propietaria de
    // las planillas, por lo que no exige permisos sobre Google Cloud.
    'cash_sheet_sync' => [
        'provider' => 'apps_script',
        'apps_script_url' => 'PEGAR_URL_DE_LA_IMPLEMENTACION_WEB',
        'apps_script_secret' => 'CLAVE_ALEATORIA_DE_32_O_MAS_CARACTERES',
        'locations' => [
            'Recoleta' => [
                'spreadsheet_id' => '131eexo3o0ALWmrOhu0HfUnTLTVH33aHTGQ2sEMlwHtk', 'sheet' => 'INGRESOS', 'header_row' => 5,
                'date_header' => 'FECHA', 'total_header' => 'FACT TOTAL', 'tickets_header' => 'Tickets', 'discounts_header' => 'DESCUENTOS',
                'payment_headers' => ['Efectivo' => 'EFECT', 'Tarjeta' => 'TRJE', 'Open Pay' => 'Open Pay', 'Mercado Pago / QR' => 'MP/QR', 'Banco Nación' => 'Banco Nación', 'Banco Provincia' => 'Banco Provincia', 'Banco Galicia' => 'Banco Galicia', 'Transferencia' => 'TRANSFERENCIA', 'MP Delivery' => 'MP Delivery', 'Pedidos Ya Efectivo' => 'PEDIDOS YA EFECTIVO', 'Pedidos Ya' => 'PEDIDOS YA', 'Rappi' => 'RAPPI'],
            ],
            'Villa Mitre' => [
                'spreadsheet_id' => '1Tkd2Mhe28OsCzOl9-TAEEFyFAczFrCbe3b08Vf2oF2k', 'sheet' => 'INGRESOS', 'header_row' => 5,
                'date_header' => 'FECHA', 'total_header' => 'FACT TOTAL', 'tickets_header' => 'Tickets', 'discounts_header' => 'DESCUENTOS',
                'payment_headers' => ['Efectivo' => 'EFECT', 'Tarjeta' => 'TRJE', 'Clover' => 'Clover', 'Banco Frances' => 'Banco Frances', 'Banco Provincia' => 'banco provincia', 'QR Galicia' => 'QR GALICIA', 'QR Banco Nación' => 'QR BANCO NACION', 'Mercado Pago / QR' => 'MP/QR', 'Transferencia' => 'Transferencia', 'MP Delivery' => 'MP DELIVERY', 'Pedidos Ya Efectivo' => 'Pedidos Ya Efectivo', 'Pedidos Ya Online' => 'Pedidos Ya online', 'Rappi' => 'RAPPI'],
            ],
            'Congreso' => [
                'spreadsheet_id' => '14BEXikqLBuiGeBKyIqwSRkCRAFfopPYM7ZhnjKdrPBk', 'sheet' => 'ingresos', 'header_row' => 5,
                'date_header' => 'FECHA', 'total_header' => 'FACT TOTAL', 'tickets_header' => 'Tickets', 'discounts_header' => 'DESCUENTOS',
                'payment_headers' => ['Efectivo' => 'EFECT', 'Tarjeta' => 'TRJE', 'Clover' => 'Clover', 'Open Pay' => 'Open Pay( Banco Frances)', 'Banco Provincia' => 'BANCO PROVINCIA', 'BNA + QR' => 'BNA+QR', 'QR Galicia' => 'QR Galicia', 'Mercado Pago / QR' => 'MP', 'Transferencia' => 'TRANSFERENCIA', 'MP Delivery' => 'MP DELIVERY', 'Pedidos Ya Tarjeta' => 'PEDIDOS YA tarjeta', 'Pedidos Ya Efectivo' => 'Pedidos Ya Efectivo', 'Rappi' => 'RAPPI'],
            ],
            'Maure' => [
                'spreadsheet_id' => '10RKMEItTwD1Dw_T671cLT1QcS1qCUvm1ZhcjlsoYGU0', 'sheet' => 'INGRESOS DIARIOS', 'header_row' => 5,
                'date_header' => 'FECHA', 'total_header' => 'FACT TOTAL', 'tickets_header' => 'Tickets', 'discounts_header' => 'DESCUENTOS',
                'payment_headers' => ['Efectivo' => 'EFECT', 'Tarjeta' => 'TRJE', 'Clover' => 'Clover', 'Open Pay' => 'Open Pay(Banco Frances)', 'Banco Provincia' => 'BANCO PROVINCIA', 'BNA + QR' => 'BNA+QR', 'QR Galicia' => 'GALICIA PROMO', 'Mercado Pago / QR' => 'MP PROMOS', 'Transferencia' => 'TRANSFERENCIA', 'MP Delivery' => 'MP DELIVERY', 'Pedidos Ya Tarjeta' => 'PEDIDOS YA tarjeta', 'Pedidos Ya Efectivo' => 'Pedidos Ya Efectivo', 'Rappi' => 'RAPPI'],
            ],
            // Falta el enlace/ID de Novo Pacheco. No se habilita escritura en
            // ese local hasta que se configure y se verifiquen sus encabezados.
            'Novo Pacheco' => ['spreadsheet_id' => '', 'sheet' => '', 'header_row' => 5],
        ],
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
