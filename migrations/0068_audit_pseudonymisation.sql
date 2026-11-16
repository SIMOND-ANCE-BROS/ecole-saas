-- Pseudonymisation of personal values in the audit log (#184, ADR 0010).
--
-- TOUCHES AN IMMUTABILITY TRIGGER: `audit_log_append_only` (0001, renamed in 0027) refused every
-- UPDATE and DELETE. It now still refuses every DELETE, and refuses every UPDATE except one that
-- only replaces, in `before`/`after`, the string value of a key listed by `audit_personal_keys()`
-- for the row's `target_table` with the placeholder `audit_placeholder()`: same row, same columns,
-- same JSON keys, every other value identical. Amounts, dates, ids and methods can therefore never
-- change, whoever runs the UPDATE (the trigger also fires for the owner and for superusers).
--
-- On top of the content check, app_user loses UPDATE and DELETE on audit_log: the only way it can
-- change a row is `pseudonymise_audit_entries(ids)`, SECURITY DEFINER, which redacts the given rows
-- of the current school (`app.school_id`, set by withSchool) and writes its own audit entry (ids and
-- a count only). TRUNCATE is refused by a statement trigger.
--
-- The list of personal keys is code, not a table: default privileges (0006) would grant app_user
-- INSERT on a new table, which would let it declare `amount_cents` personal. A new personal key
-- takes a new migration (and its mirror `PERSONAL_KEYS`, src/domain/audit/pseudonymise.ts, which
-- an integration test keeps equal).
CREATE FUNCTION audit_personal_keys() RETURNS TABLE (target_table text, key text)
  LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  VALUES
    -- E-mail of an invited person (#178); `name` is not logged today, listed in case it is.
    ('invitation', 'email'),
    ('invitation', 'name'),
    -- Free text typed for a price apart from the grid (#292, #316, #297).
    ('enrollment', 'reason'),
    ('lesson_pack', 'reason'),
    ('workshop_signup', 'reason'),
    ('workshop_signup', 'priceReason')
$$;--> statement-breakpoint
CREATE FUNCTION audit_placeholder() RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '[pseudonymisé]'::text $$;--> statement-breakpoint
-- `value` with the string values of its personal keys replaced by the placeholder; anything that is
-- not a JSON object is returned as it is.
CREATE FUNCTION audit_redacted(p_table text, p_value jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'object' THEN p_value
    ELSE COALESCE(
      (SELECT pg_catalog.jsonb_object_agg(
          e.key,
          CASE
            WHEN pg_catalog.jsonb_typeof(e.value) = 'string'
              AND EXISTS (SELECT 1 FROM public.audit_personal_keys() k WHERE k.target_table = p_table AND k.key = e.key)
            THEN pg_catalog.to_jsonb(public.audit_placeholder())
            ELSE e.value
          END)
        FROM pg_catalog.jsonb_each(p_value) e),
      '{}'::jsonb)
  END
$$;--> statement-breakpoint
-- Whether `p_new` is `p_old` with, at most, string values of personal keys replaced by the
-- placeholder: the only change the trigger lets through.
CREATE FUNCTION audit_redaction_allowed(p_table text, p_old jsonb, p_new jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_old IS NULL OR p_new IS NULL THEN p_old IS NOT DISTINCT FROM p_new
    WHEN pg_catalog.jsonb_typeof(p_old) <> 'object' OR pg_catalog.jsonb_typeof(p_new) <> 'object' THEN p_old = p_new
    ELSE
      (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(p_old) k)
        IS NOT DISTINCT FROM (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(p_new) k)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(p_old) o
        WHERE o.value IS DISTINCT FROM p_new -> o.key
          AND NOT (
            pg_catalog.jsonb_typeof(o.value) = 'string'
            AND p_new -> o.key = pg_catalog.to_jsonb(public.audit_placeholder())
            AND EXISTS (SELECT 1 FROM public.audit_personal_keys() k WHERE k.target_table = p_table AND k.key = o.key)
          )
      )
  END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.id = OLD.id
    AND NEW.school_id = OLD.school_id
    AND NEW.at = OLD.at
    AND NEW.actor IS NOT DISTINCT FROM OLD.actor
    AND NEW.target_table = OLD.target_table
    AND NEW.row_id = OLD.row_id
    AND NEW.action = OLD.action
    AND public.audit_redaction_allowed(OLD.target_table, OLD.before, NEW.before)
    AND public.audit_redaction_allowed(OLD.target_table, OLD.after, NEW.after)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The audit log can be neither modified nor deleted';
END $$;--> statement-breakpoint
CREATE FUNCTION audit_log_no_truncate() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be truncated';
END $$;--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;--> statement-breakpoint
-- Redacts the given rows of the current school (at most 500 per call: within the statement
-- timeout of withSchool) and logs the run with ids and a count only; returns how many changed.
-- SECURITY DEFINER, owned by the migration role, which bypasses RLS (#279): the school filter
-- below is what keeps it to the current school. Rows already redacted change nothing.
CREATE FUNCTION pseudonymise_audit_entries(p_ids bigint[]) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_school uuid := NULLIF(pg_catalog.current_setting('app.school_id', true), '')::uuid;
  v_changed bigint[];
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'pseudonymise_audit_entries runs inside withSchool()';
  END IF;
  IF pg_catalog.cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'pseudonymise_audit_entries takes at most 500 ids';
  END IF;
  PERFORM 1 FROM public.audit_log a
    WHERE a.school_id = v_school AND a.id = ANY (p_ids)
    ORDER BY a.id
    FOR UPDATE;
  WITH changed AS (
    UPDATE public.audit_log a
    SET before = public.audit_redacted(a.target_table, a.before),
        after = public.audit_redacted(a.target_table, a.after)
    WHERE a.school_id = v_school
      AND a.id = ANY (p_ids)
      AND (a.before IS DISTINCT FROM public.audit_redacted(a.target_table, a.before)
        OR a.after IS DISTINCT FROM public.audit_redacted(a.target_table, a.after))
    RETURNING a.id
  )
  SELECT pg_catalog.array_agg(c.id ORDER BY c.id) INTO v_changed FROM changed c;
  IF v_changed IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.audit_log (school_id, actor, target_table, row_id, action, before, after)
  VALUES (
    v_school, NULL, 'audit_log', v_school, 'update', NULL,
    pg_catalog.jsonb_build_object('pseudonymised', pg_catalog.cardinality(v_changed), 'ids', pg_catalog.to_jsonb(v_changed))
  );
  RETURN pg_catalog.cardinality(v_changed);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION pseudonymise_audit_entries(bigint[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pseudonymise_audit_entries(bigint[]) TO app_user;
