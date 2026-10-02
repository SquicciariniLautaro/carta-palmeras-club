import { useEffect, useMemo, useReducer } from "react";
import {
  CarritoContext,
  carritoReducer,
  guardarCarrito,
  leerCarritoGuardado,
} from "../../hooks/useCarrito";

export default function CarritoProvider({ children }) {
  const [items, dispatch] = useReducer(carritoReducer, undefined, leerCarritoGuardado);

  // Persistimos en localStorage cada vez que cambia
  useEffect(() => {
    guardarCarrito(items);
  }, [items]);

  const valor = useMemo(
    () => ({
      items,
      agregar: (id, config = null, cantidad = 1) => dispatch({ type: "agregar", id, config, cantidad }),
      restar: (clave) => dispatch({ type: "restar", clave }),
      eliminar: (clave) => dispatch({ type: "eliminar", clave }),
      reemplazar: (nuevos) => dispatch({ type: "reemplazar", items: nuevos }),
      vaciar: () => dispatch({ type: "vaciar" }),
      // unidades de un producto sumando todas sus líneas (para el stock)
      cantidadDe: (id) => items.filter((i) => i.id === id).reduce((acc, i) => acc + i.cantidad, 0),
    }),
    [items]
  );

  return <CarritoContext.Provider value={valor}>{children}</CarritoContext.Provider>;
}
