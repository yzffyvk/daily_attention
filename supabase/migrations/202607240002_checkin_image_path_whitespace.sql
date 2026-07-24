alter table public.check_ins
  drop constraint check_ins_image_path_check;

alter table public.check_ins
  add constraint check_ins_image_path_check
  check (
    image_path is null
    or (
      image_path ~ '[^[:space:]]'
      and length(image_path) <= 1024
    )
  );
