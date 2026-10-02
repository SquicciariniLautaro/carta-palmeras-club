import { createContext, useContext } from "react";

// El carrito guarda solo { id, cantidad }. Nombre, precio y stock se leen
// siempre de las comidas cargadas desde Supabase, así nunca quedan viejos.
export const CarritoContext = createContext(null);

export const CLAVE_CARRITO = "lpc-carrito-v1";

export function leerCarritoGuardado() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "[]");
    if (!Array.isArray(datos)) return [];
    return datos
      .filter((i) => i && typeof i.id === "string" && Number.isInteger(i.cantidad) && i.cantidad > 0)
      .map((i) => ({ id: i.id, cantidad: i.cantidad }));
  } catch {
    return [];
  }
}

export function guardarCarrito(items) {
  try {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  } catch {
    // Modo privado o almacenamiento lleno: el carrito sigue funcionando en memoria.
  }
}

export function carritoReducer(items, accion) {
  switch (accion.type) {
    case "agregar": {
      const existe = items.find((i) => i.id === accion.id);
      if (existe) {
        return items.map((i) => (i.id === accion.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...items, { id: accion.id, cantidad: 1 }];
    }
    case "restar":
      return items
        .map((i) => (i.id === accion.id ? { ...i, cantidad: i.cantidad - 1 } : i))
        .filter((i) => i.cantidad > 0);
    case "eliminar":
      return items.filter((i) => i.id !== accion.id);
    case "reemplazar":
      return accion.items;
    case "vaciar":
      return [];
    default:
      return items;
  }
}

// Compara el carrito guardado con las comidas actuales: saca lo que ya no
// existe o está agotado y ajusta cantidades al stock disponible.
export function revalidarCarrito(items, comidasPorId) {
  const cambios = [];
  const nuevos = [];
  for (const item of items) {
    const comida = comidasPorId.get(item.id);
    if (!comida) {
      cambios.push("Sacamos un producto que ya no está disponible.");
      continue;
    }
    if (comida.stock <= 0) {
      cambios.push(`"${comida.nombre}" se agotó y lo sacamos de tu pedido.`);
      continue;
    }
    if (item.cantidad > comida.stock) {
      cambios.push(`De "${comida.nombre}" quedan ${comida.stock}: ajustamos la cantidad.`);
      nuevos.push({ ...item, cantidad: comida.stock });
      continue;
    }
    nuevos.push(item);
  }
  return { items: nuevos, cambios };
}

export function useCarrito() {
  const contexto = useContext(CarritoContext);
  if (!contexto) throw new Error("useCarrito tiene que usarse dentro de <CarritoProvider>");
  return contexto;
}
