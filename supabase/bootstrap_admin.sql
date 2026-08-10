-- ============================================================================
-- Bootstrap the first admin account.
--
-- Run this AFTER you have:
--   1. Run supabase/setup.sql (creates the tables), and
--   2. Created a user in the dashboard: Authentication → Users → Add user
--      (set an email + password you'll remember, this is your admin login).
--
-- Then replace the email below with that same email and run this snippet.
-- It creates the matching profile row and marks it as an admin. We set
-- must_change_password = false so you can log straight in with the password
-- you just set (employees you create later WILL be forced to change theirs).
-- ============================================================================

insert into public.profiles (id, full_name, email, role, must_change_password)
select id, 'Admin', email, 'admin', false
from auth.users
where email = 'REPLACE_WITH_YOUR_ADMIN_EMAIL'
on conflict (id) do update
  set role = 'admin',
      must_change_password = false;
