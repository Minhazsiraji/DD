-- =============================================================================
-- Realtime for the live queue.
--
-- The publication existed but carried no tables, so nothing was ever live. Two
-- tables are added: the queue screen changes when an appointment's status moves
-- (someone arrives, starts, finishes) or when a queue row changes (called,
-- skipped, prioritised).
--
-- HOW THE CLIENT USES THIS: the payload is treated as a SIGNAL ONLY. Nothing
-- broadcast here is rendered. On any event the page re-fetches through
-- get_queue(), which is RLS-checked in the ordinary way, so what a user sees is
-- decided by the same policies as a normal read — not by whatever Realtime
-- chose to deliver.
--
-- That matters because Realtime's own RLS filtering is a separate mechanism
-- from the query path, and treating its payload as authoritative would mean
-- trusting two different filters to agree.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'queue_entries'
  ) then
    alter publication supabase_realtime add table public.queue_entries;
  end if;
end
$$;

/**
 * REPLICA IDENTITY FULL on queue_entries.
 *
 * Without it an UPDATE's old-row payload carries only the primary key, so a
 * subscriber filtering on practice_location_id would miss updates. The queue
 * only needs the signal, but a filter that silently matches nothing is worse
 * than no filter — it looks like a working subscription that never fires.
 */
alter table public.queue_entries  replica identity full;
alter table public.appointments   replica identity full;
