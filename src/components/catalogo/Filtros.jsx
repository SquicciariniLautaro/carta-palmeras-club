import { useEffect, useRef, useState } from "react";
import { IconoBuscar, IconoCerrar } from "../ui/Iconos";

// Barra fija de la carta: una pastilla por sección (lleva hasta esa tarjeta y se
// marca sola al ir bajando) y una lupa que la cambia por el buscador.
export default function Filtros({ secciones, activa, onIr, busqueda, onBusqueda }) {
  const [buscando, setBuscando] = useState(Boolean(busqueda));
  const fila = useRef(null);

  // Deja a la vista la pastilla de la sección en la que está el cliente
  useEffect(() => {
    const contenedor = fila.current;
    const boton = contenedor?.querySelector(`[data-id="${activa}"]`);
    if (!boton) return;
    const c = contenedor.getBoundingClientRect();
    const b = boton.getBoundingClientRect();
    const izquierda = contenedor.scrollLeft + b.left - c.left - (c.width - b.width) / 2;
    contenedor.scrollTo({ left: Math.max(0, izquierda), behavior: "smooth" });
  }, [activa]);

  function cerrarBuscador() {
    onBusqueda("");
    setBuscando(false);
  }

  return (
    <div className="sticky top-[72px] z-20 border-b border-borde bg-fondo/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        {buscando ? (
          <label className="relative block flex-1">
            <span className="sr-only">Buscar en la carta</span>
            <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
            <input
              type="text"
              enterKeyHint="search"
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cerrarBuscador()}
              placeholder="¿Qué tenés ganas de comer?"
              className="campo rounded-full py-2 pl-9 pr-10"
              autoFocus
            />
            <button
              type="button"
              onClick={cerrarBuscador}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-tinta-suave hover:text-tinta"
              aria-label="Cerrar el buscador"
            >
              <IconoCerrar className="size-4" />
            </button>
          </label>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setBuscando(true)}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-borde bg-papel text-tinta hover:bg-borde"
              aria-label="Buscar en la carta"
            >
              <IconoBuscar className="size-4" />
            </button>
            <nav
              ref={fila}
              className="sin-scrollbar -mr-4 flex flex-1 gap-2 overflow-x-auto pr-4"
              aria-label="Secciones de la carta"
            >
              {secciones.map((s) => {
                const actual = activa === s.id;
                return (
                  <a
                    key={s.id}
                    data-id={s.id}
                    href={`#seccion-${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onIr(s.id);
                    }}
                    aria-current={actual ? "location" : undefined}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                      actual
                        ? "bg-palmera text-fondo"
                        : "border border-tinta/15 text-tinta-suave hover:border-palmera hover:text-palmera"
                    }`}
                  >
                    {s.nombre}
                  </a>
                );
              })}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
