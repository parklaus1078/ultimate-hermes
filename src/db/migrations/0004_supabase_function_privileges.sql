do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    return;
  end if;

  execute 'revoke execute on function public.rls_auto_enable() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.rls_auto_enable() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end
$$;
