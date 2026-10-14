import { useSesion } from "../hooks/useSesion";
import { supabase } from "../lib/supabase";
import Login from "../components/admin/Login";
import Panel from "../components/admin/Panel";
import Cargando from "../components/ui/Cargando";
import Logo from "../components/ui/Logo";

// /admin: decide entre el login, "sin permisos" y el panel
export default function Admin() {
  const { sesion, cargando, esAdmin, errorChequeo } = useSesion();

  if (cargando) return <Cargando texto="Verificando sesión…" />;
  if (!sesion) return <Login />;
  if (esAdmin === null) return <Cargando texto="Verificando permisos…" />;

  if (!esAdmin) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="tarjeta w-full max-w-sm p-6 text-center">
          <Logo className="mx-auto h-24 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">No tenés permisos</h1>
          <p className="mt-2 text-sm text-tinta-suave">
            {errorChequeo
              ? "No pudimos verificar tus permisos. Revisá tu conexión."
              : `La cuenta ${sesion.user.email} no es administradora de este sitio.`}
          </p>
          <button type="button" className="boton-secundario mt-5 w-full" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return <Panel sesion={sesion} />;
}
