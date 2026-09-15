"""Read an exported workbook without modifying it; produce a private one-time import.

Usage: python scripts/prepare-mrp-import.py source.xlsx destination.json
Keep both files OUTSIDE the public website/source repository.
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path
import openpyxl

source, destination = map(Path, sys.argv[1:])
book = openpyxl.load_workbook(source, read_only=True, data_only=True)
tabs = ['00_Control_Semanal_MRP', '04_Plan_Produccion_Semanal',
        '05_Resumen_Compras_y_Produccion', '09_Lista_Compras_Operativa',
        '01_Diccionario_Insumos', '02_Recetario_Maestro']
ranges = []
errors = []
for name in tabs:
    rows = []
    for cells in book[name].iter_rows():
        row = []
        for cell in cells:
            if cell.data_type == 'e':
                errors.append(f'{name}!{cell.coordinate}: {cell.value}')
            value = cell.value
            if isinstance(value, (datetime.datetime, datetime.date)):
                value = value.isoformat()
            row.append(value)
        while row and row[-1] is None:
            row.pop()
        rows.append(row)
    while rows and not rows[-1]:
        rows.pop()
    ranges.append(rows)
if errors:
    raise SystemExit('Source formula errors: ' + json.dumps(errors, ensure_ascii=True))
bundle = {'format': 'lartisan-mrp-once-v1',
          'sourceSpreadsheetId': '1o0bcoAJUdCQ7VLskOSEM94ieBb1KHcd5O_Rz7h972fY',
          'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'tabs': tabs, 'ranges': ranges}
destination.write_text(json.dumps(bundle, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
print(json.dumps({'file': str(destination), 'bytes': destination.stat().st_size,
                  'rows': dict(zip(tabs, map(len, ranges))), 'formulaErrors': errors}, ensure_ascii=True))
