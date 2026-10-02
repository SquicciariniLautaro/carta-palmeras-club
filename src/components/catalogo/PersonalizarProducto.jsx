import { useState } from "react";
import Modal from "../ui/Modal";
import { formatearPrecio } from "../../lib/formato";
import { LARGO_ACLARACION, configInicial, opcionesDe, precioLinea } from "../../lib/opciones";
import ControlCantidad from "./ControlCantidad";
import { ImagenComida } from "./TarjetaProducto";

function Seccion({ titulo, ayuda, children }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        {titulo} {ayuda && <span className="font-normal text-tinta-suave">{ayuda}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function Opcion({ tipo, nombre, marcado, onCambiar, children, precio }) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
        marcado ? "border-palmera bg-palmera/10" : "border-borde bg-papel hover:bg-borde/50"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <input
          type={tipo}
          name={tipo === "radio" ? nombre : undefined}
          checked={marcado}
          onChange={onCambiar}
          className="size-4 accent-palmera"
        />
        {children}
      </span>
      {precio}
    </label>
  );
}

// Contenido del armado: se monta de nuevo cada vez que se abre, así arranca limpio
function Armado({ comida, restantes, onAgregar }) {
  const { variantes, quitar, agregar } = opcionesDe(comida);
  const [config, setConfig] = useState(() => configInicial(comida));
  const [cantidad, setCantidad] = useState(1);

  const alternar = (campo, valor) =>
    setConfig((c) => ({
      ...c,
      [campo]: c[campo].includes(valor) ? c[campo].filter((x) => x !== valor) : [...c[campo], valor],
    }));

  const unitario = precioLinea(comida, config);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onAgregar(config, cantidad);
      }}
    >
      <ImagenComida comida={comida} className="aspect-[16/9] w-full rounded-xl" />
      {comida.descripcion && <p className="text-sm text-tinta-suave">{comida.descripcion}</p>}

      {variantes.length > 0 && (
        <Seccion titulo="¿Cómo la querés?">
          {variantes.map((v) => (
            <Opcion
              key={v.nombre}
              tipo="radio"
              nombre="variante"
              marcado={config.variante === v.nombre}
              onCambiar={() => setConfig((c) => ({ ...c, variante: v.nombre }))}
              precio={<span className="font-semibold">{formatearPrecio(v.precio)}</span>}
            >
              {v.nombre}
            </Opcion>
          ))}
        </Seccion>
      )}

      {quitar.length > 0 && (
        <Seccion titulo="¿Querés sacarle algo?" ayuda="(tildá lo que NO querés)">
          <div className="grid gap-2 sm:grid-cols-2">
            {quitar.map((q) => (
              <Opcion
                key={q}
                tipo="checkbox"
                marcado={config.quitar.includes(q)}
                onCambiar={() => alternar("quitar", q)}
              >
                Sin {q}
              </Opcion>
            ))}
          </div>
        </Seccion>
      )}

      {agregar.length > 0 && (
        <Seccion titulo="¿Querés agregarle algo?">
          {agregar.map((a) => (
            <Opcion
              key={a.nombre}
              tipo="checkbox"
              marcado={config.agregar.includes(a.nombre)}
              onCambiar={() => alternar("agregar", a.nombre)}
              precio={<span className="font-semibold">+ {formatearPrecio(a.precio)}</span>}
            >
              {a.nombre}
            </Opcion>
          ))}
        </Seccion>
      )}

      <div>
        <label htmlFor="aclaracion" className="etiqueta">
          Aclaraciones (opcional)
        </label>
        <input
          id="aclaracion"
          className="campo"
          value={config.aclaracion}
          onChange={(e) => setConfig((c) => ({ ...c, aclaracion: e.target.value }))}
          maxLength={LARGO_ACLARACION}
          placeholder="Ej.: bien cocida, cortada al medio"
        />
      </div>

      <div className="flex items-center gap-3 border-t border-borde pt-4">
        <div className="w-28 shrink-0">
          <ControlCantidad
            cantidad={cantidad}
            onSumar={() => setCantidad((n) => Math.min(n + 1, restantes))}
            onRestar={() => setCantidad((n) => Math.max(n - 1, 1))}
            nombre={comida.nombre}
          />
        </div>
        <button type="submit" className="boton-primario flex-1 justify-between py-3">
          <span>Agregar al pedido</span>
          <span>{formatearPrecio(unitario * cantidad)}</span>
        </button>
      </div>
    </form>
  );
}

// Ventana para elegir variante, ingredientes a sacar, extras y aclaraciones
export default function PersonalizarProducto({ comida, restantes, onCerrar, onAgregar }) {
  return (
    <Modal abierto={Boolean(comida)} onCerrar={onCerrar} titulo={comida?.nombre ?? ""}>
      {comida && <Armado key={comida.id} comida={comida} restantes={restantes} onAgregar={onAgregar} />}
    </Modal>
  );
}
