import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT_DIR = "D:/work/data-editing-system/.codex-artifacts/ksbpm-a3/final-render";
const FINAL_PPTX = "D:/work/data-editing-system/outputs/나라통계시스템_KSBPM_AI_10대과제_A3_요약.pptx";

const W = 1587;
const H = 1123;
const FONT = "Malgun Gothic";

const C = {
  ink: "#111827",
  muted: "#5B6472",
  rule: "#B8C0CC",
  panel: "#F3F5F7",
  panelBlue: "#EAF4FB",
  accent: "#1C6AA6",
  accentStrong: "#0B4F86",
  accentLight: "#7BC8F6",
  white: "#FFFFFF",
  green: "#1E7A5C",
  amber: "#C47A13",
};

const presentation = Presentation.create({ slideSize: { width: W, height: H } });
presentation.theme.colorScheme = {
  name: "KSBPM AI Strategy",
  themeColors: {
    accent1: C.accent,
    accent2: C.accentStrong,
    accent3: C.accentLight,
    accent4: C.green,
    accent5: C.amber,
    accent6: "#6B7280",
    bg1: C.white,
    bg2: C.panel,
    tx1: C.ink,
    tx2: C.muted,
    dk1: "#000000",
    dk2: C.ink,
    lt1: C.white,
    lt2: C.panel,
    hlink: C.accent,
    folHlink: C.accentStrong,
  },
};

const slide = presentation.slides.add();
slide.background.fill = C.white;

function addShape({
  name,
  geometry = "rect",
  x,
  y,
  w,
  h,
  fill = "none",
  lineFill = "none",
  lineWidth = 0,
  radius,
}) {
  return slide.shapes.add({
    geometry,
    name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: lineFill, width: lineWidth },
    ...(radius !== undefined ? { borderRadius: radius } : {}),
  });
}

function addText({
  name,
  text,
  x,
  y,
  w,
  h,
  size = 22,
  color = C.ink,
  bold = false,
  align = "left",
  valign = "top",
  fill = "none",
  lineFill = "none",
  lineWidth = 0,
  inset = 0,
  radius,
}) {
  const shape = addShape({
    name,
    geometry: radius !== undefined ? "roundRect" : "textbox",
    x,
    y,
    w,
    h,
    fill,
    lineFill,
    lineWidth,
    radius,
  });
  shape.text = text;
  shape.text.style = {
    fontSize: size,
    typeface: FONT,
    color,
    bold,
    alignment: align,
    verticalAlignment: valign,
    autoFit: "shrinkText",
    insets: { top: inset, right: inset, bottom: inset, left: inset },
  };
  return shape;
}

function addLine(name, x, y, w, h = 0, color = C.rule, width = 1) {
  return slide.shapes.add({
    geometry: "line",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: color, width },
  });
}

// Connector-like structure is added first so nodes and labels remain above it.
addLine("ksbpm-process-connector", 170, 216, 1320, 0, C.rule, 2);
addLine("roadmap-connector", 285, 1030, 1182, 0, C.rule, 2);

// Header
addShape({ name: "top-accent-rule", x: 54, y: 38, w: 1479, h: 5, fill: C.accentStrong });
addText({
  name: "eyebrow",
  text: "NATIONAL STATISTICS SYSTEM 2.0  /  A3 EXECUTIVE SUMMARY",
  x: 54,
  y: 55,
  w: 980,
  h: 28,
  size: 18,
  color: C.accentStrong,
  bold: true,
});
addText({
  name: "slide-title",
  text: "KSBPM 기반 AI 10대 과제 — 메타를 먼저 연결하고 전 과정을 자동화한다",
  x: 54,
  y: 84,
  w: 1479,
  h: 58,
  size: 40,
  bold: true,
});
addText({
  name: "slide-subtitle",
  text: "통계항목 중심 메타데이터 · 지침서 Vector DB · 에디팅 이력을 공통 기반으로, 설계→수집→처리→공표→보관을 하나의 근거형 AI 업무흐름으로 전환",
  x: 54,
  y: 145,
  w: 1479,
  h: 36,
  size: 22,
  color: C.muted,
});

// KSBPM process spine
addText({ name: "ksbpm-label", text: "KSBPM 9단계", x: 54, y: 193, w: 122, h: 34, size: 22, bold: true, color: C.accentStrong });
const steps = [
  ["1", "기획", ""],
  ["2", "설계", "①②④"],
  ["3", "구현", ""],
  ["4", "수집", "③"],
  ["5", "처리", "⑤⑥⑦"],
  ["6", "분석", ""],
  ["7", "공표", "⑧⑨⑩"],
  ["8", "평가", ""],
  ["9", "보관", "메타·이력"],
];
const sx = 186;
const sw = 141;
const sg = 12;
steps.forEach(([no, label, map], i) => {
  const x = sx + i * (sw + sg);
  const active = [1, 3, 4, 6, 8].includes(i);
  addShape({
    name: `ksbpm-step-${no}`,
    x,
    y: 193,
    w: sw,
    h: 52,
    fill: active ? C.panelBlue : C.panel,
    lineFill: active ? C.accent : C.rule,
    lineWidth: active ? 2 : 1,
  });
  addText({
    name: `ksbpm-step-text-${no}`,
    text: `${no}  ${label}`,
    x,
    y: 193,
    w: sw,
    h: 52,
    size: 22,
    bold: active,
    color: active ? C.accentStrong : C.ink,
    align: "center",
    valign: "middle",
    inset: 4,
  });
  if (map) {
    addText({
      name: `ksbpm-step-map-${no}`,
      text: map,
      x,
      y: 248,
      w: sw,
      h: 28,
      size: 18,
      color: C.accentStrong,
      bold: true,
      align: "center",
    });
  }
});

// Main initiatives title
addText({ name: "initiatives-title", text: "10대 과제  |  KSBPM 업무영역별 실행 묶음", x: 54, y: 287, w: 1013, h: 36, size: 26, bold: true });

const rows = [
  {
    y: 334,
    h: 118,
    label: "자료수집\n설계·구현·수집",
    range: "01–04",
    color: C.accentStrong,
    fill: "#F5FAFD",
    tasks: [
      ["01", "조사표·항목\n자동 설계 보조", "최우선"],
      ["02", "지침서·조사표\n문서 검증", ""],
      ["03", "모바일 전자조사표\nUX 자동 변환", ""],
      ["04", "항목이동·유효성\n검증 룰 생성", ""],
    ],
  },
  {
    y: 462,
    h: 118,
    label: "자료처리\n에디팅 자동화",
    range: "05–07",
    color: C.green,
    fill: "#F3FAF7",
    tasks: [
      ["05", "에디팅 우선순위\n추천", ""],
      ["06", "자동 대체\n(Imputation) 추천", ""],
      ["07", "분류코딩 자동화\n텍스트→표준코드", ""],
    ],
  },
  {
    y: 590,
    h: 118,
    label: "자료보관·공표\n생성·검증·설명",
    range: "08–10",
    color: C.amber,
    fill: "#FFF8EE",
    tasks: [
      ["08", "통계표 생성형 AI\n명세→집계·레이아웃", ""],
      ["09", "공표 전\n자동 검증", ""],
      ["10", "공표 설명자료\n초안 생성", ""],
    ],
  },
];

rows.forEach((row, rowIndex) => {
  addShape({ name: `task-row-${rowIndex + 1}`, x: 54, y: row.y, w: 1013, h: row.h, fill: row.fill, lineFill: C.rule, lineWidth: 1 });
  addShape({ name: `task-row-accent-${rowIndex + 1}`, x: 54, y: row.y, w: 8, h: row.h, fill: row.color });
  addText({ name: `task-row-range-${rowIndex + 1}`, text: row.range, x: 76, y: row.y + 13, w: 118, h: 28, size: 18, color: row.color, bold: true });
  addText({ name: `task-row-label-${rowIndex + 1}`, text: row.label, x: 76, y: row.y + 42, w: 176, h: 63, size: 21, color: C.ink, bold: true });
  addLine(`task-row-separator-${rowIndex + 1}`, 265, row.y + 15, 0, row.h - 30, C.rule, 1);
  const taskAreaX = 285;
  const taskAreaW = 762;
  const gap = 12;
  const cellW = (taskAreaW - gap * (row.tasks.length - 1)) / row.tasks.length;
  row.tasks.forEach(([no, title, tag], i) => {
    const x = taskAreaX + i * (cellW + gap);
    if (i > 0) addLine(`task-separator-${rowIndex + 1}-${i + 1}`, x - gap / 2, row.y + 18, 0, row.h - 36, "#D7DCE3", 1);
    addText({ name: `task-no-${no}`, text: no, x, y: row.y + 15, w: 44, h: 30, size: 19, color: row.color, bold: true });
    if (tag) {
      addText({ name: `task-tag-${no}`, text: tag, x: x + cellW - 66, y: row.y + 12, w: 62, h: 28, size: 16, color: C.white, bold: true, align: "center", valign: "middle", fill: row.color, inset: 2, radius: 3 });
    }
    addText({ name: `task-title-${no}`, text: title, x, y: row.y + 48, w: cellW - 4, h: 62, size: 21, color: C.ink, bold: true });
  });
});

// Priority recommendation panel
addShape({ name: "priority-panel", x: 1097, y: 287, w: 436, h: 421, fill: C.accentStrong, lineFill: C.accentStrong, lineWidth: 1 });
addText({ name: "priority-kicker", text: "가장 먼저 수행할 과제", x: 1128, y: 315, w: 370, h: 30, size: 20, color: C.accentLight, bold: true });
addText({ name: "priority-number", text: "01", x: 1125, y: 350, w: 86, h: 65, size: 48, color: C.white, bold: true });
addText({ name: "priority-title", text: "조사표·항목\n자동 설계 보조", x: 1210, y: 352, w: 285, h: 82, size: 29, color: C.white, bold: true });
addLine("priority-rule", 1128, 448, 370, 0, "#6BA4CE", 1);
addText({
  name: "priority-reason-title",
  text: "왜 ①부터인가",
  x: 1128,
  y: 466,
  w: 370,
  h: 30,
  size: 21,
  color: C.white,
  bold: true,
});
addText({
  name: "priority-reasons",
  text: "1. 문항·변수·코드·표 셀 ID를 설계 시점에 확정\n2. 오류를 수집 전에 차단해 후단 에디팅 비용 절감\n3. ⑤ 에디팅·⑧ 통계표·⑩ 설명자료가 같은 메타를 재사용",
  x: 1128,
  y: 504,
  w: 370,
  h: 128,
  size: 20,
  color: C.white,
});
addText({
  name: "priority-phase-zero",
  text: "0단계 병행  |  통계항목 메타 연결 + 지침서 Vector DB",
  x: 1128,
  y: 651,
  w: 370,
  h: 38,
  size: 18,
  color: C.accentStrong,
  bold: true,
  align: "center",
  valign: "middle",
  fill: C.white,
  inset: 6,
  radius: 4,
});

// Shared foundation band
addText({ name: "foundation-title", text: "0단계 공통기반  |  후속 9개 과제의 정확도·재사용성·감사 가능성을 결정", x: 54, y: 736, w: 1479, h: 34, size: 25, bold: true });
addShape({ name: "foundation-band", x: 54, y: 779, w: 1479, h: 124, fill: C.panelBlue, lineFill: "#B7D6E9", lineWidth: 1 });
const foundations = [
  {
    x: 80,
    w: 430,
    no: "A",
    title: "통계항목 기반 메타데이터 연결",
    body: "Question ID ↔ Variable ID ↔ Code List ID ↔ Table Cell ID",
  },
  {
    x: 556,
    w: 455,
    no: "B",
    title: "지침서 문서 Vector DB + RAG",
    body: "작성지침·법령·심사의견·과거 해설을 검색하고 답변마다 근거 인용",
  },
  {
    x: 1057,
    w: 450,
    no: "C",
    title: "에디팅 이력·운영 거버넌스",
    body: "수정 전/후·사유·정정 로그 + 폐쇄망 + Human-in-the-loop",
  },
];
foundations.forEach((f, i) => {
  if (i > 0) addLine(`foundation-separator-${i}`, f.x - 24, 801, 0, 80, "#B7D6E9", 1);
  addText({ name: `foundation-no-${f.no}`, text: f.no, x: f.x, y: 805, w: 38, h: 38, size: 20, color: C.white, bold: true, align: "center", valign: "middle", fill: C.accentStrong, inset: 2, radius: 3 });
  addText({ name: `foundation-title-${f.no}`, text: f.title, x: f.x + 50, y: 801, w: f.w - 50, h: 34, size: 22, color: C.accentStrong, bold: true });
  addText({ name: `foundation-body-${f.no}`, text: f.body, x: f.x + 50, y: 842, w: f.w - 50, h: 48, size: 19, color: C.ink });
});

// Roadmap timeline
addText({ name: "roadmap-title", text: "중장기 로드맵", x: 54, y: 932, w: 205, h: 38, size: 27, bold: true });
addText({ name: "roadmap-subtitle", text: "기반→업무자동화→종단확장", x: 54, y: 973, w: 205, h: 50, size: 18, color: C.muted });
const phases = [
  {
    x: 285,
    w: 390,
    dot: C.accentStrong,
    label: "단기  |  0–6개월",
    title: "메타 기반과 설계 품질을 먼저 고정",
    body: "공통기반 A·B·C + ①②④ PoC\n성과: 표준항목 재사용·문서/룰 오류 사전차단",
  },
  {
    x: 700,
    w: 390,
    dot: C.green,
    label: "중기  |  6–18개월",
    title: "수집·에디팅 자동화를 현업에 내재화",
    body: "③⑤⑥⑦ 운영 + ⑧ 생성형 통계표 Pilot\n성과: 검토량 축소·처리 일관성·정시성 향상",
  },
  {
    x: 1115,
    w: 418,
    dot: C.amber,
    label: "장기  |  18–36개월",
    title: "공표·보관까지 종단 자동화와 확산",
    body: "⑧ 확산 + ⑨⑩ 운영 + 다기관 재사용\n성과: 자동검증·근거형 설명·플랫폼 표준화",
  },
];
phases.forEach((p, i) => {
  addShape({ name: `roadmap-dot-${i + 1}`, geometry: "ellipse", x: p.x, y: 1019, w: 22, h: 22, fill: p.dot, lineFill: p.dot, lineWidth: 1 });
  addText({ name: `roadmap-label-${i + 1}`, text: p.label, x: p.x, y: 931, w: p.w, h: 28, size: 18, color: p.dot, bold: true });
  addText({ name: `roadmap-title-${i + 1}`, text: p.title, x: p.x, y: 963, w: p.w, h: 34, size: 21, bold: true });
  addText({ name: `roadmap-body-${i + 1}`, text: p.body, x: p.x, y: 1046, w: p.w, h: 62, size: 18, color: C.muted });
});

// Footer and notes
addText({ name: "source-footer", text: "Source: 제공 PPT v0.5 (2026.03.01), slides 2–14 · 의사결정용 요약 재구성", x: 1120, y: 1099, w: 413, h: 18, size: 12, color: "#7A8492", align: "right" });
slide.speakerNotes.textFrame.setText(
  "[Sources]\n" +
  "- C:/Users/kse/Desktop/시연/20260301_공통_나라통계시스템AI활용서비스발굴(초안)_v0.5.pptx (user-provided source; slides 2–14)\n" +
  "[/Sources]\n\n" +
  "Priority is a synthesis of the source deck's process order and mandatory common foundation: initiative 01 first, with metadata linkage and guideline Vector DB implemented in parallel as phase 0."
);
slide.speakerNotes.setVisible(true);

async function writeBlob(path, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await fs.writeFile(path, bytes);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await writeBlob(`${OUT_DIR}/slide-1.png`, await presentation.export({ slide, format: "png", scale: 2 }));
await fs.writeFile(`${OUT_DIR}/slide-1.layout.json`, await (await slide.export({ format: "layout" })).text(), "utf8");
await writeBlob(`${OUT_DIR}/montage.webp`, await presentation.export({ format: "webp", montage: true, scale: 1 }));
const inspect = await presentation.inspect({ kind: "slide,textbox,shape,notes", maxChars: 50000 });
await fs.writeFile(`${OUT_DIR}/inspect.ndjson`, inspect.ndjson, "utf8");

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(FINAL_PPTX);
console.log(`Created ${FINAL_PPTX}`);
