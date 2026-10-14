-- Enforce the same Beijing day as the application, including direct Data API writes.
-- Existing future records are retained; new writes to them are rejected until that day.
create function private.guard_checkin_date()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.checkin_date > (clock_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception 'FUTURE_CHECKIN_DATE';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_checkin_date() from public, anon, authenticated;
create trigger check_ins_date_guard before insert or update on public.check_ins
for each row execute function private.guard_checkin_date();
