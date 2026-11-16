#!/bin/bash
# Two databases, two logins. The game role cannot connect to the house database.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE leaderboard_user LOGIN PASSWORD 'leaderboard_pass';
CREATE ROLE admin_user LOGIN PASSWORD 'admin_pass';
CREATE DATABASE freebj_leaderboard OWNER leaderboard_user;
CREATE DATABASE freebj_admin OWNER admin_user;
REVOKE ALL ON DATABASE freebj_leaderboard FROM PUBLIC;
REVOKE ALL ON DATABASE freebj_admin FROM PUBLIC;
GRANT CONNECT ON DATABASE freebj_leaderboard TO leaderboard_user;
GRANT CONNECT ON DATABASE freebj_admin TO admin_user;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname freebj_leaderboard <<'SQL'
ALTER SCHEMA public OWNER TO leaderboard_user;
GRANT ALL ON SCHEMA public TO leaderboard_user;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname freebj_admin <<'SQL'
ALTER SCHEMA public OWNER TO admin_user;
GRANT ALL ON SCHEMA public TO admin_user;
SQL
