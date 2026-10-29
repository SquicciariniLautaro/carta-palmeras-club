import { createHash } from "node:crypto";

// Función de Vercel: firma las subidas de fotos a Cloudinary y borra las
// viejas. La clave secreta de Cloudinary vive solo acá (variables de entorno
// de Vercel), nunca en el navegador. Solo atiende a administradores: el panel
// manda el token de su sesión de Supabase y se verifica con es_dueno() (los
// empleados no cambian productos).
//
// Variables: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (opcional CLOUDINARY_FOLDER) + las de Supabase que ya usa la página.

const CARPETA = process.env.CLOUDINARY_FOLDER || "palmeras-club/comidas";

// Firma de Cloudinary: parámetros ordenados "a=1&b=2" + secreto, en SHA-1
function firmar(parametros, secreto) {
  const texto = Object.keys(parametros)
    .sort()
    .map((clave) => `${clave}=${parametros[clave]}`)
    .join("&");
  return createHash("sha1").update(texto + secreto).digest("hex");
}

async function esAdmin(token) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const claveAnonima = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !claveAnonima || !token) return false;
  try {
    const respuesta = await fetch(`${url}/rest/v1/rpc/es_dueno`, {
      method: "POST",
      headers: { apikey: claveAnonima, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    return respuesta.ok && (await respuesta.json()) === true;
  } catch {
    return false;
  }
}

function leerCuerpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const nube = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !apiKey || !secreto) {
    return res.status(500).json({ error: "Falta configurar Cloudinary en el servidor (variables CLOUDINARY_…)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await esAdmin(token))) {
    return res.status(403).json({ error: "No tenés permisos para subir o borrar imágenes." });
  }

  const cuerpo = leerCuerpo(req);
  const timestamp = Math.floor(Date.now() / 1000);

  // Firma para que el panel suba directo a Cloudinary. "format: webp" hace que
  // Cloudinary guarde la foto en WebP sin importar el formato original.
  if (cuerpo.accion === "firmar") {
    const parametros = { folder: CARPETA, format: "webp", timestamp };
    return res.status(200).json({ nube, apiKey, ...parametros, signature: firmar(parametros, secreto) });
  }

  // Borra una foto (al reemplazarla o al borrar la comida). Solo de nuestra carpeta.
  if (cuerpo.accion === "borrar") {
    const publicId = typeof cuerpo.public_id === "string" ? cuerpo.public_id : "";
    if (!publicId.startsWith(`${CARPETA}/`)) {
      return res.status(400).json({ error: "Esa imagen no es de la carta." });
    }
    const parametros = { invalidate: "true", public_id: publicId, timestamp };
    const formulario = new URLSearchParams({
      ...parametros,
      timestamp: String(timestamp),
      api_key: apiKey,
      signature: firmar(parametros, secreto),
    });
    try {
      const respuesta = await fetch(`https://api.cloudinary.com/v1_1/${nube}/image/destroy`, {
        method: "POST",
        body: formulario,
      });
      if (!respuesta.ok) return res.status(502).json({ error: "Cloudinary no pudo borrar la imagen." });
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(502).json({ error: "No pudimos conectarnos con Cloudinary." });
    }
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
