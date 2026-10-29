import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { EVENTO_MODO, guardarConfigImpresora, imprimirComanda, leerConfigImpresora, leerModoImpresion } from "../../lib/impresion";
import { IconoImpresora } from "../ui/Iconos";
import Modal from "../ui/Modal";

const PRUEBA = {
  numero: 0,
  turno: "noche",
  origen: "web",
  created_at: new Date().toISOString(),
  cliente_nombre: "Prueba de impresión",
  nota: "Retira en el local. Ticket de prueba",
  venta_items: [
    { id: "1", cantidad: 2, nombre: "Burguer de prueba", detalle: "Doble · sin cebolla" },
    { id: "2", cantidad: 1, nombre: "Papas simples", detalle: null },
  ],
};

function Opcion({ marcado, onCambio, titulo, detalle }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-borde p-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-palmera" checked={marcado} onChange={(e) => onCambio(e.target.checked)} />
      <span>
        <span className="block font-medium">{titulo}</span>
        <span className="text-xs text-tinta-suave">{detalle}</span>
      </span>
    </label>
  );
}

function Paso({ titulo, children }) {
  return (
    <details className="rounded-xl bg-fondo p-3">
      <summary className="cursor-pointer font-semibold text-tinta">{titulo}</summary>
      <ol className="mt-2 list-disc space-y-1 pl-4">{children}</ol>
    </details>
  );
}

// Ubicación del acceso directo de Chrome que imprime sin preguntar.
// --user-data-dir abre un Chrome aparte: el permiso funciona aunque el Chrome
// de siempre (YouTube, WhatsApp…) ya esté abierto. --app lo abre en su propia
// ventana, así el panel no queda como una pestaña escondida detrás de otra.
function AccesoDirecto() {
  const panel = new URL("admin", window.location.origin + import.meta.env.BASE_URL).href;
  const comando = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir="C:\\PanelPalmeras" --app=${panel}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(comando);
      toast.success("Copiado");
    } catch {
      toast.error("No se pudo copiar: seleccioná el texto y copialo a mano");
    }
  }

  return (
    <li className="flex list-none items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-borde px-1.5 py-1 text-tinta select-all">{comando}</code>
      <button type="button" className="boton-secundario px-2.5 py-1.5 text-xs" onClick={copiar}>
        Copiar
      </button>
    </li>
  );
}

// Lo que pasó en la última impresión de esta computadora
function EstadoImpresion() {
  const [modo, setModo] = useState(leerModoImpresion);
  useEffect(() => {
    const alCambiar = (e) => setModo(e.detail);
    window.addEventListener(EVENTO_MODO, alCambiar);
    return () => window.removeEventListener(EVENTO_MODO, alCambiar);
  }, []);

  if (modo === "directa") {
    return (
      <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <strong>Imprime directo.</strong> La última impresión salió sola, sin el cuadro de Chrome.
      </p>
    );
  }
  if (modo === "dialogo") {
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Todavía pide confirmación.</strong> Chrome mostró el cuadro de impresión: así la comanda no sale sola cuando llega un
        pedido. Seguí el paso 3 de abajo (el acceso directo) y volvé a imprimir la prueba.
      </p>
    );
  }
  return (
    <p className="rounded-xl bg-fondo p-3 text-sm text-tinta-suave">
      Tocá <strong>Imprimir prueba</strong> para ver si en esta computadora la comanda sale sola.
    </p>
  );
}

function Contenido({ onCerrar }) {
  const [config, setConfig] = useState(leerConfigImpresora);
  const set = (cambios) => setConfig((c) => ({ ...c, ...cambios }));

  function guardar() {
    guardarConfigImpresora(config);
    toast.success("Configuración de la ticketera guardada en esta computadora");
    onCerrar();
  }

  return (
    <div className="space-y-4">
      <EstadoImpresion />

      <div>
        <span className="etiqueta">Ancho del papel</span>
        <div className="grid grid-cols-2 gap-2">
          {[80, 58].map((mm) => (
            <button
              key={mm}
              type="button"
              aria-pressed={config.ancho === mm}
              onClick={() => set({ ancho: mm })}
              className={`rounded-xl border-2 px-3 py-2.5 text-sm font-semibold ${config.ancho === mm ? "border-palmera bg-palmera/10" : "border-borde text-tinta-suave"}`}
            >
              {mm} mm
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Opcion
          marcado={config.comandaAlLlegar}
          onCambio={(v) => set({ comandaAlLlegar: v })}
          titulo="Imprimir la comanda apenas llega un pedido web"
          detalle="Sale sola cada orden nueva de la carta, aunque todavía no la confirmes."
        />
        <Opcion
          marcado={config.comandaKiosco}
          onCambio={(v) => set({ comandaKiosco: v })}
          titulo="También si el pedido es solo de bebidas o golosinas"
          detalle="Destildado: un pedido que es todo de kiosco no imprime comanda para la cocina."
        />
        <Opcion
          marcado={config.comandaAlConfirmar}
          onCambio={(v) => set({ comandaAlConfirmar: v })}
          titulo="Imprimir la comanda al confirmar un pedido"
          detalle="Cuando tocás Confirmar pedido / Pasar a cocina, sale la comanda para el chef."
        />
        <Opcion
          marcado={config.ticketAlCobrar}
          onCambio={(v) => set({ ticketAlCobrar: v })}
          titulo="Imprimir el ticket del cliente al cobrar"
          detalle="Queda tildado por defecto en la ventana de cobro (se puede destildar en cada venta)."
        />
      </div>

      <div className="space-y-2 text-xs text-tinta-suave">
        <p>
          Si en la vista previa el ticket aparece chiquito en una hoja A4, la impresora elegida no es la ticketera (por ejemplo "Microsoft
          Print to PDF"): Windows todavía no la tiene instalada.
        </p>
        <Paso titulo="1. Instalar la ticketera en Windows">
          <li>
            Bajá el driver de la marca (3nStar: <code className="rounded bg-borde px-1">3nstar.com</code> → Soporte → Drivers, buscá el modelo
            que figura en la etiqueta de abajo, por ejemplo RPT006 o RPT008). Sin el driver, Windows no la encuentra.
          </li>
          <li>
            <strong>Por USB:</strong> con la ticketera prendida y el cable conectado, instalá el driver y elegí el puerto USB001 (o el que
            aparezca).
          </li>
          <li>
            <strong>Por cable de red:</strong> apagala, mantené apretado FEED y prendela: imprime una hoja con su dirección IP. En{" "}
            <em>Agregar impresora</em> elegí "Agregar una impresora con una dirección IP o un nombre de host", poné esa IP y el driver de la
            marca.
          </li>
          <li>Si no hay driver para el modelo, el genérico "POS-80" (ESC/POS) suele funcionar.</li>
          <li>En las Preferencias de impresión de la ticketera elegí papel de {config.ancho} mm.</li>
        </Paso>
        <Paso titulo="2. Dejarla como predeterminada">
          <li>
            En Configuración → Impresoras y escáneres, <strong>destildá</strong> "Permitir que Windows administre mi impresora
            predeterminada".
          </li>
          <li>Entrá a la ticketera y tocá "Establecer como predeterminada".</li>
          <li>
            Imprimí una prueba desde acá eligiendo la ticketera en <em>Destino</em>, con márgenes "Ninguno" y sin "Encabezados y pies de
            página". Chrome lo recuerda para las próximas.
          </li>
        </Paso>
        <Paso titulo="3. Imprimir directo, sin el cuadro de diálogo">
          <li>
            Una página web no puede imprimir sola: Chrome siempre pregunta, salvo que se abra con un permiso especial. Eso hace este acceso
            directo.
          </li>
          <li>Click derecho en el escritorio → Nuevo → Acceso directo, y pegá esto como ubicación:</li>
          <AccesoDirecto />
          <li>
            Ponele de nombre "Panel Palmeras" y abrilo. Se abre en una ventana aparte: entrá con el usuario y la contraseña (solo la primera
            vez).
          </li>
          <li>
            Usá siempre esa ventana para el panel. Puede quedar detrás de otras, pero <strong>no la cierres ni la minimices</strong> mientras
            se reciben pedidos. El Chrome de siempre (YouTube, WhatsApp) se sigue usando aparte.
          </li>
          <li>Tocá Imprimir prueba desde esa ventana: arriba tiene que decir "Imprime directo".</li>
          <li>
            Si Windows dice que no encuentra el archivo, Chrome está en otra carpeta: click derecho en el ícono de Chrome → Propiedades, y
            usá esa ruta en lugar de la primera parte.
          </li>
        </Paso>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="boton-secundario"
          onClick={() => {
            guardarConfigImpresora(config);
            imprimirComanda({ ...PRUEBA, created_at: new Date().toISOString() });
          }}
        >
          <IconoImpresora className="size-4" /> Imprimir prueba
        </button>
        <div className="flex gap-2">
          <button type="button" className="boton-secundario" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="boton-primario" onClick={guardar}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfigImpresora({ abierto, onCerrar }) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Ticketera" ancho="max-w-lg">
      {abierto && <Contenido onCerrar={onCerrar} />}
    </Modal>
  );
}
