SET SERVEROUTPUT ON;

-- INIT_MODEL_OBJECTS
-- Purpose:
--   Manifest for project-provided model packages, procedures, and functions.
--   M99001 deploys the split files below in order.
--
-- Manual SQLcl execution order:
--   @@model_objects/INIT_MODEL_OBJECTS_00_CORE.sql
--   @@model_objects/INIT_MODEL_OBJECTS_10_RULE_SUMMARY.sql
--   @@model_objects/INIT_MODEL_OBJECTS_20_RULE_MODELS.sql
--   @@model_objects/INIT_MODEL_OBJECTS_30_CORRELATION.sql
--   @@model_objects/INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql

@@model_objects/INIT_MODEL_OBJECTS_00_CORE.sql
@@model_objects/INIT_MODEL_OBJECTS_10_RULE_SUMMARY.sql
@@model_objects/INIT_MODEL_OBJECTS_20_RULE_MODELS.sql
@@model_objects/INIT_MODEL_OBJECTS_30_CORRELATION.sql
@@model_objects/INIT_MODEL_OBJECTS_40_PREDICTED_TYPE.sql
