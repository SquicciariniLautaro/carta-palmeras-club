const formatoPrecio = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

// 12000 → "$ 12.000"
export function formatearPrecio(numero) {
  return formatoPrecio.format(Number(numero) || 0);
}

// Precio que se cobra: el promo si existe, si no el normal
export function precioFinal(comida) {
  return Number(comida.precio_promo ?? comida.precio);
}

export function tienePromo(comida) {
  return comida.precio_promo != null && Number(comida.precio_promo) < Number(comida.precio);
}

const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatearFechaHora(iso) {
  return formatoFechaHora.format(new Date(iso));
}

const formatoDia = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

export function formatearDia(fecha) {
  return formatoDia.format(fecha);
}

// "Hamburguésa" → "hamburguesa": para buscar sin importar tildes ni mayúsculas
export function normalizarTexto(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Fecha local en formato YYYY-MM-DD (para inputs type="date")
export function fechaInput(fecha) {
  const d = new Date(fecha);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Clave de día local para agrupar ventas
export function claveDia(fecha) {
  return fechaInput(fecha);
}

const formatoPesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// 12000.5 → "$ 12.000,50" (para caja, arqueos y reportes)
export function formatearPesos(numero) {
  return formatoPesos.format(Number(numero) || 0);
}

const formatoFecha = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const formatoHora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

// Acepta un ISO, un Date o una fecha "2026-10-16" (sin hora: se toma como día local)
function aFecha(valor) {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-").map(Number);
    return new Date(a, m - 1, d);
  }
  return new Date(valor);
}

// "16/10/2026"
export function formatearFecha(valor) {
  return formatoFecha.format(aFecha(valor));
}

// "21:34"
export function formatearHora(valor) {
  return formatoHora.format(new Date(valor));
}

// 0.256 → "25,6 %"
export function formatearPorcentaje(valor) {
  return `${(Number(valor) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}
