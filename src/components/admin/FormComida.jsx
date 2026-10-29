import { useState } from "react";
import toast from "react-hot-toast";
import { IMAGENES } from "../../config";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { borrarImagen, comprimirImagen, subirImagen } from "../../lib/imagenes";
import Modal from "../ui/Modal";
import SubirImagen from "./SubirImagen";
import { opcionesIniciales, validarOpciones } from "../../lib/opcionesForm";
import OpcionesComida from "./OpcionesComida";

function valoresIniciales(comida, categorias) {
  return {
    nombre: comida?.nombre ?? "",
    descripcion: comida?.descripcion ?? "",
    categoria_id: comida?.categoria_id ?? categorias[0]?.id ?? "",
    precio: comida?.precio != null ? String(Number(comida.precio)) : "",
    precio_promo: comida?.precio_promo != null ? String(Number(comida.precio_promo)) : "",
    destacado: comida?.destacado ?? false,
    // Si todavía no tiene precio, al ponérselo queda disponible
    activo: comida?.precio == null ? true : comida.activo,
    stock_minimo: String(comida?.stock_minimo ?? 5),
    opciones: opcionesIniciales(comida),
  };
}

function ErrorCampo({ mensaje }) {
  return mensaje ? <p className="mt-1 text-xs text-brasa">{mensaje}</p> : null;
}

// Mismas reglas que las restricciones de la base
function validar(v, conStock) {
  const errores = {};
  const nombre = v.nombre.trim();
  if (!nombre) errores.nombre = "Poné un nombre.";
  else if (nombre.length > 120) errores.nombre = "Máximo 120 caracteres.";
  if (v.descripcion.length > 1000) errores.descripcion = "Máximo 1000 caracteres.";
  if (!v.categoria_id) errores.categoria_id = "Elegí una categoría.";

  const conVariantes = v.opciones.variantes.length > 0;
  const precio = Number(v.precio);
  if (conVariantes) {
    // el precio sale de las variantes: no se valida el campo
  } else if (v.precio === "" || !Number.isFinite(precio) || precio <= 0) errores.precio = "El precio tiene que ser mayor a 0.";
  else if (precio > 9_999_999_999) errores.precio = "Precio demasiado alto.";

  if (!conVariantes && v.precio_promo !== "") {
    const promo = Number(v.precio_promo);
    if (!Number.isFinite(promo) || promo <= 0) errores.precio_promo = "Tiene que ser mayor a 0.";
    else if (!errores.precio && promo >= precio) errores.precio_promo = "Tiene que ser menor que el precio normal.";
  }

  if (conStock) {
    const minimo = Number(v.stock_minimo);
    if (v.stock_minimo === "" || !Number.isInteger(minimo) || minimo < 0 || minimo > 100_000) errores.stock_minimo = "Poné una cantidad entera (0 o más).";
  }

  const { errores: erroresOpciones } = validarOpciones(v.opciones, v.descripcion);
  if (Object.keys(erroresOpciones).length > 0) errores.opciones = erroresOpciones;
  return errores;
}

export default function FormComida({ comida, categorias, turno = "noche", onCerrar, onGuardado }) {
  const conCarta = turno === "noche";
  const [v, setV] = useState(() => valoresIniciales(comida, categorias));
  const [errores, setErrores] = useState({});
  const [archivo, setArchivo] = useState(null); // imagen nueva elegida
  const [quitarImagen, setQuitarImagen] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Solo las categorías de kiosco (bebidas, golosinas) llevan stock
  const conStock = Boolean(categorias.find((c) => c.id === v.categoria_id)?.controla_stock);

  const cambiar = (campo) => (e) => {
    const valor = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setV((prev) => ({ ...prev, [campo]: valor }));
  };

  async function guardar(e) {
    e.preventDefault();
    const encontrados = validar(v, conStock);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) {
      toast.error("Revisá los campos marcados.");
      return;
    }

    setGuardando(true);
    let nuevaImagen = null;
    try {
      // 1. Subir la imagen nueva (si hay) a Cloudinary, en WebP
      if (archivo) {
        const comprimida = await comprimirImagen(archivo);
        if (comprimida.size > IMAGENES.tamanoMaximo) {
          throw new Error("La imagen sigue pesando más de 2 MB después de comprimirla. Probá con otra.");
        }
        nuevaImagen = await subirImagen(comprimida);
      }

      // 2. Guardar la fila
      const { valor: opciones } = validarOpciones(v.opciones, v.descripcion);
      const variantes = opciones.variantes ?? [];
      const fila = {
        nombre: v.nombre.trim(),
        descripcion: v.descripcion.trim() || null,
        categoria_id: v.categoria_id,
        // con variantes, el precio "desde" es el de la primera y no hay promo
        precio: variantes.length > 0 ? variantes[0].precio : Number(v.precio),
        precio_promo: variantes.length > 0 || v.precio_promo === "" ? null : Number(v.precio_promo),
        opciones,
        destacado: v.destacado,
        activo: v.activo,
      };
      if (conStock) fila.stock_minimo = Number(v.stock_minimo);
      if (nuevaImagen) {
        fila.imagen_url = nuevaImagen.url;
        fila.imagen_path = nuevaImagen.path;
      } else if (quitarImagen) {
        fila.imagen_url = null;
        fila.imagen_path = null;
      }

      const { error } = comida
        ? await supabase.from("comidas").update(fila).eq("id", comida.id)
        : await supabase.from("comidas").insert(fila);
      if (error) throw error;

      // 3. Si se reemplazó o quitó la imagen, borrar la vieja
      if (comida?.imagen_path && (nuevaImagen || quitarImagen)) {
        await borrarImagen(comida.imagen_url, comida.imagen_path);
      }

      toast.success(comida ? "Cambios guardados" : "Comida creada");
      onGuardado();
    } catch (error) {
      // Si la fila no se guardó, no dejamos la imagen nueva huérfana
      if (nuevaImagen) await borrarImagen(nuevaImagen.url, nuevaImagen.path);
      toast.error(mensajeDeError(error, "No se pudo guardar. Revisá los datos y la imagen."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal abierto onCerrar={guardando ? () => {} : onCerrar} titulo={conCarta ? (comida ? "Editar comida" : "Nueva comida") : comida ? "Editar plato del mediodía" : "Nuevo plato del mediodía"} ancho="max-w-2xl">
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <div>
          <label htmlFor="f-nombre" className="etiqueta">
            Nombre *
          </label>
          <input id="f-nombre" className="campo" value={v.nombre} onChange={cambiar("nombre")} maxLength={120} />
          <ErrorCampo mensaje={errores.nombre} />
        </div>

        <div>
          <label htmlFor="f-desc" className="etiqueta">
            Descripción
          </label>
          <textarea
            id="f-desc"
            className="campo"
            rows={3}
            value={v.descripcion}
            onChange={cambiar("descripcion")}
            maxLength={1000}
            placeholder="Ingredientes separados por coma. Ej.: Medallón de carne, cheddar, lechuga y tomate."
          />
          <p className="mt-1 text-xs text-tinta-suave">
            Los ingredientes que escribas acá aparecen solos abajo, en "Ingredientes que se pueden sacar".
          </p>
          <ErrorCampo mensaje={errores.descripcion} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="f-cat" className="etiqueta">
              Categoría *
            </label>
            <select id="f-cat" className="campo" value={v.categoria_id} onChange={cambiar("categoria_id")}>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <ErrorCampo mensaje={errores.categoria_id} />
          </div>
          <div>
            <label htmlFor="f-precio" className="etiqueta">
              Precio (ARS) *
            </label>
            <input
              id="f-precio"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="campo"
              value={v.opciones.variantes.length > 0 ? String(v.opciones.variantes[0].precio) : v.precio}
              onChange={cambiar("precio")}
              disabled={v.opciones.variantes.length > 0}
            />
            <ErrorCampo mensaje={errores.precio} />
          </div>
          <div>
            <label htmlFor="f-promo" className="etiqueta">
              Precio promo (opcional)
            </label>
            <input
              id="f-promo"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="campo"
              value={v.precio_promo}
              onChange={cambiar("precio_promo")}
              placeholder="Vacío = sin promo"
              disabled={v.opciones.variantes.length > 0}
            />
            <ErrorCampo mensaje={errores.precio_promo} />
          </div>
        </div>

        {conStock && (
          <div className="rounded-xl border border-borde bg-fondo p-3">
            <label htmlFor="f-minimo" className="etiqueta">
              Avisar que queda poco cuando haya
            </label>
            <input
              id="f-minimo"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              className="campo sm:w-48"
              value={v.stock_minimo}
              onChange={cambiar("stock_minimo")}
            />
            <p className="mt-1 text-xs text-tinta-suave">
              Stock actual: <strong>{comida?.stock ?? "sin cargar"}</strong>. El stock no se escribe acá: se suma con "Cargar mercadería" y se
              corrige con "Ajustar", en la pestaña Stock, así queda todo en el historial.
              {conCarta && " Con stock 0 deja de verse en la carta online."}
            </p>
            <ErrorCampo mensaje={errores.stock_minimo} />
          </div>
        )}

        <OpcionesComida
          valor={v.opciones}
          descripcion={v.descripcion}
          onCambio={(opciones) => setV((prev) => ({ ...prev, opciones }))}
          errores={errores.opciones ?? {}}
        />

        <div className="flex flex-wrap gap-6">
          {conCarta && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-palmera" checked={v.destacado} onChange={cambiar("destacado")} />
              Destacado (aparece primero)
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-palmera" checked={v.activo} onChange={cambiar("activo")} />
            {conCarta ? "Activo (visible en el catálogo)" : "Disponible para vender"}
          </label>
        </div>

        {conCarta && <SubirImagen
          urlActual={quitarImagen ? null : comida?.imagen_url}
          archivo={archivo}
          onArchivo={(f) => {
            setArchivo(f);
            setQuitarImagen(false);
          }}
          onQuitar={() => {
            setArchivo(null);
            setQuitarImagen(true);
          }}
        />}

        <div className="flex justify-end gap-2 border-t border-borde pt-4">
          <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando}>
            {guardando ? "Guardando…" : comida ? "Guardar cambios" : conCarta ? "Crear comida" : "Crear plato"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
