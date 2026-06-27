-- [M99004_NOTICE_DETAIL]
SELECT NOTICE_ID,
       NOTICE_TYPE,
       TITLE,
       CONTENT,
       POST_START_AT,
       POST_END_AT,
       POPUP_YN,
       POPUP_START_AT,
       POPUP_END_AT,
       PIN_YN,
       USE_YN,
       SORT_ORDER,
       CREATED_BY,
       CREATED_AT,
       UPDATED_BY,
       UPDATED_AT,
       (SELECT COUNT(*)
          FROM "INIT$_TB_NOTICE_FILE" F
         WHERE F.NOTICE_ID = N.NOTICE_ID
           AND F.USE_YN = 'Y') AS FILE_COUNT
  FROM "INIT$_TB_NOTICE" N
 WHERE N.NOTICE_ID = :noticeId;

-- [M99004_NOTICE_LIST]
SELECT *
  FROM (
    SELECT NOTICE_ID,
           NOTICE_TYPE,
           TITLE,
           POST_START_AT,
           POST_END_AT,
           POPUP_YN,
           PIN_YN,
           USE_YN,
           SORT_ORDER,
           (SELECT COUNT(*)
              FROM "INIT$_TB_NOTICE_FILE" F
             WHERE F.NOTICE_ID = N.NOTICE_ID
               AND F.USE_YN = 'Y') AS FILE_COUNT,
           CREATED_AT,
           UPDATED_AT
      FROM "INIT$_TB_NOTICE" N
     WHERE (:keyword IS NULL OR UPPER(TITLE) LIKE :keyword OR INSTR(UPPER(DBMS_LOB.SUBSTR(CONTENT, 4000, 1)), :keywordText) > 0)
       AND (:useYn = 'ALL' OR USE_YN = :useYn)
       AND (:activeOnly = 'N' OR (
            USE_YN = 'Y'
        AND (POST_START_AT IS NULL OR POST_START_AT <= SYSTIMESTAMP)
        AND (POST_END_AT IS NULL OR POST_END_AT >= SYSTIMESTAMP)
       ))
     ORDER BY PIN_YN DESC, SORT_ORDER, CREATED_AT DESC, NOTICE_ID DESC
  )
 WHERE ROWNUM <= :limit;

-- [M99004_NOTICE_UPDATE]
UPDATE "INIT$_TB_NOTICE"
   SET NOTICE_TYPE = :noticeType,
       TITLE = :title,
       CONTENT = :content,
       POST_START_AT = :postStartAt,
       POST_END_AT = :postEndAt,
       POPUP_YN = :popupYn,
       POPUP_START_AT = :popupStartAt,
       POPUP_END_AT = :popupEndAt,
       PIN_YN = :pinYn,
       USE_YN = :useYn,
       SORT_ORDER = :sortOrder,
       UPDATED_BY = :userId,
       UPDATED_AT = SYSTIMESTAMP
 WHERE NOTICE_ID = :noticeId;

-- [M99004_NOTICE_INSERT]
INSERT INTO "INIT$_TB_NOTICE" (
    NOTICE_TYPE,
    TITLE,
    CONTENT,
    POST_START_AT,
    POST_END_AT,
    POPUP_YN,
    POPUP_START_AT,
    POPUP_END_AT,
    PIN_YN,
    USE_YN,
    SORT_ORDER,
    CREATED_BY,
    CREATED_AT
) VALUES (
    :noticeType,
    :title,
    :content,
    :postStartAt,
    :postEndAt,
    :popupYn,
    :popupStartAt,
    :popupEndAt,
    :pinYn,
    :useYn,
    :sortOrder,
    :userId,
    SYSTIMESTAMP
)
RETURNING NOTICE_ID INTO :noticeIdOut;

-- [M99004_NOTICE_DELETE]
DELETE FROM "INIT$_TB_NOTICE"
 WHERE NOTICE_ID = :noticeId;

-- [M99004_NOTICE_FILE_LIST]
SELECT FILE_ID,
       NOTICE_ID,
       FILE_NAME,
       CONTENT_TYPE,
       FILE_SIZE,
       SORT_ORDER,
       USE_YN,
       CREATED_BY,
       CREATED_AT,
       UPDATED_BY,
       UPDATED_AT
  FROM "INIT$_TB_NOTICE_FILE"
 WHERE NOTICE_ID = :noticeId
   AND (:includeInactive = 'Y' OR USE_YN = 'Y')
 ORDER BY SORT_ORDER, FILE_ID;

-- [M99004_NOTICE_FILE_INSERT]
INSERT INTO "INIT$_TB_NOTICE_FILE" (
    NOTICE_ID,
    FILE_NAME,
    CONTENT_TYPE,
    FILE_SIZE,
    FILE_DATA,
    SORT_ORDER,
    USE_YN,
    CREATED_BY,
    CREATED_AT
) VALUES (
    :noticeId,
    :fileName,
    :contentType,
    :fileSize,
    :fileData,
    :sortOrder,
    'Y',
    :userId,
    SYSTIMESTAMP
)
RETURNING FILE_ID INTO :fileIdOut;

-- [M99004_NOTICE_FILE_DOWNLOAD]
SELECT FILE_ID,
       NOTICE_ID,
       FILE_NAME,
       CONTENT_TYPE,
       FILE_SIZE,
       FILE_DATA
  FROM "INIT$_TB_NOTICE_FILE"
 WHERE FILE_ID = :fileId
   AND USE_YN = 'Y';

-- [M99004_NOTICE_FILE_DELETE]
DELETE FROM "INIT$_TB_NOTICE_FILE"
 WHERE FILE_ID = :fileId;
