import { IMAGENES } from "../config";
import { supabase } from "./supabase";

// Valida tipo y tamaño de la imagen original
export function validarImagen(archivo) {
  if (!IMAGENES.tipos.includes(archivo.type)) {
    return "Formato no permitido. Usá JPG, PNG o WebP.";
  }
  // Aceptamos originales más grandes porque se comprimen antes de subir;
  // el límite de 2 MB se controla sobre el archivo final.
  if (archivo.size > 15 * 1024 * 1024) {
    return "La imagen es demasiado pesada (máximo 15 MB antes de comprimir).";
  }
  return null;
}

// Redimensiona a un máximo de 1200 px y comprime en WebP (o JPEG si el
// navegador no sabe generar WebP).
export async function comprimirImagen(archivo) {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, IMAGENES.ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close?.();

  const aBlob = (tipo, calidad) => new Promise((ok) => canvas.toBlob(ok, tipo, calidad));
  let blob = await aBlob("image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") blob = await aBlob("image/jpeg", 0.85);
  if (blob && blob.size > IMAGENES.tamanoMaximo) blob = await aBlob(blob.type, 0.7);

  // Si comprimir no ayudó, nos quedamos con el original
  if (!blob || (blob.size > archivo.size && archivo.size <= IMAGENES.tamanoMaximo)) return archivo;
  return blob;
}

// Sube al bucket con un nombre único y devuelve { url, path }
export async function subirImagen(blob) {
  const extension = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[blob.type] || "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(IMAGENES.bucket).upload(path, blob, {
    contentType: blob.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(IMAGENES.bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// Borra una imagen del bucket (si falla, solo lo registramos)
export async function borrarImagen(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(IMAGENES.bucket).remove([path]);
  if (error) console.warn("No se pudo borrar la imagen", path, error);
}
