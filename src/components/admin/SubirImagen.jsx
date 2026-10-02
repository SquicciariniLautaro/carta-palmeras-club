import { useEffect, useRef, useState } from "react";
import { validarImagen } from "../../lib/imagenes";
import { IconoImagen, IconoSubir } from "../ui/Iconos";

// Selector de imagen con arrastrar y soltar + vista previa.
// No sube nada: devuelve el archivo elegido al formulario, que lo sube al guardar.
export default function SubirImagen({ urlActual, archivo, onArchivo, onQuitar, error }) {
  const inputRef = useRef(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [errorLocal, setErrorLocal] = useState("");
  const [vistaPrevia, setVistaPrevia] = useState(null);

  // Liberamos la URL temporal cuando cambia o se desmonta
  useEffect(() => {
    if (!vistaPrevia) return;
    return () => URL.revokeObjectURL(vistaPrevia);
  }, [vistaPrevia]);

  function elegir(nuevo) {
    if (!nuevo) return;
    const problema = validarImagen(nuevo);
    if (problema) {
      setErrorLocal(problema);
      return;
    }
    setErrorLocal("");
    setVistaPrevia(URL.createObjectURL(nuevo));
    onArchivo(nuevo);
  }

  function quitar() {
    setVistaPrevia(null);
    if (inputRef.current) inputRef.current.value = "";
    onQuitar();
  }

  const src = archivo ? vistaPrevia : urlActual;

  return (
    <div>
      <span className="etiqueta">Imagen</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          elegir(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-4 text-center transition sm:flex-row sm:text-left ${
          arrastrando ? "border-palmera bg-palmera/10" : "border-borde"
        }`}
      >
        {src ? (
          <img src={src} alt="Vista previa" className="size-24 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid size-24 shrink-0 place-items-center rounded-lg bg-borde text-tinta-suave">
            <IconoImagen className="size-8" />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-xs text-tinta-suave">
            Arrastrá una imagen o elegila. JPG, PNG o WebP. Se achica a 1200 px y se comprime antes de subir (máx. 2 MB).
          </p>
          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={() => inputRef.current?.click()}>
              <IconoSubir className="size-4" /> {src ? "Cambiar imagen" : "Elegir imagen"}
            </button>
            {src && (
              <button type="button" className="boton-secundario px-3 py-2 text-xs hover:text-brasa" onClick={quitar}>
                Quitar
              </button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => elegir(e.target.files?.[0])}
        />
      </div>
      {(errorLocal || error) && <p className="mt-1 text-xs text-brasa">{errorLocal || error}</p>}
    </div>
  );
}
