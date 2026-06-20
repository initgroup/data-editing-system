SET SERVEROUTPUT ON;

-- INIT_MODEL_TRAIN
-- Purpose:
--   Train or import Oracle Machine Learning models on the selected target DB.
--
-- Recommended pattern:
--   1. Prepare required seed/training data in INIT_MODEL_SEED.sql.
--   2. Drop or version existing models intentionally.
--   3. Call DBMS_DATA_MINING.CREATE_MODEL or DBMS_DATA_MINING.IMPORT_MODEL.
--   4. Let M91001 record deployment status in INIT$_TB_OBJECT_DEPLOY.

DECLARE
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL TRAIN START ===');
    DBMS_OUTPUT.PUT_LINE('[INFO] Add DBMS_DATA_MINING.CREATE_MODEL or model import logic to database/INIT_MODEL_TRAIN.sql.');
    DBMS_OUTPUT.PUT_LINE('[INFO] Deploy status is recorded by M91001 after execution.');
    DBMS_OUTPUT.PUT_LINE('=== INIT MODEL TRAIN END ===');
END;
/
