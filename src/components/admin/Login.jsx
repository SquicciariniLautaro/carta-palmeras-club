import { useState } from "react";
import { supabase } from "../../lib/supabase";
import Logo from "../ui/Logo";

function traducirError(error) {
  const msj = error?.message || "";
  if (/invalid login credentials/i.test(msj)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(msj)) return "Tenés que confirmar tu correo antes de entrar.";
  if (/rate limit|too many/i.test(msj)) return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
  if (/failed to fetch|network/i.test(msj)) return "No pudimos conectarnos. Revisá tu conexión.";
  return "No pudimos iniciar sesión. Probá de nuevo.";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setEnviando(false);
    if (err) setError(traducirError(err));
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={entrar} className="tarjeta w-full max-w-sm space-y-4 p-6" noValidate>
        <div className="text-center">
          <Logo className="mx-auto h-24 w-auto" />
          <h1 className="mt-4 text-xl font-semibold">Panel de administración</h1>
          <p className="text-sm text-tinta-suave">Ingresá con tu cuenta.</p>
        </div>
        <div>
          <label htmlFor="email" className="etiqueta">
            Correo electrónico
          </label>
          <input
            id="email"
            type="email"
            className="campo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="etiqueta">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            className="campo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p className="rounded-lg bg-brasa/15 px-3 py-2 text-sm text-brasa" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton-primario w-full" disabled={enviando || !email || !password}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
        <a href={import.meta.env.BASE_URL} className="block text-center text-xs text-tinta-suave hover:text-tinta">
          ← Volver al catálogo
        </a>
      </form>
    </div>
  );
}
