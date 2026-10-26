import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { LIMITES, NEGOCIO } from "../config";
import { supabase, mensajeDeError, supabaseConfigurado } from "../lib/supabase";
import { normalizarTexto, tienePromo } from "../lib/formato";
import { CONFIG_VACIA, claveLinea, itemParaPedido, precioLinea, textoConfig } from "../lib/opciones";
import { armarMensajePedido, linkWhatsApp, mensajeConsulta, notaParaRegistro } from "../lib/whatsapp";
import { estadoLocal, textoApertura } from "../lib/horarios";
import { revalidarCarrito, useCarrito } from "../hooks/useCarrito";
import CarritoProvider from "../components/catalogo/CarritoProvider";
import Navbar from "../components/catalogo/Navbar";
import Filtros from "../components/catalogo/Filtros";
import FilaProducto from "../components/catalogo/FilaProducto";
import TarjetaCategoria, { TarjetaCategoriaEsqueleto } from "../components/catalogo/TarjetaCategoria";
import SelloCarta from "../components/catalogo/SelloCarta";
import DetalleProducto from "../components/catalogo/DetalleProducto";
import PersonalizarProducto from "../components/catalogo/PersonalizarProducto";
import Carrito from "../components/catalogo/Carrito";
import BotonFlotante from "../components/catalogo/BotonFlotante";
import Footer from "../components/catalogo/Footer";
import Preloader from "../components/catalogo/Preloader";
import AvisoCerrado from "../components/catalogo/AvisoCerrado";
import { IconoFlechaAbajo } from "../components/ui/Iconos";

// Trae categorías, comidas activas y el horario de atención de la carta (turno noche)
async function obtenerCatalogo() {
  if (!supabaseConfigurado) throw new Error("Supabase no está configurado.");
  const [cats, comidas, horarios] = await Promise.all([
    supabase.from("categorias").select("id, nombre, orden").eq("turno", "noche").order("orden").order("nombre"),
    supabase
      .from("comidas")
      .select("id, nombre, descripcion, precio, precio_promo, categoria_id, imagen_url, destacado, opciones")
      .eq("activo", true)
      .eq("turno", "noche"),
    supabase.from("horarios").select("dia, abierto, desde, hasta").eq("turno", "noche"),
  ]);
  if (cats.error) throw cats.error;
  if (comidas.error) throw comidas.error;
  // Si falla el horario la carta igual se muestra (la base controla el horario al recibir el pedido)
  if (horarios.error) console.warn("No se pudo leer el horario", horarios.error);
  return { categorias: cats.data, comidas: comidas.data, horarios: horarios.data ?? [] };
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

const DURACION_INTRO_MS = 2100;

function CatalogoContenido() {
  const carrito = useCarrito();
  const [datos, setDatos] = useState({ categorias: [], comidas: [], horarios: [] });
  const [estado, setEstado] = useState("cargando"); // cargando | listo | error
  const [primeraCarga, setPrimeraCarga] = useState(true);
  // La pantalla de carga se muestra al menos este tiempo para que se aprecie la marca
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), DURACION_INTRO_MS);
    return () => clearTimeout(t);
  }, []);
  // Reloj para saber si el local está abierto (se revisa cada minuto)
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [busqueda, setBusqueda] = useState("");
  const [activa, setActiva] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [personalizandoId, setPersonalizandoId] = useState(null);
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
        toast(cambios.join("\n"), { duration: 6000 });
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

  const { categorias, comidas, horarios } = datos;
  const local = useMemo(() => estadoLocal(horarios, new Date(ahora)), [horarios, ahora]);
  const comidasPorId = useMemo(() => new Map(comidas.map((c) => [c.id, c])), [comidas]);
  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // Secciones de la carta, en el orden de las categorías: arriba las promos y al
  // final lo que no tiene categoría. Dentro de cada una, destacados primero.
  // El buscador mira el nombre y la descripción.
  const secciones = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    const coincide = (c) =>
      !texto || normalizarTexto(c.nombre).includes(texto) || normalizarTexto(c.descripcion ?? "").includes(texto);
    const ordenar = (a, b) =>
      a.destacado !== b.destacado ? (a.destacado ? -1 : 1) : a.nombre.localeCompare(b.nombre, "es");
    const lista = categorias.map((cat) => ({
      id: cat.id,
      nombre: cat.nombre,
      comidas: comidas.filter((c) => c.categoria_id === cat.id && coincide(c)).sort(ordenar),
    }));
    lista.push({
      id: "otros",
      nombre: "Otros",
      comidas: comidas.filter((c) => !categoriasPorId.has(c.categoria_id) && coincide(c)).sort(ordenar),
    });
    if (!texto) {
      lista.unshift({
        id: "promos",
        nombre: "Promos",
        bajada: "Aprovechá",
        resaltada: true,
        comidas: comidas.filter(tienePromo).sort(ordenar),
      });
    }
    return lista.filter((s) => s.comidas.length > 0);
  }, [comidas, categorias, categoriasPorId, busqueda]);

  // Marca en la barra la sección que está a la vista mientras el cliente baja
  useEffect(() => {
    if (secciones.length === 0) return;
    let pendiente = 0;
    function revisar() {
      pendiente = 0;
      let actual = secciones[0].id;
      for (const s of secciones) {
        const el = document.getElementById(`seccion-${s.id}`);
        if (el && el.getBoundingClientRect().top <= 170) actual = s.id;
      }
      setActiva(actual);
    }
    const alDesplazar = () => {
      if (!pendiente) pendiente = requestAnimationFrame(revisar);
    };
    pendiente = requestAnimationFrame(revisar);
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => {
      window.removeEventListener("scroll", alDesplazar);
      cancelAnimationFrame(pendiente);
    };
  }, [secciones]);

  function irASeccion(id) {
    setActiva(id);
    document.getElementById(`seccion-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const nombreActiva = secciones.find((s) => s.id === activa)?.nombre;

  // Líneas del carrito con los datos actuales de cada comida
  const lineas = useMemo(
    () =>
      itemsCarrito
        .map((i) => {
          const comida = comidasPorId.get(i.id);
          if (!comida) return null;
          return {
            clave: i.clave,
            comida,
            config: i.config,
            cantidad: i.cantidad,
            texto: textoConfig(comida, i.config),
            precioUnitario: precioLinea(comida, i.config),
          };
        })
        .filter(Boolean),
    [itemsCarrito, comidasPorId]
  );
  const unidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);
  const total = lineas.reduce((acc, l) => acc + l.precioUnitario * l.cantidad, 0);

  // Agrega "cantidad" unidades de una comida con esa configuración, respetando los límites.
  // Devuelve true si se agregó.
  function sumar(comida, config = CONFIG_VACIA, cantidad = 1) {
    const actual = carrito.cantidadDe(comida.id);
    if (actual + cantidad > LIMITES.unidadesPorProducto) {
      toast.error(`Podés pedir hasta ${LIMITES.unidadesPorProducto} unidades de cada producto.`);
      return false;
    }
    if (unidades + cantidad > LIMITES.unidadesPorPedido) {
      toast.error(`El pedido puede tener hasta ${LIMITES.unidadesPorPedido} unidades.`);
      return false;
    }
    const esLineaNueva = !lineas.some((l) => l.clave === claveLinea(comida.id, config));
    if (esLineaNueva && lineas.length >= LIMITES.productosDistintos) {
      toast.error(`El pedido puede tener hasta ${LIMITES.productosDistintos} productos distintos.`);
      return false;
    }
    carrito.agregar(comida.id, config, cantidad);
    if (actual === 0) toast.success(`Agregaste ${comida.nombre}`, { id: `agregado-${comida.id}`, duration: 1500 });
    return true;
  }

  const sumarLinea = (linea) => sumar(linea.comida, linea.config);
  const restarLinea = (linea) => carrito.restar(linea.clave);
  const restarSimple = (comida) => carrito.restar(claveLinea(comida.id, CONFIG_VACIA));

  function eliminar(linea) {
    carrito.eliminar(linea.clave);
    toast(`Sacaste ${linea.comida.nombre}`);
  }

  const personalizando = personalizandoId ? comidasPorId.get(personalizandoId) : null;

  function abrirPersonalizar(comida) {
    setDetalleId(null);
    setPersonalizandoId(comida.id);
  }

  function consultar(comida) {
    if (!NEGOCIO.whatsapp) {
      toast.error("Falta configurar el número de WhatsApp del negocio.");
      return;
    }
    abrirWhatsApp(linkWhatsApp(mensajeConsulta(comida)));
  }

  async function enviarPedido({ cliente, telefono, nota, entrega, direccion }) {
    if (lineas.length === 0) return false;
    if (!local.abierto) {
      toast.error(`Ahora estamos cerrados. ${textoApertura(local)}.`);
      return false;
    }
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
      items: lineas.map((l) => itemParaPedido(l.comida.id, l.cantidad, l.config)),
      cliente_nombre: cliente || null,
      cliente_telefono: telefono || null,
      nota: notaParaRegistro({ nota, entrega, direccion }) || null,
    });
    setEnviando(false);

    if (error || !data) {
      ventana?.close();
      toast.error(mensajeDeError(error, "No pudimos registrar tu pedido. Probá de nuevo."));
      // Puede haber cambiado el menú (precios, opciones): refrescamos el catálogo
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

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center sm:pb-14 sm:pt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-tinta-suave">Nuestra carta</p>
          <h1 className="font-script text-6xl leading-tight text-palmera sm:text-8xl">{NEGOCIO.nombre}</h1>
          <div className="mx-auto mt-1 flex max-w-md items-center gap-3 text-tinta">
            <span className="h-px flex-1 bg-tinta/30" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em]">Armá tu pedido</span>
            <span className="h-px flex-1 bg-tinta/30" />
          </div>
          <p className="mt-3 text-sm text-tinta-suave">Elegí lo que quieras y mandalo directo por WhatsApp.</p>
          {estado !== "error" && (
            <a
              href="#carta"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("carta")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-palmera hover:text-palmera-oscuro"
            >
              Ver la carta <IconoFlechaAbajo className="size-4 animate-bounce" />
            </a>
          )}
          {estado !== "error" && !local.abierto && (
            <div className="mt-6">
              <AvisoCerrado estado={local} horarios={horarios} />
            </div>
          )}
        </section>

        {estado === "error" ? (
          <div className="px-4">
            <div className="tarjeta mx-auto mb-10 max-w-md p-6 text-center">
              <p className="text-lg font-semibold">No pudimos cargar el menú</p>
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
          </div>
        ) : (
          <div id="carta" className="scroll-mt-[72px]">
            <Filtros
              secciones={secciones}
              activa={activa}
              onIr={irASeccion}
              busqueda={busqueda}
              onBusqueda={setBusqueda}
            />

            <div className="mantel">
              <div className="mx-auto grid max-w-6xl gap-8 px-3 py-8 sm:px-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:py-16">
                <aside className="hidden lg:block">
                  <div className="sticky top-44 pt-6">
                    <SelloCarta texto={nombreActiva ?? "¿Con hambre?"} className="w-72 xl:w-80" />
                    <p className="mx-auto mt-8 max-w-xs text-center text-sm font-medium text-fondo/90">
                      Tocá el <span className="font-bold">+</span> para sumar al pedido. Cuando termines, lo mandás
                      por WhatsApp.
                    </p>
                  </div>
                </aside>

                <div className="space-y-6">
                  <SelloCarta texto="¿Con hambre?" className="mb-2 w-40 sm:w-52 lg:hidden" />

                  {estado === "cargando" ? (
                    <>
                      <TarjetaCategoriaEsqueleto />
                      <TarjetaCategoriaEsqueleto />
                    </>
                  ) : secciones.length === 0 ? (
                    <div className="rounded-[28px] bg-papel p-8 text-center">
                      <p className="font-semibold">
                        {comidas.length === 0
                          ? "Todavía no hay comidas cargadas."
                          : `No encontramos nada con “${busqueda.trim()}”.`}
                      </p>
                      {busqueda && (
                        <button
                          type="button"
                          className="mt-3 text-sm font-medium text-palmera underline"
                          onClick={() => setBusqueda("")}
                        >
                          Ver toda la carta
                        </button>
                      )}
                    </div>
                  ) : (
                    secciones.map((s) => (
                      <TarjetaCategoria
                        key={s.id}
                        id={s.id}
                        titulo={s.nombre}
                        bajada={s.bajada}
                        resaltada={s.resaltada}
                      >
                        {s.comidas.map((comida) => (
                          <FilaProducto
                            key={comida.id}
                            comida={comida}
                            cantidad={carrito.cantidadDe(comida.id)}
                            onAgregar={() => sumar(comida)}
                            onSumar={() => sumar(comida)}
                            onRestar={() => restarSimple(comida)}
                            onPersonalizar={() => abrirPersonalizar(comida)}
                            onVerDetalle={() => setDetalleId(comida.id)}
                          />
                        ))}
                      </TarjetaCategoria>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
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
        onRestar={() => detalle && restarSimple(detalle)}
        onPersonalizar={() => detalle && abrirPersonalizar(detalle)}
        onConsultar={() => consultar(detalle)}
      />

      <PersonalizarProducto
        comida={personalizando}
        maximo={
          personalizando ? Math.max(1, LIMITES.unidadesPorProducto - carrito.cantidadDe(personalizando.id)) : 1
        }
        onCerrar={() => setPersonalizandoId(null)}
        onAgregar={(config, cantidad) => {
          if (personalizando && sumar(personalizando, config, cantidad)) setPersonalizandoId(null);
        }}
      />

      <Carrito
        abierto={carritoAbierto}
        onCerrar={cerrarCarrito}
        lineas={lineas}
        total={total}
        onSumar={sumarLinea}
        onRestar={restarLinea}
        onEliminar={eliminar}
        onVaciar={() => {
          carrito.vaciar();
          toast("Vaciaste el pedido");
        }}
        onEnviar={enviarPedido}
        enviando={enviando}
        cerrado={local.abierto ? null : textoApertura(local)}
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
