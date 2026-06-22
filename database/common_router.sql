-- [COMMON_AI_SHOWSQL]
SELECT "C##CLOUD$SERVICE".DBMS_CLOUD_AI.GENERATE(
    prompt => :prompt,
    profile_name => 'INITAI_PROFILE',
    action       => 'showsql'
) FROM DUAL;
