DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fluesterlos') THEN
    CREATE ROLE fluesterlos LOGIN PASSWORD 'fluesterlos';
  END IF;
END
$$;
ALTER ROLE fluesterlos WITH LOGIN PASSWORD 'fluesterlos';
