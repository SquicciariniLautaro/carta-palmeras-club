-- =====================================================================
-- Las Palmeras Club · Actualización del 19/11/2026
-- Cuentas abiertas, consumos en la cancha, regalos y platos del mediodía a $ 7.500
--
--   1. Cuentas que pagan al final (mesas, barra): tienen su propio panel,
--      "Cuentas abiertas", separado de los pedidos de delivery / carta. Se
--      les van sumando cosas y se cobran al final.
--   2. Cancha: lo que consumen (bebidas, comida) se anota en la cuenta del
--      turno y se cobra todo junto con el alquiler.
--   3. Regalos (la cerveza que va con la cancha, una vuelta de la casa…): se
--      anotan a $ 0, descuentan stock y quedan registrados con lo que valen.
--   4. Todos los platos del mediodía pasan a $ 7.500 (los de kiosco no) y
--      quedan disponibles. El que vale más se cambia desde Platos → Editar.
--      Si volvés a correr este archivo, los precios NO se vuelven a pisar.
--
-- Para una base que YA está andando: pegá este archivo entero en
-- Supabase → SQL Editor → New query → Run. Se puede volver a correr.
-- =====================================================================

begin;

-- 1. Columnas nuevas ----------------------------------------------------
alter table public.ventas add column if not exists es_cuenta boolean not null default false;
-- Las ventas en caja que quedaron abiertas de antes pasan a ser cuentas
update public.ventas set es_cuenta = true
 where origen = 'manual' and turno in ('noche', 'mediodia') and estado <> 'cerrado' and not es_cuenta;

alter table public.venta_items add column if not exists regalo boolean not null default false;
alter table public.venta_items add column if not exists precio_lista numeric(12,2);
alter table public.venta_items drop constraint if exists venta_items_precio_lista_check;
alter table public.venta_items add constraint venta_items_precio_lista_check check (precio_lista is null or precio_lista >= 0);
alter table public.venta_items drop constraint if exists venta_items_regalo_check;
alter table public.venta_items add constraint venta_items_regalo_check check (not regalo or (precio_unitario = 0 and subtotal = 0));

-- 2. Funciones ----------------------------------------------------------
-- Cada producto vendido descuenta su stock; si se saca del pedido, se borra
-- la venta o se cancela el pedido, vuelve.
create or replace function public._mover_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_web boolean;
begin
  -- Al juntar dos líneas iguales de una cuenta (_sumar_items) el stock ya se movió
  if current_setting('palmeras.sin_stock', true) = 'si' then
    return null;
  end if;
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

-- Turnos de la cancha: no se pisan, y uno cobrado no cambia de precio ni se
-- borra sin anular el cobro.
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
      raise exception 'Este turno ya está cobrado o señado, o tiene consumos anotados. Para borrarlo, primero anulá el cobro o sacá los consumos de su cuenta.';
    end if;
    -- Turno fijo: se libera solo ese día (no se vuelve a anotar)
    if old.fijo_id is not null then
      insert into public.cancha_fijos_libres (fijo_id, fecha) values (old.fijo_id, old.fecha) on conflict do nothing;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.venta_id is not null and new.venta_id is not null and new.precio <> old.precio then
    raise exception 'Este turno ya tiene su cuenta (cobro, seña o consumos). Para cambiarle el precio, primero anulá el cobro o sacá los consumos.';
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
    case when v.origen = 'web' then 'Pedido web' when v.es_cuenta then 'Abrió una cuenta' else 'Venta en caja' end,
    '#' || v.numero || coalesce(' · ' || v.cliente_nombre, '') || ' · ' || initcap(v.turno), v.total);
end;
$$;

-- Una venta solo se cierra registrando el cobro, y una cobrada no se reabre
-- sin anular el cobro (así los números de caja siempre cierran)
create or replace function public._controlar_cierre_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Una cuenta en $ 0 (todo de regalo) se cierra sin cobro
  if new.estado = 'cerrado' and old.estado <> 'cerrado' and new.total > 0
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
     and (old.estado = 'cerrado' or exists (select 1 from public.pagos p where p.venta_id = v_id)) then
    raise exception 'Esta venta ya tiene un cobro: solo el dueño puede borrarla o cancelarla.';
  end if;
  -- Una venta cerrada (también una de regalos, sin cobro) la reabre solo el dueño
  if tg_op = 'UPDATE' and old.estado = 'cerrado' and new.estado <> 'cerrado' then
    raise exception 'Esta venta ya está cerrada: solo el dueño puede reabrirla.';
  end if;
  return coalesce(new, old);
end;
$$;

-- Agrega ítems a una venta tomando los precios de la base.
-- p_items: [{ "comida_id": "<uuid>", "cantidad": 2,
--             "variante": "Doble", "quitar": ["Cebolla"], "agregar": ["Huevo"],
--             "aclaracion": "bien cocida" }, ...]
-- Solo comida_id y cantidad son obligatorios. Cada combinación distinta
-- (por ejemplo una doble sin cebolla) es una línea aparte.
-- "regalo": true = cortesía (solo desde el panel): va a $ 0, descuenta stock y
-- guarda en precio_lista lo que vale en la carta. Queda en Actividad.
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
  v_regalo   boolean;
  v_numero   bigint;
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
             nullif(btrim(x.aclaracion), '') as aclaracion,
             coalesce(x.regalo, false) as regalo
      from jsonb_to_recordset(p_items)
           as x (comida_id uuid, cantidad int, variante text, quitar jsonb, agregar jsonb, aclaracion text, regalo boolean)
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
      -- Los regalos los anota solo el local (nunca un pedido de la carta online)
      if r.regalo and p_solo_activas then
        raise exception 'Hay un producto con datos inválidos en el pedido.';
      end if;
      v_regalo := r.regalo;

      select * into c from public.comidas where id = r.comida_id;
      if not found or (p_solo_activas and (not c.activo or c.turno <> 'noche')) then
        raise exception 'Un producto del pedido ya no está disponible. Actualizá la página e intentá de nuevo.';
      end if;

      v_precio  := coalesce(c.precio_promo, c.precio);   -- el precio sale de la base, nunca del cliente
      v_partes  := case when v_regalo then '{Regalo}'::text[] else '{}'::text[] end;
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

      insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal, regalo, precio_lista)
      values (p_venta_id, c.id, c.nombre, nullif(array_to_string(v_partes, ' · '), ''),
              case when v_regalo then 0 else v_precio end, r.cantidad,
              case when v_regalo then 0 else v_precio * r.cantidad end, v_regalo, v_precio);

      if v_regalo then
        select v.numero into v_numero from public.ventas v where v.id = p_venta_id;
        perform public._registrar('venta', 'Anotó un regalo',
          '#' || v_numero || ' · ' || r.cantidad || 'x ' || c.nombre || coalesce(' (' || r.aclaracion || ')', ''),
          v_precio * r.cantidad);
      end if;
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
  v_web      boolean;
  -- Pedido web: límites del carrito. En el local (cuentas de mesa, barra o
  -- cancha que se llenan durante horas) los límites son más amplios.
  v_max_lineas   int;
  v_max_unidades int;
  v_max_producto int;
begin
  select v.origen = 'web' into v_web from public.ventas v where v.id = p_venta_id;
  v_max_lineas   := case when v_web then 30 else 100 end;
  v_max_unidades := case when v_web then 100 else 500 end;
  v_max_producto := case when v_web then 50 else 200 end;

  select count(*), coalesce(sum(cantidad), 0), coalesce(sum(subtotal), 0)
    into v_lineas, v_unidades, v_total
    from public.venta_items
   where venta_id = p_venta_id;

  if v_lineas = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if v_lineas > v_max_lineas then
    raise exception 'El pedido tiene demasiados productos (máximo % distintos).', v_max_lineas;
  end if;
  if v_unidades > v_max_unidades then
    raise exception 'El pedido supera el máximo de % unidades.', v_max_unidades;
  end if;
  if exists (select 1 from public.venta_items
              where venta_id = p_venta_id
              group by comida_id
             having sum(cantidad) > v_max_producto) then
    raise exception 'Se pueden pedir hasta % unidades de cada producto.', v_max_producto;
  end if;

  update public.ventas set total = v_total where id = p_venta_id;
end;
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
  v_resta    numeric(12,2);   -- el total menos lo que ya se pagó antes (seña)
begin
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v.estado = 'cerrado' then
    raise exception 'Esta cuenta ya está cobrada.';
  end if;
  v_resta := v.total - (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = p_venta_id);

  -- No queda nada por cobrar (todo de regalo, o ya se pagó con la seña): se cierra sin cobro
  if v_resta = 0 and (p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0) then
    update public.ventas set estado = 'cerrado', cerrada_at = now() where id = p_venta_id;
    return;
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

-- Solo admin: venta en el local (caja), de la noche o del mediodía.
--   pagos = null  → queda como cuenta abierta (mesa, barra): va al panel
--                   "Cuentas abiertas", se le van sumando cosas y se cobra al final
--   pagos = [...] → se cobra en el momento (mismo formato que cobrar_venta)
--   pagos = []    → solo si da $ 0 (todo de regalo): se cierra sin cobro
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
                              registrar_venta_local.nota, 'manual', false,
                              case when registrar_venta_local.pagos is null then 'entregado' else 'pendiente' end,
                              registrar_venta_local.turno, null);
  if registrar_venta_local.pagos is null then
    update public.ventas v set es_cuenta = true where v.id = v_id;
  end if;
  perform public._registrar_venta(v_id);

  if registrar_venta_local.pagos is not null then
    perform public._cobrar(v_id, registrar_venta_local.pagos);
  end if;

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'estado', v.estado)
          from public.ventas v where v.id = v_id);
end;
$$;

-- Solo admin: edita un pedido que todavía no se cobró.
--   items:  líneas que se conservan, con su cantidad: [{ "id": "<venta_item>", "cantidad": 2 }]
--           (las que no vienen se borran; mantienen el precio con el que se pidieron)
--   nuevos: líneas para sumar, mismo formato que crear_pedido (precio actual de la base)
-- En la cuenta de un turno de cancha, el alquiler no se saca (se cambia desde el
-- turno). Si se sacan todos los consumos y no hay seña, la cuenta se borra y el
-- turno vuelve a quedar solo reservado.
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
  v_max     int;
  v_pagado  numeric(12,2);
  v_total   numeric(12,2);
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select * into v_antes from public.ventas v where v.id = editar_venta.venta_id for update;
  v_max := case when v_antes.origen = 'web' then 50 else 200 end;
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
    -- El alquiler de la cancha queda como está
    if v_antes.turno = 'cancha' and exists (
         select 1 from public.venta_items vi
          where vi.venta_id = editar_venta.venta_id and vi.comida_id is null
            and not exists (select 1 from jsonb_to_recordset(v_items) as x (id uuid, cantidad int)
                             where x.id = vi.id and x.cantidad = vi.cantidad)) then
      raise exception 'El alquiler de la cancha no se saca ni se cambia desde la cuenta: cambialo desde el turno.';
    end if;

    -- Borra las líneas que ya no están
    delete from public.venta_items vi
     where vi.venta_id = editar_venta.venta_id
       and not exists (select 1 from jsonb_array_elements(v_items) e
                        where (e ->> 'id')::uuid = vi.id);

    -- Actualiza cantidades (el precio unitario queda como estaba)
    for r in select x.id, x.cantidad from jsonb_to_recordset(v_items) as x (id uuid, cantidad int) loop
      if r.id is null or r.cantidad is null or r.cantidad <= 0 or r.cantidad > v_max then
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
  v_total  := (select v.total from public.ventas v where v.id = editar_venta.venta_id);
  v_pagado := (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = editar_venta.venta_id);
  if v_total < v_pagado then
    raise exception 'La cuenta quedaría en % y ya se pagó % (seña): no puede quedar por debajo.',
      public._pesos(v_total), public._pesos(v_pagado);
  end if;

  -- Cancha sin consumos ni seña: se borra la cuenta y el turno queda solo reservado
  if v_antes.turno = 'cancha' and v_pagado = 0
     and not exists (select 1 from public.venta_items vi where vi.venta_id = editar_venta.venta_id and vi.comida_id is not null) then
    perform set_config('palmeras.automatico', 'si', true);
    delete from public.ventas v where v.id = editar_venta.venta_id;
    perform set_config('palmeras.automatico', '', true);
    perform public._registrar('cancha', 'Sacó los consumos de un turno',
      '#' || v_antes.numero || coalesce(' · ' || v_antes.cliente_nombre, '') || ' · total ' || public._pesos(v_antes.total)
        || ' → ' || public._pesos(v_total), v_total);
    return jsonb_build_object('numero', v_antes.numero, 'total', v_total);
  end if;

  perform public._registrar('venta', 'Editó un pedido',
    '#' || v_antes.numero || ' · total ' || public._pesos(v_antes.total) || ' → ' || public._pesos(v_total), v_total);

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = editar_venta.venta_id);
end;
$$;

-- Solo dueño: anula el cobro (o la seña) de un turno de la cancha: lo cobrado
-- sale de la caja. Si la cuenta tiene consumos, quedan anotados y la cuenta
-- vuelve a estar abierta; si era solo el alquiler, se borra y el turno queda
-- reservado sin cobrar. No se puede si el cobro ya está en un arqueo cerrado.
create or replace function public.anular_cobro_cancha(turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ventas%rowtype;
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede anular un cobro.';
  end if;
  select x.* into v
    from public.cancha_turnos c join public.ventas x on x.id = c.venta_id
   where c.id = anular_cobro_cancha.turno_id
     for update of c;
  if not found or (v.estado <> 'cerrado' and not exists (select 1 from public.pagos p where p.venta_id = v.id)) then
    raise exception 'Este turno no está cobrado ni señado.';
  end if;
  if exists (select 1 from public.venta_items i where i.venta_id = v.id and i.comida_id is not null) then
    delete from public.pagos p where p.venta_id = v.id;
    update public.ventas x set estado = 'entregado', cerrada_at = null where x.id = v.id;
  else
    delete from public.ventas x where x.id = v.id;   -- el turno queda sin cobrar (on delete set null)
  end if;
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
  v_total  numeric(12,2);
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
  -- Lo que hay que pagar: el alquiler más lo que se consumió (si ya tiene cuenta)
  v_total := coalesce((select v.total from public.ventas v where v.id = t.venta_id), t.precio);
  if round(senar_turno_cancha.monto, 2) >= v_total - v_pagado then
    raise exception 'La seña tiene que ser menor que lo que falta pagar (%). Si paga todo, usá Cobrar.',
      public._pesos(v_total - v_pagado);
  end if;
  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para cobrar la seña.';
  end if;

  v_venta := public._venta_de_turno(t.id);
  insert into public.pagos (venta_id, caja_id, metodo, monto, concepto, nota)
  values (v_venta, v_caja, senar_turno_cancha.metodo, round(senar_turno_cancha.monto, 2), 'venta', 'Seña');

  return jsonb_build_object('pagado', v_pagado + round(senar_turno_cancha.monto, 2),
                            'resta', v_total - v_pagado - round(senar_turno_cancha.monto, 2));
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
  if exists (select 1 from public.venta_items i where i.venta_id = t.venta_id and i.comida_id is not null) then
    raise exception 'Este turno tiene consumos anotados en su cuenta: si no vino, sacalos antes de cerrarlo con la seña.';
  end if;
  if not exists (select 1 from public.pagos p where p.venta_id = t.venta_id) then
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

-- Suma productos a una cuenta que todavía no se cobró (mismo formato que
-- crear_pedido, con "regalo" para las cortesías). Si ya hay una línea igual
-- (mismo producto, opciones y precio), le suma la cantidad en vez de repetirla.
create or replace function public._sumar_items(p_venta_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes  uuid[];
  v_nuevas uuid[];
  r        record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto.';
  end if;
  v_antes := coalesce((select array_agg(i.id) from public.venta_items i where i.venta_id = p_venta_id), '{}');
  perform public._agregar_items(p_venta_id, p_items, false);
  v_nuevas := coalesce((select array_agg(i.id) from public.venta_items i
                         where i.venta_id = p_venta_id and not (i.id = any (v_antes))), '{}');

  -- El stock ya se descontó al agregar: juntar las líneas no lo vuelve a mover
  perform set_config('palmeras.sin_stock', 'si', true);
  for r in
    select n.id as nueva, n.cantidad,
           (select e.id from public.venta_items e
             where e.venta_id = n.venta_id and e.id = any (v_antes)
               and e.comida_id is not distinct from n.comida_id and e.nombre = n.nombre
               and e.detalle is not distinct from n.detalle and e.precio_unitario = n.precio_unitario
               and e.regalo = n.regalo
             order by e.id limit 1) as vieja
      from public.venta_items n
     where n.id = any (v_nuevas)
  loop
    if r.vieja is not null then
      update public.venta_items e
         set cantidad = e.cantidad + r.cantidad, subtotal = e.precio_unitario * (e.cantidad + r.cantidad)
       where e.id = r.vieja;
      delete from public.venta_items e where e.id = r.nueva;
    end if;
  end loop;
  perform set_config('palmeras.sin_stock', '', true);

  perform public._recalcular_venta(p_venta_id);
end;
$$;

-- Admin: suma productos (o regalos) a una cuenta abierta: mesa, barra o un
-- pedido que todavía no se cobró.
create or replace function public.sumar_a_cuenta(venta_id uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.ventas%rowtype;
  v_total numeric(12,2);
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into v from public.ventas x where x.id = sumar_a_cuenta.venta_id for update;
  if not found then
    raise exception 'La cuenta no existe.';
  end if;
  if v.estado = 'cerrado' then
    raise exception 'Esta cuenta ya está cobrada. Para sumarle algo, abrí otra cuenta.';
  end if;

  perform public._sumar_items(v.id, sumar_a_cuenta.items);
  v_total := (select x.total from public.ventas x where x.id = v.id);
  perform public._registrar('venta', 'Sumó a la cuenta',
    '#' || v.numero || coalesce(' · ' || v.cliente_nombre, '') || ' · total ' || public._pesos(v.total) || ' → ' || public._pesos(v_total),
    v_total);
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v_total);
end;
$$;

-- Admin: suma lo que consumen en la cancha (bebidas, comida, regalos) a la
-- cuenta del turno, así se cobra todo junto con el alquiler.
create or replace function public.sumar_a_turno_cancha(turno_id uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.cancha_turnos%rowtype;
  v_venta uuid;
  v_antes numeric(12,2);
  v       public.ventas%rowtype;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into t from public.cancha_turnos c where c.id = sumar_a_turno_cancha.turno_id for update;
  if not found then
    raise exception 'El turno no existe.';
  end if;
  if exists (select 1 from public.ventas x where x.id = t.venta_id and x.estado = 'cerrado') then
    raise exception 'Este turno ya está cobrado. Lo que consuman después, anotalo en una cuenta nueva.';
  end if;

  v_antes := coalesce((select x.total from public.ventas x where x.id = t.venta_id), t.precio);
  v_venta := public._venta_de_turno(t.id);
  perform public._sumar_items(v_venta, sumar_a_turno_cancha.items);
  select * into v from public.ventas x where x.id = v_venta;
  perform public._registrar('cancha', 'Sumó consumos al turno',
    to_char(t.fecha, 'DD/MM') || ' ' || to_char(t.desde, 'HH24:MI') || ' · ' || t.cliente_nombre
      || ' · total ' || public._pesos(v_antes) || ' → ' || public._pesos(v.total),
    v.total);
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total);
end;
$$;

revoke execute on function public._sumar_items(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.sumar_a_cuenta(uuid, jsonb) from public, anon;
revoke execute on function public.sumar_a_turno_cancha(uuid, jsonb) from public, anon;
grant execute on function public.sumar_a_cuenta(uuid, jsonb) to authenticated;
grant execute on function public.sumar_a_turno_cancha(uuid, jsonb) to authenticated;

-- 3. Platos del mediodía a $ 7.500 (una sola vez) -------------------------
-- Solo los platos de cocina sin variantes; bebidas y golosinas quedan como están.
-- Queda una línea en Actividad, y por ella sabemos que ya se hizo.
do $$
declare
  v_n int;
begin
  if exists (select 1 from public.actividad where tipo = 'catalogo' and accion = 'Puso $ 7.500 a los platos del mediodía') then
    return;
  end if;
  -- Sin una línea de actividad por plato
  perform set_config('palmeras.automatico', 'si', true);
  update public.comidas c
     set precio       = 7500,
         precio_promo = case when c.precio_promo < 7500 then c.precio_promo end,
         activo       = case when c.precio is null then true else c.activo end
   where c.turno = 'mediodia'
     and not exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock)
     and coalesce(jsonb_array_length(case when jsonb_typeof(c.opciones -> 'variantes') = 'array' then c.opciones -> 'variantes' end), 0) = 0;
  get diagnostics v_n = row_count;
  perform set_config('palmeras.automatico', '', true);
  insert into public.actividad (usuario, rol, tipo, accion, detalle, monto)
  values (null, null, 'catalogo', 'Puso $ 7.500 a los platos del mediodía', v_n || ' platos', 7500);
end;
$$;

commit;

-- Comprobación: los platos del mediodía con su precio
select k.nombre as categoria, count(*) as platos, min(c.precio) as desde, max(c.precio) as hasta,
       count(*) filter (where c.activo) as disponibles
from public.comidas c
join public.categorias k on k.id = c.categoria_id
where c.turno = 'mediodia'
group by k.nombre, k.orden
order by k.orden;
