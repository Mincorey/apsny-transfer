-- Аудит 29.09.2026, пункт В-13: любой вошедший мог перезаписать чужой
-- аватар и фото машины.
--
-- Было (политики Storage на бакете avatars):
--   INSERT  to authenticated  WITH CHECK (bucket_id = 'avatars')
--   UPDATE  to authenticated  USING      (bucket_id = 'avatars')
-- — ни слова о владельце. Файлы лежат по пути <id пользователя>/..., id
-- публичны, и одного запроса upload(..., { upsert: true }) хватало, чтобы
-- подменить чужую картинку. Сам бакет был без ограничений размера и типа.
--
-- Стало:
--   • писать, менять и удалять можно только в своей папке
--     (первая часть пути = auth.uid());
--   • появилась политика DELETE — раньше её не было, и удаление старого фото
--     из Profile.tsx молча не срабатывало, файлы копились;
--   • бакет принимает только JPEG / PNG / WebP до 5 МБ — проверяет сервер,
--     а не только браузер.
-- Чтение (Public can read avatars) не меняется: аватары публичные.

drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Authenticated users can update" on storage.objects;

create policy avatars_insert_own on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_update_own on storage.objects
  as permissive for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete_own on storage.objects
  as permissive for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

update storage.buckets
set file_size_limit    = 5242880,  -- 5 МБ
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';
