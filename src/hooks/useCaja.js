import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Caja abierta en este momento (o null). La comparten el tablero de pedidos,
// la venta en caja, las cuentas corrientes, los gastos y la sección Caja.
export const CajaContext = createContext({ caja: null, cargando: true, recargar: () => Promise.resolve() });

export function useCaja() {
  return useContext(CajaContext);
}

// Clientes con su saldo de cuenta corriente (para elegir a quién se le fía)
export function useClientes(activo = true) {
  const [estado, setEstado] = useState({ clientes: [], cargando: true });

  const recargar = useCallback(() => {
    return supabase
      .from("clientes_saldos")
      .select("*")
      .order("nombre")
      .then(({ data, error }) => setEstado({ clientes: error ? [] : data, cargando: false }));
  }, []);

  useEffect(() => {
    if (activo) recargar();
  }, [activo, recargar]);

  return { ...estado, recargar };
}
