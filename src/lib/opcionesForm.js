import { normalizarTexto } from "./formato";
import { LARGO_PREGUNTA, opcionesDe } from "./opciones";

// Conversión entre las opciones de una comida y el formulario del panel

export const MAX_VARIANTES = 6;
export const MAX_QUITAR = 20;
export const MAX_AGREGAR = 10;
export const LARGO_INGREDIENTE = 40;

// Saca los ingredientes de la descripción, separados por coma, punto, punto y
// coma, renglón o " y ". Si hay un rótulo ("Ingredientes: …") lo ignora, y
// también lo que empieza con un número ("3 burguers con papas" es un combo,
// no un ingrediente).
// "Medallones de carne, cheddar, lechuga y cebolla." → ["Medallones de carne", "Cheddar", "Lechuga", "Cebolla"]
export function ingredientesDeDescripcion(texto) {
  const vistos = new Set();
  const lista = [];
  for (const parte of (texto || "").split(/[,;.\n•·]+|\s+y\s+/i)) {
    const limpio = parte.replace(/^[^:]*:/, "").replace(/^[\s\-*]+/, "").trim();
    if (!limpio || limpio.length > LARGO_INGREDIENTE || /^\d/.test(limpio)) continue;
    const nombre = limpio[0].toLocaleUpperCase("es") + limpio.slice(1);
    const clave = normalizarTexto(nombre);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lista.push(nombre);
  }
  return lista;
}

// En el formulario los ingredientes que se pueden sacar se guardan así:
//   excluidos:    ingredientes de la descripción que NO se pueden sacar (claves normalizadas)
//   quitarManual: ingredientes cargados a mano que no están en la descripción
// La lista final sale de juntar la descripción (menos los excluidos) con los manuales,
// así se actualiza sola mientras el dueño escribe la descripción.
export function opcionesIniciales(comida) {
  const o = opcionesDe(comida);
  const configurado = Array.isArray(comida?.opciones?.quitar);
  const delTexto = ingredientesDeDescripcion(comida?.descripcion);
  const guardados = new Set(o.quitar.map(normalizarTexto));
  const enTexto = new Set(delTexto.map(normalizarTexto));
  return {
    variantes: o.variantes.map((v) => ({ nombre: v.nombre, precio: String(v.precio) })),
    pregunta: o.pregunta,
    // Si la comida nunca tuvo la lista configurada, arrancan todos marcados
    excluidos: configurado ? delTexto.map(normalizarTexto).filter((clave) => !guardados.has(clave)) : [],
    quitarManual: o.quitar.filter((q) => !enTexto.has(normalizarTexto(q))),
    agregar: o.agregar.map((a) => ({ nombre: a.nombre, precio: String(a.precio) })),
  };
}

// Ingredientes que se pueden sacar, en el orden en que se muestran
export function quitarFinal(op, descripcion) {
  const excluidos = new Set(op.excluidos);
  const lista = ingredientesDeDescripcion(descripcion).filter((i) => !excluidos.has(normalizarTexto(i)));
  const claves = new Set(lista.map(normalizarTexto));
  for (const manual of op.quitarManual) {
    const nombre = manual.trim();
    const clave = normalizarTexto(nombre);
    if (!clave || claves.has(clave)) continue;
    claves.add(clave);
    lista.push(nombre);
  }
  return lista;
}

// Devuelve { errores, valor }: valor es lo que se guarda en la columna "opciones"
export function validarOpciones(op, descripcion) {
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
  const pregunta = op.pregunta.trim();
  if (pregunta.length > LARGO_PREGUNTA) errores.pregunta = `La pregunta puede tener hasta ${LARGO_PREGUNTA} caracteres.`;

  const quitar = quitarFinal(op, descripcion);
  if (quitar.length > MAX_QUITAR) errores.quitar = `Máximo ${MAX_QUITAR} ingredientes para sacar. Desmarcá algunos.`;
  else if (quitar.some((q) => q.length > LARGO_INGREDIENTE)) {
    errores.quitar = `Cada ingrediente puede tener hasta ${LARGO_INGREDIENTE} caracteres.`;
  }

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
    if (pregunta) valor.pregunta = pregunta;
  }
  // Las listas se guardan siempre (aunque estén vacías) para que quede claro que el dueño las configuró
  valor.quitar = quitar;
  valor.agregar = op.agregar.map((a) => ({ nombre: a.nombre.trim(), precio: Number(a.precio) }));
  return { errores, valor };
}
