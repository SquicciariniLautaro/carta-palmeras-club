import { opcionesDe } from "./opciones";

// Conversión entre las opciones de una comida y el formulario del panel

export function opcionesIniciales(comida) {
  const o = opcionesDe(comida);
  return {
    variantes: o.variantes.map((v) => ({ nombre: v.nombre, precio: String(v.precio) })),
    quitar: o.quitar.join(", "),
    agregar: o.agregar.map((a) => ({ nombre: a.nombre, precio: String(a.precio) })),
  };
}

export const MAX_VARIANTES = 6;
export const MAX_QUITAR = 20;
export const MAX_AGREGAR = 10;

export function listaQuitar(texto) {
  return [...new Set(texto.split(",").map((x) => x.trim()).filter(Boolean))];
}

// Devuelve { errores, valor }: valor es lo que se guarda en la columna "opciones"
export function validarOpciones(op) {
  const errores = {};

  const nombres = new Set();
  for (const v of op.variantes) {
    const nombre = v.nombre.trim();
    const precio = Number(v.precio);
    if (!nombre || nombre.length > 30) errores.variantes = "Cada variante necesita un nombre (hasta 30 caracteres).";
    else if (nombres.has(nombre.toLowerCase())) errores.variantes = "Hay dos variantes con el mismo nombre.";
    else if (v.precio === "" || !Number.isFinite(precio) || precio <= 0) errores.variantes = "Cada variante necesita un precio mayor a 0.";
    nombres.add(nombre.toLowerCase());
  }

  const quitar = listaQuitar(op.quitar);
  if (quitar.length > MAX_QUITAR) errores.quitar = `Máximo ${MAX_QUITAR} ingredientes.`;
  else if (quitar.some((q) => q.length > 40)) errores.quitar = "Cada ingrediente puede tener hasta 40 caracteres.";

  const extras = new Set();
  for (const a of op.agregar) {
    const nombre = a.nombre.trim();
    const precio = Number(a.precio);
    if (!nombre || nombre.length > 40) errores.agregar = "Cada extra necesita un nombre (hasta 40 caracteres).";
    else if (extras.has(nombre.toLowerCase())) errores.agregar = "Hay dos extras con el mismo nombre.";
    else if (a.precio === "" || !Number.isFinite(precio) || precio < 0) errores.agregar = "Cada extra necesita un precio (0 o más).";
    extras.add(nombre.toLowerCase());
  }

  const valor = {};
  if (op.variantes.length > 0) {
    valor.variantes = op.variantes.map((v) => ({ nombre: v.nombre.trim(), precio: Number(v.precio) }));
  }
  if (quitar.length > 0) valor.quitar = quitar;
  // Siempre se guarda la lista (aunque esté vacía) para que quede claro que el dueño la configuró
  valor.agregar = op.agregar.map((a) => ({ nombre: a.nombre.trim(), precio: Number(a.precio) }));
  return { errores, valor };
}

