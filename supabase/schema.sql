-- =====================================================================
-- Las Palmeras Club · Esquema completo de Supabase
-- Pegá este archivo entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr: usa "if not exists" / "create or replace"
-- y borra las políticas antes de crearlas de nuevo. En una base creada
-- con una versión anterior, también la migra (turnos, cobros, caja,
-- gastos y cuentas corrientes).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Turnos del negocio:
--   noche    → la carta online (pedidos por WhatsApp) y las ventas de la noche
--   mediodia → menú del mediodía, solo de uso interno (no aparece en la carta)

create table if not exists public.categorias (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  orden  int  not null default 0,
  turno  text not null default 'noche'
);

alter table public.categorias add column if not exists turno text not null default 'noche';
alter table public.categorias drop constraint if exists categorias_turno_check;
alter table public.categorias add constraint categorias_turno_check check (turno in ('noche', 'mediodia'));
-- El nombre se repite solo entre turnos distintos ("Bebidas" puede estar en los dos)
alter table public.categorias drop constraint if exists categorias_nombre_key;
create unique index if not exists categorias_turno_nombre_idx on public.categorias (turno, nombre);

create table if not exists public.comidas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (length(btrim(nombre)) between 1 and 120),
  descripcion  text check (descripcion is null or length(descripcion) <= 1000),
  precio       numeric(12,2) not null check (precio > 0),
  precio_promo numeric(12,2) check (precio_promo is null or (precio_promo > 0 and precio_promo < precio)),
  -- "restrict": no se puede borrar una categoría que todavía tiene comidas
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  imagen_url   text,
  imagen_path  text,          -- ruta dentro del bucket "comidas", para poder borrarla
  destacado    boolean not null default false,
  activo       boolean not null default true,
  -- Opciones para personalizar el pedido (todas opcionales):
  --   variantes: [{ "nombre": "Simple", "precio": 8500 }, ...]  (si hay, el precio sale de acá)
  --   quitar:    ["Cebolla", "Tomate"]                          (ingredientes que se pueden sacar)
  --   agregar:   [{ "nombre": "Huevo", "precio": 1000 }, ...]   (extras con costo)
  --   pregunta:  "¿Para cuántas personas?"                     (título de las variantes en la carta)
  opciones     jsonb not null default '{}'::jsonb check (jsonb_typeof(opciones) = 'object'),
  -- Lo copia un trigger desde la categoría: no hace falta mandarlo
  turno        text not null default 'noche',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Para bases creadas con una versión anterior de este archivo
alter table public.comidas
  add column if not exists opciones jsonb not null default '{}'::jsonb;
alter table public.comidas add column if not exists turno text not null default 'noche';
alter table public.comidas drop constraint if exists comidas_turno_check;
alter table public.comidas add constraint comidas_turno_check check (turno in ('noche', 'mediodia'));

-- El local no maneja stock: se quita la columna de versiones anteriores.
-- Para ocultar una comida que no hay, se desactiva desde el panel.
alter table public.comidas drop column if exists stock;

create index if not exists comidas_categoria_idx on public.comidas (categoria_id);

-- Clientes con cuenta corriente (fiado)
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) between 1 and 80),
  telefono       text check (telefono is null or length(telefono) <= 30),
  documento      text check (documento is null or length(documento) <= 20),   -- DNI / CUIT
  notas          text check (notas is null or length(notas) <= 300),
  limite_credito numeric(12,2) check (limite_credito is null or limite_credito >= 0),
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.ventas (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity unique,  -- número de pedido legible
  created_at       timestamptz not null default now(),
  -- pendiente → en_preparacion → enviado → entregado → cerrado (cobrado)
  estado           text not null default 'pendiente',
  total            numeric(12,2) not null default 0 check (total >= 0),
  cliente_nombre   text check (cliente_nombre is null or length(cliente_nombre) <= 80),
  cliente_telefono text check (cliente_telefono is null or cliente_telefono ~ '^[0-9]{8,15}$'),
  nota             text check (nota is null or length(nota) <= 300),
  origen           text not null default 'web' check (origen in ('web', 'manual')),
  turno            text not null default 'noche',
  cerrada_at       timestamptz          -- cuándo se cobró
);

alter table public.ventas add column if not exists turno text not null default 'noche';
alter table public.ventas add column if not exists cliente_telefono text;
alter table public.ventas add column if not exists cerrada_at timestamptz;
alter table public.ventas drop constraint if exists ventas_turno_check;
alter table public.ventas add constraint ventas_turno_check check (turno in ('noche', 'mediodia'));
alter table public.ventas drop constraint if exists ventas_cliente_telefono_check;
alter table public.ventas add constraint ventas_cliente_telefono_check
  check (cliente_telefono is null or cliente_telefono ~ '^[0-9]{8,15}$');

-- Estados del pedido. Las bases anteriores usaban confirmada/cancelada:
-- se pasan a cerrado/cancelado antes de poner la regla nueva.
alter table public.ventas drop constraint if exists ventas_estado_check;
update public.ventas set estado = 'cerrado'   where estado = 'confirmada';
update public.ventas set estado = 'cancelado' where estado = 'cancelada';
-- Los pedidos cancelados se eliminan solos (ver trigger más abajo)
delete from public.ventas where estado = 'cancelado';
update public.ventas set cerrada_at = created_at where estado = 'cerrado' and cerrada_at is null;
alter table public.ventas add constraint ventas_estado_check
  check (estado in ('pendiente', 'en_preparacion', 'enviado', 'entregado', 'cerrado', 'cancelado'));

create index if not exists ventas_created_at_idx on public.ventas (created_at desc);
create index if not exists ventas_estado_idx on public.ventas (estado);
create index if not exists ventas_turno_idx on public.ventas (turno, created_at desc);

create table if not exists public.venta_items (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas (id) on delete cascade,
  comida_id       uuid references public.comidas (id) on delete set null,
  nombre          text not null,              -- copia del nombre al momento de la venta
  detalle         text,                       -- opción elegida, ingredientes sacados, extras, aclaración
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  cantidad        int not null check (cantidad > 0),
  subtotal        numeric(12,2) not null check (subtotal >= 0)
);

alter table public.venta_items add column if not exists detalle text;

create index if not exists venta_items_venta_idx on public.venta_items (venta_id);
create index if not exists venta_items_comida_idx on public.venta_items (comida_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Horario de atención por turno: un turno por día (0 = domingo … 6 = sábado),
-- en hora de Argentina. El de la noche es el que controla la carta online.
--   desde < hasta  → turno normal (ej. 11:00 a 15:00)
--   desde > hasta  → cruza la medianoche (ej. 20:00 a 01:00)
--   desde = hasta  → abierto todo el día
create table if not exists public.horarios (
  turno   text not null default 'noche' check (turno in ('noche', 'mediodia')),
  dia     smallint not null check (dia between 0 and 6),
  abierto boolean not null default true,
  desde   time not null default '00:00',
  hasta   time not null default '00:00',
  primary key (turno, dia)
);

-- Bases anteriores: la clave era solo el día
alter table public.horarios add column if not exists turno text not null default 'noche';
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.horarios'::regclass and contype = 'p'
                and array_length(conkey, 1) = 1) then
    alter table public.horarios drop constraint horarios_pkey;
    alter table public.horarios add primary key (turno, dia);
  end if;
end;
$$;
alter table public.horarios drop constraint if exists horarios_turno_check;
alter table public.horarios add constraint horarios_turno_check check (turno in ('noche', 'mediodia'));

insert into public.horarios (turno, dia)
select 'noche', d from generate_series(0, 6) as d
on conflict (turno, dia) do nothing;

insert into public.horarios (turno, dia, desde, hasta)
select 'mediodia', d, '11:30', '15:30' from generate_series(0, 6) as d
on conflict (turno, dia) do nothing;

-- Menú del mediodía: qué platos salen cada día (cronograma)
create table if not exists public.menu_dia (
  fecha     date not null,
  comida_id uuid not null references public.comidas (id) on delete cascade,
  orden     int  not null default 0,
  primary key (fecha, comida_id)
);

-- Caja: cada fila es un arqueo (apertura → cierre). Solo una abierta a la vez.
-- Un arqueo cerrado ya no se puede editar (si hubo un error, se borra).
create table if not exists public.cajas (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity unique,
  estado           text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  turno            text check (turno is null or turno in ('noche', 'mediodia')),
  abierta_at       timestamptz not null default now(),
  abierta_por      text,
  monto_inicial    numeric(12,2) not null default 0 check (monto_inicial >= 0),
  cerrada_at       timestamptz,
  cerrada_por      text,
  efectivo_contado numeric(12,2) check (efectivo_contado is null or efectivo_contado >= 0),
  conteo           jsonb not null default '{}'::jsonb check (jsonb_typeof(conteo) = 'object'),
  resumen          jsonb,                 -- foto de los totales al cerrar
  nota             text check (nota is null or length(nota) <= 500)
);

create unique index if not exists cajas_una_abierta_idx on public.cajas ((estado)) where estado = 'abierta';
create index if not exists cajas_abierta_at_idx on public.cajas (abierta_at desc);

-- Cobros. Cada venta cobrada tiene uno o más pagos (se pueden combinar):
--   concepto 'venta'        → cobro de una venta (efectivo, transferencia o a cuenta corriente)
--   concepto 'cobro_cuenta' → el cliente paga (en efectivo o transferencia) lo que debe en su cuenta
create table if not exists public.pagos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venta_id   uuid references public.ventas (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete restrict,
  caja_id    uuid references public.cajas (id) on delete set null,
  metodo     text not null check (metodo in ('efectivo', 'transferencia', 'cuenta_corriente')),
  monto      numeric(12,2) not null check (monto > 0),
  concepto   text not null default 'venta' check (concepto in ('venta', 'cobro_cuenta')),
  nota       text check (nota is null or length(nota) <= 200),
  constraint pagos_coherentes check (
    (concepto = 'venta' and venta_id is not null
       and (metodo <> 'cuenta_corriente' or cliente_id is not null))
    or
    (concepto = 'cobro_cuenta' and venta_id is null and cliente_id is not null
       and metodo <> 'cuenta_corriente')
  )
);

create index if not exists pagos_created_at_idx on public.pagos (created_at desc);
create index if not exists pagos_venta_idx on public.pagos (venta_id);
create index if not exists pagos_cliente_idx on public.pagos (cliente_id);
create index if not exists pagos_caja_idx on public.pagos (caja_id);

-- Ingresos y retiros de efectivo de la caja que no son ventas
-- (cambio que se agrega, retiro del dueño, etc.)
create table if not exists public.caja_movimientos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  caja_id    uuid not null references public.cajas (id) on delete cascade,
  tipo       text not null check (tipo in ('ingreso', 'retiro')),
  concepto   text not null check (length(btrim(concepto)) between 1 and 120),
  monto      numeric(12,2) not null check (monto > 0)
);

create index if not exists caja_movimientos_caja_idx on public.caja_movimientos (caja_id);

-- Gastos y costos del negocio
create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  fecha       date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  categoria   text not null check (length(btrim(categoria)) between 1 and 60),
  tipo        text not null default 'variable' check (tipo in ('fijo', 'variable')),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 200),
  proveedor   text check (proveedor is null or length(proveedor) <= 120),
  comprobante text check (comprobante is null or length(comprobante) <= 60),
  monto       numeric(12,2) not null check (monto > 0),
  -- pagado: ya salió la plata · pendiente: factura a pagar (cuenta en "por pagar")
  estado      text not null default 'pagado' check (estado in ('pagado', 'pendiente')),
  vencimiento date,
  metodo      text check (metodo is null or metodo in ('efectivo', 'transferencia', 'tarjeta')),
  -- si se pagó en efectivo con la plata de la caja abierta, descuenta del arqueo
  caja_id     uuid references public.cajas (id) on delete set null,
  constraint gastos_pagado_con_metodo check (estado = 'pendiente' or metodo is not null),
  constraint gastos_caja_solo_efectivo check (caja_id is null or (metodo = 'efectivo' and estado = 'pagado'))
);

create index if not exists gastos_fecha_idx on public.gastos (fecha desc);
create index if not exists gastos_caja_idx on public.gastos (caja_id);

-- ---------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comidas_updated_at on public.comidas;
create trigger comidas_updated_at
  before update on public.comidas
  for each row execute function public.tocar_updated_at();

-- La comida toma el turno de su categoría (noche o mediodía)
create or replace function public._turno_de_categoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.turno into new.turno from public.categorias c where c.id = new.categoria_id;
  return new;
end;
$$;

drop trigger if exists comidas_turno on public.comidas;
create trigger comidas_turno
  before insert or update of categoria_id on public.comidas
  for each row execute function public._turno_de_categoria();

update public.comidas c set turno = k.turno
  from public.categorias k
 where k.id = c.categoria_id and c.turno <> k.turno;

-- Un pedido que pasa a "cancelado" se elimina automáticamente
create or replace function public._eliminar_cancelado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ventas where id = new.id;
  return null;
end;
$$;

drop trigger if exists ventas_eliminar_cancelado on public.ventas;
create trigger ventas_eliminar_cancelado
  after insert or update of estado on public.ventas
  for each row when (new.estado = 'cancelado')
  execute function public._eliminar_cancelado();

-- Una venta solo se cierra registrando el cobro, y una cobrada no se reabre
-- sin anular el cobro (así los números de caja siempre cierran)
create or replace function public._controlar_cierre_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'cerrado' and old.estado <> 'cerrado'
     and not exists (select 1 from public.pagos where venta_id = new.id) then
    raise exception 'Para cerrar la cuenta registrá el cobro (efectivo, transferencia o cuenta corriente).';
  end if;
  if old.estado = 'cerrado' and new.estado <> 'cerrado'
     and exists (select 1 from public.pagos where venta_id = new.id) then
    raise exception 'Esta venta ya está cobrada. Para cambiarla, primero anulá el cobro.';
  end if;
  return new;
end;
$$;

drop trigger if exists ventas_controlar_cierre on public.ventas;
create trigger ventas_controlar_cierre
  before update of estado on public.ventas
  for each row execute function public._controlar_cierre_venta();

-- Un arqueo cerrado no se edita (sí se puede borrar)
create or replace function public._bloquear_arqueo_cerrado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado = 'cerrada' then
    raise exception 'Este arqueo está cerrado y ya no se puede editar. Si hubo un error, podés borrarlo.';
  end if;
  return new;
end;
$$;

drop trigger if exists cajas_bloquear_cerrada on public.cajas;
create trigger cajas_bloquear_cerrada
  before update on public.cajas
  for each row execute function public._bloquear_arqueo_cerrado();

-- Los movimientos de un arqueo cerrado (cobros, ingresos, retiros y gastos
-- pagados con la caja) tampoco se pueden tocar.
create or replace function public._bloquear_movimiento_cerrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.caja_id is not null
     and exists (select 1 from public.cajas where id = old.caja_id and estado = 'cerrada') then
    raise exception 'Este movimiento es parte de un arqueo cerrado y ya no se puede modificar ni borrar.';
  end if;
  if tg_op <> 'DELETE' and new.caja_id is not null
     and exists (select 1 from public.cajas where id = new.caja_id and estado = 'cerrada') then
    raise exception 'Ese arqueo ya está cerrado: no se le pueden sumar movimientos.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_bloquear_cerrado on public.pagos;
create trigger pagos_bloquear_cerrado
  before insert or update or delete on public.pagos
  for each row execute function public._bloquear_movimiento_cerrado();

drop trigger if exists caja_movimientos_bloquear_cerrado on public.caja_movimientos;
create trigger caja_movimientos_bloquear_cerrado
  before insert or update or delete on public.caja_movimientos
  for each row execute function public._bloquear_movimiento_cerrado();

drop trigger if exists gastos_bloquear_cerrado on public.gastos;
create trigger gastos_bloquear_cerrado
  before insert or update or delete on public.gastos
  for each row execute function public._bloquear_movimiento_cerrado();

-- ---------------------------------------------------------------------
-- 3. es_admin() y horario
-- security definer: lee "admins" sin pasar por RLS (evita recursión).
-- ---------------------------------------------------------------------

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ¿La carta (turno noche) está abierta en este momento?
create or replace function public.local_abierto(p_momento timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local timestamp := p_momento at time zone 'America/Argentina/Buenos_Aires';
  v_dia   int  := extract(dow from v_local)::int;
  v_hora  time := v_local::time;
  h       public.horarios%rowtype;
begin
  -- Sin horarios cargados: siempre abierto
  if not exists (select 1 from public.horarios where turno = 'noche') then
    return true;
  end if;

  -- Turno de hoy
  select * into h from public.horarios where turno = 'noche' and dia = v_dia;
  if found and h.abierto then
    if h.desde = h.hasta then
      return true;                                         -- todo el día
    elsif h.desde < h.hasta and v_hora >= h.desde and v_hora < h.hasta then
      return true;
    elsif h.desde > h.hasta and v_hora >= h.desde then
      return true;                                         -- turno que sigue después de las 00
    end if;
  end if;

  -- Lo que queda del turno de ayer, si cruzó la medianoche
  select * into h from public.horarios where turno = 'noche' and dia = (v_dia + 6) % 7;
  if found and h.abierto and h.desde > h.hasta and v_hora < h.hasta then
    return true;
  end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Funciones internas (no se pueden llamar desde el cliente)
-- ---------------------------------------------------------------------

-- Funciones de versiones anteriores (manejaban stock o cambiaron de firma)
drop function if exists public.confirmar_venta(uuid);
drop function if exists public.cancelar_venta(uuid);
drop function if exists public._descontar_stock(uuid);
drop function if exists public._devolver_stock(uuid);
drop function if exists public._crear_venta(jsonb, text, text, text, boolean);
drop function if exists public._crear_venta(jsonb, text, text, text, boolean, text);
drop function if exists public.crear_pedido(jsonb, text, text);
drop function if exists public.registrar_venta_manual(jsonb, text, text);

-- Agrega ítems a una venta tomando los precios de la base.
-- p_items: [{ "comida_id": "<uuid>", "cantidad": 2,
--             "variante": "Doble", "quitar": ["Cebolla"], "agregar": ["Huevo"],
--             "aclaracion": "bien cocida" }, ...]
-- Solo comida_id y cantidad son obligatorios. Cada combinación distinta
-- (por ejemplo una doble sin cebolla) es una línea aparte.
-- p_solo_activas = pedido web: solo comidas activas de la carta (turno noche).
create or replace function public._agregar_items(
  p_venta_id uuid,
  p_items jsonb,
  p_solo_activas boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  c          public.comidas%rowtype;
  v_precio   numeric(12,2);
  v_var      jsonb;
  v_extra    jsonb;
  v_texto    text;
  v_quitar   text[];
  v_agregar  text[];
  v_partes   text[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El formato del pedido no es válido.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;

  begin
    for r in
      select x.comida_id, x.cantidad,
             nullif(btrim(x.variante), '') as variante,
             coalesce(x.quitar, '[]'::jsonb) as quitar,
             coalesce(x.agregar, '[]'::jsonb) as agregar,
             nullif(btrim(x.aclaracion), '') as aclaracion
      from jsonb_to_recordset(p_items)
           as x (comida_id uuid, cantidad int, variante text, quitar jsonb, agregar jsonb, aclaracion text)
    loop
      if r.comida_id is null or r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Hay un producto con datos inválidos en el pedido.';
      end if;
      if r.cantidad > 50 then
        raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
      end if;
      if jsonb_typeof(r.quitar) <> 'array' or jsonb_typeof(r.agregar) <> 'array'
         or jsonb_array_length(r.quitar) > 20 or jsonb_array_length(r.agregar) > 10 then
        raise exception 'Las opciones del pedido no son válidas.';
      end if;
      if r.aclaracion is not null and length(r.aclaracion) > 80 then
        raise exception 'La aclaración es demasiado larga (máximo 80 caracteres).';
      end if;

      select * into c from public.comidas where id = r.comida_id;
      if not found or (p_solo_activas and (not c.activo or c.turno <> 'noche')) then
        raise exception 'Un producto del pedido ya no está disponible. Actualizá la página e intentá de nuevo.';
      end if;

      v_precio  := coalesce(c.precio_promo, c.precio);   -- el precio sale de la base, nunca del cliente
      v_partes  := '{}';
      v_quitar  := '{}';
      v_agregar := '{}';

      -- Variante: si el producto tiene, su precio reemplaza al base (sin elegir, vale la primera)
      if jsonb_typeof(c.opciones -> 'variantes') = 'array' and jsonb_array_length(c.opciones -> 'variantes') > 0 then
        if r.variante is null then
          v_var := (c.opciones -> 'variantes') -> 0;
        else
          v_var := null;
          select e into v_var
            from jsonb_array_elements(c.opciones -> 'variantes') e
           where e ->> 'nombre' = r.variante
           limit 1;
          if v_var is null then
            raise exception 'La opción "%" ya no está disponible para "%". Actualizá la página.', r.variante, c.nombre;
          end if;
        end if;
        v_precio := (v_var ->> 'precio')::numeric;
        v_partes := v_partes || (v_var ->> 'nombre');
      elsif r.variante is not null then
        raise exception 'La opción "%" ya no está disponible para "%". Actualizá la página.', r.variante, c.nombre;
      end if;

      -- Ingredientes que se sacan (sin costo)
      for v_texto in select distinct jsonb_array_elements_text(r.quitar) loop
        if not (coalesce(c.opciones -> 'quitar', '[]'::jsonb) ? v_texto) then
          raise exception '"%" no se puede sacar de "%". Actualizá la página.', v_texto, c.nombre;
        end if;
        v_quitar := v_quitar || v_texto;
      end loop;
      if array_length(v_quitar, 1) > 0 then
        v_partes := v_partes || ('sin ' || array_to_string(v_quitar, ', '));
      end if;

      -- Extras (suman al precio)
      for v_texto in select distinct jsonb_array_elements_text(r.agregar) loop
        v_extra := null;
        select e into v_extra
          from jsonb_array_elements(coalesce(c.opciones -> 'agregar', '[]'::jsonb)) e
         where e ->> 'nombre' = v_texto
         limit 1;
        if v_extra is null then
          raise exception '"%" no se puede agregar a "%". Actualizá la página.', v_texto, c.nombre;
        end if;
        v_precio  := v_precio + (v_extra ->> 'precio')::numeric;
        -- precio 0 = el local confirma el precio por WhatsApp
        v_agregar := v_agregar || ((v_extra ->> 'nombre')
                     || case when (v_extra ->> 'precio')::numeric = 0 then ' (precio a confirmar)' else '' end);
      end loop;
      if array_length(v_agregar, 1) > 0 then
        v_partes := v_partes || ('extra ' || array_to_string(v_agregar, ', '));
      end if;

      if r.aclaracion is not null then
        v_partes := v_partes || ('"' || r.aclaracion || '"');
      end if;

      insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
      values (p_venta_id, c.id, c.nombre, nullif(array_to_string(v_partes, ' · '), ''),
              v_precio, r.cantidad, v_precio * r.cantidad);
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;
end;
$$;

-- Controla los límites del pedido y recalcula el total con sus ítems.
create or replace function public._recalcular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lineas   int;
  v_unidades int;
  v_total    numeric(12,2);
begin
  select count(*), coalesce(sum(cantidad), 0), coalesce(sum(subtotal), 0)
    into v_lineas, v_unidades, v_total
    from public.venta_items
   where venta_id = p_venta_id;

  if v_lineas = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if v_lineas > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;
  if v_unidades > 100 then
    raise exception 'El pedido supera el máximo de 100 unidades.';
  end if;
  if exists (select 1 from public.venta_items
              where venta_id = p_venta_id
              group by comida_id
             having sum(cantidad) > 50) then
    raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
  end if;

  update public.ventas set total = v_total where id = p_venta_id;
end;
$$;

-- "3884131570" / "+54 9 388 413-1570" → "5493884131570" (o null si no hay número)
create or replace function public._normalizar_telefono(p_telefono text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  v := regexp_replace(v, '^00', '');
  if v !~ '^54' then
    v := '549' || regexp_replace(v, '^0', '');
  end if;
  if length(v) < 10 or length(v) > 15 then
    raise exception 'El número de WhatsApp no es válido. Escribilo con código de área, por ejemplo 388 4131570.';
  end if;
  return v;
end;
$$;

-- Crea una venta con sus ítems y devuelve su id.
create or replace function public._crear_venta(
  p_items jsonb,
  p_cliente_nombre text,
  p_nota text,
  p_origen text,
  p_solo_activas boolean,
  p_estado text,
  p_turno text,
  p_telefono text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta_id uuid;
  v_cliente  text := nullif(btrim(coalesce(p_cliente_nombre, '')), '');
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;
  if p_turno is null or p_turno not in ('noche', 'mediodia') then
    raise exception 'Elegí el turno de la venta (noche o mediodía).';
  end if;

  insert into public.ventas (estado, total, cliente_nombre, cliente_telefono, nota, origen, turno)
  values (p_estado, 0, v_cliente, public._normalizar_telefono(p_telefono), v_nota, p_origen, p_turno)
  returning id into v_venta_id;

  perform public._agregar_items(v_venta_id, p_items, p_solo_activas);
  perform public._recalcular_venta(v_venta_id);
  return v_venta_id;
end;
$$;

create or replace function public._caja_abierta()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.cajas where estado = 'abierta' limit 1;
$$;

-- Saldo de la cuenta corriente: lo que se cargó a cuenta menos lo que pagó
create or replace function public._saldo_cliente(p_cliente_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when metodo = 'cuenta_corriente' then monto
                           when concepto = 'cobro_cuenta' then -monto
                           else 0 end), 0)
    from public.pagos
   where cliente_id = p_cliente_id;
$$;

create or replace function public._pesos(p numeric)
returns text
language sql
immutable
as $$
  select '$ ' || trim(to_char(p, '999999999990.00'));
$$;

-- Registra el cobro de una venta y la deja cerrada.
-- p_pagos: [{ "metodo": "efectivo", "monto": 5000 },
--           { "metodo": "cuenta_corriente", "monto": null, "cliente_id": "<uuid>" }]
-- Un pago con monto null se lleva lo que falta para completar el total.
-- Efectivo y transferencia necesitan la caja abierta (quedan en ese arqueo).
create or replace function public._cobrar(p_venta_id uuid, p_pagos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v          public.ventas%rowtype;
  r          record;
  v_suma     numeric(12,2) := 0;
  v_sin_monto int := 0;
  v_cc_cli   uuid;
  v_cc_monto numeric(12,2) := 0;
  v_caja     uuid;
  v_con_caja boolean := false;
  v_cli      public.clientes%rowtype;
  v_lista    jsonb := '[]'::jsonb;
  v_monto    numeric(12,2);
begin
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v.estado = 'cerrado' then
    raise exception 'Esta cuenta ya está cobrada.';
  end if;
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indicá cómo se pagó.';
  end if;
  if jsonb_array_length(p_pagos) > 3 then
    raise exception 'Se pueden combinar hasta 3 formas de pago.';
  end if;

  begin
    for r in select x.metodo, x.monto, x.cliente_id
               from jsonb_to_recordset(p_pagos) as x (metodo text, monto numeric, cliente_id uuid) loop
      if r.metodo is null or r.metodo not in ('efectivo', 'transferencia', 'cuenta_corriente') then
        raise exception 'Forma de pago no válida.';
      end if;
      if r.monto is null then
        v_sin_monto := v_sin_monto + 1;
      elsif r.monto <= 0 then
        raise exception 'Cada pago tiene que tener un monto mayor a 0.';
      else
        v_suma := v_suma + round(r.monto, 2);
      end if;
      if r.metodo = 'cuenta_corriente' then
        if r.cliente_id is null then
          raise exception 'Elegí el cliente de la cuenta corriente.';
        end if;
        if v_cc_cli is not null and v_cc_cli <> r.cliente_id then
          raise exception 'Solo se puede cargar a una cuenta corriente por venta.';
        end if;
        v_cc_cli := r.cliente_id;
      else
        v_con_caja := true;
      end if;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pago no es válido.';
  end;

  if v_sin_monto > 1 then
    raise exception 'Solo una forma de pago puede quedar sin monto (se lleva el resto).';
  end if;
  if v_sin_monto = 1 and v_suma >= v.total then
    raise exception 'Los montos ya cubren el total: sacá la forma de pago que sobra.';
  end if;
  if v_sin_monto = 0 and v_suma <> v.total then
    raise exception 'Los pagos suman % y el total de la cuenta es %.', public._pesos(v_suma), public._pesos(v.total);
  end if;

  -- Arma la lista final (completa el pago sin monto)
  for r in select x.metodo, x.monto, x.cliente_id
             from jsonb_to_recordset(p_pagos) as x (metodo text, monto numeric, cliente_id uuid) loop
    v_monto := coalesce(round(r.monto, 2), v.total - v_suma);
    if r.metodo = 'cuenta_corriente' then
      v_cc_monto := v_cc_monto + v_monto;
    end if;
    v_lista := v_lista || jsonb_build_object('metodo', r.metodo, 'monto', v_monto,
                                             'cliente_id', case when r.metodo = 'cuenta_corriente' then r.cliente_id end);
  end loop;

  if v_cc_cli is not null then
    select * into v_cli from public.clientes where id = v_cc_cli;
    if not found or not v_cli.activo then
      raise exception 'El cliente de la cuenta corriente no existe o está dado de baja.';
    end if;
    if v_cli.limite_credito is not null
       and public._saldo_cliente(v_cc_cli) + v_cc_monto > v_cli.limite_credito then
      raise exception 'Con esta venta, la cuenta de % supera su límite de crédito (%).',
        v_cli.nombre, public._pesos(v_cli.limite_credito);
    end if;
  end if;

  v_caja := public._caja_abierta();
  if v_con_caja and v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para registrar cobros en efectivo o por transferencia.';
  end if;

  insert into public.pagos (venta_id, cliente_id, caja_id, metodo, monto, concepto)
  select p_venta_id, x.cliente_id, v_caja, x.metodo, x.monto, 'venta'
    from jsonb_to_recordset(v_lista) as x (metodo text, monto numeric, cliente_id uuid);

  update public.ventas
     set estado = 'cerrado',
         cerrada_at = now(),
         cliente_nombre = coalesce(cliente_nombre, v_cli.nombre)
   where id = p_venta_id;
end;
$$;

-- Totales de un arqueo (en vivo mientras está abierto; al cerrar se guarda una copia)
create or replace function public._resumen_caja(p_caja_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c   public.cajas%rowtype;
  res jsonb;
begin
  select * into c from public.cajas where id = p_caja_id;
  if not found then
    raise exception 'El arqueo no existe.';
  end if;

  with p as (
    select * from public.pagos where caja_id = p_caja_id
  ), t as (
    select
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'efectivo'), 0)          as ventas_efectivo,
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'transferencia'), 0)     as ventas_transferencia,
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'cuenta_corriente'), 0)  as ventas_cuenta_corriente,
      coalesce(sum(monto) filter (where concepto = 'cobro_cuenta' and metodo = 'efectivo'), 0)      as cobros_cuenta_efectivo,
      coalesce(sum(monto) filter (where concepto = 'cobro_cuenta' and metodo = 'transferencia'), 0) as cobros_cuenta_transferencia,
      count(distinct venta_id) as cantidad_ventas
    from p
  ), m as (
    select
      coalesce(sum(monto) filter (where tipo = 'ingreso'), 0) as ingresos,
      coalesce(sum(monto) filter (where tipo = 'retiro'), 0)  as retiros
    from public.caja_movimientos where caja_id = p_caja_id
  ), g as (
    select coalesce(sum(monto), 0) as gastos_efectivo
      from public.gastos where caja_id = p_caja_id
  ), x as (
    select coalesce(sum(v.total) filter (where v.turno = 'noche'), 0)    as vendido_noche,
           coalesce(sum(v.total) filter (where v.turno = 'mediodia'), 0) as vendido_mediodia
      from public.ventas v
     where v.id in (select venta_id from p where venta_id is not null)
  )
  select jsonb_build_object(
    'monto_inicial', c.monto_inicial,
    'ventas_efectivo', t.ventas_efectivo,
    'ventas_transferencia', t.ventas_transferencia,
    'ventas_cuenta_corriente', t.ventas_cuenta_corriente,
    'cobros_cuenta_efectivo', t.cobros_cuenta_efectivo,
    'cobros_cuenta_transferencia', t.cobros_cuenta_transferencia,
    'ingresos', m.ingresos,
    'retiros', m.retiros,
    'gastos_efectivo', g.gastos_efectivo,
    'cantidad_ventas', t.cantidad_ventas,
    'vendido_noche', x.vendido_noche,
    'vendido_mediodia', x.vendido_mediodia,
    'total_vendido', t.ventas_efectivo + t.ventas_transferencia + t.ventas_cuenta_corriente,
    'total_transferencias', t.ventas_transferencia + t.cobros_cuenta_transferencia,
    'efectivo_esperado', c.monto_inicial + t.ventas_efectivo + t.cobros_cuenta_efectivo
                         + m.ingresos - m.retiros - g.gastos_efectivo
  ) into res
  from t, m, g, x;

  return res;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Funciones RPC (las que llama el frontend)
-- El cambio de estado y el borrado de pedidos los hace el panel directo
-- sobre la tabla "ventas" (las políticas RLS solo se lo permiten al admin).
-- ---------------------------------------------------------------------

-- La llama el catálogo (anónimo) justo antes de abrir WhatsApp.
-- Devuelve { numero, total, items: [{ nombre, detalle, cantidad, precio_unitario, subtotal }] }
create or replace function public.crear_pedido(
  items jsonb,
  cliente_nombre text default null,
  nota text default null,
  cliente_telefono text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.local_abierto() then
    raise exception 'Ahora estamos cerrados. Mirá el horario en la carta y hacé tu pedido cuando abramos.';
  end if;

  -- Freno simple contra abuso: como mucho 20 pedidos web por minuto en total.
  if (select count(*) from public.ventas
       where origen = 'web' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un minuto.';
  end if;

  v_id := public._crear_venta(crear_pedido.items, crear_pedido.cliente_nombre, crear_pedido.nota,
                              'web', true, 'pendiente', 'noche', crear_pedido.cliente_telefono);

  return (
    select jsonb_build_object(
      'numero', v.numero,
      'total',  v.total,
      'items',  coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', vi.nombre,
                 'detalle', vi.detalle,
                 'cantidad', vi.cantidad,
                 'precio_unitario', vi.precio_unitario,
                 'subtotal', vi.subtotal) order by vi.nombre, vi.detalle nulls first)
        from public.venta_items vi where vi.venta_id = v.id), '[]'::jsonb)
    )
    from public.ventas v where v.id = v_id
  );
end;
$$;

-- Solo admin: venta en el local (caja), de la noche o del mediodía.
--   pagos = null  → queda como cuenta abierta (mesa) y se cobra después
--   pagos = [...] → se cobra en el momento (mismo formato que cobrar_venta)
-- Permite vender comidas inactivas (ocultas en el catálogo).
create or replace function public.registrar_venta_local(
  items jsonb,
  turno text,
  cliente_nombre text default null,
  nota text default null,
  pagos jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  v_id := public._crear_venta(registrar_venta_local.items, registrar_venta_local.cliente_nombre,
                              registrar_venta_local.nota, 'manual', false, 'pendiente',
                              registrar_venta_local.turno, null);

  if registrar_venta_local.pagos is not null and jsonb_typeof(registrar_venta_local.pagos) = 'array'
     and jsonb_array_length(registrar_venta_local.pagos) > 0 then
    perform public._cobrar(v_id, registrar_venta_local.pagos);
  end if;

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'estado', v.estado)
          from public.ventas v where v.id = v_id);
end;
$$;

-- Solo admin: cobra una venta (cierra la cuenta).
create or replace function public.cobrar_venta(venta_id uuid, pagos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  perform public._cobrar(cobrar_venta.venta_id, cobrar_venta.pagos);
  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = cobrar_venta.venta_id);
end;
$$;

-- Solo admin: anula el cobro de una venta (vuelve a "entregado"). No se puede
-- si el cobro ya quedó en un arqueo cerrado.
create or replace function public.anular_cobro(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if not exists (select 1 from public.ventas v where v.id = anular_cobro.venta_id and v.estado = 'cerrado') then
    raise exception 'Esta venta no está cobrada.';
  end if;
  delete from public.pagos p where p.venta_id = anular_cobro.venta_id;
  update public.ventas v set estado = 'entregado', cerrada_at = null where v.id = anular_cobro.venta_id;
end;
$$;

-- Solo admin: edita un pedido que todavía no se cobró.
--   items:  líneas que se conservan, con su cantidad: [{ "id": "<venta_item>", "cantidad": 2 }]
--           (las que no vienen se borran; mantienen el precio con el que se pidieron)
--   nuevos: líneas para sumar, mismo formato que crear_pedido (precio actual de la base)
create or replace function public.editar_venta(
  venta_id uuid,
  items jsonb,
  nuevos jsonb default '[]'::jsonb,
  cliente_nombre text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado  text;
  v_items   jsonb := coalesce(editar_venta.items, '[]'::jsonb);
  v_nuevos  jsonb := coalesce(editar_venta.nuevos, '[]'::jsonb);
  v_cliente text := nullif(btrim(coalesce(editar_venta.cliente_nombre, '')), '');
  v_nota    text := nullif(btrim(coalesce(editar_venta.nota, '')), '');
  r         record;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select v.estado into v_estado from public.ventas v where v.id = editar_venta.venta_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v_estado = 'cerrado' then
    raise exception 'Esta venta ya está cobrada. Para modificarla, primero anulá el cobro.';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_nuevos) <> 'array' then
    raise exception 'El formato del pedido no es válido.';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;

  begin
    -- Borra las líneas que ya no están
    delete from public.venta_items vi
     where vi.venta_id = editar_venta.venta_id
       and not exists (select 1 from jsonb_array_elements(v_items) e
                        where (e ->> 'id')::uuid = vi.id);

    -- Actualiza cantidades (el precio unitario queda como estaba)
    for r in select x.id, x.cantidad from jsonb_to_recordset(v_items) as x (id uuid, cantidad int) loop
      if r.id is null or r.cantidad is null or r.cantidad <= 0 or r.cantidad > 50 then
        raise exception 'Hay un producto con una cantidad inválida.';
      end if;
      update public.venta_items vi
         set cantidad = r.cantidad,
             subtotal = vi.precio_unitario * r.cantidad
       where vi.id = r.id and vi.venta_id = editar_venta.venta_id;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;

  if jsonb_array_length(v_nuevos) > 0 then
    perform public._agregar_items(editar_venta.venta_id, v_nuevos, false);
  end if;

  update public.ventas v
     set cliente_nombre = v_cliente,
         nota = v_nota
   where v.id = editar_venta.venta_id;

  perform public._recalcular_venta(editar_venta.venta_id);

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = editar_venta.venta_id);
end;
$$;

-- Solo admin: el cliente paga (todo o parte) lo que debe en su cuenta corriente.
create or replace function public.cobrar_cuenta_corriente(
  cliente_id uuid,
  monto numeric,
  metodo text,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric(12,2);
  v_caja  uuid;
  v_nota  text := nullif(btrim(coalesce(cobrar_cuenta_corriente.nota, '')), '');
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if not exists (select 1 from public.clientes c where c.id = cobrar_cuenta_corriente.cliente_id) then
    raise exception 'El cliente no existe.';
  end if;
  if cobrar_cuenta_corriente.metodo is null or cobrar_cuenta_corriente.metodo not in ('efectivo', 'transferencia') then
    raise exception 'Elegí si paga en efectivo o por transferencia.';
  end if;
  if cobrar_cuenta_corriente.monto is null or cobrar_cuenta_corriente.monto <= 0 then
    raise exception 'El monto tiene que ser mayor a 0.';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;

  v_saldo := public._saldo_cliente(cobrar_cuenta_corriente.cliente_id);
  if round(cobrar_cuenta_corriente.monto, 2) > v_saldo then
    raise exception 'El monto (%) es mayor a lo que debe (%).',
      public._pesos(cobrar_cuenta_corriente.monto), public._pesos(v_saldo);
  end if;

  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para registrar el cobro.';
  end if;

  insert into public.pagos (cliente_id, caja_id, metodo, monto, concepto, nota)
  values (cobrar_cuenta_corriente.cliente_id, v_caja, cobrar_cuenta_corriente.metodo,
          round(cobrar_cuenta_corriente.monto, 2), 'cobro_cuenta', v_nota);

  return jsonb_build_object('saldo', public._saldo_cliente(cobrar_cuenta_corriente.cliente_id));
end;
$$;

-- Solo admin: abre la caja (empieza un arqueo).
create or replace function public.abrir_caja(
  monto_inicial numeric default 0,
  turno text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_abierta public.cajas%rowtype;
  v_id      uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into v_abierta from public.cajas where estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya hay una caja abierta (arqueo N° %). Cerrala antes de abrir otra.', v_abierta.numero;
  end if;
  if coalesce(abrir_caja.monto_inicial, 0) < 0 then
    raise exception 'El efectivo inicial no puede ser negativo.';
  end if;

  insert into public.cajas (monto_inicial, turno, nota, abierta_por)
  values (round(coalesce(abrir_caja.monto_inicial, 0), 2), abrir_caja.turno,
          nullif(btrim(coalesce(abrir_caja.nota, '')), ''), auth.jwt() ->> 'email')
  returning id into v_id;

  return (select to_jsonb(c) from public.cajas c where c.id = v_id);
end;
$$;

-- Solo admin: totales en vivo de un arqueo.
create or replace function public.resumen_caja(caja_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  return public._resumen_caja(resumen_caja.caja_id);
end;
$$;

-- Solo admin: cierra el arqueo de forma definitiva con el efectivo contado.
create or replace function public.cerrar_caja(
  caja_id uuid,
  efectivo_contado numeric,
  conteo jsonb default '{}'::jsonb,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c     public.cajas%rowtype;
  v_res jsonb;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into c from public.cajas where id = cerrar_caja.caja_id for update;
  if not found then
    raise exception 'El arqueo no existe.';
  end if;
  if c.estado = 'cerrada' then
    raise exception 'Este arqueo ya está cerrado.';
  end if;
  if cerrar_caja.efectivo_contado is null or cerrar_caja.efectivo_contado < 0 then
    raise exception 'Ingresá el efectivo que contaste en la caja.';
  end if;

  v_res := public._resumen_caja(c.id);
  v_res := v_res || jsonb_build_object(
    'efectivo_contado', round(cerrar_caja.efectivo_contado, 2),
    'diferencia', round(cerrar_caja.efectivo_contado, 2) - (v_res ->> 'efectivo_esperado')::numeric);

  update public.cajas
     set estado = 'cerrada',
         cerrada_at = now(),
         cerrada_por = auth.jwt() ->> 'email',
         efectivo_contado = round(cerrar_caja.efectivo_contado, 2),
         conteo = coalesce(cerrar_caja.conteo, '{}'::jsonb),
         resumen = v_res,
         nota = coalesce(nullif(btrim(coalesce(cerrar_caja.nota, '')), ''), c.nota)
   where id = c.id;

  return (select to_jsonb(x) from public.cajas x where x.id = c.id);
end;
$$;

-- Solo admin: suma a la caja abierta los cobros que quedaron sin arqueo
-- (por ejemplo, porque se borró el arqueo en el que estaban).
create or replace function public.asignar_cobros_sin_caja()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja uuid;
  v_n    int;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'No hay una caja abierta.';
  end if;
  update public.pagos set caja_id = v_caja where caja_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Saldos de las cuentas corrientes (respeta las políticas RLS de quien consulta)
drop view if exists public.clientes_saldos;
create view public.clientes_saldos
with (security_invoker = true)
as
select c.id, c.nombre, c.telefono, c.documento, c.notas, c.limite_credito, c.activo, c.created_at,
       coalesce(s.cargado, 0) as total_cargado,
       coalesce(s.pagado, 0)  as total_pagado,
       coalesce(s.cargado, 0) - coalesce(s.pagado, 0) as saldo,
       s.ultimo_movimiento
  from public.clientes c
  left join (
    select p.cliente_id,
           sum(p.monto) filter (where p.metodo = 'cuenta_corriente') as cargado,
           sum(p.monto) filter (where p.concepto = 'cobro_cuenta')   as pagado,
           max(p.created_at) as ultimo_movimiento
      from public.pagos p
     where p.cliente_id is not null
     group by p.cliente_id
  ) s on s.cliente_id = c.id;

-- Permisos de ejecución: por defecto Postgres deja ejecutar a todos.
revoke execute on function public._agregar_items(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._recalcular_venta(uuid) from public, anon, authenticated;
revoke execute on function public._crear_venta(jsonb, text, text, text, boolean, text, text, text) from public, anon, authenticated;
revoke execute on function public._normalizar_telefono(text) from public, anon, authenticated;
revoke execute on function public._caja_abierta() from public, anon, authenticated;
revoke execute on function public._saldo_cliente(uuid) from public, anon, authenticated;
revoke execute on function public._cobrar(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._resumen_caja(uuid) from public, anon, authenticated;
revoke execute on function public._turno_de_categoria() from public, anon, authenticated;
revoke execute on function public._eliminar_cancelado() from public, anon, authenticated;
revoke execute on function public._controlar_cierre_venta() from public, anon, authenticated;
revoke execute on function public._bloquear_movimiento_cerrado() from public, anon, authenticated;
revoke execute on function public.registrar_venta_local(jsonb, text, text, text, jsonb) from public, anon;
revoke execute on function public.cobrar_venta(uuid, jsonb) from public, anon;
revoke execute on function public.anular_cobro(uuid) from public, anon;
revoke execute on function public.editar_venta(uuid, jsonb, jsonb, text, text) from public, anon;
revoke execute on function public.cobrar_cuenta_corriente(uuid, numeric, text, text) from public, anon;
revoke execute on function public.abrir_caja(numeric, text, text) from public, anon;
revoke execute on function public.resumen_caja(uuid) from public, anon;
revoke execute on function public.cerrar_caja(uuid, numeric, jsonb, text) from public, anon;
revoke execute on function public.asignar_cobros_sin_caja() from public, anon;

grant execute on function public.es_admin() to anon, authenticated;   -- lo usan las políticas RLS
grant execute on function public.local_abierto(timestamptz) to anon, authenticated;
grant execute on function public.crear_pedido(jsonb, text, text, text) to anon, authenticated;
grant execute on function public.registrar_venta_local(jsonb, text, text, text, jsonb) to authenticated;
grant execute on function public.cobrar_venta(uuid, jsonb) to authenticated;
grant execute on function public.anular_cobro(uuid) to authenticated;
grant execute on function public.editar_venta(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.cobrar_cuenta_corriente(uuid, numeric, text, text) to authenticated;
grant execute on function public.abrir_caja(numeric, text, text) to authenticated;
grant execute on function public.resumen_caja(uuid) to authenticated;
grant execute on function public.cerrar_caja(uuid, numeric, jsonb, text) to authenticated;
grant execute on function public.asignar_cobros_sin_caja() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------

alter table public.categorias       enable row level security;
alter table public.comidas          enable row level security;
alter table public.ventas           enable row level security;
alter table public.venta_items      enable row level security;
alter table public.admins           enable row level security;
alter table public.horarios         enable row level security;
alter table public.clientes         enable row level security;
alter table public.menu_dia         enable row level security;
alter table public.cajas            enable row level security;
alter table public.pagos            enable row level security;
alter table public.caja_movimientos enable row level security;
alter table public.gastos           enable row level security;

-- Defensa extra: el rol anónimo no toca ventas, plata ni admins de forma directa.
revoke all on public.ventas, public.venta_items, public.admins, public.clientes, public.menu_dia,
              public.cajas, public.pagos, public.caja_movimientos, public.gastos from anon;
revoke all on public.clientes_saldos from anon;
revoke insert, update, delete on public.admins from authenticated;
-- Los cobros y los arqueos se crean y se cierran solo con las funciones de arriba
revoke insert, update on public.pagos from authenticated;

-- categorias: el público ve las de la carta (noche); escritura solo admin
drop policy if exists "categorias_lectura_publica" on public.categorias;
create policy "categorias_lectura_publica" on public.categorias
  for select to anon, authenticated using (turno = 'noche' or public.es_admin());

drop policy if exists "categorias_admin_inserta" on public.categorias;
create policy "categorias_admin_inserta" on public.categorias
  for insert to authenticated with check (public.es_admin());

drop policy if exists "categorias_admin_edita" on public.categorias;
create policy "categorias_admin_edita" on public.categorias
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "categorias_admin_borra" on public.categorias;
create policy "categorias_admin_borra" on public.categorias
  for delete to authenticated using (public.es_admin());

-- comidas: el público ve solo las activas de la carta; el admin ve y edita todo
drop policy if exists "comidas_lectura" on public.comidas;
create policy "comidas_lectura" on public.comidas
  for select to anon, authenticated using ((activo and turno = 'noche') or public.es_admin());

drop policy if exists "comidas_admin_inserta" on public.comidas;
create policy "comidas_admin_inserta" on public.comidas
  for insert to authenticated with check (public.es_admin());

drop policy if exists "comidas_admin_edita" on public.comidas;
create policy "comidas_admin_edita" on public.comidas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "comidas_admin_borra" on public.comidas;
create policy "comidas_admin_borra" on public.comidas
  for delete to authenticated using (public.es_admin());

-- horarios: lectura pública (la carta muestra si está abierto), escritura solo admin
drop policy if exists "horarios_lectura_publica" on public.horarios;
create policy "horarios_lectura_publica" on public.horarios
  for select to anon, authenticated using (true);

drop policy if exists "horarios_admin_inserta" on public.horarios;
create policy "horarios_admin_inserta" on public.horarios
  for insert to authenticated with check (public.es_admin());

drop policy if exists "horarios_admin_edita" on public.horarios;
create policy "horarios_admin_edita" on public.horarios
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Tablas de uso interno: todo solo para el admin
-- (ventas y venta_items: el público entra únicamente por crear_pedido)
do $$
declare
  t text;
begin
  foreach t in array array['ventas', 'venta_items', 'clientes', 'menu_dia', 'cajas', 'pagos', 'caja_movimientos', 'gastos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())',
                   t || '_admin', t);
  end loop;
end;
$$;

-- admins: cada usuario puede ver solamente su propio registro
drop policy if exists "admins_ver_propio" on public.admins;
create policy "admins_ver_propio" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Tiempo real: el panel se entera al instante de los pedidos nuevos o cambiados.
-- Respeta las políticas de arriba: solo el admin recibe los cambios de "ventas".
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ventas') then
    alter publication supabase_realtime add table public.ventas;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Storage: bucket público "comidas"
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comidas', 'comidas', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Al ser público, las imágenes se ven por su URL pública sin política de
-- lectura. Listar, subir, reemplazar y borrar: solo admin.
drop policy if exists "comidas_storage_admin_lista" on storage.objects;
create policy "comidas_storage_admin_lista" on storage.objects
  for select to authenticated using (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_sube" on storage.objects;
create policy "comidas_storage_admin_sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_reemplaza" on storage.objects;
create policy "comidas_storage_admin_reemplaza" on storage.objects
  for update to authenticated
  using (bucket_id = 'comidas' and public.es_admin())
  with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_borra" on storage.objects;
create policy "comidas_storage_admin_borra" on storage.objects
  for delete to authenticated using (bucket_id = 'comidas' and public.es_admin());

-- ---------------------------------------------------------------------
-- 8. Datos iniciales: el menú impreso de Las Palmeras Club
-- Solo inserta lo que falta (no pisa cambios hechos desde el panel).
-- ---------------------------------------------------------------------

insert into public.categorias (nombre, orden) values
  ('Burguers', 1),
  ('Combos', 2),
  ('Pizzas', 3),
  ('Sandwiches', 4),
  ('Napolitanas', 5),
  ('Papas', 6),
  ('Bebidas', 7)
on conflict (turno, nombre) do nothing;

-- Hamburguesas: un solo producto por hamburguesa, con variantes (Simple / Doble)
-- y los ingredientes que se pueden sacar. Si la base todavía tiene los
-- productos separados ("X doble" y "X simple"), los une en uno (conserva la
-- foto del doble). Se puede volver a correr sin problema.
do $$
declare
  v_cat   uuid;
  r       record;
  d       public.comidas%rowtype;
  s       public.comidas%rowtype;
  v_vars  jsonb;
  v_opc   jsonb;
  -- Extras de arranque con precio 0: el local confirma el precio por WhatsApp.
  -- El dueño les pone precio (o los saca) desde el panel: Comidas → Editar.
  v_extras jsonb := '[{"nombre":"Carne extra","precio":0},{"nombre":"Cheddar extra","precio":0},{"nombre":"Bacon extra","precio":0},{"nombre":"Huevo","precio":0}]'::jsonb;
begin
  select id into v_cat from public.categorias where nombre = 'Burguers';
  if v_cat is null then
    return;
  end if;

  for r in
    select * from (values
      ('Burguer Cheese', 'Medallones de carne y cheddar.', 7500, 11000, '[]'::jsonb),
      ('Burguer Big Mac', 'Medallones de carne, salsa Big Mac, cheddar, pepinillos, lechuga y cebolla.', 8500, 11000,
        '["Salsa Big Mac","Cheddar","Pepinillos","Lechuga","Cebolla"]'::jsonb),
      ('Burguer Big Bang', 'Medallones de carne, salsa de la casa, cheddar, cebolla y bacon.', 8500, 11000,
        '["Salsa de la casa","Cheddar","Cebolla","Bacon"]'::jsonb),
      ('Burguer Texas', 'Medallones de carne, cheddar, bacon, barbacoa y aros de cebolla.', 8500, 11000,
        '["Cheddar","Bacon","Barbacoa","Aros de cebolla"]'::jsonb),
      ('Burguer Milwaukee', 'Medallones de carne, cheddar, bacon, cebolla crispy, lechuga, tomate y mayonesa.', 8500, 11000,
        '["Cheddar","Bacon","Cebolla crispy","Lechuga","Tomate","Mayonesa"]'::jsonb),
      ('Burguer Cuarto de Libra', 'Medallones de carne, cheddar, extra bacon y cebolla en cubos.', 8500, 11000,
        '["Cheddar","Extra bacon","Cebolla en cubos"]'::jsonb),
      ('Burguer Americana', 'Medallones de carne, cheddar, extra bacon, pepinillos, cebolla morada, ketchup y alioli.', 8500, 11000,
        '["Cheddar","Extra bacon","Pepinillos","Cebolla morada","Ketchup","Alioli"]'::jsonb),
      ('Burguer Alabama', 'Medallones de carne, cheddar, pepinillos, cebolla crispy, lechuga, tomate y mayonesa.', 8500, 11000,
        '["Cheddar","Pepinillos","Cebolla crispy","Lechuga","Tomate","Mayonesa"]'::jsonb),
      ('Burguer CBH', 'Medallones de carne, cheddar, extra bacon, manteca y miel.', 8500, 11000,
        '["Cheddar","Extra bacon","Manteca","Miel"]'::jsonb)
    ) as t (base, descripcion, precio_simple, precio_doble, quitar)
  loop
    v_vars := jsonb_build_array(
      jsonb_build_object('nombre', 'Simple', 'precio', r.precio_simple),
      jsonb_build_object('nombre', 'Doble',  'precio', r.precio_doble));
    v_opc := jsonb_build_object('variantes', v_vars, 'quitar', r.quitar, 'agregar', v_extras);

    if exists (select 1 from public.comidas where nombre = r.base) then
      -- ya está unificada: solo le damos los extras si nunca tuvo la lista
      -- (si el dueño la dejó vacía desde el panel, queda guardada como [] y no se toca)
      update public.comidas
         set opciones = opciones || jsonb_build_object('agregar', v_extras)
       where nombre = r.base and not (opciones ? 'agregar');
      continue;
    end if;

    select * into d from public.comidas where nombre = r.base || ' doble';
    select * into s from public.comidas where nombre = r.base || ' simple';

    if d.id is not null then
      update public.comidas
         set nombre       = r.base,
             descripcion  = r.descripcion,
             precio       = r.precio_simple,
             precio_promo = null,
             opciones     = v_opc,
             imagen_url   = coalesce(d.imagen_url, s.imagen_url),
             imagen_path  = case when d.imagen_url is null then s.imagen_path else d.imagen_path end
       where id = d.id;
      if s.id is not null then
        delete from public.comidas where id = s.id;   -- las ventas viejas conservan el nombre
      end if;
    else
      insert into public.comidas (nombre, descripcion, precio, categoria_id, opciones)
      values (r.base, r.descripcion, r.precio_simple, v_cat, v_opc);
    end if;
  end loop;
end;
$$;

-- Napolitana: un solo producto y el cliente elige para cuántas personas.
-- Si la base todavía tiene las tres separadas, las une en una (conserva sus
-- precios y la primera foto que encuentre). Se puede volver a correr.
do $$
declare
  v_cat  uuid;
  u      public.comidas%rowtype;
  d      public.comidas%rowtype;
  t      public.comidas%rowtype;
  v_base uuid;
  v_vars jsonb;
  v_opc  jsonb;
begin
  if exists (select 1 from public.comidas where nombre = 'Napolitana') then
    return;
  end if;

  select * into u from public.comidas where nombre = 'Napolitana para una persona';
  select * into d from public.comidas where nombre = 'Napolitana para dos personas';
  select * into t from public.comidas where nombre = 'Napolitana para tres personas';

  v_vars := jsonb_build_array(
    jsonb_build_object('nombre', 'Para 1 persona',  'precio', coalesce(u.precio_promo, u.precio, 10000)),
    jsonb_build_object('nombre', 'Para 2 personas', 'precio', coalesce(d.precio_promo, d.precio, 19000)),
    jsonb_build_object('nombre', 'Para 3 personas', 'precio', coalesce(t.precio_promo, t.precio, 28000)));
  v_opc := jsonb_build_object('variantes', v_vars, 'pregunta', '¿Para cuántas personas?');
  v_base := coalesce(u.id, d.id, t.id);

  if v_base is null then
    select id into v_cat from public.categorias where nombre = 'Napolitanas';
    if v_cat is not null then
      insert into public.comidas (nombre, precio, categoria_id, opciones)
      values ('Napolitana', (v_vars -> 0 ->> 'precio')::numeric, v_cat, v_opc);
    end if;
    return;
  end if;

  update public.comidas
     set nombre       = 'Napolitana',
         precio       = (v_vars -> 0 ->> 'precio')::numeric,
         precio_promo = null,
         opciones     = opciones || v_opc,
         imagen_url   = coalesce(u.imagen_url, d.imagen_url, t.imagen_url),
         imagen_path  = case when u.imagen_url is not null then u.imagen_path
                             when d.imagen_url is not null then d.imagen_path
                             else t.imagen_path end
   where id = v_base;

  -- las ventas viejas conservan el nombre de cada napolitana
  delete from public.comidas where id in (u.id, d.id, t.id) and id <> v_base;
end;
$$;

insert into public.comidas (nombre, descripcion, precio, destacado, categoria_id)
select m.nombre, m.descripcion, m.precio, m.destacado, c.id
from (values
  ('Combos', 'Promo Cheese Simples', '3 burguers cheese simples con papas.', 17000, true),
  ('Combos', 'Promo Burritos Burguer', '2 burritos a elección (Texas o Milwaukee) con papas.', 16000, true),
  ('Pizzas', 'Pizza muzzarella clásica', null, 9000, false),
  ('Pizzas', 'Pizza muzzarella especial', null, 9000, false),
  ('Pizzas', 'Pizza napolitana', null, 9000, false),
  ('Pizzas', 'Pizza de huevo', null, 9000, false),
  ('Pizzas', 'Pizza de choclo', null, 9000, false),
  ('Pizzas', 'Pizza provenzal', null, 9000, false),
  ('Pizzas', 'Pizza americana', null, 10000, false),
  ('Pizzas', 'Pizza fugazzeta', null, 9000, false),
  ('Sandwiches', 'Sándwich de lomito especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito criollo', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito americano', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa criolla', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa de la casa', null, 9500, false),
  ('Papas', 'Papas con salchicha', null, 8500, false),
  ('Papas', 'Papas tradicionales a caballo', null, 9000, false),
  ('Papas', 'Papas americanas', null, 10000, false),
  ('Papas', 'Papas con huevo revuelto', null, 8500, false),
  ('Papas', 'Papas simples', null, 8000, false),
  ('Bebidas', 'Coca-Cola 500 ml', null, 3000, false),
  ('Bebidas', 'Aquarius 1,5 L', null, 3500, false),
  ('Bebidas', 'Coca-Cola 1,5 L', null, 4500, false),
  ('Bebidas', 'Agua mineral 500 ml', null, 2000, false)
) as m (categoria, nombre, descripcion, precio, destacado)
join public.categorias c on c.nombre = m.categoria
where not exists (select 1 from public.comidas x where x.nombre = m.nombre);

-- ---------------------------------------------------------------------
-- 9. Dar permisos de administrador al dueño
-- Primero creá el usuario en Authentication → Users → Add user, y después
-- descomentá y corré esta línea con su correo:
-- ---------------------------------------------------------------------

-- insert into public.admins (user_id)
-- select id from auth.users where email = 'dueño@ejemplo.com';
