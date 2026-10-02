import Modal from "../ui/Modal";
import { IconoWhatsApp } from "../ui/Iconos";
import { STOCK_BAJO } from "../../config";
import { tieneOpciones } from "../../lib/opciones";
import ControlCantidad from "./ControlCantidad";
import Precio from "./Precio";
import { ImagenComida } from "./TarjetaProducto";

// Modal con la descripción completa de una comida
export default function DetalleProducto({ comida, categoria, cantidad, onCerrar, onAgregar, onSumar, onRestar, onPersonalizar, onConsultar }) {
  const agotado = comida ? comida.stock <= 0 : false;
  return (
    <Modal abierto={Boolean(comida)} onCerrar={onCerrar} titulo={comida?.nombre ?? ""}>
      {comida && (
        <div className="space-y-4">
          <ImagenComida comida={comida} className="aspect-[4/3] w-full rounded-xl" />
          {categoria && <p className="text-xs font-medium uppercase tracking-wider text-palmera">{categoria}</p>}
          <p className="whitespace-pre-line text-sm text-tinta-suave">
            {comida.descripcion || "Sin descripción."}
          </p>
          <div className="flex items-center justify-between gap-3">
            <Precio comida={comida} grande />
            {agotado ? (
              <span className="rounded-full bg-borde px-3 py-1 text-xs font-bold uppercase">Agotado</span>
            ) : (
              comida.stock <= STOCK_BAJO && (
                <span className="text-xs font-semibold text-brasa">Quedan {comida.stock}</span>
              )
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {!agotado &&
              (comida && tieneOpciones(comida) ? (
                <button type="button" className="boton-primario" onClick={onPersonalizar}>
                  Armar mi pedido
                </button>
              ) : cantidad > 0 ? (
                <ControlCantidad cantidad={cantidad} onSumar={onSumar} onRestar={onRestar} nombre={comida.nombre} />
              ) : (
                <button type="button" className="boton-primario" onClick={onAgregar}>
                  Agregar al pedido
                </button>
              ))}
            <button type="button" className="boton-secundario" onClick={onConsultar}>
              <IconoWhatsApp className="size-4 text-whatsapp" /> Consultar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
