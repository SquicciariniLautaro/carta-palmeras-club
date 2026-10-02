import { createContext, useContext } from "react";

import { claveLinea, configValida, normalizarConfig } from "../lib/opciones";

// El carrito guarda solo { id, cantidad, config }. Nombre, precio y stock se
// leen siempre de las comidas cargadas desde Supabase, así nunca quedan viejos.
// Cada combinación distinta de opciones (por ejemplo una doble sin cebolla) es
// una línea aparte, identificada por su "clave".
export const CarritoContext = createContext(null);

export const CLAVE_CARRITO = "lpc-carrito-v2";

function armarItem(id, cantidad, config) {
  const c = normalizarConfig(config);
  return { clave: claveLinea(id, c), id, cantidad, config: c };
}

export function leerCarritoGuardado() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "[]");
    if (!Array.isArray(datos)) return [];
    return datos
      .filter((i) => i && typeof i.id === "string" && Number.isInteger(i.cantidad) && i.cantidad > 0)
      .map((i) => armarItem(i.id, i.cantidad, i.config));
  } catch {
    return [];
  }
}

export function guardarCarrito(items) {
  try {
    localStorage.setItem(
      CLAVE_CARRITO,
      JSON.stringify(items.map(({ id, cantidad, config }) => ({ id, cantidad, config })))
    );
  } catch {
    // Modo privado o almacenamiento lleno: el carrito sigue funcionando en memoria.
  }
}

export function carritoReducer(items, accion) {
  switch (accion.type) {
    case "agregar": {
      const nuevo = armarItem(accion.id, accion.cantidad ?? 1, accion.config);
      const existe = items.find((i) => i.clave === nuevo.clave);
      if (existe) {
        return items.map((i) => (i.clave === nuevo.clave ? { ...i, cantidad: i.cantidad + nuevo.cantidad } : i));
      }
      return [...items, nuevo];
    }
    case "restar":
      return items
        .map((i) => (i.clave === accion.clave ? { ...i, cantidad: i.cantidad - 1 } : i))
        .filter((i) => i.cantidad > 0);
    case "eliminar":
      return items.filter((i) => i.clave !== accion.clave);
    case "reemplazar":
      return accion.items;
    case "vaciar":
      return [];
    default:
      return items;
  }
}

// Compara el carrito guardado con las comidas actuales: saca lo que ya no
// existe, está agotado o cambió de opciones, y ajusta cantidades al stock
// (el stock es por producto: cuenta todas sus líneas juntas).
export function revalidarCarrito(items, comidasPorId) {
  const cambios = [];
  const nuevos = [];
  const usado = new Map();
  for (const item of items) {
    const comida = comidasPorId.get(item.id);
    if (!comida) {
      cambios.push("Sacamos un producto que ya no está disponible.");
      continue;
    }
    if (!configValida(comida, item.config)) {
      cambios.push(`Cambiaron las opciones de "${comida.nombre}" y lo sacamos de tu pedido.`);
      continue;
    }
    if (comida.stock <= 0) {
      cambios.push(`"${comida.nombre}" se agotó y lo sacamos de tu pedido.`);
      continue;
    }
    const restante = comida.stock - (usado.get(item.id) ?? 0);
    if (restante <= 0) {
      cambios.push(`De "${comida.nombre}" quedan ${comida.stock}: sacamos una línea de tu pedido.`);
      continue;
    }
    if (item.cantidad > restante) {
      cambios.push(`De "${comida.nombre}" quedan ${comida.stock}: ajustamos la cantidad.`);
      nuevos.push({ ...item, cantidad: restante });
      usado.set(item.id, comida.stock);
      continue;
    }
    usado.set(item.id, (usado.get(item.id) ?? 0) + item.cantidad);
    nuevos.push(item);
  }
  return { items: nuevos, cambios };
}

export function useCarrito() {
  const contexto = useContext(CarritoContext);
  if (!contexto) throw new Error("useCarrito tiene que usarse dentro de <CarritoProvider>");
  return contexto;
}
