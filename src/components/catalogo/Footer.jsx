import { Link } from "react-router";
import { NEGOCIO } from "../../config";
import { linkWhatsApp, mensajeConsulta } from "../../lib/whatsapp";
import Logo from "../ui/Logo";
import { IconoCandado, IconoInstagram, IconoWhatsApp } from "../ui/Iconos";

const LAMBDA_INSTAGRAM = "https://www.instagram.com/lambdasoluciones";

// Firma de Lambda Soluciones: negro, λ amarilla con brillo y grilla de puntos
function FirmaLambda() {
  return (
    <a
      href={LAMBDA_INSTAGRAM}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden border-t border-white/5 bg-black"
      aria-label="Sitio realizado por Lambda Soluciones Digitales. Ver su Instagram"
    >
      {/* grilla sutil de puntos, como en su Instagram */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(rgb(255 214 10 / 0.35) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
        aria-hidden="true"
      />
      {/* pb-24: deja lugar para el botón flotante "Ver pedido" */}
      <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 pb-24 pt-6 text-center sm:flex-row sm:items-start sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-lambda/25 bg-[radial-gradient(circle,#2a2405_0%,#000_70%)] text-2xl font-bold text-lambda transition group-hover:scale-110"
            style={{ textShadow: "0 0 8px rgb(255 214 10 / 0.9), 0 0 22px rgb(255 214 10 / 0.6)" }}
            aria-hidden="true"
          >
            λ
          </span>
          <span className="leading-tight">
            <span className="block text-[11px] uppercase tracking-[0.25em] text-white/50">Diseño y desarrollo</span>
            <span className="block text-sm font-semibold text-white">
              Lambda <span className="text-lambda">Soluciones Digitales</span>
            </span>
          </span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-lambda/40 px-4 py-1.5 text-xs font-medium text-lambda transition group-hover:border-lambda group-hover:bg-lambda group-hover:text-black">
          <IconoInstagram className="size-4" /> @lambdasoluciones
        </span>
      </div>
    </a>
  );
}

export default function Footer() {
  const anio = new Date().getFullYear();
  return (
    <footer className="mt-16">
      <div className="border-t border-noche-3 bg-noche-2/60 pb-10 pt-10">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 text-center sm:grid-cols-3 sm:text-left">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <Logo className="h-24 w-auto" />
          </div>

          <div className="space-y-2">
            <h2 className="font-script text-3xl text-queso">Pedidos</h2>
            <p className="text-sm text-crema-suave">
              Armá tu pedido en esta página y te llega directo por WhatsApp. Te confirmamos la demora y la forma de pago.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="font-script text-3xl text-queso">Seguinos</h2>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <a href={NEGOCIO.instagram} target="_blank" rel="noopener noreferrer" className="boton-secundario">
                <IconoInstagram className="size-4 text-queso" /> Seguinos en Instagram
              </a>
              {NEGOCIO.whatsapp && (
                <a
                  href={linkWhatsApp(mensajeConsulta())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="boton-whatsapp"
                >
                  <IconoWhatsApp className="size-4" /> Escribinos
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-6xl flex-col items-center gap-2 px-4 text-xs text-crema-suave sm:flex-row sm:justify-between">
          <p>
            © {anio} {NEGOCIO.nombre}. Todos los derechos reservados.
          </p>
          <Link
            to="/admin"
            aria-label="Acceso administrador"
            title="Acceso administrador"
            className="rounded p-1 text-crema-suave/30 transition-colors hover:text-crema-suave focus-visible:text-crema-suave"
          >
            <IconoCandado className="size-3.5" />
          </Link>
        </div>
      </div>
      <FirmaLambda />
    </footer>
  );
}
