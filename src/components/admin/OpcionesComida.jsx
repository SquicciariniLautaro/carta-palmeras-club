import { useState } from "react";
import { IconoBasura, IconoCerrar, IconoCheck, IconoMas } from "../ui/Iconos";
import { normalizarTexto } from "../../lib/formato";
import { LARGO_PREGUNTA, PREGUNTA_POR_DEFECTO } from "../../lib/opciones";
import {
  LARGO_INGREDIENTE,
  MAX_AGREGAR,
  MAX_VARIANTES,
  ingredientesDeDescripcion,
} from "../../lib/opcionesForm";

// Opciones para personalizar una comida: variantes (Simple / Doble…),
// ingredientes que se pueden sacar y extras con costo.
function Filas({ filas, onCambiar, etiquetaNombre, placeholderNombre, onAgregar, textoAgregar, limite }) {
  return (
    <div className="space-y-2">
      {filas.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="campo flex-1"
            aria-label={etiquetaNombre}
            placeholder={placeholderNombre}
            value={f.nombre}
            maxLength={40}
            onChange={(e) => onCambiar(filas.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))}
          />
          <input
            className="campo w-28"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            aria-label={`Precio de ${f.nombre || etiquetaNombre}`}
            placeholder="Precio"
            value={f.precio}
            onChange={(e) => onCambiar(filas.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))}
          />
          <button
            type="button"
            className="rounded-lg p-2 text-tinta-suave hover:bg-borde hover:text-brasa"
            onClick={() => onCambiar(filas.filter((_, j) => j !== i))}
            aria-label={`Quitar ${f.nombre || etiquetaNombre}`}
          >
            <IconoBasura className="size-4" />
          </button>
        </div>
      ))}
      {filas.length < limite && (
        <button type="button" className="boton-secundario px-3 py-1.5 text-xs" onClick={onAgregar}>
          <IconoMas className="size-3.5" /> {textoAgregar}
        </button>
      )}
    </div>
  );
}

// Ingredientes que el cliente puede sacar. Los de la descripción aparecen
// solos (marcados); el dueño toca los que NO se pueden sacar para desmarcarlos.
function IngredientesQuitar({ valor, descripcion, onCambio, error }) {
  const [nuevo, setNuevo] = useState("");
  const delTexto = ingredientesDeDescripcion(descripcion);
  const excluidos = new Set(valor.excluidos);
  const enTexto = new Set(delTexto.map(normalizarTexto));
  const manuales = valor.quitarManual.filter((m) => !enTexto.has(normalizarTexto(m)));

  function alternar(ingrediente) {
    const clave = normalizarTexto(ingrediente);
    onCambio({
      ...valor,
      excluidos: excluidos.has(clave) ? valor.excluidos.filter((x) => x !== clave) : [...valor.excluidos, clave],
      quitarManual: valor.quitarManual.filter((m) => normalizarTexto(m) !== clave),
    });
  }

  function borrarManual(ingrediente) {
    const clave = normalizarTexto(ingrediente);
    onCambio({ ...valor, quitarManual: valor.quitarManual.filter((m) => normalizarTexto(m) !== clave) });
  }

  function agregarManual() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    const clave = normalizarTexto(nombre);
    if (enTexto.has(clave)) {
      // ya está en la descripción: solo lo marcamos
      onCambio({ ...valor, excluidos: valor.excluidos.filter((x) => x !== clave) });
    } else if (!manuales.some((m) => normalizarTexto(m) === clave)) {
      onCambio({ ...valor, quitarManual: [...valor.quitarManual, nombre] });
    }
    setNuevo("");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Ingredientes que se pueden sacar</p>
      <p className="text-xs text-tinta-suave">
        Se cargan solos con los ingredientes de la descripción (separalos con comas). Tocá los que{" "}
        <strong>no</strong> se pueden sacar para desmarcarlos.
      </p>

      {delTexto.length === 0 && manuales.length === 0 ? (
        <p className="rounded-xl bg-fondo px-3 py-2.5 text-xs text-tinta-suave">
          Escribí los ingredientes en la descripción y van a aparecer acá.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {delTexto.map((ingrediente) => {
            const marcado = !excluidos.has(normalizarTexto(ingrediente));
            return (
              <li key={normalizarTexto(ingrediente)}>
                <button
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => alternar(ingrediente)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    marcado
                      ? "border-palmera bg-palmera/10 text-tinta"
                      : "border-borde bg-papel text-tinta-suave line-through hover:bg-borde"
                  }`}
                >
                  {marcado && <IconoCheck className="mr-1 inline size-3.5" />}
                  {ingrediente}
                </button>
              </li>
            );
          })}
          {manuales.map((ingrediente) => (
            <li key={`manual-${normalizarTexto(ingrediente)}`}>
              <span className="inline-flex items-center gap-1 rounded-full border border-palmera bg-palmera/10 py-1.5 pl-3 pr-1.5 text-xs font-medium">
                <IconoCheck className="size-3.5" /> {ingrediente}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-tinta-suave hover:bg-borde hover:text-brasa"
                  onClick={() => borrarManual(ingrediente)}
                  aria-label={`Quitar ${ingrediente} de la lista`}
                >
                  <IconoCerrar className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <label htmlFor="f-quitar-nuevo" className="sr-only">
          Agregar otro ingrediente
        </label>
        <input
          id="f-quitar-nuevo"
          className="campo flex-1 py-2"
          value={nuevo}
          maxLength={LARGO_INGREDIENTE}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // que Enter no guarde el formulario
              agregarManual();
            }
          }}
          placeholder="Otro ingrediente que no está en la descripción"
        />
        <button type="button" className="boton-secundario shrink-0 px-3 py-2 text-xs" onClick={agregarManual}>
          <IconoMas className="size-3.5" /> Agregar
        </button>
      </div>
      {error && <p className="text-xs text-brasa">{error}</p>}
    </div>
  );
}

export default function OpcionesComida({ valor, descripcion, onCambio, errores }) {
  const set = (campo) => (nuevo) => onCambio({ ...valor, [campo]: nuevo });
  return (
    <fieldset className="space-y-5 rounded-xl border border-borde p-4">
      <legend className="px-1 text-sm font-semibold">Opciones para el cliente (opcional)</legend>

      <div className="space-y-2">
        <p className="text-sm font-medium">Variantes</p>
        <p className="text-xs text-tinta-suave">
          Para tamaños o versiones, por ejemplo Simple, Doble, Triple, o para 1, 2 o 3 personas. Cada una tiene su precio.
          Si cargás variantes, el precio de la comida sale de ellas.
        </p>
        <Filas
          filas={valor.variantes}
          onCambiar={set("variantes")}
          etiquetaNombre="Nombre de la variante"
          placeholderNombre="Ej.: Doble"
          onAgregar={() => set("variantes")([...valor.variantes, { nombre: "", precio: "" }])}
          textoAgregar="Agregar variante"
          limite={MAX_VARIANTES}
        />
        {errores.variantes && <p className="text-xs text-brasa">{errores.variantes}</p>}
        {valor.variantes.length > 0 && (
          <div>
            <label htmlFor="f-pregunta" className="etiqueta">
              Pregunta que ve el cliente (opcional)
            </label>
            <input
              id="f-pregunta"
              className="campo"
              value={valor.pregunta}
              maxLength={LARGO_PREGUNTA}
              onChange={(e) => set("pregunta")(e.target.value)}
              placeholder={`${PREGUNTA_POR_DEFECTO} · ¿Para cuántas personas?`}
            />
            {errores.pregunta && <p className="mt-1 text-xs text-brasa">{errores.pregunta}</p>}
          </div>
        )}
      </div>

      <IngredientesQuitar valor={valor} descripcion={descripcion} onCambio={onCambio} error={errores.quitar} />

      <div className="space-y-2">
        <p className="text-sm font-medium">Extras con costo</p>
        <p className="text-xs text-tinta-suave">
          Cosas que el cliente puede sumar, por ejemplo carne extra o huevo. Con precio 0, el cliente ve "Precio a confirmar" y
          vos le confirmás el valor por WhatsApp. Para que un extra no aparezca, borralo.
        </p>
        <Filas
          filas={valor.agregar}
          onCambiar={set("agregar")}
          etiquetaNombre="Nombre del extra"
          placeholderNombre="Ej.: Huevo"
          onAgregar={() => set("agregar")([...valor.agregar, { nombre: "", precio: "" }])}
          textoAgregar="Agregar extra"
          limite={MAX_AGREGAR}
        />
        {errores.agregar && <p className="text-xs text-brasa">{errores.agregar}</p>}
      </div>
    </fieldset>
  );
}
