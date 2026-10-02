import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { LIMITES, NEGOCIO } from "../config";
import { supabase, mensajeDeError, supabaseConfigurado } from "../lib/supabase";
import { normalizarTexto, precioFinal, tienePromo } from "../lib/formato";
import { armarMensajePedido, linkWhatsApp, mensajeConsulta, notaParaRegistro } from "../lib/whatsapp";
import { revalidarCarrito, useCarrito } from "../hooks/useCarrito";
import CarritoProvider from "../components/catalogo/CarritoProvider";
import Navbar from "../components/catalogo/Navbar";
import Filtros from "../components/catalogo/Filtros";
import TarjetaProducto, { TarjetaEsqueleto } from "../components/catalogo/TarjetaProducto";
import DetalleProducto from "../components/catalogo/DetalleProducto";
import Carrito from "../components/catalogo/Carrito";
import BotonFlotante from "../components/catalogo/BotonFlotante";
import Footer from "../components/catalogo/Footer";
import Preloader from "../components/catalogo/Preloader";

// Trae categorías y comidas activas
async function obtenerCatalogo() {
  if (!supabaseConfigurado) throw new Error("Supabase no está configurado.");
  const [cats, comidas] = await Promise.all([
    supabase.from("categorias").select("id, nombre, orden").order("orden").order("nombre"),
    supabase
      .from("comidas")
      .select("id, nombre, descripcion, precio, precio_promo, categoria_id, imagen_url, destacado, stock")
      .eq("activo", true),
  ]);
  if (cats.error) throw cats.error;
  if (comidas.error) throw comidas.error;
  return { categorias: cats.data, comidas: comidas.data };
}

// Abre WhatsApp en otra pestaña. Si el navegador bloquea la ventana
// emergente, navega en la misma pestaña.
function abrirWhatsApp(link, ventanaPrevia = null) {
  if (ventanaPrevia && !ventanaPrevia.closed) {
    ventanaPrevia.location.href = link;
    return;
  }
  const ventana = window.open(link, "_blank", "noopener,noreferrer");
  if (!ventana) window.location.href = link;
}

export default function Catalogo() {
  return (
    <CarritoProvider>
      <CatalogoContenido />
    </CarritoProvider>
  );
}

const DURACION_INTRO_MS = 2800;

function CatalogoContenido() {
  const carrito = useCarrito();
  const [datos, setDatos] = useState({ categorias: [], comidas: [] });
  const [estado, setEstado] = useState("cargando"); // cargando | listo | error
  const [primeraCarga, setPrimeraCarga] = useState(true);
  // La pantalla de carga se muestra al menos este tiempo para que se aprecie la marca
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), DURACION_INTRO_MS);
    return () => clearTimeout(t);
  }, []);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [detalleId, setDetalleId] = useState(null);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const { items: itemsCarrito, reemplazar } = carrito;

  // Aplica datos nuevos y revalida el carrito guardado contra ellos
  const aplicarDatos = useCallback(
    (nuevos, itemsActuales) => {
      setDatos(nuevos);
      setEstado("listo");
      setPrimeraCarga(false);
      const porId = new Map(nuevos.comidas.map((c) => [c.id, c]));
      const { items, cambios } = revalidarCarrito(itemsActuales, porId);
      if (cambios.length > 0) {
        reemplazar(items);
        toast(cambios.join("\n"), { icon: "🛒", duration: 6000 });
      }
    },
    [reemplazar]
  );

  // Carga inicial (los items del carrito se leen una sola vez, al montar)
  const [itemsIniciales] = useState(itemsCarrito);
  useEffect(() => {
    let activo = true;
    obtenerCatalogo()
      .then((nuevos) => activo && aplicarDatos(nuevos, itemsIniciales))
      .catch((error) => {
        console.error(error);
        if (activo) {
          setEstado("error");
          setPrimeraCarga(false);
        }
      });
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  function reintentar() {
    setEstado("cargando");
    obtenerCatalogo()
      .then((nuevos) => aplicarDatos(nuevos, itemsCarrito))
      .catch(() => setEstado("error"));
  }

  const { categorias, comidas } = datos;
  const comidasPorId = useMemo(() => new Map(comidas.map((c) => [c.id, c])), [comidas]);
  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // Categorías que tienen al menos una comida visible
  const categoriasConComidas = useMemo(
    () => categorias.filter((cat) => comidas.some((c) => c.categoria_id === cat.id)),
    [categorias, comidas]
  );
  const hayPromos = comidas.some(tienePromo);

  // Filtro + búsqueda + orden (destacados primero, luego categoría y nombre)
  const visibles = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    return comidas
      .filter((c) => {
        if (filtro === "promos" && !tienePromo(c)) return false;
        if (filtro !== "todos" && filtro !== "promos" && c.categoria_id !== filtro) return false;
        if (texto && !normalizarTexto(c.nombre).includes(texto)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
        const oa = categoriasPorId.get(a.categoria_id)?.orden ?? 0;
        const ob = categoriasPorId.get(b.categoria_id)?.orden ?? 0;
        if (oa !== ob) return oa - ob;
        return a.nombre.localeCompare(b.nombre, "es");
      });
  }, [comidas, filtro, busqueda, categoriasPorId]);

  // Líneas del carrito con los datos actuales de cada comida
  const lineas = useMemo(
    () =>
      itemsCarrito
        .map((i) => ({ comida: comidasPorId.get(i.id), cantidad: i.cantidad }))
        .filter((l) => l.comida),
    [itemsCarrito, comidasPorId]
  );
  const unidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);
  const total = lineas.reduce((acc, l) => acc + precioFinal(l.comida) * l.cantidad, 0);

  function sumar(comida) {
    const actual = carrito.cantidadDe(comida.id);
    if (actual >= comida.stock) {
      toast.error(`No hay más stock de "${comida.nombre}" (quedan ${comida.stock}).`);
      return;
    }
    if (actual >= LIMITES.unidadesPorProducto) {
      toast.error(`Podés pedir hasta ${LIMITES.unidadesPorProducto} unidades de cada producto.`);
      return;
    }
    if (unidades >= LIMITES.unidadesPorPedido) {
      toast.error(`El pedido puede tener hasta ${LIMITES.unidadesPorPedido} unidades.`);
      return;
    }
    if (actual === 0 && lineas.length >= LIMITES.productosDistintos) {
      toast.error(`El pedido puede tener hasta ${LIMITES.productosDistintos} productos distintos.`);
      return;
    }
    carrito.agregar(comida.id);
    if (actual === 0) toast.success(`Agregaste ${comida.nombre}`, { id: `agregado-${comida.id}`, duration: 1500 });
  }

  function restar(comida) {
    carrito.restar(comida.id);
  }

  function eliminar(comida) {
    carrito.eliminar(comida.id);
    toast(`Sacaste ${comida.nombre}`, { icon: "🗑️" });
  }

  function consultar(comida) {
    if (!NEGOCIO.whatsapp) {
      toast.error("Falta configurar el número de WhatsApp del negocio.");
      return;
    }
    abrirWhatsApp(linkWhatsApp(mensajeConsulta(comida)));
  }

  async function enviarPedido({ cliente, nota, entrega, direccion }) {
    if (lineas.length === 0) return false;
    if (!NEGOCIO.whatsapp) {
      toast.error("Falta configurar el número de WhatsApp del negocio.");
      return false;
    }

    // Abrimos la pestaña ya (dentro del click) para que el navegador no la
    // bloquee; cuando el pedido queda registrado le cargamos el link.
    const ventana = window.open("", "_blank");
    if (ventana) ventana.opener = null;

    setEnviando(true);
    const { data, error } = await supabase.rpc("crear_pedido", {
      items: lineas.map((l) => ({ comida_id: l.comida.id, cantidad: l.cantidad })),
      cliente_nombre: cliente || null,
      nota: notaParaRegistro({ nota, entrega, direccion }) || null,
    });
    setEnviando(false);

    if (error || !data) {
      ventana?.close();
      toast.error(mensajeDeError(error, "No pudimos registrar tu pedido. Probá de nuevo."));
      // Puede haber cambiado el stock: refrescamos el catálogo
      obtenerCatalogo().then((nuevos) => aplicarDatos(nuevos, itemsCarrito)).catch(() => {});
      return false;
    }

    const mensaje = armarMensajePedido({
      numero: data.numero,
      items: data.items,
      total: data.total,
      cliente,
      nota,
      entrega,
      direccion,
    });
    abrirWhatsApp(linkWhatsApp(mensaje), ventana);

    toast.success(`¡Pedido #${data.numero} registrado! Terminá de enviarlo en WhatsApp.`, { duration: 6000 });
    carrito.vaciar();
    setCarritoAbierto(false);
    obtenerCatalogo().then((nuevos) => aplicarDatos(nuevos, [])).catch(() => {});
    return true;
  }

  const cerrarCarrito = useCallback(() => setCarritoAbierto(false), []);
  const detalle = detalleId ? comidasPorId.get(detalleId) : null;

  if (intro || (primeraCarga && estado === "cargando")) return <Preloader />;

  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar cantidad={unidades} onAbrirCarrito={() => setCarritoAbierto(true)} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        <section className="pb-2 pt-4 text-center">
          <h1 className="font-script text-5xl leading-tight text-palmera sm:text-6xl">{NEGOCIO.nombre}</h1>
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-tinta">Nuestra carta</h2>
          <p className="mt-1 text-sm text-tinta-suave">Armá tu pedido y mandalo por WhatsApp.</p>
        </section>

        {estado === "error" ? (
          <div className="tarjeta mx-auto my-10 max-w-md p-6 text-center">
            <p className="text-lg font-semibold">Uy, no pudimos cargar el menú 😕</p>
            <p className="mt-1 text-sm text-tinta-suave">
              Revisá tu conexión e intentá de nuevo. Si sigue fallando, escribinos por WhatsApp.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" className="boton-primario" onClick={reintentar}>
                Reintentar
              </button>
              <button type="button" className="boton-whatsapp" onClick={() => consultar(null)}>
                WhatsApp
              </button>
            </div>
          </div>
        ) : (
          <>
            <Filtros
              categorias={categoriasConComidas}
              filtro={filtro}
              onFiltro={setFiltro}
              busqueda={busqueda}
              onBusqueda={setBusqueda}
              hayPromos={hayPromos}
            />

            {estado === "cargando" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <TarjetaEsqueleto key={i} />
                ))}
              </div>
            ) : visibles.length === 0 ? (
              <div className="py-16 text-center text-tinta-suave">
                <p className="text-4xl">🥥</p>
                <p className="mt-2 font-medium text-tinta">
                  {comidas.length === 0 ? "Todavía no hay comidas cargadas." : "No encontramos nada con ese filtro."}
                </p>
                {(busqueda || filtro !== "todos") && (
                  <button
                    type="button"
                    className="mt-3 text-sm text-palmera underline"
                    onClick={() => {
                      setBusqueda("");
                      setFiltro("todos");
                    }}
                  >
                    Ver todo el menú
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visibles.map((comida) => (
                  <TarjetaProducto
                    key={comida.id}
                    comida={comida}
                    cantidad={carrito.cantidadDe(comida.id)}
                    onAgregar={() => sumar(comida)}
                    onSumar={() => sumar(comida)}
                    onRestar={() => restar(comida)}
                    onVerDetalle={() => setDetalleId(comida.id)}
                    onConsultar={() => consultar(comida)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      <DetalleProducto
        comida={detalle}
        categoria={detalle ? categoriasPorId.get(detalle.categoria_id)?.nombre : null}
        cantidad={detalle ? carrito.cantidadDe(detalle.id) : 0}
        onCerrar={() => setDetalleId(null)}
        onAgregar={() => detalle && sumar(detalle)}
        onSumar={() => detalle && sumar(detalle)}
        onRestar={() => detalle && restar(detalle)}
        onConsultar={() => consultar(detalle)}
      />

      <Carrito
        abierto={carritoAbierto}
        onCerrar={cerrarCarrito}
        lineas={lineas}
        total={total}
        onSumar={sumar}
        onRestar={restar}
        onEliminar={eliminar}
        onVaciar={() => {
          carrito.vaciar();
          toast("Vaciaste el pedido", { icon: "🧺" });
        }}
        onEnviar={enviarPedido}
        enviando={enviando}
      />

      <BotonFlotante
        cantidad={unidades}
        total={total}
        visible={!carritoAbierto}
        onClick={() => setCarritoAbierto(true)}
      />
    </div>
  );
}
