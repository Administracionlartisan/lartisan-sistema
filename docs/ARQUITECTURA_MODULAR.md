# Arquitectura modular del sistema L'ARTISAN

La aplicación conserva una única entrada en `app/page.tsx`, pero las responsabilidades reutilizables y de mayor riesgo ya no viven dentro de ese archivo.

```text
app/
├── api/
│   └── pilot/health/route.ts
├── components/
│   ├── AiHelpChat.tsx
│   └── ReportNavigation.tsx
├── data/
│   ├── assistantKnowledge.ts
│   ├── operationDiagnostics.ts
│   └── reportGuide.ts
├── modules/
│   ├── administracion/
│   │   ├── ComingSoonPanel.tsx
│   │   └── ComingSoonPanel.module.css
│   ├── auth/
│   │   ├── AuthScreens.tsx
│   │   └── AuthScreens.module.css
│   ├── config/
│   │   └── operationalCatalog.ts
│   ├── shared/
│   │   ├── components/Heading.tsx
│   │   ├── constants.ts
│   │   ├── downloadCsv.ts
│   │   └── types.ts
│   ├── usuarios/
│   │   └── apiUserMapper.ts
│   └── ventas/
│       └── thermalReceipt.ts
├── globals.css
├── layout.tsx
└── page.tsx
```

## Responsabilidad de cada bloque

- `auth`: acceso administrativo, acceso de ventas, carga segura y cambio obligatorio de contraseña.
- `ventas`: construcción y formato del ticket térmico de 80 mm.
- `usuarios`: traducción de usuarios recibidos desde la API al modelo de la interfaz.
- `config`: catálogos operativos, productos, locales, permisos, horarios y referencias de informes.
- `shared`: tipos, constantes, utilidades y componentes comunes.
- `administracion`: paneles propios del área administrativa, incluido el estado de módulos próximos.
- `data`: conocimiento de la ayuda, diagnóstico operativo y guía de reportes.
- `components`: componentes visuales compartidos que ya existían antes de esta reorganización.

## Regla para las próximas funciones

Cada función nueva debe ubicarse dentro del módulo de su área. `app/page.tsx` debe limitarse progresivamente a coordinar estado, navegación y composición; no debe volver a contener catálogos extensos, generadores de documentos, modelos de datos ni estilos particulares.

Los estilos específicos de un módulo se guardan junto al componente en archivos `*.module.css`. `globals.css` queda reservado para identidad visual, impresión y reglas realmente globales.

## Controles automáticos

`npm run test:structure` comprueba que las responsabilidades extraídas sigan en sus carpetas y no regresen accidentalmente a `page.tsx`.
