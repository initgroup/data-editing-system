from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db_connection

router = APIRouter()

class PopulationItem(BaseModel):
    region_cd: str
    pop_cnt: int
    survey_dt: str
    gender_cd: str
    salary: Optional[int] = None

# 조회 (Read)
@router.get("/population")
def get_population():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="DB Connection Failed")
    
    cursor = conn.cursor()
    cursor.execute("SELECT POP_ID, REGION_CD, POP_CNT, GENDER_CD, SALARY FROM POPULATION FETCH FIRST 100 ROWS ONLY")
    columns = [col[0] for col in cursor.description]
    cursor.rowfactory = lambda *args: dict(zip(columns, args))
    data = cursor.fetchall()
    
    cursor.close()
    conn.close()
    return {"status": "success", "data": data}

# 생성 (Create)
@router.post("/population")
def create_population(item: PopulationItem):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        sql = """INSERT INTO POPULATION (REGION_CD, POP_CNT, SURVEY_DT, GENDER_CD, SALARY) 
                 VALUES (:1, :2, TO_DATE(:3, 'YYYY-MM-DD'), :4, :5)"""
        cursor.execute(sql, (item.region_cd, item.pop_cnt, item.survey_dt, item.gender_cd, item.salary))
        conn.commit()
        return {"status": "success", "message": "데이터가 추가되었습니다."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cursor.close()
        conn.close()