SET SERVEROUTPUT ON;

-- INIT_MODEL_SEED
-- Purpose:
--   Prepare seed tables, settings tables, and optional sample training data
--   required by project-provided Oracle Machine Learning models.
--
-- Authoring rule:
--   Keep this file idempotent. Existing seed objects should be skipped,
--   merged, or recreated intentionally.

DECLARE
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL SEED START ===');
    DBMS_OUTPUT.PUT_LINE('[INFO] Add ML seed table/settings/data preparation logic to database/INIT_MODEL_SEED.sql.');
    DBMS_OUTPUT.PUT_LINE('[INFO] Deploy status is recorded by M91001 after execution.');
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL SEED END ===');
END;
/
