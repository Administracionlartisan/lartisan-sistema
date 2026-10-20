const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");

function parseLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
}

export function parseHistoryCsv(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("El CSV debe incluir encabezados y al menos una fila.");
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const headers = parseLine(lines[0], delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseLine(line, delimiter)[index] || ""])));
}

export const SALES_HISTORY_TEMPLATE = [
  ["fecha", "local", "operacion", "bruto", "descuento", "neto", "medio_pago", "comprobante", "cliente", "canal", "estado"],
  ["2026-01-15 13:30:00", "Recoleta", "", 15000, 0, 15000, "Efectivo", "Factura B", "Consumidor final", "Mostrador", "activa"],
];

export const CASH_HISTORY_TEMPLATE = [
  ["apertura", "local", "turno", "abrio", "fondo_inicial", "cierre", "cerro", "esperado", "contado", "diferencia", "sobre"],
  ["2026-01-15 09:00:00", "Recoleta", "", "Nombre", 10000, "2026-01-15 21:00:00", "Nombre", 85000, 85000, 0, 70000],
];
