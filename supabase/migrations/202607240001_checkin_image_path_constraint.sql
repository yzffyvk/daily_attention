alter table public.check_ins
  drop constraint check_ins_image_path_check;

alter table public.check_ins
  add constraint check_ins_image_path_check
  check (
    image_path is null
    or (
      length(trim(image_path)) > 0
      and length(image_path) <= 1024
    )
  );
