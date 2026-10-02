import { IconoBuscar, IconoCerrar } from "../ui/Iconos";

// Buscador + fila desplazable de filtros: Todos, Promos y una por categoría
export default function Filtros({ categorias, filtro, onFiltro, busqueda, onBusqueda, hayPromos }) {
  const opciones = [
    { id: "todos", nombre: "Todos" },
    ...(hayPromos ? [{ id: "promos", nombre: "🔥 Promos" }] : []),
    ...categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
  ];

  return (
    <div className="sticky top-[72px] z-20 -mx-4 bg-fondo px-4 pb-3 pt-3">
      <label className="relative block">
        <span className="sr-only">Buscar comidas</span>
        <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => onBusqueda(e.target.value)}
          placeholder="Buscar en el menú…"
          className="campo rounded-full pl-9 pr-9"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => onBusqueda("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-tinta-suave hover:text-tinta"
            aria-label="Borrar búsqueda"
          >
            <IconoCerrar className="size-4" />
          </button>
        )}
      </label>

      <div className="sin-scrollbar mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Categorías">
        {opciones.map((op) => {
          const activa = filtro === op.id;
          return (
            <button
              key={op.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => onFiltro(op.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                activa
                  ? "bg-palmera text-fondo"
                  : "border border-borde bg-papel text-tinta-suave hover:text-tinta"
              }`}
            >
              {op.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
