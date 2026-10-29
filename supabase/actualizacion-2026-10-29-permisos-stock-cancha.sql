-- =====================================================================
-- Las Palmeras Club · Actualización del 29/10/2026 (3)
-- Empleados con permisos de empleado, registro de actividad (quién hizo
-- cada cosa), stock con historial y carga de mercadería, señas y turnos
-- fijos de la cancha.
--
-- Para una base que YA está andando (con las actualizaciones anteriores del
-- 29/10 corridas): pegá este archivo entero en Supabase → SQL Editor →
-- New query → Run. No borra datos. Se puede volver a correr.
-- (En una base nueva alcanza con schema.sql, que ya trae todo esto.)
-- =====================================================================

begin;

-- 1. Tablas y columnas nuevas ------------------------------------------
-- Turnos fijos de la cancha (todas las semanas el mismo día y hora). El panel
-- los anota como turnos comunes de cada día (preparar_turnos_fijos) para
-- cobrarlos o señarlos; si un día no vienen, se libera ese día.
create table if not exists public.cancha_fijos (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  dia_semana       smallint not null check (dia_semana between 0 and 6),   -- 0 = domingo
  desde            time not null,
  minutos          int  not null default 60 check (minutos between 30 and 720),
  cliente_nombre   text not null check (length(btrim(cliente_nombre)) between 1 and 80),
  cliente_telefono text check (cliente_telefono is null or length(cliente_telefono) <= 30),
  precio           numeric(12,2) not null check (precio > 0),
  nota             text check (nota is null or length(nota) <= 300),
  activo           boolean not null default true,
  creado_por       text default (auth.jwt() ->> 'email')
);

alter table public.cancha_turnos add column if not exists fijo_id uuid references public.cancha_fijos (id) on delete set null;
alter table public.cancha_turnos add column if not exists creado_por text default (auth.jwt() ->> 'email');
create unique index if not exists cancha_turnos_fijo_fecha_idx on public.cancha_turnos (fijo_id, fecha);

-- Días en que un turno fijo no viene (para no volver a anotarlo)
create table if not exists public.cancha_fijos_libres (
  fijo_id uuid not null references public.cancha_fijos (id) on delete cascade,
  fecha   date not null,
  primary key (fijo_id, fecha)
);

-- Ajustes que define el dueño. Por ahora: cancha_precio_hora (precio por
-- hora de la cancha: el empleado no puede cobrar otro precio).
create table if not exists public.ajustes (
  clave text primary key,
  valor numeric(12,2) not null check (valor >= 0)
);

-- Quién cobró cada cosa y quién movió la caja (correo del usuario)
alter table public.pagos add column if not exists usuario text default (auth.jwt() ->> 'email');
alter table public.caja_movimientos add column if not exists usuario text default (auth.jwt() ->> 'email');

-- Stock: a partir de cuántas unidades avisa que queda poco
alter table public.comidas add column if not exists stock_minimo int not null default 5;
alter table public.comidas drop constraint if exists comidas_stock_minimo_check;
alter table public.comidas add constraint comidas_stock_minimo_check check (stock_minimo between 0 and 100000);

-- Historial de stock: cada venta, devolución, mercadería que entra y ajuste
create table if not exists public.stock_movimientos (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  comida_id        uuid references public.comidas (id) on delete set null,
  nombre           text not null,
  tipo             text not null check (tipo in ('venta', 'devolucion', 'ingreso', 'ajuste')),
  cantidad         int  not null,            -- + entra, − sale
  stock_resultante int,
  venta_numero     bigint,
  nota             text check (nota is null or length(nota) <= 200),
  usuario          text default (auth.jwt() ->> 'email')
);

create index if not exists stock_movimientos_fecha_idx on public.stock_movimientos (created_at desc);
create index if not exists stock_movimientos_comida_idx on public.stock_movimientos (comida_id, created_at desc);

-- Registro de actividad: quién hizo qué y cuándo. Lo llenan triggers y
-- funciones; solo lo ve el dueño y nadie lo puede editar ni borrar.
create table if not exists public.actividad (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usuario    text,            -- correo; null = la carta online
  rol        text,
  tipo       text not null,   -- venta, cobro, caja, cancha, stock, catalogo, cliente, gasto
  accion     text not null,
  detalle    text,
  monto      numeric(12,2)
);

create index if not exists actividad_fecha_idx on public.actividad (created_at desc);

-- 2. Funciones que cambiaron (stock con historial, cobro con seña, solo el dueño anula) --
drop function if exists public._ajustar_stock(uuid, int, boolean);
create or replace function public._ajustar_stock(p_comida_id uuid, p_delta int, p_estricto boolean, p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock  int;
  v_nombre text;
  v_numero bigint;
begin
  if p_comida_id is null or p_delta = 0 then
    return;
  end if;
  update public.comidas c
     set stock = c.stock + p_delta
   where c.id = p_comida_id
     and c.stock is not null
     and exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock)
  returning c.stock, c.nombre into v_stock, v_nombre;
  if not found then
    return;
  end if;
  if p_delta < 0 and p_estricto and v_stock < 0 then
    raise exception 'No nos queda stock suficiente de "%" (quedan %). Actualizá la página.',
      v_nombre, greatest(v_stock - p_delta, 0);
  end if;
  select v.numero into v_numero from public.ventas v where v.id = p_venta_id;
  insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, venta_numero, nota)
  values (p_comida_id, v_nombre, case when p_delta < 0 then 'venta' else 'devolucion' end, p_delta, v_stock, v_numero,
          case when p_delta > 0 and v_numero is null then 'Pedido cancelado o venta borrada' end);
end;
$$;

create or replace function public._controlar_turno_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.cancha_turnos%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.venta_id is not null then
      raise exception 'Este turno ya está cobrado o señado. Para borrarlo, primero anulá el cobro.';
    end if;
    -- Turno fijo: se libera solo ese día (no se vuelve a anotar)
    if old.fijo_id is not null then
      insert into public.cancha_fijos_libres (fijo_id, fecha) values (old.fijo_id, old.fecha) on conflict do nothing;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.venta_id is not null and new.venta_id is not null and new.precio <> old.precio then
    raise exception 'Este turno ya está cobrado. Para cambiarle el precio, primero anulá el cobro.';
  end if;

  select * into t
    from public.cancha_turnos x
   where x.id <> new.id
     and (x.fecha + x.desde) < (new.fecha + new.desde) + make_interval(mins => new.minutos)
     and (new.fecha + new.desde) < (x.fecha + x.desde) + make_interval(mins => x.minutos)
   order by x.fecha, x.desde
   limit 1;
  if found then
    raise exception 'La cancha ya está reservada de % a % (%).',
      to_char(t.desde, 'HH24:MI'), to_char(t.desde + make_interval(mins => t.minutos), 'HH24:MI'), t.cliente_nombre;
  end if;
  return new;
end;
$$;

create or replace function public._mover_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_web boolean;
begin
  if tg_op = 'DELETE' then
    perform public._ajustar_stock(old.comida_id, old.cantidad, false, old.venta_id);
    return old;
  end if;
  select v.origen = 'web' into v_web from public.ventas v where v.id = new.venta_id;
  if tg_op = 'INSERT' then
    perform public._ajustar_stock(new.comida_id, -new.cantidad, coalesce(v_web, false), new.venta_id);
  else
    perform public._ajustar_stock(new.comida_id, old.cantidad - new.cantidad, coalesce(v_web, false), new.venta_id);
  end if;
  return new;
end;
$$;

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
  v_resta    numeric(12,2);   -- el total menos lo que ya se pagó antes (seña)
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
  v_resta := v.total - (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = p_venta_id);

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
  if v_sin_monto = 1 and v_suma >= v_resta then
    raise exception 'Los montos ya cubren el total: sacá la forma de pago que sobra.';
  end if;
  if v_sin_monto = 0 and v_suma <> v_resta then
    raise exception 'Los pagos suman % y lo que hay que cobrar es %.', public._pesos(v_suma), public._pesos(v_resta);
  end if;

  -- Arma la lista final (completa el pago sin monto)
  for r in select x.metodo, x.monto, x.cliente_id
             from jsonb_to_recordset(p_pagos) as x (metodo text, monto numeric, cliente_id uuid) loop
    v_monto := coalesce(round(r.monto, 2), v_resta - v_suma);
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
  perform public._registrar_venta(v_id);

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
  perform public._registrar_venta(v_id);

  if registrar_venta_local.pagos is not null and jsonb_typeof(registrar_venta_local.pagos) = 'array'
     and jsonb_array_length(registrar_venta_local.pagos) > 0 then
    perform public._cobrar(v_id, registrar_venta_local.pagos);
  end if;

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'estado', v.estado)
          from public.ventas v where v.id = v_id);
end;
$$;

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
  v_antes   public.ventas%rowtype;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select * into v_antes from public.ventas v where v.id = editar_venta.venta_id for update;
  v_estado := v_antes.estado;
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
  perform public._registrar('venta', 'Editó un pedido',
    '#' || v_antes.numero || ' · total ' || public._pesos(v_antes.total) || ' → '
      || public._pesos((select v.total from public.ventas v where v.id = editar_venta.venta_id)),
    (select v.total from public.ventas v where v.id = editar_venta.venta_id));

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = editar_venta.venta_id);
end;
$$;

create or replace function public.anular_cobro(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede anular un cobro.';
  end if;
  if not exists (select 1 from public.ventas v where v.id = anular_cobro.venta_id and v.estado = 'cerrado') then
    raise exception 'Esta venta no está cobrada.';
  end if;
  delete from public.pagos p where p.venta_id = anular_cobro.venta_id;
  update public.ventas v set estado = 'entregado', cerrada_at = null where v.id = anular_cobro.venta_id;
end;
$$;

create or replace function public.cobrar_turno_cancha(turno_id uuid, pagos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.cancha_turnos%rowtype;
  v_venta uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into t from public.cancha_turnos c where c.id = cobrar_turno_cancha.turno_id for update;
  if not found then
    raise exception 'El turno no existe.';
  end if;

  v_venta := public._venta_de_turno(t.id);
  perform public._cobrar(v_venta, cobrar_turno_cancha.pagos);

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = v_venta);
end;
$$;

create or replace function public.anular_cobro_cancha(turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta uuid;
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede anular un cobro.';
  end if;
  select c.venta_id into v_venta from public.cancha_turnos c where c.id = anular_cobro_cancha.turno_id for update;
  if v_venta is null then
    raise exception 'Este turno no está cobrado.';
  end if;
  delete from public.ventas v where v.id = v_venta;   -- el turno queda sin cobrar (on delete set null)
end;
$$;

-- 3. Permisos del empleado y registro de actividad ------------------
-- ---------------------------------------------------------------------
-- Permisos del empleado y registro de actividad
-- Las reglas miran current_user: 'authenticated' es alguien desde el panel
-- tocando la tabla directo. Las funciones de la base (cobrar, cerrar caja,
-- cargar mercadería…) corren como dueño de la base y ya hacen sus controles.
-- ---------------------------------------------------------------------

-- Anota una línea en el registro de actividad con el usuario que la hizo
create or replace function public._registrar(p_tipo text, p_accion text, p_detalle text default null, p_monto numeric default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.actividad (usuario, rol, tipo, accion, detalle, monto)
  values (auth.jwt() ->> 'email', (select a.rol from public.admins a where a.user_id = auth.uid()),
          p_tipo, p_accion, p_detalle, p_monto);
$$;

-- Venta nueva (pedido web o venta en caja)
create or replace function public._registrar_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ventas%rowtype;
begin
  select * into v from public.ventas where id = p_venta_id;
  perform public._registrar('venta',
    case when v.origen = 'web' then 'Pedido web' else 'Venta en caja' end,
    '#' || v.numero || coalesce(' · ' || v.cliente_nombre, '') || ' · ' || initcap(v.turno), v.total);
end;
$$;

create or replace function public._nombre_estado(p_estado text)
returns text
language sql
immutable
as $$
  select case p_estado
    when 'pendiente' then 'Nuevo' when 'en_preparacion' then 'En preparación'
    when 'enviado' then 'En camino / listo' when 'entregado' then 'Entregado'
    when 'cerrado' then 'Cobrado' else p_estado end;
$$;

-- Lo que pasa en las tablas importantes queda en "actividad"
create or replace function public._actividad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero bigint;
  v_turno  text;
  v_texto  text;
begin
  -- Cambios que hace la base sola (turnos fijos que se anotan o se corren)
  if current_setting('palmeras.automatico', true) = 'si' then
    return null;
  end if;

  case tg_table_name
  when 'ventas' then
    if tg_op = 'UPDATE' and new.estado <> old.estado and new.estado not in ('cerrado', 'cancelado') then
      perform public._registrar('venta', 'Cambió el estado',
        '#' || new.numero || ': ' || public._nombre_estado(old.estado) || ' → ' || public._nombre_estado(new.estado), null);
    elsif tg_op = 'DELETE' then
      perform public._registrar('venta',
        case when old.estado = 'cerrado' then 'Borró una venta cobrada' else 'Canceló un pedido' end,
        '#' || old.numero || coalesce(' · ' || old.cliente_nombre, '') || ' · ' || initcap(old.turno), old.total);
    end if;

  when 'pagos' then
    if tg_op = 'INSERT' then
      if new.concepto = 'cobro_cuenta' then
        perform public._registrar('cobro', 'Cobró cuenta corriente',
          (select c.nombre from public.clientes c where c.id = new.cliente_id) || ' · ' || initcap(replace(new.metodo, '_', ' ')), new.monto);
      else
        select v.numero, v.turno into v_numero, v_turno from public.ventas v where v.id = new.venta_id;
        perform public._registrar('cobro', case when new.nota = 'Seña' then 'Cobró una seña' else 'Cobró' end,
          '#' || v_numero || ' · ' || initcap(v_turno) || ' · ' || initcap(replace(new.metodo, '_', ' ')), new.monto);
      end if;
    elsif tg_op = 'DELETE' then
      select v.numero into v_numero from public.ventas v where v.id = old.venta_id;
      perform public._registrar('cobro', 'Anuló un cobro',
        coalesce('#' || v_numero || ' · ', '') || initcap(replace(old.metodo, '_', ' ')), old.monto);
    end if;

  when 'cajas' then
    if tg_op = 'INSERT' then
      perform public._registrar('caja', 'Abrió la caja', 'Arqueo N° ' || new.numero, new.monto_inicial);
    elsif tg_op = 'UPDATE' and new.estado = 'cerrada' and old.estado = 'abierta' then
      perform public._registrar('caja', 'Cerró la caja',
        'Arqueo N° ' || new.numero || ' · contado ' || public._pesos(new.efectivo_contado)
          || ' · diferencia ' || public._pesos(coalesce((new.resumen ->> 'diferencia')::numeric, 0)),
        new.efectivo_contado);
    elsif tg_op = 'DELETE' then
      perform public._registrar('caja', 'Borró un arqueo', 'Arqueo N° ' || old.numero, null);
    end if;

  when 'caja_movimientos' then
    if tg_op = 'INSERT' then
      perform public._registrar('caja', case when new.tipo = 'ingreso' then 'Ingreso de efectivo' else 'Retiro de efectivo' end,
        new.concepto, new.monto);
    elsif tg_op = 'DELETE' then
      perform public._registrar('caja', 'Borró un ingreso o retiro', old.concepto, old.monto);
    end if;

  when 'comidas' then
    if tg_op = 'INSERT' then
      perform public._registrar('catalogo', 'Creó un producto', new.nombre, new.precio);
    elsif tg_op = 'DELETE' then
      perform public._registrar('catalogo', 'Borró un producto', old.nombre, old.precio);
    else
      if new.precio is distinct from old.precio or new.precio_promo is distinct from old.precio_promo
         or new.opciones -> 'variantes' is distinct from old.opciones -> 'variantes' then
        perform public._registrar('catalogo', 'Cambió el precio', new.nombre || ' · ' || public._pesos(old.precio)
          || ' → ' || public._pesos(new.precio)
          || case when new.opciones -> 'variantes' is distinct from old.opciones -> 'variantes' then ' (variantes)' else '' end,
          new.precio);
      end if;
      if new.activo is distinct from old.activo then
        perform public._registrar('catalogo', case when new.activo then 'Marcó que hay' else 'Marcó que no hay' end, new.nombre, null);
      end if;
      if new.nombre is distinct from old.nombre then
        perform public._registrar('catalogo', 'Cambió el nombre', old.nombre || ' → ' || new.nombre, null);
      end if;
    end if;

  when 'clientes' then
    if tg_op = 'INSERT' then
      perform public._registrar('cliente', 'Creó una cuenta corriente', new.nombre, new.limite_credito);
    elsif tg_op = 'UPDATE' then
      if new.limite_credito is distinct from old.limite_credito then
        perform public._registrar('cliente', 'Cambió el límite de crédito', new.nombre, new.limite_credito);
      end if;
      if new.activo is distinct from old.activo then
        perform public._registrar('cliente', case when new.activo then 'Reactivó una cuenta' else 'Dio de baja una cuenta' end, new.nombre, null);
      end if;
    end if;

  when 'gastos' then
    perform public._registrar('gasto',
      case tg_op when 'INSERT' then 'Cargó un gasto' when 'UPDATE' then 'Modificó un gasto' else 'Borró un gasto' end,
      coalesce(new.descripcion, old.descripcion), coalesce(new.monto, old.monto));

  when 'cancha_turnos' then
    v_texto := to_char(coalesce(new.fecha, old.fecha), 'DD/MM') || ' ' || to_char(coalesce(new.desde, old.desde), 'HH24:MI')
               || ' · ' || coalesce(new.cliente_nombre, old.cliente_nombre);
    if tg_op = 'INSERT' then
      perform public._registrar('cancha', 'Reservó un turno', v_texto, new.precio);
    elsif tg_op = 'DELETE' then
      perform public._registrar('cancha', case when old.fijo_id is not null then 'Liberó un turno fijo' else 'Borró un turno' end,
        v_texto, old.precio);
    elsif (new.fecha, new.desde, new.minutos, new.precio, new.cliente_nombre)
          is distinct from (old.fecha, old.desde, old.minutos, old.precio, old.cliente_nombre) then
      perform public._registrar('cancha', 'Modificó un turno', v_texto, new.precio);
    end if;

  when 'cancha_fijos' then
    v_texto := (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[coalesce(new.dia_semana, old.dia_semana) + 1]
               || ' ' || to_char(coalesce(new.desde, old.desde), 'HH24:MI') || ' · ' || coalesce(new.cliente_nombre, old.cliente_nombre);
    perform public._registrar('cancha',
      case tg_op when 'INSERT' then 'Anotó un turno fijo' when 'UPDATE' then 'Modificó un turno fijo' else 'Borró un turno fijo' end,
      v_texto, coalesce(new.precio, old.precio));

  when 'ajustes' then
    perform public._registrar('cancha', 'Cambió el precio de la cancha', 'Por hora', coalesce(new.valor, old.valor));
  else
    null;
  end case;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['ventas', 'pagos', 'cajas', 'caja_movimientos', 'comidas', 'clientes', 'gastos',
                           'cancha_turnos', 'cancha_fijos', 'ajustes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_actividad', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._actividad()',
                   t || '_actividad', t);
  end loop;
end;
$$;

-- Cosas que solo hace el dueño (categorías, horarios, menú del día, borrar
-- arqueos o movimientos de caja…). El argumento es el mensaje para el empleado.
create or replace function public._solo_dueno()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' and not public.es_dueno() then
    raise exception '%', coalesce(tg_argv[0], 'Esto lo puede hacer solo el dueño.');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('categorias',       'insert or update or delete', 'Las categorías las cambia solo el dueño.'),
    ('horarios',         'insert or update or delete', 'Los horarios los cambia solo el dueño.'),
    ('menu_dia',         'insert or update or delete', 'El menú del día lo arma solo el dueño.'),
    ('comidas',          'insert or delete',           'Los productos los crea y los borra solo el dueño.'),
    ('cajas',            'delete',                     'Solo el dueño puede borrar un arqueo.'),
    ('caja_movimientos', 'update or delete',           'Solo el dueño puede borrar o cambiar un ingreso o retiro.'),
    ('clientes',         'delete',                     'Solo el dueño puede borrar una cuenta corriente.'),
    ('ajustes',          'insert or update or delete', 'El precio de la cancha lo define solo el dueño.')
  ) as x (tabla, eventos, mensaje) loop
    execute format('drop trigger if exists %I on public.%I', r.tabla || '_solo_dueno', r.tabla);
    execute format('create trigger %I before %s on public.%I for each row execute function public._solo_dueno(%L)',
                   r.tabla || '_solo_dueno', r.eventos, r.tabla, r.mensaje);
  end loop;
end;
$$;

-- Columnas que el empleado sí puede cambiar a mano (lo demás, solo el dueño):
-- de una comida, si hay o no hay; de una venta, el estado; de la caja, el
-- conteo y la nota; de un cliente, sus datos pero no el límite ni la baja.
create or replace function public._solo_estas_columnas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb := to_jsonb(old);
  c       text;
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return new;
  end if;
  foreach c in array tg_argv loop
    v_nuevo := v_nuevo - c;
    v_viejo := v_viejo - c;
  end loop;
  if v_nuevo is distinct from v_viejo then
    raise exception '%', case tg_table_name
      when 'comidas'  then 'Los productos y los precios los cambia solo el dueño. Vos podés marcar si hay o no hay.'
      when 'cajas'    then 'Solo el dueño puede cambiar el efectivo inicial de la caja.'
      when 'clientes' then 'Solo el dueño puede cambiar el límite de crédito o dar de baja una cuenta.'
      else 'Esto lo puede cambiar solo el dueño.' end;
  end if;
  return new;
end;
$$;

drop trigger if exists comidas_permisos on public.comidas;
create trigger comidas_permisos before update on public.comidas
  for each row execute function public._solo_estas_columnas('activo', 'updated_at');

drop trigger if exists cajas_permisos on public.cajas;
create trigger cajas_permisos before update on public.cajas
  for each row execute function public._solo_estas_columnas('conteo', 'efectivo_contado', 'nota');

drop trigger if exists clientes_permisos on public.clientes;
create trigger clientes_permisos before update on public.clientes
  for each row execute function public._solo_estas_columnas('nombre', 'telefono', 'documento', 'notas');

-- El stock no se escribe a mano (ni el dueño): se mueve con las ventas,
-- cargar_mercaderia y ajustar_stock, así siempre queda en el historial.
create or replace function public._stock_por_funciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.stock := null;   -- un producto nuevo arranca sin stock: se carga con mercadería
    elsif new.stock is distinct from old.stock then
      raise exception 'El stock se cambia desde la pestaña Stock: cargar mercadería o ajustar.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comidas_stock_por_funciones on public.comidas;
create trigger comidas_stock_por_funciones before insert or update on public.comidas
  for each row execute function public._stock_por_funciones();

-- Ventas: el empleado solo cambia el estado; no cancela ni borra una venta
-- que ya tiene plata cobrada (cobrada o señada).
create or replace function public._proteger_venta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'estado') is distinct from (to_jsonb(old) - 'estado') then
    raise exception 'De una venta solo podés cambiar el estado.';
  end if;
  if (tg_op = 'DELETE' or new.estado = 'cancelado')
     and exists (select 1 from public.pagos p where p.venta_id = v_id) then
    raise exception 'Esta venta ya tiene un cobro: solo el dueño puede borrarla o cancelarla.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists ventas_proteger on public.ventas;
create trigger ventas_proteger before update or delete on public.ventas
  for each row execute function public._proteger_venta();

-- Cancha: el empleado cobra el precio que fijó el dueño (si lo cargó)
create or replace function public._precio_cancha()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hora numeric;
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.precio = old.precio and new.minutos = old.minutos then
    return new;
  end if;
  select a.valor into v_hora from public.ajustes a where a.clave = 'cancha_precio_hora';
  if v_hora is not null and new.precio <> round(v_hora * new.minutos / 60.0, 2) then
    raise exception 'El precio de la cancha lo define el dueño: % por hora (este turno: %).',
      public._pesos(v_hora), public._pesos(round(v_hora * new.minutos / 60.0, 2));
  end if;
  return new;
end;
$$;

drop trigger if exists cancha_turnos_precio on public.cancha_turnos;
create trigger cancha_turnos_precio before insert or update on public.cancha_turnos
  for each row execute function public._precio_cancha();

drop trigger if exists cancha_fijos_precio on public.cancha_fijos;
create trigger cancha_fijos_precio before insert or update on public.cancha_fijos
  for each row execute function public._precio_cancha();

-- Turnos fijos: dos fijos no se pisan el mismo día de la semana
create or replace function public._controlar_fijo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f      public.cancha_fijos%rowtype;
  v_ini  int := extract(hour from new.desde)::int * 60 + extract(minute from new.desde)::int;
begin
  if not new.activo then
    return new;
  end if;
  select * into f
    from public.cancha_fijos x
   where x.id <> new.id and x.activo and x.dia_semana = new.dia_semana
     and (extract(hour from x.desde)::int * 60 + extract(minute from x.desde)::int) < v_ini + new.minutos
     and v_ini < (extract(hour from x.desde)::int * 60 + extract(minute from x.desde)::int) + x.minutos
   limit 1;
  if found then
    raise exception 'Ese día y horario ya es el turno fijo de %.', f.cliente_nombre;
  end if;
  return new;
end;
$$;

drop trigger if exists cancha_fijos_controlar on public.cancha_fijos;
create trigger cancha_fijos_controlar before insert or update on public.cancha_fijos
  for each row execute function public._controlar_fijo();

-- Si cambia un turno fijo, se corrigen los días que vienen y todavía no se
-- pagaron. Si cambia de día o se da de baja, esos días se liberan.
create or replace function public._fijo_cambiado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_id  uuid := coalesce(new.id, old.id);
begin
  perform set_config('palmeras.automatico', 'si', true);
  if tg_op = 'DELETE' or not new.activo or new.dia_semana <> old.dia_semana then
    delete from public.cancha_turnos t where t.fijo_id = v_id and t.fecha >= v_hoy and t.venta_id is null;
    delete from public.cancha_fijos_libres l where l.fijo_id = v_id and l.fecha >= v_hoy;
  else
    update public.cancha_turnos t
       set desde = new.desde, minutos = new.minutos, cliente_nombre = new.cliente_nombre,
           cliente_telefono = new.cliente_telefono, precio = new.precio, nota = new.nota
     where t.fijo_id = v_id and t.fecha >= v_hoy and t.venta_id is null;
  end if;
  perform set_config('palmeras.automatico', '', true);
  return coalesce(new, old);
end;
$$;

drop trigger if exists cancha_fijos_cambiado on public.cancha_fijos;
create trigger cancha_fijos_cambiado after update on public.cancha_fijos
  for each row execute function public._fijo_cambiado();

drop trigger if exists cancha_fijos_borrado on public.cancha_fijos;
create trigger cancha_fijos_borrado before delete on public.cancha_fijos
  for each row execute function public._fijo_cambiado();

-- 4. Funciones nuevas: seña, turnos fijos, mercadería y ajuste de stock --
-- La venta de un turno de cancha (la crea la primera vez que se paga algo)
create or replace function public._venta_de_turno(p_turno_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.cancha_turnos%rowtype;
  v_venta uuid;
begin
  select * into t from public.cancha_turnos c where c.id = p_turno_id for update;
  if t.venta_id is not null then
    return t.venta_id;
  end if;

  insert into public.ventas (estado, total, cliente_nombre, nota, origen, turno)
  values ('entregado', t.precio, t.cliente_nombre, t.nota, 'manual', 'cancha')
  returning id into v_venta;

  insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
  values (v_venta, null, case when t.fijo_id is null then 'Alquiler de cancha' else 'Alquiler de cancha (turno fijo)' end,
          to_char(t.fecha, 'DD/MM') || ' · ' || to_char(t.desde, 'HH24:MI') || ' a '
            || to_char(t.desde + make_interval(mins => t.minutos), 'HH24:MI'),
          t.precio, 1, t.precio);

  update public.cancha_turnos c set venta_id = v_venta where c.id = t.id;
  return v_venta;
end;
$$;

-- Admin: seña de un turno (parte del precio, en efectivo o transferencia).
-- Entra en la caja abierta; al cobrar el turno se cobra solo lo que falta.
create or replace function public.senar_turno_cancha(turno_id uuid, monto numeric, metodo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.cancha_turnos%rowtype;
  v_venta  uuid;
  v_pagado numeric(12,2);
  v_caja   uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into t from public.cancha_turnos c where c.id = senar_turno_cancha.turno_id for update;
  if not found then
    raise exception 'El turno no existe.';
  end if;
  if senar_turno_cancha.metodo is null or senar_turno_cancha.metodo not in ('efectivo', 'transferencia') then
    raise exception 'La seña se cobra en efectivo o por transferencia.';
  end if;
  if senar_turno_cancha.monto is null or senar_turno_cancha.monto <= 0 then
    raise exception 'La seña tiene que ser mayor a 0.';
  end if;
  if exists (select 1 from public.ventas v where v.id = t.venta_id and v.estado = 'cerrado') then
    raise exception 'Este turno ya está cobrado.';
  end if;
  v_pagado := (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = t.venta_id);
  if round(senar_turno_cancha.monto, 2) >= t.precio - v_pagado then
    raise exception 'La seña tiene que ser menor que lo que falta pagar (%). Si paga todo, usá Cobrar.',
      public._pesos(t.precio - v_pagado);
  end if;
  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para cobrar la seña.';
  end if;

  v_venta := public._venta_de_turno(t.id);
  insert into public.pagos (venta_id, caja_id, metodo, monto, concepto, nota)
  values (v_venta, v_caja, senar_turno_cancha.metodo, round(senar_turno_cancha.monto, 2), 'venta', 'Seña');

  return jsonb_build_object('pagado', v_pagado + round(senar_turno_cancha.monto, 2),
                            'resta', t.precio - v_pagado - round(senar_turno_cancha.monto, 2));
end;
$$;

-- Solo dueño: el turno señado no vino. Se cierra cobrando solo la seña.
create or replace function public.cerrar_turno_con_sena(turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.cancha_turnos%rowtype;
  v_pagado numeric(12,2);
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede cerrar un turno con la seña.';
  end if;
  select * into t from public.cancha_turnos c where c.id = cerrar_turno_con_sena.turno_id for update;
  if t.venta_id is null or exists (select 1 from public.ventas v where v.id = t.venta_id and v.estado = 'cerrado') then
    raise exception 'Este turno no tiene una seña pendiente.';
  end if;
  v_pagado := (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = t.venta_id);

  update public.venta_items i
     set precio_unitario = v_pagado, subtotal = v_pagado, detalle = coalesce(i.detalle || ' · ', '') || 'no vino: quedó la seña'
   where i.venta_id = t.venta_id;
  update public.ventas v set total = v_pagado, estado = 'cerrado', cerrada_at = now() where v.id = t.venta_id;
  perform public._registrar('cancha', 'Cerró un turno con la seña (no vino)',
    to_char(t.fecha, 'DD/MM') || ' ' || to_char(t.desde, 'HH24:MI') || ' · ' || t.cliente_nombre, v_pagado);
end;
$$;

-- Admin: anota los turnos fijos de un día (desde hoy en adelante). Si ese
-- día está liberado, o ya hay un turno suelto en ese horario, no lo anota.
create or replace function public.preparar_turnos_fijos(fecha date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  f   public.cancha_fijos%rowtype;
  v_n int := 0;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if preparar_turnos_fijos.fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    return 0;
  end if;
  perform set_config('palmeras.automatico', 'si', true);
  for f in select * from public.cancha_fijos x
            where x.activo and x.dia_semana = extract(dow from preparar_turnos_fijos.fecha)
              and not exists (select 1 from public.cancha_turnos t where t.fijo_id = x.id and t.fecha = preparar_turnos_fijos.fecha)
              and not exists (select 1 from public.cancha_fijos_libres l where l.fijo_id = x.id and l.fecha = preparar_turnos_fijos.fecha)
  loop
    begin
      insert into public.cancha_turnos (fecha, desde, minutos, cliente_nombre, cliente_telefono, precio, nota, fijo_id, creado_por)
      values (preparar_turnos_fijos.fecha, f.desde, f.minutos, f.cliente_nombre, f.cliente_telefono, f.precio, f.nota, f.id, f.creado_por);
      v_n := v_n + 1;
    exception when raise_exception or unique_violation then
      null;   -- se pisa con un turno suelto: queda el que ya estaba
    end;
  end loop;
  perform set_config('palmeras.automatico', '', true);
  return v_n;
end;
$$;

-- Admin (dueño o empleado): entra mercadería de kiosco. Suma al stock.
-- items: [{ "comida_id": "<uuid>", "cantidad": 24 }]
create or replace function public.cargar_mercaderia(items jsonb, nota text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_stock int;
  v_nom   text;
  v_nota  text := nullif(btrim(coalesce(cargar_mercaderia.nota, '')), '');
  v_n     int := 0;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'Agregá al menos un producto.';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;
  begin
    for r in select x.comida_id, x.cantidad from jsonb_to_recordset(items) as x (comida_id uuid, cantidad int) loop
      if r.comida_id is null or r.cantidad is null or r.cantidad <= 0 or r.cantidad > 100000 then
        raise exception 'Revisá las cantidades: tienen que ser números enteros mayores a 0.';
      end if;
      update public.comidas c
         set stock = coalesce(c.stock, 0) + r.cantidad
       where c.id = r.comida_id
         and exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock)
      returning c.stock, c.nombre into v_stock, v_nom;
      if not found then
        raise exception 'Solo se carga mercadería de productos de kiosco (bebidas y golosinas).';
      end if;
      insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, nota)
      values (r.comida_id, v_nom, 'ingreso', r.cantidad, v_stock, v_nota);
      perform public._registrar('stock', 'Cargó mercadería', v_nom || ' +' || r.cantidad || coalesce(' · ' || v_nota, ''), null);
      v_n := v_n + 1;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato de la mercadería no es válido.';
  end;
  return v_n;
end;
$$;

-- Solo dueño: corrige el stock con lo que hay de verdad (después de contar).
create or replace function public.ajustar_stock(comida_id uuid, stock_real int, nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c      public.comidas%rowtype;
  v_nota text := nullif(btrim(coalesce(ajustar_stock.nota, '')), '');
  v_dif  int;
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede ajustar el stock.';
  end if;
  if ajustar_stock.stock_real is null or ajustar_stock.stock_real < 0 or ajustar_stock.stock_real > 1000000 then
    raise exception 'Poné la cantidad que hay (0 o más).';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;
  select * into c from public.comidas x where x.id = ajustar_stock.comida_id for update;
  if not found or not exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock) then
    raise exception 'Solo los productos de kiosco llevan stock.';
  end if;
  v_dif := ajustar_stock.stock_real - coalesce(c.stock, 0);
  update public.comidas x set stock = ajustar_stock.stock_real where x.id = c.id;
  insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, nota)
  values (c.id, c.nombre, 'ajuste', v_dif, ajustar_stock.stock_real, v_nota);
  perform public._registrar('stock', 'Ajustó el stock',
    c.nombre || ': ' || coalesce(c.stock::text, 'sin cargar') || ' → ' || ajustar_stock.stock_real || coalesce(' · ' || v_nota, ''), null);
end;
$$;

-- 5. Permisos --------------------------------------------------------
revoke execute on function public._ajustar_stock(uuid, int, boolean, uuid) from public, anon, authenticated;

-- Empleados: permisos, actividad, stock y cancha (29/10/2026)
revoke execute on function public._venta_de_turno(uuid) from public, anon, authenticated;
revoke execute on function public._registrar(text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public._registrar_venta(uuid) from public, anon, authenticated;
revoke execute on function public._actividad() from public, anon, authenticated;
revoke execute on function public._controlar_fijo() from public, anon, authenticated;
revoke execute on function public._fijo_cambiado() from public, anon, authenticated;
revoke execute on function public.senar_turno_cancha(uuid, numeric, text) from public, anon;
revoke execute on function public.cerrar_turno_con_sena(uuid) from public, anon;
revoke execute on function public.preparar_turnos_fijos(date) from public, anon;
revoke execute on function public.cargar_mercaderia(jsonb, text) from public, anon;
revoke execute on function public.ajustar_stock(uuid, int, text) from public, anon;
grant execute on function public.senar_turno_cancha(uuid, numeric, text) to authenticated;
grant execute on function public.cerrar_turno_con_sena(uuid) to authenticated;
grant execute on function public.preparar_turnos_fijos(date) to authenticated;
grant execute on function public.cargar_mercaderia(jsonb, text) to authenticated;
grant execute on function public.ajustar_stock(uuid, int, text) to authenticated;

alter table public.cancha_fijos        enable row level security;
alter table public.cancha_fijos_libres enable row level security;
alter table public.ajustes             enable row level security;
alter table public.stock_movimientos   enable row level security;
alter table public.actividad           enable row level security;

revoke all on public.cancha_fijos, public.cancha_fijos_libres, public.ajustes,
              public.stock_movimientos, public.actividad from anon;
-- Historiales: solo los escribe la base; nadie los edita ni los borra
revoke insert, update, delete on public.stock_movimientos, public.actividad, public.cancha_fijos_libres from authenticated;
-- Los productos de una venta y los cobros se tocan solo con las funciones
revoke insert, update, delete on public.venta_items from authenticated;
revoke delete on public.pagos from authenticated;

drop policy if exists "cancha_fijos_admin" on public.cancha_fijos;
create policy "cancha_fijos_admin" on public.cancha_fijos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "cancha_fijos_libres_admin" on public.cancha_fijos_libres;
create policy "cancha_fijos_libres_admin" on public.cancha_fijos_libres
  for select to authenticated using (public.es_admin());

drop policy if exists "ajustes_lectura" on public.ajustes;
create policy "ajustes_lectura" on public.ajustes
  for select to authenticated using (public.es_admin());
drop policy if exists "ajustes_dueno" on public.ajustes;
create policy "ajustes_dueno" on public.ajustes
  for all to authenticated using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists "stock_movimientos_admin" on public.stock_movimientos;
create policy "stock_movimientos_admin" on public.stock_movimientos
  for select to authenticated using (public.es_admin());

drop policy if exists "actividad_dueno" on public.actividad;
create policy "actividad_dueno" on public.actividad
  for select to authenticated using (public.es_dueno());

commit;

-- Comprobación: tiene que mostrar 5 tablas nuevas (o ya existentes) en 0 o más
select 'actividad' as tabla, count(*) from public.actividad
union all select 'stock_movimientos', count(*) from public.stock_movimientos
union all select 'cancha_fijos', count(*) from public.cancha_fijos
union all select 'cancha_fijos_libres', count(*) from public.cancha_fijos_libres
union all select 'ajustes', count(*) from public.ajustes;
