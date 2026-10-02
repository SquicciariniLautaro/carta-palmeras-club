import Modal from "./Modal";

// Diálogo de confirmación para acciones destructivas
export default function Confirmar({
  abierto,
  titulo,
  mensaje,
  textoConfirmar = "Confirmar",
  peligro = true,
  procesando = false,
  onConfirmar,
  onCancelar,
}) {
  return (
    <Modal abierto={abierto} onCerrar={onCancelar} titulo={titulo} ancho="max-w-sm">
      <p className="text-sm text-tinta-suave">{mensaje}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="boton-secundario" onClick={onCancelar} disabled={procesando}>
          Volver
        </button>
        <button
          type="button"
          className={peligro ? "boton-peligro" : "boton-primario"}
          onClick={onConfirmar}
          disabled={procesando}
        >
          {procesando ? "Procesando…" : textoConfirmar}
        </button>
      </div>
    </Modal>
  );
}
