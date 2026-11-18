import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  EVENTO_CORTADOR,
  EVENTO_MODO,
  cortarPapel,
  guardarConfigImpresora,
  imprimirComanda,
  leerConfigImpresora,
  leerCortador,
  leerModoImpresion,
} from "../../lib/impresion";
import { IconoImpresora } from "../ui/Iconos";
import Modal from "../ui/Modal";
import { NOMBRE_INSTALADOR, descargarInstalador } from "../../lib/instalador";
import cuerpoInstalador from "../../lib/instalador-panel.ps1?raw";

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
const urlPanel = () => new URL("admin", window.location.origin + import.meta.env.BASE_URL).href;

// Lo más fácil: un archivo que se abre con doble clic en la computadora del local y deja
// todo listo (ticketera predeterminada, corte del papel y acceso directo). Ver lib/instalador.js
function Instalador() {
  function descargar() {
    try {
      descargarInstalador(cuerpoInstalador, urlPanel());
      toast.success("Instalador descargado: abrilo con doble clic desde Descargas");
    } catch {
      toast.error("No se pudo armar el instalador.");
    }
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-palmera/40 bg-palmera/5 p-3 text-sm">
      <p className="font-semibold">Dejarla lista en un minuto (recomendado)</p>
      <p className="text-xs text-tinta-suave">
        Hacelo en la computadora del local, con la ticketera prendida y conectada. El instalador la deja como impresora predeterminada,
        hace que corte el papel (aunque el driver no tenga esa opción) y crea en el escritorio el acceso directo <strong>Panel Palmeras</strong>: una ventana de Chrome solo
        para el panel, que imprime la comanda sin preguntar.
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-tinta-suave">
        <li>
          Tocá <strong>Descargar instalador</strong>. Si Chrome avisa que el archivo puede ser peligroso, elegí <strong>Conservar</strong>.
        </li>
        <li>
          Abrí <strong>{NOMBRE_INSTALADOR}</strong> con doble clic. Si Windows dice "Windows protegió su PC", tocá{" "}
          <strong>Más información</strong> → <strong>Ejecutar de todas formas</strong>.
        </li>
        <li>Escribí el número de la ticketera de la lista y respondé las preguntas. Al final se abre el panel solo.</li>
        <li>
          Entrá con tu usuario y tocá <strong>Ticketera</strong> → <strong>Imprimir prueba</strong>: tiene que salir sola y cortada. Si
          Chrome pregunta si el panel puede usar <em>apps y dispositivos de esta computadora</em>, tocá <strong>Permitir</strong>.
        </li>
      </ol>
      <button type="button" className="boton-primario w-full text-sm" onClick={descargar}>
        Descargar instalador
      </button>
    </div>
  );
}

function AccesoDirecto() {
  const comando = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --autoplay-policy=no-user-gesture-required --user-data-dir="C:\\PanelPalmeras" --app=${urlPanel()}`;

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
        pedido. Usá el instalador de abajo (o el paso 3) y volvé a imprimir la prueba desde el acceso directo.
      </p>
    );
  }
  return (
    <p className="rounded-xl bg-fondo p-3 text-sm text-tinta-suave">
      Tocá <strong>Imprimir prueba</strong> para ver si en esta computadora la comanda sale sola.
    </p>
  );
}

// El corte del papel cuando el driver no lo hace (lo instala el instalador, paso 4)
function EstadoCorte() {
  const [estado, setEstado] = useState(leerCortador);
  const [probando, setProbando] = useState(false);
  useEffect(() => {
    const alCambiar = (e) => setEstado(e.detail);
    window.addEventListener(EVENTO_CORTADOR, alCambiar);
    return () => window.removeEventListener(EVENTO_CORTADOR, alCambiar);
  }, []);

  async function probar() {
    setProbando(true);
    const ok = await cortarPapel();
    setProbando(false);
    if (ok) toast.success("La ticketera cortó el papel");
    else toast.error("El cortador no respondió en esta computadora");
  }

  const boton = (
    <button type="button" className="boton-secundario shrink-0 px-2.5 py-1.5 text-xs" onClick={probar} disabled={probando}>
      {probando ? "Cortando…" : "Probar corte"}
    </button>
  );

  if (estado === "si") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="flex-1">
          <strong>Corta el papel.</strong> El cortador está andando: después de cada comanda la ticketera corta.
        </p>
        {boton}
      </div>
    );
  }
  if (estado === "fallo") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="flex-1">
          <strong>No corta.</strong> El cortador no respondió. Si Chrome preguntó por "apps y dispositivos de esta computadora", tocá{" "}
          <strong>Permitir</strong>. Si no, volvé a abrir el instalador (paso 4).
        </p>
        {boton}
      </div>
    );
  }
  return null;
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
      <EstadoCorte />

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

      <Instalador />

      <div className="space-y-2 text-xs text-tinta-suave">
        <p className="font-semibold text-tinta">O hacelo a mano, paso por paso:</p>
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
        <Paso titulo="4. Que corte el papel solo después de cada comanda">
          <li>
            El programa de comandas que usaban antes le manda la orden de corte directo a la ticketera. Desde el navegador eso lo hace el
            driver de Windows: hay que activarlo una sola vez y queda para siempre.
          </li>
          <li>
            Inicio → escribí <strong>Impresoras</strong> → Impresoras y escáneres → tocá la ticketera →{" "}
            <strong>Preferencias de impresión</strong>.
          </li>
          <li>
            Buscá la opción de corte (según el driver se llama <em>Corte de papel</em>, <em>Paper Cut</em>, <em>Cutter</em> o{" "}
            <em>Cut Mode</em>; a veces está adentro del botón <strong>Opciones avanzadas</strong> o en la pestaña{" "}
            <em>Características / Device Settings</em>).
          </li>
          <li>
            Elegí <strong>Corte al final del documento</strong> (<em>Cut at end of document / End of job</em>) y, si lo pregunta,{" "}
            <strong>Corte parcial</strong> (deja una pestañita y el papel no se cae). No elijas "Sin corte" ni "Corte por página".
          </li>
          <li>Tocá Aplicar → Aceptar y volvé a tocar Imprimir prueba: la comanda tiene que salir cortada.</li>
          <li>
            Si en las Preferencias no aparece ninguna opción de corte (pasa con el driver genérico <strong>POS-80</strong>), usá el{" "}
            <strong>instalador</strong> de arriba: instala un "cortador" que le manda la orden de corte a la ticketera después de cada
            comanda, como el programa que usaban antes. La primera vez Chrome pregunta si el panel puede usar{" "}
            <em>apps y dispositivos de esta computadora</em>: tocá <strong>Permitir</strong>.
          </li>
        </Paso>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="boton-secundario"
          onClick={() => {
            guardarConfigImpresora(config);
            imprimirComanda({ ...PRUEBA, created_at: new Date().toISOString() }, { probarCorte: true });
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
