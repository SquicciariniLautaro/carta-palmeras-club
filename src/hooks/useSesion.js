import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Si la base todavía no tiene mi_rol() (falta correr la actualización), se
// usa es_admin() como antes y quien entra es dueño: así nadie queda afuera.
async function consultarRol() {
  const { data, error } = await supabase.rpc("mi_rol");
  if (!error) return { rol: data ?? null, error: null };
  if (error.code !== "PGRST202") return { rol: null, error };
  const viejo = await supabase.rpc("es_admin");
  return { rol: viejo.data === true ? "dueno" : null, error: viejo.error };
}

// Devuelve la sesión de Supabase, si el usuario puede entrar al panel y con qué rol.
// sesion: undefined = cargando, null = sin sesión.
// esAdmin: null = verificando, true / false.
// rol: "dueno" (todo) o "empleado" (sin Gastos y costos ni Finanzas).
export function useSesion() {
  const [sesion, setSesion] = useState(undefined);
  const [chequeo, setChequeo] = useState({ userId: null, rol: null, error: null });

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
    consultarRol().then(({ rol, error }) => {
      if (activo) setChequeo({ userId, rol, error });
    });
    return () => {
      activo = false;
    };
  }, [userId]);

  let esAdmin = null;
  if (sesion === null) esAdmin = false;
  else if (userId && chequeo.userId === userId) esAdmin = chequeo.rol !== null;

  return {
    sesion,
    cargando: sesion === undefined,
    esAdmin,
    rol: esAdmin ? chequeo.rol : null,
    errorChequeo: chequeo.userId === userId ? chequeo.error : null,
  };
}
