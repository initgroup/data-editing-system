-- [AUTH_SIGNUP_EXISTING_USER]
SELECT USE_YN
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId;

-- [AUTH_SIGNUP_INSERT_USER]
INSERT INTO "INIT$_TB_USER" (
    LOGIN_ID,
    USER_NAME,
    EMAIL,
    PASSWORD_HASH,
    ROLE_CODE,
    USE_YN,
    CREATED_AT
) VALUES (
    :loginId,
    :userName,
    :email,
    :passwordHash,
    :roleCode,
    :useYn,
    SYSTIMESTAMP
);

-- [AUTH_LOGIN_USER]
SELECT USER_ID,
       LOGIN_ID,
       USER_NAME,
       EMAIL,
       PASSWORD_HASH,
       USE_YN,
       ROLE_CODE
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId;
