import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Devuelve la sesión de Supabase y si el usuario es administrador.
// sesion: undefined = cargando, null = sin sesión.
// esAdmin: null = verificando, true / false.
export function useSesion() {
  const [sesion, setSesion] = useState(undefined);
  const [chequeo, setChequeo] = useState({ userId: null, esAdmin: false, error: null });

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (activo) setSesion(data.session ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      // No llamar a Supabase acá adentro: solo guardamos la sesión.
      setSesion(nuevaSesion ?? null);
    });
    return () => {
      activo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = sesion?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let activo = true;
    supabase.rpc("es_admin").then(({ data, error }) => {
      if (activo) setChequeo({ userId, esAdmin: data === true, error });
    });
    return () => {
      activo = false;
    };
  }, [userId]);

  let esAdmin = null;
  if (sesion === null) esAdmin = false;
  else if (userId && chequeo.userId === userId) esAdmin = chequeo.esAdmin;

  return {
    sesion,
    cargando: sesion === undefined,
    esAdmin,
    errorChequeo: chequeo.userId === userId ? chequeo.error : null,
  };
}
