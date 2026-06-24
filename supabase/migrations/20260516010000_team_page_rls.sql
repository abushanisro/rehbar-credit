-- Allow all authenticated users to read the full team list (needed for TEAM page).
-- Previously only own-row SELECT was allowed; that was fine when the table was
-- private, but now any authenticated teammate should be able to see who else is
-- on the platform and what role they hold.

-- ── profiles: open SELECT to all authenticated ────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all_auth" ON public.profiles;
CREATE POLICY "profiles_select_all_auth" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- ── user_roles: open SELECT to all authenticated ──────────────────────────────
-- The existing "user_roles_admin_all" policy still guards INSERT / UPDATE / DELETE
-- so only admins can mutate roles. We only open reading.
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_all_auth" ON public.user_roles;
CREATE POLICY "user_roles_select_all_auth" ON public.user_roles
  FOR SELECT TO authenticated USING (true);
