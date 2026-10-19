import { useState } from "react";
import toast from "react-hot-toast";
import { guardarConfigImpresora, imprimirComanda, leerConfigImpresora } from "../../lib/impresion";
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

      <div className="rounded-xl bg-fondo p-3 text-xs text-tinta-suave">
        <p className="font-semibold text-tinta">Para imprimir sin el cuadro de diálogo</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>Instalá la ticketera en Windows y dejala como impresora predeterminada.</li>
          <li>
            Abrí el panel con un acceso directo de Chrome que tenga al final <code className="rounded bg-borde px-1">--kiosk-printing</code>.
          </li>
          <li>En la primera impresión elegí márgenes "Ninguno" y desactivá "Encabezados y pies de página".</li>
        </ol>
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
