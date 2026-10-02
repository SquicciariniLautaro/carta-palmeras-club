import { precioFinal } from "./formato";

// Opciones de personalización de una comida (columna "opciones" de la base):
//   variantes: [{ nombre: "Simple", precio: 8500 }, ...]  el precio sale de la variante elegida
//   quitar:    ["Cebolla", ...]                           ingredientes que se pueden sacar
//   agregar:   [{ nombre: "Huevo", precio: 1000 }, ...]   extras con costo
// El precio final lo vuelve a calcular la base al crear el pedido.

export const LARGO_ACLARACION = 80;

export const CONFIG_VACIA = Object.freeze({ variante: null, quitar: [], agregar: [], aclaracion: "" });

const esTexto = (x) => typeof x === "string" && x.trim() !== "";

export function opcionesDe(comida) {
  const o = comida?.opciones && typeof comida.opciones === "object" ? comida.opciones : {};
  const variantes = (Array.isArray(o.variantes) ? o.variantes : [])
    .filter((v) => v && esTexto(v.nombre) && Number(v.precio) > 0)
    .map((v) => ({ nombre: v.nombre, precio: Number(v.precio) }));
  const quitar = (Array.isArray(o.quitar) ? o.quitar : []).filter(esTexto);
  const agregar = (Array.isArray(o.agregar) ? o.agregar : [])
    .filter((a) => a && esTexto(a.nombre) && Number(a.precio) >= 0)
    .map((a) => ({ nombre: a.nombre, precio: Number(a.precio) }));
  return { variantes, quitar, agregar };
}

export function tieneOpciones(comida) {
  const o = opcionesDe(comida);
  return o.variantes.length > 0 || o.quitar.length > 0 || o.agregar.length > 0;
}

// Configuración con la que arranca el armado de un producto
export function configInicial(comida) {
  const { variantes } = opcionesDe(comida);
  return { variante: variantes[0]?.nombre ?? null, quitar: [], agregar: [], aclaracion: "" };
}

// Deja la configuración en forma canónica (sirve también para lo guardado en el navegador)
export function normalizarConfig(config) {
  const c = config && typeof config === "object" ? config : {};
  const lista = (x) => [...new Set((Array.isArray(x) ? x : []).filter(esTexto))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    variante: esTexto(c.variante) ? c.variante : null,
    quitar: lista(c.quitar),
    agregar: lista(c.agregar),
    aclaracion: typeof c.aclaracion === "string" ? c.aclaracion.trim().slice(0, LARGO_ACLARACION) : "",
  };
}

// Dos líneas del carrito son la misma si tienen igual producto y configuración
export function claveLinea(id, config) {
  const c = normalizarConfig(config);
  return [id, c.variante ?? "", c.quitar.join(","), c.agregar.join(","), c.aclaracion.toLowerCase()].join("|");
}

// ¿La configuración sigue siendo posible con las opciones actuales?
export function configValida(comida, config) {
  const o = opcionesDe(comida);
  const c = normalizarConfig(config);
  if (o.variantes.length > 0) {
    if (c.variante !== null && !o.variantes.some((v) => v.nombre === c.variante)) return false;
  } else if (c.variante !== null) {
    return false;
  }
  if (!c.quitar.every((q) => o.quitar.includes(q))) return false;
  if (!c.agregar.every((a) => o.agregar.some((x) => x.nombre === a))) return false;
  return true;
}

// Precio de una unidad con esa configuración
export function precioLinea(comida, config) {
  const o = opcionesDe(comida);
  const c = normalizarConfig(config);
  let base = precioFinal(comida);
  if (o.variantes.length > 0) {
    base = (o.variantes.find((v) => v.nombre === c.variante) ?? o.variantes[0]).precio;
  }
  const extras = o.agregar.filter((a) => c.agregar.includes(a.nombre)).reduce((s, a) => s + a.precio, 0);
  return base + extras;
}

// Precio más bajo para mostrar "Desde $X" en las tarjetas
export function precioDesde(comida) {
  const { variantes } = opcionesDe(comida);
  return variantes.length > 1 ? Math.min(...variantes.map((v) => v.precio)) : null;
}

// "Doble · sin cebolla · extra Huevo · «bien cocida»"
export function textoConfig(comida, config) {
  const o = opcionesDe(comida);
  const c = normalizarConfig(config);
  const partes = [];
  if (o.variantes.length > 0) partes.push(c.variante ?? o.variantes[0].nombre);
  if (c.quitar.length > 0) partes.push(`sin ${c.quitar.map((q) => q).join(", ")}`);
  if (c.agregar.length > 0) {
    const nombres = c.agregar.map((nombre) => {
      const extra = o.agregar.find((a) => a.nombre === nombre);
      return extra && extra.precio === 0 ? `${nombre} (precio a confirmar)` : nombre;
    });
    partes.push(`extra ${nombres.join(", ")}`);
  }
  if (c.aclaracion) partes.push(`«${c.aclaracion}»`);
  return partes.join(" · ");
}

// Lo que se manda a crear_pedido
export function itemParaPedido(comidaId, cantidad, config) {
  const c = normalizarConfig(config);
  return {
    comida_id: comidaId,
    cantidad,
    variante: c.variante,
    quitar: c.quitar,
    agregar: c.agregar,
    aclaracion: c.aclaracion || null,
  };
}
