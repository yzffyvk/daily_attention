alter table public.check_ins
  drop constraint check_ins_image_path_check;

alter table public.check_ins
  add constraint check_ins_image_path_check
  check (
    image_path is null
    or (
      length(image_path) <= 1024
      and split_part(image_path, '/', 1) = user_id::text
      and image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  );
