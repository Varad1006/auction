#!/usr/bin/env bash
# Creates the test users used by tests/e2e/smoke.mjs in a LOCAL Supabase
# (supabase start) and maps owner1/owner2 to the first two teams.
# The users are marked as Google sign-ins so the real role logic applies.
# Never run this against a hosted project.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
case "$NEXT_PUBLIC_SUPABASE_URL" in
  http://127.0.0.1*|http://localhost*) ;;
  *) echo "Refusing: NEXT_PUBLIC_SUPABASE_URL is not local" >&2; exit 1 ;;
esac
KEY="$SUPABASE_SERVICE_ROLE_KEY"
for who in admin owner1 owner2 stranger; do
  curl -s -o /dev/null -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$who@test.local\",\"password\":\"test-password-1\",\"email_confirm\":true,
         \"app_metadata\":{\"provider\":\"google\",\"providers\":[\"google\"]},
         \"user_metadata\":{\"full_name\":\"Test $who\"}}"
done
psql "${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -q -v ON_ERROR_STOP=1 <<'SQL'
insert into owners (email, team_id)
select 'owner' || rn || '@test.local', id
  from (select id, row_number() over (order by sort_order, name) rn from teams) t
 where rn <= 2
on conflict (email) do update set team_id = excluded.team_id;
SQL
echo "Test users ready (ADMIN_EMAILS must include admin@test.local)."
