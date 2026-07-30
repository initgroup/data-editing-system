"""Generate the deterministic M02001 household survey sample CSV.

The data is synthetic and contains no real people or households.  It is shaped
to exercise M03001 logical column types, categorical association rules,
continuous formula rules, and rule-violation detection.
"""

from __future__ import annotations

import csv
import math
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path


ROW_COUNT = 1_500
RANDOM_SEED = 20250730
OUTPUT_PATH = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "samples"
    / "national_household_living_survey_sample.csv"
)

FIELD_NAMES = [
    "HOUSEHOLD_ID",
    "SURVEY_YEAR",
    "SURVEY_WAVE",
    "ENUMERATION_DISTRICT_ID",
    "REGION_CODE",
    "SIDO_NAME",
    "DISTRICT_TYPE",
    "URBAN_RURAL",
    "STRATUM_CODE",
    "PSU_CODE",
    "SURVEY_DATE",
    "RESPONSE_METHOD",
    "RESPONSE_STATUS",
    "HOUSING_TYPE",
    "TENURE_TYPE",
    "APARTMENT_FLOOR",
    "HOUSEHOLD_TYPE",
    "HOUSEHOLD_SIZE",
    "HOUSEHOLD_SIZE_GROUP",
    "HEAD_GENDER",
    "HEAD_AGE",
    "AGE_GROUP",
    "EDUCATION_LEVEL_CODE",
    "EDUCATION_LEVEL",
    "EMPLOYMENT_STATUS",
    "LABOR_FORCE_STATUS",
    "INDUSTRY_GROUP",
    "INTERNET_USE_YN",
    "HEALTH_GRADE",
    "LIFE_SATISFACTION_SCORE",
    "LOCAL_DEPRIVATION_PERCENTILE",
    "COMMUTE_MINUTES",
    "WORK_HOURS_WEEK",
    "MONTHLY_EARNED_INCOME_MANWON",
    "MONTHLY_BUSINESS_INCOME_MANWON",
    "MONTHLY_TRANSFER_INCOME_MANWON",
    "MONTHLY_OTHER_INCOME_MANWON",
    "TOTAL_MONTHLY_INCOME_MANWON",
    "ANNUAL_HOUSEHOLD_INCOME_MANWON",
    "TAX_AND_SOCIAL_INSURANCE_MANWON",
    "DISPOSABLE_INCOME_MANWON",
    "FOOD_EXPENDITURE_MANWON",
    "HOUSING_EXPENDITURE_MANWON",
    "EDUCATION_EXPENDITURE_MANWON",
    "HEALTH_EXPENDITURE_MANWON",
    "TRANSPORT_EXPENDITURE_MANWON",
    "OTHER_EXPENDITURE_MANWON",
    "TOTAL_MONTHLY_EXPENDITURE_MANWON",
    "MONTHLY_SAVINGS_MANWON",
    "PER_CAPITA_DISPOSABLE_INCOME_MANWON",
    "EQUIVALIZED_DISPOSABLE_INCOME_MANWON",
    "HOUSING_COST_BURDEN_RATE",
    "ECONOMIC_STRESS_INDEX",
    "SURVEY_WEIGHT",
    "RESPONDENT_NOTE",
]

HEADER_LABELS = [
    "가구식별번호",
    "조사연도",
    "조사차수",
    "조사구식별번호",
    "시도코드",
    "시도명",
    "행정구역유형",
    "도시농촌구분",
    "층화코드",
    "표본조사구코드",
    "조사일자",
    "응답방식",
    "응답상태",
    "주택유형",
    "점유형태",
    "아파트층수",
    "가구유형",
    "가구원수",
    "가구원수구간",
    "가구주성별",
    "가구주연령",
    "가구주연령대",
    "교육수준코드",
    "교육수준",
    "종사상지위",
    "경제활동상태",
    "산업분류",
    "인터넷이용여부",
    "건강상태등급",
    "삶의만족도점수",
    "지역박탈도백분위",
    "통근시간_분",
    "주당근로시간",
    "월근로소득_만원",
    "월사업소득_만원",
    "월이전소득_만원",
    "월기타소득_만원",
    "월총소득_만원",
    "연간가구소득_만원",
    "세금사회보험료_만원",
    "가처분소득_만원",
    "식료품비_만원",
    "주거비_만원",
    "교육비_만원",
    "보건의료비_만원",
    "교통비_만원",
    "기타지출_만원",
    "월총지출_만원",
    "월저축액_만원",
    "1인당가처분소득_만원",
    "균등화가처분소득_만원",
    "주거비부담률",
    "경제스트레스지수",
    "조사가중치",
    "응답자메모",
]

REGIONS = [
    ("R01", "서울특별시", 19),
    ("R02", "부산광역시", 7),
    ("R03", "대구광역시", 5),
    ("R04", "인천광역시", 6),
    ("R05", "광주광역시", 3),
    ("R06", "대전광역시", 3),
    ("R07", "울산광역시", 2),
    ("R08", "세종특별자치시", 1),
    ("R09", "경기도", 27),
    ("R10", "강원특별자치도", 3),
    ("R11", "충청북도", 3),
    ("R12", "충청남도", 4),
    ("R13", "전북특별자치도", 3),
    ("R14", "전라남도", 3),
    ("R15", "경상북도", 5),
    ("R16", "경상남도", 7),
    ("R17", "제주특별자치도", 2),
]
REGION_NAMES = [region[1] for region in REGIONS]

EDUCATION_LEVELS = {
    1: "무학",
    2: "초등학교",
    3: "중학교",
    4: "고등학교",
    5: "대학교",
    6: "대학원",
}

HOUSEHOLD_SIZE_GROUPS = ["1인", "2인", "3~4인", "5인 이상"]
AGE_GROUPS = ["20대 이하", "30대", "40대", "50대", "60대", "70대 이상"]
LABOR_FORCE_GROUPS = ["취업", "실업", "비경제활동"]


def round_step(value: float, step: float = 1.0) -> float:
    return round(round(value / step) * step, 1)


def rotate(value: str, values: list[str]) -> str:
    return values[(values.index(value) + 1) % len(values)]


def household_size_group(size: int) -> str:
    if size == 1:
        return "1인"
    if size == 2:
        return "2인"
    if size <= 4:
        return "3~4인"
    return "5인 이상"


def age_group(age: int) -> str:
    if age < 30:
        return "20대 이하"
    if age < 40:
        return "30대"
    if age < 50:
        return "40대"
    if age < 60:
        return "50대"
    if age < 70:
        return "60대"
    return "70대 이상"


def education_code_for_age(rng: random.Random, age: int) -> int:
    if age >= 70:
        weights = [8, 25, 25, 32, 9, 1]
    elif age >= 55:
        weights = [1, 7, 18, 43, 27, 4]
    elif age >= 35:
        weights = [0, 1, 5, 38, 48, 8]
    else:
        weights = [0, 0, 2, 34, 53, 11]
    return rng.choices(list(EDUCATION_LEVELS), weights=weights, k=1)[0]


def employment_for_age(rng: random.Random, age: int) -> str:
    if age < 25:
        values = ["상용근로자", "임시·일용근로자", "실업자", "학생", "비경제활동"]
        weights = [18, 20, 9, 45, 8]
    elif age < 60:
        values = ["상용근로자", "임시·일용근로자", "자영업자", "무급가족종사자", "실업자", "비경제활동"]
        weights = [48, 14, 18, 3, 5, 12]
    elif age < 70:
        values = ["상용근로자", "임시·일용근로자", "자영업자", "무급가족종사자", "실업자", "비경제활동"]
        weights = [19, 18, 22, 5, 3, 33]
    else:
        values = ["임시·일용근로자", "자영업자", "무급가족종사자", "비경제활동"]
        weights = [9, 11, 4, 76]
    return rng.choices(values, weights=weights, k=1)[0]


def labor_force_status(employment_status: str) -> str:
    if employment_status in {"상용근로자", "임시·일용근로자", "자영업자", "무급가족종사자"}:
        return "취업"
    if employment_status == "실업자":
        return "실업"
    return "비경제활동"


def make_note(row_number: int) -> str:
    if row_number % 31 == 0:
        return ""
    note_number = ((row_number - 1) % 900) + 1
    phrases = [
        "생활비, 주거비 항목 재확인",
        "가구원 수 변동 내용을 면접원이 확인",
        "소득 항목은 월평균 금액으로 응답",
        "온라인 조사 후 전화로 일부 항목 보완",
        "교육비와 보건비 영수증을 참고해 응답",
        "응답자가 조사표 작성 기준을 확인함",
    ]
    return f"메모-{note_number:04d}: {phrases[note_number % len(phrases)]}"


def build_rows() -> list[dict[str, object]]:
    rng = random.Random(RANDOM_SEED)
    region_choices = [(code, name) for code, name, _ in REGIONS]
    region_weights = [weight for _, _, weight in REGIONS]
    deprivation_weights = [
        100,
        55,
        30,
        16,
        9,
        5,
        3,
        2,
        1.2,
        0.8,
        0.6,
        0.5,
        0.4,
        0.3,
        0.25,
        0.2,
        0.15,
        0.1,
        0.08,
        0.05,
    ]
    other_income_values = list(range(0, 155, 5))
    other_income_weights = [
        12 if value == 0 else max(1, 7 - value / 25)
        for value in other_income_values
    ]
    start_date = date(2025, 4, 1)
    rows: list[dict[str, object]] = []

    for row_number in range(1, ROW_COUNT + 1):
        region_code, canonical_sido = rng.choices(region_choices, weights=region_weights, k=1)[0]
        region_index = next(index for index, region in enumerate(REGIONS, start=1) if region[0] == region_code)
        metro_region = region_index <= 8
        district_type = rng.choices(
            ["동부", "읍부", "면부"],
            weights=[88, 8, 4] if metro_region else [57, 19, 24],
            k=1,
        )[0]
        canonical_urban_rural = "도시" if district_type == "동부" else "농촌"

        household_type = rng.choices(
            ["1인가구", "부부", "부부+자녀", "한부모", "3세대", "기타"],
            weights=[31, 22, 29, 7, 6, 5],
            k=1,
        )[0]
        size_options = {
            "1인가구": ([1], [1]),
            "부부": ([2], [1]),
            "부부+자녀": ([3, 4, 5], [32, 50, 18]),
            "한부모": ([2, 3, 4], [30, 48, 22]),
            "3세대": ([4, 5, 6, 7], [15, 40, 30, 15]),
            "기타": ([2, 3, 4, 5, 6], [20, 26, 25, 18, 11]),
        }
        size_values, size_weights = size_options[household_type]
        household_size = rng.choices(size_values, weights=size_weights, k=1)[0]
        canonical_size_group = household_size_group(household_size)

        if row_number <= 72:
            head_age = 17 + row_number
        else:
            head_age = min(89, max(18, int(round(rng.gauss(51, 16)))))
        canonical_age_group = age_group(head_age)
        head_gender = rng.choices(["남성", "여성"], weights=[51, 49], k=1)[0]

        education_code = education_code_for_age(rng, head_age)
        canonical_education = EDUCATION_LEVELS[education_code]
        employment_status = employment_for_age(rng, head_age)
        canonical_labor_status = labor_force_status(employment_status)
        employed = canonical_labor_status == "취업"

        industry_group = ""
        if employed:
            industry_group = rng.choices(
                ["농림어업", "제조업", "건설업", "도소매·숙박", "운수업", "정보통신", "금융·전문서비스", "공공·교육", "보건·복지", "기타서비스"],
                weights=[6, 17, 8, 17, 7, 6, 10, 11, 10, 8],
                k=1,
            )[0]

        internet_probability = 0.96 if head_age < 50 else 0.82 if head_age < 65 else 0.48
        internet_use = "Y" if rng.random() < internet_probability else "N"
        response_method = rng.choices(
            ["인터넷", "전화", "방문면접"],
            weights=[65, 20, 15] if internet_use == "Y" else [4, 38, 58],
            k=1,
        )[0]
        response_status = rng.choices(["완료", "부분응답", "대리응답"], weights=[93, 4, 3], k=1)[0]

        housing_type = rng.choices(
            ["아파트", "단독주택", "연립·다세대", "오피스텔", "기타"],
            weights=[62, 13, 17, 6, 2] if canonical_urban_rural == "도시" else [24, 50, 17, 2, 7],
            k=1,
        )[0]
        tenure_type = rng.choices(
            ["자가", "전세", "보증부월세", "월세", "무상"],
            weights=[56, 15, 20, 6, 3],
            k=1,
        )[0]
        apartment_floor = ((row_number * 7) % 30) + 1 if housing_type == "아파트" else 0

        local_deprivation_grade = (
            row_number * 5
            if row_number <= 20
            else rng.choices(range(5, 101, 5), weights=deprivation_weights, k=1)[0]
        )
        health_base = 5 - max(0, head_age - 35) / 18 - local_deprivation_grade / 120
        health_grade = min(5, max(1, int(round(health_base + rng.gauss(0, 0.7)))))

        commute_minutes: float | str = ""
        work_hours_week: float | str = ""
        if employed:
            commute_base = 42 if canonical_urban_rural == "도시" else 28
            commute_minutes = round(max(5, min(120, rng.gauss(commute_base, 18))) * 2) / 2
            hours_base = 44 if employment_status in {"자영업자", "무급가족종사자"} else 40
            work_hours_week = round(max(8, min(72, rng.gauss(hours_base, 7))) * 2) / 2

        education_income_effect = {1: -55, 2: -35, 3: -15, 4: 15, 5: 75, 6: 145}[education_code]
        earned_income = 0.0
        business_income = 0.0
        if employment_status == "상용근로자":
            earned_income = round_step(max(90, rng.gauss(330 + education_income_effect, 105)), 5)
        elif employment_status == "임시·일용근로자":
            earned_income = round_step(max(35, rng.gauss(155 + education_income_effect * 0.25, 55)), 5)
        elif employment_status == "자영업자":
            business_income = round_step(max(40, rng.gauss(310 + education_income_effect * 0.7, 150)), 5)
        elif employment_status == "무급가족종사자":
            business_income = round_step(max(10, rng.gauss(85, 35)), 5)

        transfer_base = 20 + max(0, head_age - 60) * 2.1 + (25 if household_size >= 4 else 0)
        transfer_income = round_step(max(0, rng.gauss(transfer_base, 22)), 5)
        other_income = rng.choices(other_income_values, weights=other_income_weights, k=1)[0]

        clean_total_income = round(earned_income + business_income + transfer_income + other_income, 1)
        total_income = clean_total_income + (50 if row_number % 47 == 0 else 0)
        annual_income = round(total_income * 12, 1) + (1_200 if row_number % 61 == 0 else 0)
        tax_rate = 0.055 if clean_total_income < 300 else 0.105 if clean_total_income < 600 else 0.17
        tax_and_insurance = round(clean_total_income * tax_rate, 1)
        disposable_income = round(clean_total_income - tax_and_insurance, 1)

        food_expenditure = round_step(max(22, rng.gauss(34 + household_size * 20, 12)), 1)
        housing_base = {
            "자가": 34,
            "전세": 48,
            "보증부월세": 76,
            "월세": 88,
            "무상": 18,
        }[tenure_type]
        housing_expenditure = round_step(
            max(8, rng.gauss(housing_base + (18 if canonical_urban_rural == "도시" else 0), 15)),
            1,
        )
        education_expenditure = round_step(
            max(0, rng.gauss(max(0, household_size - 2) * (18 if 30 <= head_age < 60 else 5), 13)),
            1,
        )
        health_expenditure = round_step(max(2, rng.gauss(8 + max(0, head_age - 50) * 0.8, 8)), 1)
        transport_expenditure = round_step(
            max(3, rng.gauss(14 + (18 if employed else 3) + (5 if canonical_urban_rural == "농촌" else 0), 8)),
            1,
        )
        other_expenditure = round_step(max(8, rng.gauss(20 + household_size * 7, 10)), 1)
        clean_total_expenditure = round(
            food_expenditure
            + housing_expenditure
            + education_expenditure
            + health_expenditure
            + transport_expenditure
            + other_expenditure,
            1,
        )
        total_expenditure = clean_total_expenditure + (150 if row_number % 53 == 0 else 0)
        monthly_savings = round(disposable_income - total_expenditure, 1)
        if row_number % 59 == 0:
            monthly_savings += 75

        per_capita_income = round(disposable_income / household_size, 1)
        equivalized_income = round(disposable_income / math.sqrt(household_size), 1)
        if row_number % 71 == 0:
            equivalized_income += 250
        housing_burden_rate = round(housing_expenditure / max(disposable_income, 1) * 100, 1)
        if row_number % 73 == 0:
            housing_burden_rate += 20

        commute_for_formula = float(commute_minutes or 0)
        economic_stress_index = round(
            32
            + 0.002 * total_expenditure
            + 0.003 * (commute_for_formula**2)
            - 0.012 * disposable_income,
            1,
        )
        if row_number % 67 == 0:
            economic_stress_index += 25
        life_satisfaction = min(
            5,
            max(1, int(round(4.5 - economic_stress_index / 18 + health_grade / 5 + rng.gauss(0, 0.65)))),
        )

        sido_name = canonical_sido
        if row_number % 71 == 0:
            sido_name = REGION_NAMES[(REGION_NAMES.index(canonical_sido) + 1) % len(REGION_NAMES)]
        urban_rural = canonical_urban_rural
        if row_number % 83 == 0:
            urban_rural = "농촌" if canonical_urban_rural == "도시" else "도시"
        size_group = canonical_size_group
        if row_number % 67 == 0:
            size_group = rotate(canonical_size_group, HOUSEHOLD_SIZE_GROUPS)
        displayed_age_group = canonical_age_group
        if row_number % 79 == 0:
            displayed_age_group = rotate(canonical_age_group, AGE_GROUPS)
        education_level = canonical_education
        if row_number % 73 == 0:
            education_level = EDUCATION_LEVELS[(education_code % len(EDUCATION_LEVELS)) + 1]
        displayed_labor_status = canonical_labor_status
        if row_number % 89 == 0:
            displayed_labor_status = rotate(canonical_labor_status, LABOR_FORCE_GROUPS)

        row = {
            "HOUSEHOLD_ID": f"HH-2025-{row_number:06d}",
            "SURVEY_YEAR": 2025,
            "SURVEY_WAVE": ((row_number - 1) % 4) + 1,
            "ENUMERATION_DISTRICT_ID": f"ED-{((row_number - 1) % 500) + 1:04d}",
            "REGION_CODE": region_code,
            "SIDO_NAME": sido_name,
            "DISTRICT_TYPE": district_type,
            "URBAN_RURAL": urban_rural,
            "STRATUM_CODE": f"ST-{region_index:02d}-{district_type[0]}",
            "PSU_CODE": f"PSU-{((row_number * 37) % 300) + 1:04d}",
            "SURVEY_DATE": (start_date + timedelta(days=(row_number * 37) % 180)).isoformat(),
            "RESPONSE_METHOD": response_method,
            "RESPONSE_STATUS": response_status,
            "HOUSING_TYPE": housing_type,
            "TENURE_TYPE": tenure_type,
            "APARTMENT_FLOOR": apartment_floor,
            "HOUSEHOLD_TYPE": household_type,
            "HOUSEHOLD_SIZE": household_size,
            "HOUSEHOLD_SIZE_GROUP": size_group,
            "HEAD_GENDER": head_gender,
            "HEAD_AGE": head_age,
            "AGE_GROUP": displayed_age_group,
            "EDUCATION_LEVEL_CODE": education_code,
            "EDUCATION_LEVEL": education_level,
            "EMPLOYMENT_STATUS": employment_status,
            "LABOR_FORCE_STATUS": displayed_labor_status,
            "INDUSTRY_GROUP": industry_group,
            "INTERNET_USE_YN": internet_use,
            "HEALTH_GRADE": health_grade,
            "LIFE_SATISFACTION_SCORE": life_satisfaction,
            "LOCAL_DEPRIVATION_PERCENTILE": local_deprivation_grade,
            "COMMUTE_MINUTES": commute_minutes,
            "WORK_HOURS_WEEK": work_hours_week,
            "MONTHLY_EARNED_INCOME_MANWON": earned_income,
            "MONTHLY_BUSINESS_INCOME_MANWON": business_income,
            "MONTHLY_TRANSFER_INCOME_MANWON": transfer_income,
            "MONTHLY_OTHER_INCOME_MANWON": other_income,
            "TOTAL_MONTHLY_INCOME_MANWON": total_income,
            "ANNUAL_HOUSEHOLD_INCOME_MANWON": annual_income,
            "TAX_AND_SOCIAL_INSURANCE_MANWON": tax_and_insurance,
            "DISPOSABLE_INCOME_MANWON": disposable_income,
            "FOOD_EXPENDITURE_MANWON": food_expenditure,
            "HOUSING_EXPENDITURE_MANWON": housing_expenditure,
            "EDUCATION_EXPENDITURE_MANWON": education_expenditure,
            "HEALTH_EXPENDITURE_MANWON": health_expenditure,
            "TRANSPORT_EXPENDITURE_MANWON": transport_expenditure,
            "OTHER_EXPENDITURE_MANWON": other_expenditure,
            "TOTAL_MONTHLY_EXPENDITURE_MANWON": total_expenditure,
            "MONTHLY_SAVINGS_MANWON": monthly_savings,
            "PER_CAPITA_DISPOSABLE_INCOME_MANWON": per_capita_income,
            "EQUIVALIZED_DISPOSABLE_INCOME_MANWON": equivalized_income,
            "HOUSING_COST_BURDEN_RATE": housing_burden_rate,
            "ECONOMIC_STRESS_INDEX": economic_stress_index,
            "SURVEY_WEIGHT": round(0.5 + ((row_number * 73) % 301) * 0.005, 3),
            "RESPONDENT_NOTE": make_note(row_number),
        }
        rows.append(row)

    return rows


def count_mismatches(rows: list[dict[str, object]]) -> dict[str, int]:
    def mismatch_count(predicate) -> int:
        return sum(1 for row in rows if not predicate(row))

    return {
        "REGION_CODE=SIDO_NAME": mismatch_count(
            lambda row: row["SIDO_NAME"]
            == next(region[1] for region in REGIONS if region[0] == row["REGION_CODE"])
        ),
        "DISTRICT_TYPE=URBAN_RURAL": mismatch_count(
            lambda row: row["URBAN_RURAL"]
            == ("도시" if row["DISTRICT_TYPE"] == "동부" else "농촌")
        ),
        "HOUSEHOLD_SIZE=HOUSEHOLD_SIZE_GROUP": mismatch_count(
            lambda row: row["HOUSEHOLD_SIZE_GROUP"]
            == household_size_group(int(row["HOUSEHOLD_SIZE"]))
        ),
        "HEAD_AGE=AGE_GROUP": mismatch_count(
            lambda row: row["AGE_GROUP"] == age_group(int(row["HEAD_AGE"]))
        ),
        "EDUCATION_LEVEL_CODE=EDUCATION_LEVEL": mismatch_count(
            lambda row: row["EDUCATION_LEVEL"]
            == EDUCATION_LEVELS[int(row["EDUCATION_LEVEL_CODE"])]
        ),
        "EMPLOYMENT_STATUS=LABOR_FORCE_STATUS": mismatch_count(
            lambda row: row["LABOR_FORCE_STATUS"]
            == labor_force_status(str(row["EMPLOYMENT_STATUS"]))
        ),
        "TOTAL_INCOME=INCOME_COMPONENT_SUM": mismatch_count(
            lambda row: math.isclose(
                float(row["TOTAL_MONTHLY_INCOME_MANWON"]),
                sum(
                    float(row[column])
                    for column in (
                        "MONTHLY_EARNED_INCOME_MANWON",
                        "MONTHLY_BUSINESS_INCOME_MANWON",
                        "MONTHLY_TRANSFER_INCOME_MANWON",
                        "MONTHLY_OTHER_INCOME_MANWON",
                    )
                ),
                abs_tol=0.01,
            )
        ),
        "TOTAL_INCOME=TAX_AND_INSURANCE+DISPOSABLE_INCOME": mismatch_count(
            lambda row: math.isclose(
                float(row["TOTAL_MONTHLY_INCOME_MANWON"]),
                float(row["TAX_AND_SOCIAL_INSURANCE_MANWON"])
                + float(row["DISPOSABLE_INCOME_MANWON"]),
                abs_tol=0.01,
            )
        ),
        "ANNUAL_INCOME=MONTHLY_INCOME*12": mismatch_count(
            lambda row: math.isclose(
                float(row["ANNUAL_HOUSEHOLD_INCOME_MANWON"]),
                float(row["TOTAL_MONTHLY_INCOME_MANWON"]) * 12,
                abs_tol=0.01,
            )
        ),
        "TOTAL_EXPENDITURE=EXPENDITURE_COMPONENT_SUM": mismatch_count(
            lambda row: math.isclose(
                float(row["TOTAL_MONTHLY_EXPENDITURE_MANWON"]),
                sum(
                    float(row[column])
                    for column in (
                        "FOOD_EXPENDITURE_MANWON",
                        "HOUSING_EXPENDITURE_MANWON",
                        "EDUCATION_EXPENDITURE_MANWON",
                        "HEALTH_EXPENDITURE_MANWON",
                        "TRANSPORT_EXPENDITURE_MANWON",
                        "OTHER_EXPENDITURE_MANWON",
                    )
                ),
                abs_tol=0.01,
            )
        ),
        "SAVINGS=DISPOSABLE_INCOME-TOTAL_EXPENDITURE": mismatch_count(
            lambda row: math.isclose(
                float(row["MONTHLY_SAVINGS_MANWON"]),
                float(row["DISPOSABLE_INCOME_MANWON"])
                - float(row["TOTAL_MONTHLY_EXPENDITURE_MANWON"]),
                abs_tol=0.01,
            )
        ),
        "EQUIVALIZED_INCOME=DISPOSABLE_INCOME/SQRT(HOUSEHOLD_SIZE)": mismatch_count(
            lambda row: math.isclose(
                float(row["EQUIVALIZED_DISPOSABLE_INCOME_MANWON"]),
                round(
                    float(row["DISPOSABLE_INCOME_MANWON"])
                    / math.sqrt(int(row["HOUSEHOLD_SIZE"])),
                    1,
                ),
                abs_tol=0.01,
            )
        ),
        "HOUSING_BURDEN=HOUSING_EXPENDITURE/DISPOSABLE_INCOME*100": mismatch_count(
            lambda row: math.isclose(
                float(row["HOUSING_COST_BURDEN_RATE"]),
                round(
                    float(row["HOUSING_EXPENDITURE_MANWON"])
                    / max(float(row["DISPOSABLE_INCOME_MANWON"]), 1)
                    * 100,
                    1,
                ),
                abs_tol=0.01,
            )
        ),
        "ECONOMIC_STRESS=POLYNOMIAL_FORMULA": mismatch_count(
            lambda row: math.isclose(
                float(row["ECONOMIC_STRESS_INDEX"]),
                round(
                    32
                    + 0.002 * float(row["TOTAL_MONTHLY_EXPENDITURE_MANWON"])
                    + 0.003 * (float(row["COMMUTE_MINUTES"] or 0) ** 2)
                    - 0.012 * float(row["DISPOSABLE_INCOME_MANWON"]),
                    1,
                ),
                abs_tol=0.01,
            )
        ),
    }


def normalized_entropy(values: list[int]) -> float:
    counts = Counter(values)
    total = len(values)
    if len(counts) <= 1:
        return 0.0
    entropy = -sum(
        (count / total) * math.log(count / total)
        for count in counts.values()
    )
    return entropy / math.log(len(counts))


def direct_formula_r2(actual_values: list[float], expected_values: list[float]) -> float:
    actual_mean = sum(actual_values) / len(actual_values)
    residual_sum = sum(
        (actual - expected) ** 2
        for actual, expected in zip(actual_values, expected_values)
    )
    total_sum = sum((actual - actual_mean) ** 2 for actual in actual_values)
    return 1.0 - residual_sum / total_sum


def validate_rows(rows: list[dict[str, object]]) -> dict[str, int]:
    assert len(rows) == ROW_COUNT and ROW_COUNT >= 1_000
    assert len(FIELD_NAMES) == len(set(FIELD_NAMES))
    assert len(HEADER_LABELS) == len(FIELD_NAMES)
    assert len(HEADER_LABELS) == len(set(HEADER_LABELS))
    assert all(label.strip() for label in HEADER_LABELS)
    assert all(list(row) == FIELD_NAMES for row in rows)
    assert len({row["HOUSEHOLD_ID"] for row in rows}) == ROW_COUNT

    note_values = [str(row["RESPONDENT_NOTE"]) for row in rows if row["RESPONDENT_NOTE"]]
    note_distinct_ratio = len(set(note_values)) / len(note_values)
    assert 0.5 < note_distinct_ratio < 0.9

    deprivation_values = [int(row["LOCAL_DEPRIVATION_PERCENTILE"]) for row in rows]
    assert len(set(deprivation_values)) == 20
    assert max(deprivation_values) == 100
    assert normalized_entropy(deprivation_values) < 0.7
    assert len(set(deprivation_values)) / (max(deprivation_values) - min(deprivation_values) + 1) < 0.8

    other_income_values = [
        float(row["MONTHLY_OTHER_INCOME_MANWON"])
        for row in rows
    ]
    assert len(set(other_income_values)) > 30
    assert (
        len(set(other_income_values))
        / (max(other_income_values) - min(other_income_values) + 1)
        < 0.8
    )

    total_income_values = [
        float(row["TOTAL_MONTHLY_INCOME_MANWON"])
        for row in rows
    ]
    tax_and_disposable_values = [
        float(row["TAX_AND_SOCIAL_INSURANCE_MANWON"])
        + float(row["DISPOSABLE_INCOME_MANWON"])
        for row in rows
    ]
    savings_values = [
        float(row["MONTHLY_SAVINGS_MANWON"])
        for row in rows
    ]
    disposable_less_expenditure_values = [
        float(row["DISPOSABLE_INCOME_MANWON"])
        - float(row["TOTAL_MONTHLY_EXPENDITURE_MANWON"])
        for row in rows
    ]
    assert direct_formula_r2(total_income_values, tax_and_disposable_values) >= 0.995
    assert direct_formula_r2(savings_values, disposable_less_expenditure_values) >= 0.995

    mismatches = count_mismatches(rows)
    categorical_rules = (
        "REGION_CODE=SIDO_NAME",
        "DISTRICT_TYPE=URBAN_RURAL",
        "HOUSEHOLD_SIZE=HOUSEHOLD_SIZE_GROUP",
        "HEAD_AGE=AGE_GROUP",
        "EDUCATION_LEVEL_CODE=EDUCATION_LEVEL",
        "EMPLOYMENT_STATUS=LABOR_FORCE_STATUS",
    )
    assert all(mismatches[rule_name] >= 15 for rule_name in categorical_rules)
    assert all(count > 0 for count in mismatches.values())
    assert all(count / ROW_COUNT < 0.05 for count in mismatches.values())
    return mismatches


def write_csv(rows: list[dict[str, object]]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=FIELD_NAMES)
        writer.writerow(dict(zip(FIELD_NAMES, HEADER_LABELS)))
        writer.writerows(rows)


def main() -> None:
    rows = build_rows()
    mismatches = validate_rows(rows)
    write_csv(rows)
    print(f"Created {OUTPUT_PATH} ({len(rows)} rows, {len(FIELD_NAMES)} columns)")
    for rule_name, count in mismatches.items():
        print(f"  {rule_name}: {count} intentional violation(s)")


if __name__ == "__main__":
    main()
