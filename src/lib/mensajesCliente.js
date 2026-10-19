// Respuestas por WhatsApp al cliente que hizo el pedido web. Se abren en
// WhatsApp (Web o la app) con el mensaje ya escrito, en el chat del cliente.
import { NEGOCIO } from "../config";
import { formatearPrecio } from "./formato";
import { esEnvio } from "../components/admin/ventasUtils";

function saludo(venta) {
  const nombre = venta.cliente_nombre?.trim().split(/\s+/)[0];
  return nombre ? `Hola ${nombre}!` : "Hola!";
}

export const PLANTILLAS = {
  recibido: {
    nombre: "Pedido recibido",
    texto: (venta) =>
      `${saludo(venta)} Recibimos tu pedido #${venta.numero} en ${NEGOCIO.nombre}. En unos minutos te lo confirmamos.`,
  },
  confirmado: {
    nombre: "Pedido confirmado",
    texto: (venta, { demora } = {}) =>
      [
        `${saludo(venta)} Tu pedido #${venta.numero} está confirmado y ya lo estamos preparando.`,
        `Total: ${formatearPrecio(venta.total)}.`,
        demora ? `${esEnvio(venta) ? "Llega en" : "Va a estar listo en"} aproximadamente ${demora} minutos.` : "",
        "Gracias por elegirnos.",
      ]
        .filter(Boolean)
        .join(" "),
  },
  en_camino: {
    nombre: "En camino / listo",
    texto: (venta) =>
      esEnvio(venta)
        ? `${saludo(venta)} Tu pedido #${venta.numero} ya salió y está en camino.`
        : `${saludo(venta)} Tu pedido #${venta.numero} ya está listo para retirar en el local.`,
  },
};

export function linkWhatsAppCliente(telefono, texto) {
  return `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;
}

// Normaliza lo que se escribe a mano en el panel: "388 413-1570" → "5493884131570"
export function normalizarTelefono(texto) {
  let v = String(texto ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (!v) return "";
  if (!v.startsWith("54")) v = `549${v.replace(/^0/, "")}`;
  return v.length >= 10 && v.length <= 15 ? v : "";
}

// "5493884131570" → "+54 9 388 413-1570" (para mostrar)
export function mostrarTelefono(tel) {
  if (!tel) return "";
  const m = /^549(\d{3})(\d{3})(\d{4})$/.exec(tel);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : `+${tel}`;
}
