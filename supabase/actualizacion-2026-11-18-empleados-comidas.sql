-- =====================================================================
-- Las Palmeras Club · Actualización del 18/11/2026
-- Los empleados también agregan y editan comidas (nombre, precio, foto,
-- categoría, opciones, destacado…). Borrar una comida sigue siendo solo
-- del dueño. Cada cambio queda en Actividad con el usuario que lo hizo.
--
-- Para una base que YA está andando: pegá este archivo entero en
-- Supabase → SQL Editor → New query → Run. Se puede volver a correr.
-- =====================================================================

begin;

-- Antes: crear y borrar, solo el dueño. Ahora: solo borrar.
drop trigger if exists comidas_solo_dueno on public.comidas;
create trigger comidas_solo_dueno before delete on public.comidas
  for each row execute function public._solo_dueno('Borrar un producto lo puede hacer solo el dueño.');

-- Antes el empleado solo podía cambiar "activo" (si hay o no hay)
drop trigger if exists comidas_permisos on public.comidas;

commit;
