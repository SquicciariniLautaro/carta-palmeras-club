import { NEGOCIO } from "../config";

// Planillas de Excel (.xlsx) con formato contable: título, período, encabezados,
// importes en pesos con 2 decimales, fechas reales de Excel, filtros, totales con
// fórmula y la fila de encabezado fija. ExcelJS se carga recién al exportar.

const FORMATOS = {
  moneda: '"$" #,##0.00;[Red]-"$" #,##0.00',
  numero: "#,##0.00",
  entero: "#,##0",
  porcentaje: "0.0%",
  fecha: "dd/mm/yyyy",
  fechaHora: "dd/mm/yyyy hh:mm",
};

const COLOR_ENCABEZADO = "FF2B211B";
const COLOR_FRANJA = "FFF7F2E8";
const COLOR_TOTAL = "FFEDE3D0";
const BORDE = { style: "thin", color: { argb: "FFD9CBB0" } };

// Excel no tiene zonas horarias: pasamos la hora local tal cual se ve en la pantalla
function fechaExcel(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d));
  }
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

function valorCelda(valor, tipo) {
  if (valor == null || valor === "") return null;
  if (tipo === "fecha" || tipo === "fechaHora") return fechaExcel(valor);
  if (["moneda", "numero", "entero", "porcentaje"].includes(tipo)) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return String(valor);
}

function letraColumna(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function generadoEl() {
  return new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function encabezadoHoja(ws, hoja, columnas) {
  const ancho = Math.max(columnas, 2);
  ws.mergeCells(1, 1, 1, ancho);
  const titulo = ws.getCell(1, 1);
  titulo.value = `${NEGOCIO.nombre} · ${hoja.titulo}`;
  titulo.font = { bold: true, size: 14, color: { argb: COLOR_ENCABEZADO } };
  ws.mergeCells(2, 1, 2, ancho);
  ws.getCell(2, 1).value = hoja.subtitulo ?? "";
  ws.getCell(2, 1).font = { size: 11, color: { argb: "FF6B5B4E" } };
  ws.mergeCells(3, 1, 3, ancho);
  ws.getCell(3, 1).value = `Generado el ${generadoEl()}`;
  ws.getCell(3, 1).font = { size: 9, italic: true, color: { argb: "FF6B5B4E" } };
}

function estiloEncabezado(celda) {
  celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
  celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ENCABEZADO } };
  celda.alignment = { vertical: "middle", wrapText: true };
  celda.border = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };
}

// Hoja de tabla: columnas [{ titulo, clave, tipo, ancho }], filas (objetos) y
// totales (claves de las columnas que se suman al final)
function hojaTabla(libro, hoja) {
  const { columnas, filas, totales = [] } = hoja;
  const ws = libro.addWorksheet(hoja.nombre.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: columnas.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  encabezadoHoja(ws, hoja, columnas.length);

  const filaEnc = ws.getRow(5);
  columnas.forEach((c, i) => {
    const celda = filaEnc.getCell(i + 1);
    celda.value = c.titulo;
    estiloEncabezado(celda);
    if (["moneda", "numero", "entero", "porcentaje"].includes(c.tipo)) celda.alignment = { ...celda.alignment, horizontal: "right" };
    ws.getColumn(i + 1).width = c.ancho ?? 14;
  });
  filaEnc.height = 22;

  filas.forEach((f, n) => {
    const fila = ws.getRow(6 + n);
    columnas.forEach((c, i) => {
      const celda = fila.getCell(i + 1);
      celda.value = valorCelda(typeof c.valor === "function" ? c.valor(f) : f[c.clave], c.tipo);
      if (FORMATOS[c.tipo]) celda.numFmt = FORMATOS[c.tipo];
      celda.border = { bottom: { style: "hair", color: { argb: "FFE4D4B6" } } };
      if (c.tipo === "texto" || !c.tipo) celda.alignment = { vertical: "top", wrapText: Boolean(c.ajustar) };
      if (n % 2 === 1) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FRANJA } };
    });
  });

  const primera = 6;
  const ultima = 5 + filas.length;
  if (filas.length > 0) {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: ultima, column: columnas.length } };
  }

  if (totales.length > 0) {
    const fila = ws.getRow(ultima + 1);
    fila.getCell(1).value = filas.length === 0 ? "TOTAL (sin movimientos)" : "TOTAL";
    columnas.forEach((c, i) => {
      const celda = fila.getCell(i + 1);
      if (totales.includes(c.clave)) {
        const col = letraColumna(i + 1);
        celda.value = filas.length ? { formula: `SUBTOTAL(9,${col}${primera}:${col}${ultima})` } : 0;
        celda.numFmt = FORMATOS[c.tipo] ?? FORMATOS.numero;
      }
      celda.font = { bold: true };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
      celda.border = { top: { style: "medium", color: { argb: COLOR_ENCABEZADO } } };
    });
  }

  if (hoja.notas?.length) {
    const desde = ultima + (totales.length ? 3 : 2);
    hoja.notas.forEach((texto, i) => {
      ws.mergeCells(desde + i, 1, desde + i, Math.max(columnas.length, 2));
      const celda = ws.getCell(desde + i, 1);
      celda.value = texto;
      celda.font = { size: 9, italic: true, color: { argb: "FF6B5B4E" } };
    });
  }
}

// Hoja de resumen: filas [{ concepto, valor, tipo, seccion?, destacado?, detalle? }]
// Una fila con solo "seccion" es un subtítulo.
function hojaResumen(libro, hoja) {
  const ws = libro.addWorksheet(hoja.nombre.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  encabezadoHoja(ws, hoja, 3);
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 60;

  let n = 5;
  for (const f of hoja.filas) {
    const fila = ws.getRow(n++);
    if (f.seccion) {
      fila.getCell(1).value = f.seccion;
      [1, 2, 3].forEach((i) => estiloEncabezado(fila.getCell(i)));
      continue;
    }
    fila.getCell(1).value = f.concepto;
    const celda = fila.getCell(2);
    celda.value = valorCelda(f.valor, f.tipo ?? "moneda");
    celda.numFmt = FORMATOS[f.tipo ?? "moneda"] ?? FORMATOS.moneda;
    celda.alignment = { horizontal: "right" };
    fila.getCell(3).value = f.detalle ?? "";
    fila.getCell(3).font = { size: 9, color: { argb: "FF6B5B4E" } };
    fila.getCell(3).alignment = { wrapText: true, vertical: "top" };
    [1, 2, 3].forEach((i) => (fila.getCell(i).border = { bottom: { style: "hair", color: { argb: "FFE4D4B6" } } }));
    if (f.destacado) {
      [1, 2].forEach((i) => {
        fila.getCell(i).font = { bold: true, size: 12 };
        fila.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
      });
    }
  }
}

export function descargarArchivo(contenido, nombre, tipo = "text/plain;charset=utf-8") {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// hojas: [{ nombre, titulo, subtitulo, tipo: "tabla" | "resumen", ... }]
export async function descargarExcel(archivo, hojas) {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  libro.creator = NEGOCIO.nombre;
  libro.created = new Date();
  for (const hoja of hojas) {
    if (hoja.tipo === "resumen") hojaResumen(libro, hoja);
    else hojaTabla(libro, hoja);
  }
  const buffer = await libro.xlsx.writeBuffer();
  const nombre = archivo.endsWith(".xlsx") ? archivo : `${archivo}.xlsx`;
  descargarArchivo(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    nombre
  );
}
