-- ============================================================================
-- Storage buckets for Resource Planning.
-- Already created via API on the current project; this file exists so a fresh
-- project can reproduce it. Paste into the Supabase SQL Editor and Run.
--
-- The 'cvs' bucket is PRIVATE. All uploads and downloads go through
-- authenticated server actions using the service-role key (which bypasses
-- storage RLS), so no public access or storage.objects policies are needed.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs',
  'cvs',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

-- The 'oem-letters' bucket holds manufacturer authorisation letters. Also PRIVATE,
-- accessed only through service-role server actions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'oem-letters',
  'oem-letters',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;
