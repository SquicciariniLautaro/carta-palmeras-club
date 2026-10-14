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
