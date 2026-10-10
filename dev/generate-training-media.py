"""Genera el material audiovisual de demostración exclusivamente en .demo-local.

No acepta destinos remotos ni modifica la aplicación. Toma las nueve capturas
del navegador local, sintetiza voz es-AR, produce WebVTT y valida los MP4.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

if os.environ.get("LARTISAN_LOCAL_TRAINING") != "1":
    raise SystemExit("Definí LARTISAN_LOCAL_TRAINING=1 para generar sólo material local.")

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".demo-local" / "training-recordings"
RAW = LOCAL / "raw"
FINAL = LOCAL / "final"
FINAL.mkdir(parents=True, exist_ok=True)
FFMPEG = Path(os.environ["LARTISAN_FFMPEG"])
if not FFMPEG.is_file(): raise SystemExit("FFmpeg local no disponible.")

chapters = [
    ("introduccion-navegacion", "Introducción y navegación", "Ingresá con tu usuario de demostración y nunca compartas contraseñas. Confirmá el local asignado antes de operar. El menú reúne Ventas, Caja, Stock, Pedidos, Fichaje, Clientes y Chat. Si una función no aparece, no pruebes acciones al azar: consultá la guía o avisá a Supervisión."),
    ("apertura-caja", "Apertura y gestión de caja", "Antes de vender, verificá que no exista otra caja abierta en el local. Declarás el fondo inicial real y quedás como responsable del turno. La caja no se transfiere abierta: para un relevo se realiza arqueo y cierre completo, y recién entonces abre la siguiente responsable."),
    ("ventas-medios-pago", "Ventas, productos y medios de pago", "Buscá el producto y revisá presentación, cantidad y stock antes de cobrar. Asociá el cliente cuando corresponda y elegí el medio de pago realmente utilizado. Los descuentos sólo se aplican dentro de tu autorización. Revisá el total y confirmá una única vez."),
    ("clientes", "Clientes", "Primero buscá por documento para evitar duplicados. Si no existe, registrá únicamente los datos obligatorios y verificá documento, correo y CUIT. Desde el historial podés consultar compras y devoluciones. No edites datos de un cliente para corregir una venta ya realizada."),
    ("stock-pedidos-devoluciones", "Stock, pedidos, recepción y devoluciones", "Consultá el stock antes de comprometer un producto. En pedidos, transferencias y recepciones registrá el remito o motivo y confirmá las cantidades reales. Una devolución debe vincularse a la venta e indicar si el producto vuelve o no al stock."),
    ("egresos-incidencias", "Egresos e incidencias", "Un egreso requiere concepto, importe, medio de pago y comprobante cuando exista. Una incidencia documenta un problema, pero no reemplaza un ajuste de caja. Si la operación requiere autorización, dejala pendiente y avisá por Chat Interno."),
    ("fichaje", "Fichaje", "Al llegar al local, registrá tu entrada y autorizá la ubicación. Si el GPS no está disponible, tiene baja precisión o estás fuera del radio, el sistema genera una excepción. No intentes falsear la ubicación. Al terminar el turno, registrá tu salida."),
    ("chat-interno", "Chat Interno", "Usá Chat Interno para coordinar con Administración, Supervisión y el grupo de tu local. Confirmá el destinatario antes de enviar. Adjuntá sólo imágenes o PDF permitidos. Nunca compartas contraseñas, datos bancarios ni documentos personales."),
    ("cierre-sincronizacion", "Cierre de caja y situaciones especiales", "Antes del cierre, controlá todos los medios de pago, el efectivo físico, el sobre y cualquier diferencia. Confirmá una sola vez y esperá la sincronización. Una anulación posterior conserva el cierre histórico y crea un ajuste auditado: nunca edites históricos ni filas de Drive."),
]

raw = sorted((path for path in RAW.glob("*.webm") if path.stat().st_size > 500_000), key=lambda path: path.stat().st_mtime)
if len(raw) < len(chapters): raise SystemExit(f"Faltan capturas locales: hay {len(raw)} de {len(chapters)}.")
raw = raw[-len(chapters):]

def command(*args: str) -> str:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    return result.stdout + result.stderr

def media_duration(path: Path) -> float:
    output = command(str(FFMPEG), "-i", str(path), "-f", "null", "-")
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", output)
    if not match: raise RuntimeError(f"No se pudo leer duración: {path.name}")
    return int(match.group(1))*3600 + int(match.group(2))*60 + float(match.group(3))

def seconds_vtt(value: float) -> str:
    milliseconds = max(0, int(value * 1000)); hours, milliseconds = divmod(milliseconds, 3_600_000); minutes, milliseconds = divmod(milliseconds, 60_000); seconds, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"

async def voice(text: str, target: Path) -> None:
    import edge_tts
    await edge_tts.Communicate(text, voice="es-AR-ElenaNeural", rate="+0%", volume="+0%").save(str(target))

manifest = []
for index, ((slug, title, script), source) in enumerate(zip(chapters, raw), start=1):
    prefix = f"{index:02}-{slug}"
    narration = FINAL / f"{prefix}.mp3"
    awaitable = voice(script, narration); asyncio.run(awaitable)
    duration = media_duration(narration)
    phrases = [item.strip() for item in re.split(r"(?<=[.!?])\s+", script) if item.strip()]
    unit = duration / len(phrases)
    vtt_lines = ["WEBVTT", ""]
    for phrase_index, phrase in enumerate(phrases):
        vtt_lines.extend([f"{seconds_vtt(phrase_index*unit)} --> {seconds_vtt(min(duration, (phrase_index+1)*unit))}", phrase, ""])
    vtt = FINAL / f"{prefix}.vtt"; vtt.write_text("\n".join(vtt_lines), encoding="utf-8")
    mp4 = FINAL / f"{prefix}.mp4"
    command(str(FFMPEG), "-y", "-stream_loop", "-1", "-i", str(source), "-i", str(narration), "-shortest", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(mp4))
    command(str(FFMPEG), "-v", "error", "-i", str(mp4), "-f", "null", "-")
    if mp4.stat().st_size < 50_000 or not vtt.read_text(encoding="utf-8").startswith("WEBVTT"): raise RuntimeError(f"Validación fallida: {prefix}")
    manifest.append({"id": slug, "title": title, "video": mp4.name, "captions": vtt.name, "narration": narration.name, "durationSeconds": round(duration, 2), "source": source.name, "environment": "local-demo-only"})

(FINAL / "manifest.json").write_text(json.dumps({"environment":"local-demo-only", "chapters":manifest}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"ok": True, "chapters": len(manifest)}, ensure_ascii=False))
