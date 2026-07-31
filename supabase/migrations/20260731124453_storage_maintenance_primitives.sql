create function public.delete_expired_storage_upload_reservations(
  target_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  with candidates as (
    select reservations.path
    from private.storage_upload_reservations reservations
    where reservations.expires_at <= pg_catalog.now()
      and not exists (
        select 1
        from storage.objects objects
        where objects.bucket_id = 'checkin-images'
          and objects.name = reservations.path
      )
    order by reservations.expires_at, reservations.path
    limit target_limit
  ),
  deleted as (
    delete from private.storage_upload_reservations reservations
    using candidates
    where reservations.path = candidates.path
    returning 1
  )
  select pg_catalog.count(*)::integer
  into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_storage_upload_reservations(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_expired_storage_upload_reservations(integer)
  to service_role;

create function public.list_orphan_checkin_image_paths(target_limit integer)
returns table (path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  return query
  select objects.name as path
  from storage.objects objects
  where objects.bucket_id = 'checkin-images'
    and objects.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1
      from public.check_ins records
      where records.image_path = objects.name
    )
  order by objects.created_at, objects.name
  limit target_limit;
end;
$$;

revoke all on function public.list_orphan_checkin_image_paths(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_orphan_checkin_image_paths(integer)
  to service_role;
