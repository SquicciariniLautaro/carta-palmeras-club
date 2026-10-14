import { IMAGENES } from "../config";
import { supabase } from "./supabase";

// Las fotos nuevas se guardan en Cloudinary, siempre en WebP. Las que se
// subieron antes al bucket de Supabase siguen funcionando hasta que se cambien.

// Error con un mensaje pensado para mostrarle al dueño tal cual
function errorVisible(mensaje) {
  const error = new Error(mensaje);
  error.visible = true;
  return error;
}

export function esDeCloudinary(url) {
  return typeof url === "string" && url.startsWith("https://res.cloudinary.com/");
}

// URL de la foto al tamaño justo para cada lugar. En las de Cloudinary pide un
// recorte con la comida centrada (g_auto busca el plato y lo pone en el medio),
// en WebP y con la calidad ajustada sola. Las fotos viejas se usan tal cual.
//   urlImagen(url, { ancho: 600, proporcion: "1:1" })
export function urlImagen(url, { ancho = 800, proporcion = "1:1" } = {}) {
  if (!esDeCloudinary(url)) return url;
  const transformacion = `c_fill,g_auto,ar_${proporcion},w_${ancho},f_webp,q_auto`;
  return url.replace("/image/upload/", `/image/upload/${transformacion}/`);
}

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

// Redimensiona a un máximo de 1200 px y comprime en WebP. Si el navegador no
// sabe generar WebP (Safari viejo) manda JPEG y Cloudinary lo pasa a WebP igual.
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

// Habla con /api/cloudinary (función de Vercel): firma las subidas y borra
// fotos. Solo responde a administradores, por eso va el token de la sesión.
async function llamarApi(cuerpo) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw errorVisible("Tu sesión venció. Volvé a iniciar sesión.");

  let respuesta;
  try {
    respuesta = await fetch(IMAGENES.api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw errorVisible("No pudimos conectarnos. Revisá tu conexión a internet.");
  }
  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !json) {
    throw errorVisible(json?.error || "El servicio de imágenes no respondió. Probá de nuevo en un rato.");
  }
  return json;
}

// Sube a Cloudinary (convertida a WebP) y devuelve { url, path }.
// "path" es el public_id de Cloudinary, para poder borrarla después.
export async function subirImagen(blob) {
  const firma = await llamarApi({ accion: "firmar" });

  const formulario = new FormData();
  formulario.append("file", blob);
  formulario.append("api_key", firma.apiKey);
  formulario.append("timestamp", firma.timestamp);
  formulario.append("signature", firma.signature);
  formulario.append("folder", firma.folder);
  formulario.append("format", firma.format);

  let respuesta;
  try {
    respuesta = await fetch(`https://api.cloudinary.com/v1_1/${firma.nube}/image/upload`, {
      method: "POST",
      body: formulario,
    });
  } catch {
    throw errorVisible("No pudimos subir la imagen. Revisá tu conexión a internet.");
  }
  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !json?.secure_url) {
    console.warn("Cloudinary rechazó la imagen", json);
    throw errorVisible("Cloudinary no aceptó la imagen. Probá con otra o revisá la configuración.");
  }
  return { url: json.secure_url, path: json.public_id };
}

// Borra una imagen (de Cloudinary o del bucket viejo). Si falla, solo lo registramos.
export async function borrarImagen(url, path) {
  if (!path) return;
  try {
    if (esDeCloudinary(url)) {
      await llamarApi({ accion: "borrar", public_id: path });
    } else {
      const { error } = await supabase.storage.from(IMAGENES.bucketAnterior).remove([path]);
      if (error) throw error;
    }
  } catch (error) {
    console.warn("No se pudo borrar la imagen", path, error);
  }
}
