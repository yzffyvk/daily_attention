begin;

-- Saving a source does not require a fetchable web URL. AI generation validates
-- HTTP/HTTPS separately before it can create a fetch job.
alter table public.check_ins drop constraint check_ins_source_url_check;
alter table public.check_ins add constraint check_ins_source_url_check
  check (source_url is null or length(source_url) <= 2048);

create or replace function public.normalize_learning_source_url(value text)
returns text language plpgsql immutable strict security invoker set search_path='' as $$
declare result text:=btrim(value); authority text; rest text; fragment text;
begin
  -- Descriptive sources are compared as text, including any literal # characters.
  if result !~* '^https?://' then return result; end if;
  fragment:=substring(result from '#.*$');
  if fragment is not null and fragment !~* '^#([!/?]|%(2f|21|3f))' then result:=split_part(result,'#',1); end if;
  authority:=substring(result from '^https?://[^/?#]+');
  if authority is null then return result; end if;
  rest:=substring(result from length(authority)+1);
  authority:=lower(authority);
  if authority like 'https://%' then authority:=regexp_replace(authority,':443$','');
  else authority:=regexp_replace(authority,':80$',''); end if;
  if rest='' or left(rest,1) in ('?','#') then rest:='/'||rest; end if;
  return authority||rest;
end; $$;

commit;
