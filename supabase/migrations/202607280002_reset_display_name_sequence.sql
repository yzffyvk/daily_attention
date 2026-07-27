do $$
begin
  if not (
    not exists (select 1 from auth.users)
    and not exists (select 1 from public.profiles)
    and not exists (select 1 from private.account_recovery_credentials)
    and not exists (select 1 from public.check_ins)
    and not exists (
      select 1 from storage.objects where bucket_id = 'checkin-images'
    )
  ) then
    raise exception 'DISPLAY_NAME_SEQUENCE_RESET_REQUIRES_CLEAN_SLATE';
  end if;

  perform pg_catalog.setval(
    'private.attention_display_name_seq'::regclass,
    1,
    false
  );
end;
$$;
