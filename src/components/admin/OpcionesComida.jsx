import { IconoBasura, IconoMas } from "../ui/Iconos";
import { MAX_AGREGAR, MAX_QUITAR, MAX_VARIANTES } from "../../lib/opcionesForm";

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

export default function OpcionesComida({ valor, onCambio, errores }) {
  const set = (campo) => (nuevo) => onCambio({ ...valor, [campo]: nuevo });
  return (
    <fieldset className="space-y-5 rounded-xl border border-borde p-4">
      <legend className="px-1 text-sm font-semibold">Opciones para el cliente (opcional)</legend>

      <div className="space-y-2">
        <p className="text-sm font-medium">Variantes</p>
        <p className="text-xs text-tinta-suave">
          Para tamaños o versiones, por ejemplo Simple, Doble, Triple. Cada una tiene su precio. Si cargás variantes, el
          precio de la comida sale de ellas.
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
      </div>

      <div className="space-y-2">
        <label htmlFor="f-quitar" className="text-sm font-medium">
          Ingredientes que se pueden sacar
        </label>
        <input
          id="f-quitar"
          className="campo"
          value={valor.quitar}
          onChange={(e) => set("quitar")(e.target.value)}
          placeholder="Separados por coma. Ej.: Cebolla, Tomate, Pepinillos"
        />
        {errores.quitar && <p className="text-xs text-brasa">{errores.quitar}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Extras con costo</p>
        <p className="text-xs text-tinta-suave">Cosas que el cliente puede sumar, por ejemplo Huevo o Medallón extra.</p>
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
