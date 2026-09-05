-- Doctor's Diary Database V2, P1 operational grants.
-- New discovery/lifecycle surfaces are RPC-only; bootstrap remains DB-owner only.

revoke all on function public.list_pending_credential_reviews(bigint,integer)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.read_credential_review_case(uuid)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.read_credential_review_history(uuid,bigint,integer)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.activate_platform_staff(uuid,text)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.deactivate_platform_staff(uuid,text)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.bootstrap_platform_admin(uuid,text)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;

-- Reassert the replaced role lifecycle functions explicitly.
revoke all on function public.grant_platform_staff_role(uuid,platform_staff_role)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.revoke_platform_staff_role(uuid)
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
grant execute on function public.list_pending_credential_reviews(bigint,integer),
  public.read_credential_review_case(uuid),
  public.read_credential_review_history(uuid,bigint,integer),
  public.activate_platform_staff(uuid,text),
  public.deactivate_platform_staff(uuid,text),
  public.grant_platform_staff_role(uuid,platform_staff_role),
  public.revoke_platform_staff_role(uuid)
to authenticated;

-- Explicitly deny service_role on every new/replaced operational surface.
revoke execute on function public.list_pending_credential_reviews(bigint,integer) from service_role;
revoke execute on function public.read_credential_review_case(uuid) from service_role;
revoke execute on function public.read_credential_review_history(uuid,bigint,integer) from service_role;
revoke execute on function public.activate_platform_staff(uuid,text) from service_role;
revoke execute on function public.deactivate_platform_staff(uuid,text) from service_role;
revoke execute on function public.grant_platform_staff_role(uuid,platform_staff_role) from service_role;
revoke execute on function public.revoke_platform_staff_role(uuid) from service_role;
revoke execute on function public.bootstrap_platform_admin(uuid,text) from service_role;

-- bootstrap_platform_admin intentionally receives NO application-role grant.
-- Its owner-only guard is additionally enforced inside the SECURITY INVOKER body.