import { NEGOCIO } from "../config";
import { formatearPrecio } from "./formato";

export function linkWhatsApp(mensaje) {
  return `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(mensaje)}`;
}

// Mensaje del pedido. Los ítems y el total vienen de la base (crear_pedido),
// así el dueño recibe exactamente lo que quedó registrado.
export function armarMensajePedido({ numero, items, total, cliente, nota }) {
  const lineas = items.map(
    (i) => `*${i.cantidad}x* ${i.nombre} - ${formatearPrecio(i.subtotal)}`
  );

  const partes = [`¡Hola ${NEGOCIO.nombre}! Quiero hacer este pedido:`, ""];
  partes.push(`*Pedido #${numero}*`);
  if (cliente) partes.push(`*A nombre de:* ${cliente}`);
  partes.push("", ...lineas, "", `*Total a pagar: ${formatearPrecio(total)}*`);
  if (nota) partes.push("", `*Nota:* ${nota}`);
  partes.push("", "¿Me confirmás el tiempo de demora y cómo te lo pago?");

  return partes.join("\n");
}

export function mensajeConsulta(comida) {
  return comida
    ? `¡Hola ${NEGOCIO.nombre}! Quería consultar por "${comida.nombre}".`
    : `¡Hola ${NEGOCIO.nombre}! Quería hacerles una consulta.`;
}
