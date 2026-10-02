import { NEGOCIO } from "../config";

// Convierte 11000 en "$ 11.000"
export function formatearPrecio(numero) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(numero);
}

// Arma el texto del pedido tal como le va a llegar al dueño por WhatsApp
export function armarMensaje({ items, datos, total }) {
  const lineas = items.map(
    (i) =>
      `• ${i.cantidad}x ${i.nombre}${i.opcion !== "Único" ? ` (${i.opcion})` : ""} - ${formatearPrecio(i.precio * i.cantidad)}`
  );

  const partes = [
    `*Nuevo pedido - ${NEGOCIO.nombre}*`,
    "",
    `*Cliente:* ${datos.nombre}`,
    `*Modalidad:* ${datos.entrega === "delivery" ? "Delivery" : "Retiro en el local"}`,
  ];
  if (datos.entrega === "delivery") partes.push(`*Dirección:* ${datos.direccion}`);
  partes.push(`*Pago:* ${datos.pago}`, "", "*Pedido:*", ...lineas, "", `*Total: ${formatearPrecio(total)}*`);
  if (datos.notas.trim()) partes.push("", `*Aclaraciones:* ${datos.notas}`);

  return partes.join("\n");
}

// Link que abre WhatsApp con el mensaje ya escrito
export function linkWhatsApp(mensaje) {
  return `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(mensaje)}`;
}
