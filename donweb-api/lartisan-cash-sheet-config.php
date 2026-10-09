<?php

declare(strict_types=1);

// Este archivo se sube a la raíz privada del hosting (junto a
// lartisan-backup-config.php), nunca dentro de public_html.
// Novo Pacheco queda deliberadamente sin configurar hasta que se habilite.
return [
    // Apps Script ejecuta como el propietario de las planillas: no requiere
    // acceso al proyecto de Google Cloud. Completar ambos valores luego de
    // implementar el archivo google-apps-script/LArtisanCashCloseSync.gs.
    'provider' => 'apps_script',
    'apps_script_url' => 'https://script.google.com/macros/s/AKfycbwf1eq-pNK42Dgc40W1JSR60XR4VWg4TijABJKUVhD9nqpmLqDN7Hg2OYMZzrbTttFUPw/exec',
    'apps_script_secret' => 'jL8xQ2mV7pR4cN9kW6tY3aF5hD1sZ0uE8bG2qM7vK4nP9rT',
    'locations' => [
        'Maure' => [
            'spreadsheet_id' => '10RKMEItTwD1Dw_T671cLT1QcS1qCUvm1ZhcjlsoYGU0',
            'sheet' => 'INGRESOS DIARIOS',
            'sheet_name' => 'INGRESOS DIARIOS',
            'header_row' => 5,
        ],
        'Congreso' => [
            'spreadsheet_id' => '14BEXikqLBuiGeBKyIqwSRkCRAFfopPYM7ZhnjKdrPBk',
            'sheet' => 'ingresos',
            'sheet_name' => 'ingresos',
            'header_row' => 5,
        ],
        'Villa Mitre' => [
            'spreadsheet_id' => '1Tkd2Mhe28OsCzOl9-TAEEFyFAczFrCbe3b08Vf2oF2k',
            'sheet' => 'INGRESOS',
            'sheet_name' => 'INGRESOS',
            'header_row' => 5,
        ],
        'Recoleta' => [
            'spreadsheet_id' => '131eexo3o0ALWmrOhu0HfUnTLTVH33aHTGQ2sEMlwHtk',
            'sheet' => 'INGRESOS',
            'sheet_name' => 'INGRESOS',
            'header_row' => 5,
        ],
    ],
];
