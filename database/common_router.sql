-- [COMMON_AI_SET_PROFILE]
BEGIN
    DBMS_CLOUD_AI.set_profile('INITAI_PROFILE');
END;

-- [COMMON_AI_SHOWSQL]
SELECT "C##CLOUD$SERVICE".DBMS_CLOUD_AI.GENERATE(
    prompt => :prompt,
    profile_name => 'INITAI_PROFILE',
    action       => 'showsql'
) FROM DUAL;
