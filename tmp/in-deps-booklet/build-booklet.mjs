import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const W = 794;
const H = 1123;
const M = 62;
const CONTENT_W = W - M * 2;
const FONT = "Malgun Gothic";
const MONO = "Consolas";

const C = {
  navy: "#15255A",
  blue: "#2F6FB5",
  blue2: "#5E92CE",
  teal: "#158D91",
  green: "#3E8D65",
  amber: "#B97316",
  red: "#B54D58",
  violet: "#6E62A8",
  ink: "#14233C",
  body: "#3F4F65",
  muted: "#6D7A8D",
  line: "#D7E0EA",
  soft: "#F2F6FA",
  softBlue: "#EAF2FB",
  softTeal: "#E9F5F4",
  softGreen: "#ECF5EF",
  softAmber: "#FAF2E6",
  softRed: "#F9ECEE",
  softViolet: "#F1EFF8",
  white: "#FFFFFF",
};

const FINAL_PPTX = "D:/work/data-editing-system/tmp/in-deps-booklet/in-deps-system-booklet-a4.pptx";
const RENDER_DIR = "D:/work/data-editing-system/tmp/in-deps-booklet/rendered";
const LOGO_PATH = "D:/work/data-editing-system/frontend/assets/indeps_banner_bilingual.png";
const INIT_LOGO_PATH = "D:/work/data-editing-system/frontend/assets/init-logo.png";
const GUIDE_SOURCE = "D:/work/data-editing-system/frontend/help/in-deps-system-guide.html";
const MENU_SOURCE = "D:/work/data-editing-system/frontend/config/menu.config.js";

async function readImage(path) {
  const bytes = await fs.readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function addRect(slide, name, x, y, w, h, fill, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry || "rect",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: {
      style: "solid",
      fill: options.lineFill || fill,
      width: options.lineWidth ?? 0,
    },
    ...(options.radius ? { borderRadius: options.radius } : {}),
  });
}

function addText(slide, name, text, x, y, w, h, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: options.typeface || FONT,
    fontSize: options.fontSize ?? 18,
    bold: options.bold ?? false,
    color: options.color || C.body,
    alignment: options.align || "left",
    verticalAlignment: options.valign || "top",
    autoFit: options.autoFit || "none",
    lineSpacing: options.lineSpacing ?? 1.12,
    insets: options.insets || { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addBullets(slide, name, items, x, y, w, h, options = {}) {
  const shape = addText(slide, name, "", x, y, w, h, {
    fontSize: options.fontSize ?? 17,
    color: options.color || C.body,
    lineSpacing: options.lineSpacing ?? 1.16,
  });
  shape.text.set(items.map((item) => ({
    bulletCharacter: options.bullet || "•",
    marginLeft: options.marginLeft ?? 21,
    indent: options.indent ?? -13,
    spaceAfter: options.spaceAfter ?? 8,
    runs: Array.isArray(item) ? item : [item],
  })));
  shape.text.style = {
    typeface: FONT,
    fontSize: options.fontSize ?? 17,
    color: options.color || C.body,
    lineSpacing: options.lineSpacing ?? 1.16,
    autoFit: "none",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addHeader(slide, chapter, title, subtitle, page, accent = C.blue) {
  addRect(slide, `page-${page}-rail`, 0, 0, 10, H, accent);
  addText(slide, `page-${page}-chapter`, chapter, M, 45, 460, 24, {
    fontSize: 13,
    bold: true,
    color: accent,
  });
  addText(slide, `page-${page}-title`, title, M, 82, CONTENT_W, 84, {
    fontSize: 38,
    bold: true,
    color: C.ink,
      lineSpacing: 0.96,
  });
  if (subtitle) {
    addText(slide, `page-${page}-subtitle`, subtitle, M, 170, CONTENT_W, 50, {
      fontSize: 17,
      color: C.body,
      lineSpacing: 1.22,
    });
  }
  addRect(slide, `page-${page}-top-rule`, M, subtitle ? 226 : 170, CONTENT_W, 2, C.line);
  addFooter(slide, page, accent);
  return subtitle ? 256 : 200;
}

function addFooter(slide, page, accent = C.blue) {
  addRect(slide, `page-${page}-footer-rule`, M, H - 56, CONTENT_W, 1, C.line);
  addText(slide, `page-${page}-footer-name`, "IN-DEPS 시스템 소개서", M, H - 43, 300, 18, {
    fontSize: 10,
    color: C.muted,
  });
  addText(slide, `page-${page}-footer-number`, String(page).padStart(2, "0"), W - M - 50, H - 45, 50, 20, {
    fontSize: 11,
    bold: true,
    color: accent,
    align: "right",
  });
}

function addSectionLabel(slide, name, text, x, y, w, color = C.blue) {
  addRect(slide, `${name}-bar`, x, y + 4, 5, 20, color);
  return addText(slide, name, text, x + 16, y, w - 16, 28, {
    fontSize: 15,
    bold: true,
    color,
  });
}

function addNumberCircle(slide, name, value, x, y, fill = C.blue, size = 42) {
  const circle = addRect(slide, `${name}-circle`, x, y, size, size, fill, { geometry: "ellipse" });
  addText(slide, `${name}-number`, String(value), x, y + 2, size, size - 4, {
    fontSize: size >= 42 ? 17 : 14,
    bold: true,
    color: C.white,
    align: "center",
    valign: "middle",
  });
  return circle;
}

function addBand(slide, name, y, title, body, accent = C.blue, fill = C.softBlue, options = {}) {
  const h = options.height || 120;
  addRect(slide, `${name}-fill`, M, y, CONTENT_W, h, fill, { radius: "rounded-xl" });
  addRect(slide, `${name}-accent`, M, y, 8, h, accent);
  if (options.kicker) {
    addText(slide, `${name}-kicker`, options.kicker, M + 28, y + 18, 210, 20, {
      fontSize: 12,
      bold: true,
      color: accent,
      typeface: options.mono ? MONO : FONT,
    });
  }
  const titleY = options.kicker ? y + 44 : y + 22;
  addText(slide, `${name}-title`, title, M + 28, titleY, 245, 34, {
    fontSize: options.titleSize || 22,
    bold: true,
    color: C.ink,
  });
  addText(slide, `${name}-body`, body, M + 290, y + 22, CONTENT_W - 322, h - 40, {
    fontSize: options.bodySize || 16,
    color: C.body,
    lineSpacing: 1.2,
    valign: "middle",
  });
}

function addCallout(slide, name, text, x, y, w, h, fill = C.softBlue, accent = C.blue) {
  addRect(slide, `${name}-fill`, x, y, w, h, fill, { radius: "rounded-xl", lineFill: accent, lineWidth: 1 });
  addRect(slide, `${name}-accent`, x, y, 6, h, accent);
  addText(slide, `${name}-text`, text, x + 22, y + 18, w - 42, h - 32, {
    fontSize: 17,
    bold: true,
    color: C.ink,
    lineSpacing: 1.18,
    valign: "middle",
  });
}

function addMenuRow(slide, name, y, code, title, description, accent = C.blue, fill = C.white) {
  addRect(slide, `${name}-row`, M, y, CONTENT_W, 78, fill, { radius: "rounded-lg", lineFill: C.line, lineWidth: 1 });
  addText(slide, `${name}-code`, code, M + 18, y + 18, 96, 22, {
    fontSize: 13,
    bold: true,
    color: accent,
    typeface: MONO,
  });
  addText(slide, `${name}-title`, title, M + 122, y + 15, 180, 28, {
    fontSize: 18,
    bold: true,
    color: C.ink,
  });
  addText(slide, `${name}-desc`, description, M + 312, y + 13, CONTENT_W - 330, 54, {
    fontSize: 14,
    color: C.body,
    lineSpacing: 1.17,
    valign: "middle",
  });
}

function addNotes(slide, extraSources = []) {
  const sources = [
    `${GUIDE_SOURCE} (content source, accessed 2026-08-26)`,
    ...extraSources,
  ];
  slide.speakerNotes.textFrame.setText([
    "[Sources]",
    ...sources.map((source) => `- ${source}`),
  ]);
}

function addImage(slide, name, blob, contentType, x, y, w, h, fit = "contain", alt = "") {
  return slide.images.add({
    name,
    blob,
    contentType,
    alt,
    fit,
    position: { left: x, top: y, width: w, height: h },
  });
}

function addVerticalFlow(slide, items, startY, options = {}) {
  const x = options.x || M;
  const w = options.width || CONTENT_W;
  const h = options.itemHeight || 116;
  const gap = options.gap || 18;
  const accent = options.accent || C.blue;
  const nodes = [];
  items.forEach((item, index) => {
    const y = startY + index * (h + gap);
    const node = addRect(slide, `${options.name || "flow"}-node-${index + 1}`, x, y, w, h, item.fill || C.white, {
      radius: "rounded-xl",
      lineFill: item.accent || accent,
      lineWidth: 1,
    });
    nodes.push(node);
    addNumberCircle(slide, `${options.name || "flow"}-num-${index + 1}`, item.number || index + 1, x + 18, y + 26, item.accent || accent, 42);
    addText(slide, `${options.name || "flow"}-title-${index + 1}`, item.title, x + 78, y + 19, 220, 32, {
      fontSize: 21,
      bold: true,
      color: C.ink,
    });
    if (item.kicker) {
      addText(slide, `${options.name || "flow"}-kicker-${index + 1}`, item.kicker, x + 78, y + 57, 220, 20, {
        fontSize: 12,
        bold: true,
        color: item.accent || accent,
        typeface: MONO,
      });
    }
    addText(slide, `${options.name || "flow"}-body-${index + 1}`, item.body, x + 310, y + 18, w - 332, h - 34, {
      fontSize: item.bodySize || 16,
      color: C.body,
      lineSpacing: 1.2,
      valign: "middle",
    });
  });
  for (let index = 0; index < nodes.length - 1; index += 1) {
    slide.shapes.connect(nodes[index], nodes[index + 1], {
      kind: "straight",
      fromSide: "bottom",
      toSide: "top",
      line: { style: "solid", fill: C.line, width: 2 },
      tail: { type: "arrow", width: "sm", length: "sm" },
    });
  }
  return nodes;
}

async function main() {
  await fs.mkdir(RENDER_DIR, { recursive: true });
  const [productLogo, initLogo] = await Promise.all([readImage(LOGO_PATH), readImage(INIT_LOGO_PATH)]);
  const deck = Presentation.create({ slideSize: { width: W, height: H } });

  // 01. Cover
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    addRect(slide, "cover-top", 0, 0, W, 34, C.navy);
    addRect(slide, "cover-right", W - 124, 0, 124, H, C.softBlue);
    addRect(slide, "cover-right-accent", W - 26, 0, 26, H, C.blue);
    addImage(slide, "cover-product-logo", productLogo, "image/png", M, 78, 560, 175, "contain", "인뎁스 IN-DEPS 제품 로고");
    addText(slide, "cover-kicker", "SYSTEM INTRODUCTION · PRINT EDITION", M, 333, 470, 28, {
      fontSize: 14,
      bold: true,
      color: C.blue,
    });
    addText(slide, "cover-title", "인아이티 데이터\n에디팅 플랫폼 시스템", M, 392, 600, 150, {
      fontSize: 52,
      bold: true,
      color: C.ink,
      lineSpacing: 0.98,
    });
    addText(slide, "cover-subtitle", "데이터 선정부터 규칙 발굴, 검토·수정, 운영 반영까지\n하나의 추적 가능한 흐름으로 연결하는 IN-DEPS 시스템 소개서", M, 587, 575, 90, {
      fontSize: 20,
      color: C.body,
      lineSpacing: 1.3,
    });
    addRect(slide, "cover-statement-line", M, 742, 120, 5, C.teal);
    addText(slide, "cover-statement", "근거를 만들고, 사람이 결정하며,\n모든 변경을 Run과 감사 이력으로 추적합니다.", M, 770, 540, 82, {
      fontSize: 23,
      bold: true,
      color: C.navy,
      lineSpacing: 1.2,
    });
    addImage(slide, "cover-init-logo", initLogo, "image/png", M, 984, 196, 56, "contain", "INIT 인아이티 회사 로고");
    addText(slide, "cover-edition", "A4 PORTRAIT · EDITABLE POWERPOINT + PRINT PDF", 330, 1002, 330, 22, {
      fontSize: 10,
      bold: true,
      color: C.muted,
      align: "right",
    });
    addNotes(slide);
  }

  // 02. Definition and value
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "INTRODUCTION", "하나의 흐름으로 데이터 품질을 관리합니다", "IN-DEPS는 분석 모델만 제공하는 도구가 아니라, 데이터 품질 판단의 근거와 사람이 승인한 변경 과정을 함께 관리하는 데이터 에디팅 플랫폼입니다.", 2, C.blue);
    addText(slide, "p2-big-statement", "발견 → 검토 → 수정 → 검증 → 반영", M, y + 20, CONTENT_W, 54, {
      fontSize: 31,
      bold: true,
      color: C.navy,
      align: "center",
    });
    addText(slide, "p2-big-caption", "각 단계는 독립된 책임을 가지며, 모든 실행은 프로젝트·시나리오·Target DB·Flow Run 컨텍스트 안에서 연결됩니다.", M + 36, y + 88, CONTENT_W - 72, 60, {
      fontSize: 17,
      color: C.body,
      align: "center",
      lineSpacing: 1.25,
    });
    addBand(slide, "p2-trace", y + 184, "근거가 남는 분석", "컬럼 프로파일, 관계 지표, 규칙 품질, 위반 상세와 실제 Run 파라미터를 함께 보존합니다.", C.blue, C.softBlue, { kicker: "TRACEABILITY", height: 132 });
    addBand(slide, "p2-human", y + 334, "사람이 내리는 결정", "모델과 Rule 결과는 후보를 만들고, 최종 규칙 선정과 데이터 수정·운영 반영은 검토와 권한을 통과합니다.", C.teal, C.softTeal, { kicker: "HUMAN REVIEW", height: 132 });
    addBand(slide, "p2-control", y + 484, "통제되는 운영 반영", "원본 기준본, 편집본, 효과 검증과 버전 DML을 분리해 자동 탐지가 원본 변경으로 직결되지 않도록 설계합니다.", C.green, C.softGreen, { kicker: "CONTROLLED CHANGE", height: 132 });
    addCallout(slide, "p2-callout", "핵심 원칙 · 좋은 결과는 실행 성공 여부가 아니라, 설명 가능한 근거와 검토 가능한 변경 과정으로 판단합니다.", M, y + 650, CONTENT_W, 92, C.softViolet, C.violet);
    addNotes(slide);
  }

  // 03. Contents
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "GUIDE MAP", "이 소개서는 업무 흐름을 따라 읽도록 구성했습니다", "웹 페이지의 섹션 순서를 그대로 인쇄하지 않고, 하나의 질문에 한 페이지가 답하도록 내용을 다시 묶었습니다.", 3, C.teal);
    const chapters = [
      ["01", "업무 흐름과 시스템 구조", "04–06", "전체 프로세스, 아키텍처, 운영 원칙"],
      ["02", "에디팅 규칙 발굴 4단계", "07–11", "컬럼 유형, 관계, 규칙, 위반, SAME_RUN"],
      ["03", "Flow 실행과 결과 해석", "12–14", "DAG 검증, 실행 경로, 상태 해석"],
      ["04", "결정·수정·운영 반영", "15–16", "규칙 결정, 편집본, 효과 검증, DML"],
      ["05", "전체 업무 메뉴", "17–20", "24개 활성 업무 화면과 역할"],
      ["06", "운영·보안·용어", "21–24", "실행 체크, 보안 경계, 핵심 용어"],
    ];
    chapters.forEach(([no, title, pages, desc], index) => {
      const rowY = y + 8 + index * 116;
      addNumberCircle(slide, `p3-num-${no}`, no, M, rowY + 22, index < 2 ? C.blue : index < 4 ? C.teal : C.violet, 44);
      addText(slide, `p3-title-${no}`, title, M + 68, rowY + 11, 340, 34, { fontSize: 23, bold: true, color: C.ink });
      addText(slide, `p3-desc-${no}`, desc, M + 68, rowY + 52, 420, 34, { fontSize: 15, color: C.body });
      addText(slide, `p3-pages-${no}`, pages, W - M - 100, rowY + 24, 100, 28, { fontSize: 17, bold: true, color: C.blue, align: "right", typeface: MONO });
      if (index < chapters.length - 1) addRect(slide, `p3-line-${index}`, M + 68, rowY + 96, CONTENT_W - 68, 1, C.line);
    });
    addNotes(slide);
  }

  // 04. End-to-end journey
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "01 · END-TO-END JOURNEY", "여섯 단계가 하나의 추적 가능한 업무를 만듭니다", "메뉴는 개별 기능의 모음이 아니라, 업무 범위를 정의하고 분석 근거를 만든 뒤 안전한 변경과 보고로 이어지는 연속 프로세스입니다.", 4, C.blue);
    addVerticalFlow(slide, [
      { title: "업무 범위 정의", kicker: "M01001 · M01002", body: "프로젝트와 시나리오로 모든 실행의 상위 업무 맥락을 정합니다.", accent: C.blue, fill: C.softBlue },
      { title: "대상 데이터 준비", kicker: "M02001 · M02002", body: "파일을 적재하거나 Target DB 테이블을 관리 대상으로 연결합니다.", accent: C.blue2, fill: C.soft },
      { title: "4단계 모델 작업", kicker: "M03001–M03004", body: "컬럼 유형, 관계, 규칙, 위반 탐지 Job을 저장하고 개별 검증합니다.", accent: C.teal, fill: C.softTeal },
      { title: "통합 Flow 실행", kicker: "M04001 · M04002", body: "Job을 DAG로 연결하고 같은 Flow Run에서 실행·분석합니다.", accent: C.violet, fill: C.softViolet },
      { title: "결정·수정·반영", kicker: "M05001–M05003", body: "규칙 확정, 오류 수정, 효과 검증과 운영 DML을 서로 분리합니다.", accent: C.amber, fill: C.softAmber },
      { title: "결과 보고·운영", kicker: "M06001– · M90001–", body: "보고서와 모델·사용자·시스템 리소스를 운영합니다.", accent: C.green, fill: C.softGreen },
    ], y + 4, { name: "journey", itemHeight: 103, gap: 15 });
    addNotes(slide, [MENU_SOURCE + " (menu structure, accessed 2026-08-26)"]);
  }

  // 05. Architecture
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "01 · SYSTEM ARCHITECTURE", "업무 컨텍스트와 실행 계약이 시스템을 잇습니다", "사용자 채널에서 결과 아티팩트까지 모든 단계가 세션·권한·Target DB와 Flow Run을 공통 기준으로 사용합니다.", 5, C.teal);
    const layers = [
      ["사용자 채널", "웹 작업공간", "메뉴, 데이터 작업, Flow 캔버스, 분석과 보고서를 하나의 로그인 세션에서 조작", C.blue, C.softBlue],
      ["보안 경계", "세션·API 게이트웨이", "서버 세션, 사용자 역할과 시스템 DB 권한을 확인한 뒤 업무 API 연결", C.navy, C.soft],
      ["업무 기준", "프로젝트·시나리오·Target DB", "대상 데이터, 실행 Job과 결과가 같은 업무 범위 안에서 움직이도록 컨텍스트 고정", C.teal, C.softTeal],
      ["실행 제어", "Flow·Job·실행 리소스", "DAG 검증 후 DB_OBJECT, OML_PYTHON, INTERNAL/EXTERNAL API 중 한 경로 선택", C.violet, C.softViolet],
      ["결과·운영", "Run 아티팩트·분석·편집·보고", "Node 결과와 실제 파라미터를 보존하고 규칙 결정, 수정, 반영, 보고로 연결", C.green, C.softGreen],
    ];
    const nodes = [];
    layers.forEach(([label, title, body, accent, fill], index) => {
      const nodeY = y + 8 + index * 138;
      const node = addRect(slide, `p5-layer-${index}`, M + 72, nodeY, CONTENT_W - 72, 112, fill, { radius: "rounded-xl", lineFill: accent, lineWidth: 1 });
      nodes.push(node);
      addText(slide, `p5-label-${index}`, label, M, nodeY + 18, 56, 56, { fontSize: 13, bold: true, color: accent, align: "center", valign: "middle" });
      addText(slide, `p5-title-${index}`, title, M + 96, nodeY + 16, CONTENT_W - 126, 30, { fontSize: 22, bold: true, color: C.ink });
      addText(slide, `p5-body-${index}`, body, M + 96, nodeY + 53, CONTENT_W - 120, 46, { fontSize: 15, color: C.body, lineSpacing: 1.18 });
    });
    for (let index = 0; index < nodes.length - 1; index += 1) {
      slide.shapes.connect(nodes[index], nodes[index + 1], { kind: "straight", fromSide: "bottom", toSide: "top", line: { style: "solid", fill: C.line, width: 2 }, tail: { type: "arrow", width: "sm", length: "sm" } });
    }
    addNotes(slide);
  }

  // 06. Principles
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "01 · OPERATING PRINCIPLES", "탐지와 수정은 의도적으로 분리됩니다", "자동 분석은 검토 가능한 근거를 만들고, 사람이 승인한 결과만 별도 편집본과 통제된 운영 반영 단계로 이동합니다.", 6, C.amber);
    addText(slide, "p6-center", "자동화는 후보를 만들고\n운영 변경은 통제를 통과합니다", M + 55, y + 30, CONTENT_W - 110, 110, { fontSize: 32, bold: true, color: C.navy, align: "center", lineSpacing: 1.12 });
    const cards = [
      ["01", "Run 기반 추적", "실제 파라미터, 노드 상태, 결과 아티팩트를 Flow Run과 Node Run 단위로 연결합니다.", C.blue, C.softBlue],
      ["02", "탐지와 수정 분리", "규칙 위반 탐지는 검토 자료를 만들 뿐 원본 데이터를 자동으로 수정하지 않습니다.", C.teal, C.softTeal],
      ["03", "운영 반영 통제", "수정본 효과 검증, DML 검증, 실행 전 확인과 감사 이력을 순서대로 통과합니다.", C.green, C.softGreen],
    ];
    cards.forEach(([no, title, body, accent, fill], index) => {
      const cardY = y + 190 + index * 184;
      addRect(slide, `p6-card-${index}`, M, cardY, CONTENT_W, 154, fill, { radius: "rounded-xl" });
      addNumberCircle(slide, `p6-num-${index}`, no, M + 24, cardY + 47, accent, 48);
      addText(slide, `p6-title-${index}`, title, M + 98, cardY + 28, 230, 35, { fontSize: 24, bold: true, color: C.ink });
      addText(slide, `p6-body-${index}`, body, M + 98, cardY + 76, CONTENT_W - 130, 58, { fontSize: 17, color: C.body, lineSpacing: 1.2 });
    });
    addCallout(slide, "p6-callout", "SUCCESS는 실행이 끝났다는 뜻입니다. 규칙의 품질과 데이터 변경의 적절성은 별도의 지표와 사람의 검토로 판단합니다.", M, y + 718, CONTENT_W, 72, C.softAmber, C.amber);
    addNotes(slide);
  }

  // 07. Step 1
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "02 · FOUR-STAGE DISCOVERY · STEP 1", "컬럼 유형은 프로파일·Rule·Model을 함께 봅니다", "데이터 타입만으로 연속형을 단정하지 않고, 분포와 컬럼명 의미를 포함한 Rule 결과와 활성 모델 판단을 호환성 가드에서 결합합니다.", 7, C.blue);
    addVerticalFlow(slide, [
      { title: "컬럼 프로파일", kicker: "INPUT", body: "NULL·DISTINCT·비율, 최소·최대, 길이, 소수·정수 비율, 엔트로피·분포와 컬럼명 힌트를 수집합니다.", accent: C.blue, fill: C.softBlue, bodySize: 15 },
      { title: "Rule·Model 판정", kicker: "PARALLEL EVIDENCE", body: "V3 Rule 함수가 세부 유형과 근거를 만들고, 활성 OML 모델은 기존 계약과 파라미터를 유지한 채 독립적으로 판단합니다.", accent: C.violet, fill: C.softViolet, bodySize: 15 },
      { title: "최종 호환성 가드", kicker: "FINAL SELECTION", body: "일치·누락·신뢰도·그룹 호환성을 평가하고 연속형→범주형 오분류를 차단하며 식별자·자유 텍스트를 보호합니다.", accent: C.teal, fill: C.softTeal, bodySize: 15 },
      { title: "Run·최종 유형", kicker: "OUTPUT", body: "RULE·MODEL·FINAL 유형과 근거를 저장하고 사용자 확정값을 보존한 최신 최종 유형을 M03002에 제공합니다.", accent: C.green, fill: C.softGreen, bodySize: 15 },
    ], y + 8, { name: "step1", itemHeight: 132, gap: 22 });
    addCallout(slide, "p7-functions", "Rule 근거 · INIT$_FN_PREDICT_BASE_TYPE_V3 / INIT$_FN_PREDICT_BASE_REASON_V3", M, y + 644, CONTENT_W, 72, C.soft, C.navy);
    addText(slide, "p7-note", "모델 판단 로직 자체는 변경하지 않습니다. 개선은 Rule의 설명력과 최종 선택의 호환성 검증에 집중합니다.", M + 18, y + 739, CONTENT_W - 36, 64, { fontSize: 17, bold: true, color: C.red, align: "center", lineSpacing: 1.2 });
    addNotes(slide);
  }

  // 08. Step 2
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "02 · FOUR-STAGE DISCOVERY · STEP 2", "관계 지표는 컬럼 유형 조합에 따라 달라집니다", "1단계의 최신 확정 유형을 기준으로 적합한 지표를 계산하고, 통과 관계를 네트워크·군집으로 확장합니다.", 8, C.teal);
    const metrics = [
      ["범주형 × 범주형", "Cramér's V", "범주 간 결합 강도와 p-value", C.blue, C.softBlue],
      ["연속형 × 연속형", "Pearson / Spearman", "선형 또는 순위 관계와 p-value", C.teal, C.softTeal],
      ["범주형 × 연속형", "Eta Squared", "집단이 연속값 변동을 설명하는 정도", C.violet, C.softViolet],
    ];
    metrics.forEach(([pair, metric, desc, accent, fill], index) => {
      const cardY = y + 14 + index * 148;
      addRect(slide, `p8-metric-${index}`, M, cardY, CONTENT_W, 122, fill, { radius: "rounded-xl" });
      addText(slide, `p8-pair-${index}`, pair, M + 22, cardY + 20, 190, 24, { fontSize: 15, bold: true, color: accent });
      addText(slide, `p8-metric-name-${index}`, metric, M + 22, cardY + 56, 230, 34, { fontSize: 25, bold: true, color: C.ink, typeface: MONO });
      addText(slide, `p8-desc-${index}`, desc, M + 300, cardY + 35, CONTENT_W - 330, 56, { fontSize: 16, color: C.body, valign: "middle", lineSpacing: 1.2 });
    });
    addSectionLabel(slide, "p8-network-label", "통과 관계를 네트워크와 군집으로 재구성", M, y + 476, CONTENT_W, C.green);
    addBullets(slide, "p8-network-bullets", [
      "실제 Run 임계값으로 PASS 여부를 저장하고 강한 관계를 weighted edge로 선택합니다.",
      "결정적 community, degree, centrality를 계산해 3단계 규칙 발굴의 선택적 보조 입력으로 사용합니다.",
      "LATEST_MASTER 유형과 Target 테이블·유의수준·강도·샘플·edge 제한을 함께 기록합니다.",
    ], M + 8, y + 522, CONTENT_W - 16, 166, { fontSize: 17 });
    addCallout(slide, "p8-warning", "해석 주의 · 관계 통과는 인과관계나 최종 업무 규칙을 뜻하지 않습니다. 기준 미달 관계도 다변량 수식 후보에 필요할 수 있습니다.", M, y + 680, CONTENT_W, 96, C.softAmber, C.amber);
    addNotes(slide);
  }

  // 09. Step 3
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "02 · FOUR-STAGE DISCOVERY · STEP 3", "범주형과 연속형 규칙을 독립적으로 발굴합니다", "통합 실행은 두 분석 경로를 함께 호출하지만, 결과는 자동 확정이 아니라 사람이 검토할 규칙 후보입니다.", 9, C.violet);
    const left = M;
    const gap = 24;
    const colW = (CONTENT_W - gap) / 2;
    addRect(slide, "p9-left", left, y + 16, colW, 480, C.softBlue, { radius: "rounded-xl" });
    addText(slide, "p9-left-kicker", "CATEGORICAL", left + 24, y + 42, colW - 48, 20, { fontSize: 13, bold: true, color: C.blue });
    addText(slide, "p9-left-title", "Apriori 연관 규칙", left + 24, y + 79, colW - 48, 38, { fontSize: 27, bold: true, color: C.ink });
    addText(slide, "p9-left-desc", "조건–결과 형태의 사람이 읽을 수 있는 IF/THEN 후보를 만듭니다.", left + 24, y + 132, colW - 48, 70, { fontSize: 17, color: C.body, lineSpacing: 1.25 });
    addBullets(slide, "p9-left-bullets", [
      "최소 support·confidence 적용",
      "규칙 길이와 조합 예산 제한",
      "Oracle ML 모델과 요약 동시 생성",
      "lift와 표본 건수 함께 저장",
    ], left + 24, y + 230, colW - 48, 210, { fontSize: 16, spaceAfter: 12 });

    const right = left + colW + gap;
    addRect(slide, "p9-right", right, y + 16, colW, 480, C.softTeal, { radius: "rounded-xl" });
    addText(slide, "p9-right-kicker", "CONTINUOUS", right + 24, y + 42, colW - 48, 20, { fontSize: 13, bold: true, color: C.teal });
    addText(slide, "p9-right-title", "LASSO + Symbolic", right + 24, y + 79, colW - 48, 38, { fontSize: 27, bold: true, color: C.ink });
    addText(slide, "p9-right-desc", "중요변수를 압축하고 설명 가능한 f(x)=y 수식 후보를 비교합니다.", right + 24, y + 132, colW - 48, 70, { fontSize: 17, color: C.body, lineSpacing: 1.25 });
    addBullets(slide, "p9-right-bullets", [
      "결측 중앙값 보정과 표준화",
      "교차검증 또는 계수로 변수 선택",
      "선형·강건·비율·다항·PySR 비교",
      "Oracle-safe 수식과 R² 저장",
    ], right + 24, y + 230, colW - 48, 210, { fontSize: 16, spaceAfter: 12 });

    addSectionLabel(slide, "p9-partial-label", "부분 완료도 검토 가능한 결과로 남깁니다", M, y + 536, CONTENT_W, C.amber);
    addBullets(slide, "p9-partial", [
      "범주형·연속형 하위 작업의 성공과 실패를 독립적으로 확인합니다.",
      "일부만 완료되면 성공 결과와 실패 메시지를 함께 반환합니다.",
      "Flow Node는 FAILED로 기록될 수 있으므로 메시지와 생성된 결과를 함께 읽습니다.",
    ], M + 8, y + 582, CONTENT_W - 16, 150, { fontSize: 17 });
    addCallout(slide, "p9-callout", "중요변수 결과와 최종 수식 채택 결과는 서로 다른 판단 단계입니다.", M, y + 718, CONTENT_W, 78, C.softViolet, C.violet);
    addNotes(slide);
  }

  // 10. Step 4
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "02 · FOUR-STAGE DISCOVERY · STEP 4", "위반 탐지는 같은 Run의 규칙만 적용합니다", "범주형 연관 규칙과 연속형 Symbolic 수식을 SAME_RUN 계약으로 받아 위반 후보와 상세 행을 저장합니다.", 10, C.red);
    addCallout(slide, "p10-input", "필수 입력 · 같은 Flow Run에서 성공한 연관 모델·범주형 규칙 요약·Symbolic 규칙", M, y + 10, CONTENT_W, 84, C.softViolet, C.violet);
    const colW = (CONTENT_W - 26) / 2;
    addRect(slide, "p10-cat", M, y + 126, colW, 400, C.softBlue, { radius: "rounded-xl" });
    addText(slide, "p10-cat-title", "범주형 위반", M + 24, y + 153, colW - 48, 35, { fontSize: 26, bold: true, color: C.ink });
    addText(slide, "p10-cat-desc", "규칙 조건이 일치하지만 결과가 NULL이거나 예상값과 다른 행을 찾습니다.", M + 24, y + 205, colW - 48, 84, { fontSize: 17, color: C.body, lineSpacing: 1.24 });
    addBullets(slide, "p10-cat-bullets", ["confidence·lift를 보조 점수로 사용", "규칙별 저장·스캔 제한 적용", "위반 후보와 근거를 함께 보존"], M + 24, y + 317, colW - 48, 160, { fontSize: 16, spaceAfter: 12 });

    const right = M + colW + 26;
    addRect(slide, "p10-num", right, y + 126, colW, 400, C.softTeal, { radius: "rounded-xl" });
    addText(slide, "p10-num-title", "연속형 위반", right + 24, y + 153, colW - 48, 35, { fontSize: 26, bold: true, color: C.ink });
    addText(slide, "p10-num-desc", "허용된 수식으로 예측값을 계산하고 실제값과의 상대·절대 오차를 평가합니다.", right + 24, y + 205, colW - 48, 84, { fontSize: 17, color: C.body, lineSpacing: 1.24 });
    addBullets(slide, "p10-num-bullets", ["허용 feature와 수식만 안전하게 평가", "상대·절대 오차 임계값 적용", "실제·예측·오차를 상세 저장"], right + 24, y + 317, colW - 48, 160, { fontSize: 16, spaceAfter: 12 });

    addBand(slide, "p10-result", y + 560, "결과를 이렇게 읽습니다", "SUCCESS이면서 0건이면 정상 결과일 수 있습니다. FAILED이면 범주형·연속형의 성공 여부를 부분 완료 메시지로 나누어 확인합니다.", C.amber, C.softAmber, { height: 132, titleSize: 21, bodySize: 16 });
    addCallout(slide, "p10-warning", "위반 탐지는 원본을 수정하지 않습니다. 실제 오류 수정은 M05002의 별도 편집 테이블에서 수행합니다.", M, y + 710, CONTENT_W, 84, C.softRed, C.red);
    addNotes(slide);
  }

  // 11. Integrated 4-step contract
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "02 · FOUR-STAGE DISCOVERY · RUN CONTRACT", "4단계는 같은 Run 안에서 계약으로 이어집니다", "각 단계는 결과 테이블만 넘기는 것이 아니라, 어떤 기준과 Run을 참조할지 명시한 아티팩트 계약으로 연결됩니다.", 11, C.violet);
    const x = M + 28;
    const nodeW = CONTENT_W - 56;
    const nodes = [];
    const items = [
      ["1", "컬럼 유형", "RULE · MODEL · FINAL 유형과 사용자 확정 기준", C.blue, C.softBlue],
      ["2", "관계·군집", "유형별 지표, PASS 관계, 네트워크와 community", C.teal, C.softTeal],
      ["3", "규칙 발굴", "Apriori 규칙, LASSO 중요변수, Symbolic 수식", C.violet, C.softViolet],
      ["4", "위반 탐지", "범주형·연속형 위반 후보와 상세 행", C.red, C.softRed],
    ];
    items.forEach(([no, title, body, accent, fill], index) => {
      const nodeY = y + 22 + index * 162;
      const node = addRect(slide, `p11-node-${index}`, x, nodeY, nodeW, 124, fill, { radius: "rounded-xl", lineFill: accent, lineWidth: 1 });
      nodes.push(node);
      addNumberCircle(slide, `p11-num-${index}`, no, x + 22, nodeY + 37, accent, 48);
      addText(slide, `p11-title-${index}`, title, x + 92, nodeY + 24, 180, 32, { fontSize: 24, bold: true, color: C.ink });
      addText(slide, `p11-body-${index}`, body, x + 92, nodeY + 67, nodeW - 118, 38, { fontSize: 16, color: C.body });
      if (index === 0) addText(slide, "p11-latest", "LATEST_MASTER", x + nodeW - 155, nodeY + 18, 130, 20, { fontSize: 12, bold: true, color: accent, align: "right", typeface: MONO });
      if (index >= 1) addText(slide, `p11-same-${index}`, "SAME_RUN", x + nodeW - 120, nodeY + 18, 95, 20, { fontSize: 12, bold: true, color: accent, align: "right", typeface: MONO });
    });
    for (let index = 0; index < nodes.length - 1; index += 1) {
      slide.shapes.connect(nodes[index], nodes[index + 1], { kind: "straight", fromSide: "bottom", toSide: "top", line: { style: "solid", fill: C.violet, width: 3 }, tail: { type: "arrow", width: "med", length: "med" } });
      addText(slide, `p11-link-label-${index}`, index === 0 ? "최신 확정 유형" : "같은 Run의 선행 아티팩트", x + nodeW - 210, y + 146 + index * 162, 185, 20, { fontSize: 11, bold: true, color: C.muted, align: "right" });
    }
    addCallout(slide, "p11-callout", "Flow 분석에서는 단계별 결과뿐 아니라 실제 Run 파라미터와 선행 아티팩트가 같은 실행 맥락인지 함께 확인합니다.", M, y + 690, CONTENT_W, 94, C.soft, C.navy);
    addNotes(slide);
  }

  // 12. DAG orchestration
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "03 · FLOW ORCHESTRATION", "저장된 Job을 검증 가능한 DAG로 실행합니다", "M04001의 Flow는 그림이 아니라 저장·검증·실행 가능한 실행 계획이며, 각 노드 상태와 출력을 같은 Flow Run에 기록합니다.", 12, C.violet);
    addVerticalFlow(slide, [
      { title: "Job 배치·연결", kicker: "01 · DESIGN", body: "저장한 4단계 Job과 확장 리소스를 노드·엣지로 구성합니다.", accent: C.blue, fill: C.softBlue },
      { title: "구조·계약 검증", kicker: "02 · VALIDATE", body: "순환, 역방향 단계, 포트·아티팩트와 SAME_RUN 입력을 확인합니다.", accent: C.teal, fill: C.softTeal },
      { title: "런타임 값 확정", kicker: "03 · BIND", body: "Target, Result, 선행 출력, Run ID와 실제 파라미터를 결합합니다.", accent: C.violet, fill: C.softViolet },
      { title: "실행 경로 선택", kicker: "04 · EXECUTE", body: "저장된 EXEC_SOURCE_TYPE에 맞는 실행 어댑터를 한 개 선택합니다.", accent: C.amber, fill: C.softAmber },
      { title: "결과 정규화", kicker: "05 · MATERIALIZE", body: "출력 계약과 메시지를 Run·Node 결과 아티팩트로 저장합니다.", accent: C.green, fill: C.softGreen },
    ], y + 4, { name: "dag", itemHeight: 112, gap: 19 });
    addCallout(slide, "p12-callout", "Validate를 통과하지 못한 연결은 실행하지 않습니다. 필수 선행 노드는 SUCCESS가 되어야 후행 노드가 진행됩니다.", M, y + 680, CONTENT_W, 92, C.softRed, C.red);
    addNotes(slide);
  }

  // 13. Resource routing
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "03 · EXECUTION RESOURCE ROUTING", "실행 리소스는 세 경로로 라우팅됩니다", "Job에 저장된 실행 유형과 결과 계약을 기준으로 Target DB, OML Python, 내부·외부 API 경로 중 하나를 선택합니다.", 13, C.teal);
    addBand(slide, "p13-db", y + 12, "Target DB 실행 객체", "등록된 프로시저·패키지·Oracle ML 모델을 서버 세션의 검증된 Target DB 연결에서 실행합니다. 객체명·파라미터·결과 계약이 실제 DB 정의와 일치해야 합니다.", C.blue, C.softBlue, { kicker: "DB_OBJECT · M90001", mono: true, height: 180, titleSize: 23, bodySize: 16 });
    addBand(slide, "p13-oml", y + 216, "OML Python SQL API", "OML4Py Script Repository와 pyqEval·pyqTableEval·pyqRowEval·pyqGroupEval·pyqIndexEval 계약을 사용하고 결과를 표준 출력 형식으로 정규화합니다.", C.violet, C.softViolet, { kicker: "OML_PYTHON · OML4PY", mono: true, height: 180, titleSize: 23, bodySize: 16 });
    addBand(slide, "p13-api", y + 420, "내부 Python·외부 JSON API", "기본 2~4단계는 INTERNAL_API가 같은 WAS 함수를 직접 호출합니다. 사용자가 EXTERNAL_API를 등록한 경우에만 원격 HTTP JSON endpoint를 호출합니다.", C.teal, C.softTeal, { kicker: "WEB_API · M90002", mono: true, height: 180, titleSize: 23, bodySize: 16 });
    addSectionLabel(slide, "p13-check-label", "공통 검증 항목", M, y + 640, CONTENT_W, C.amber);
    addBullets(slide, "p13-check", ["Target·Result·Run 바인드와 출력 계약", "권한·ACL·시간·응답 크기·유효 JSON", "대용량 처리 범위, 병렬 자원과 커밋 단위"], M + 8, y + 684, CONTENT_W - 16, 132, { fontSize: 17 });
    addNotes(slide);
  }

  // 14. Status interpretation
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "03 · RUN & NODE STATUS", "SUCCESS와 좋은 결과는 같은 말이 아닙니다", "실행 상태는 프로세스가 어떻게 종료되었는지를 나타냅니다. 규칙 품질과 업무 승인 여부는 결과 지표·표본·메시지를 별도로 확인해야 합니다.", 14, C.amber);
    const rows = [
      ["SUCCESS", "노드 실행과 결과 계약 저장 완료", "업무 승인이나 규칙 품질을 뜻하지 않습니다. 실제 지표와 표본을 확인합니다.", C.green, C.softGreen],
      ["FAILED", "실행 오류 또는 검토가 필요한 부분 완료", "메시지에서 성공한 하위 작업과 실패한 작업을 유형별로 나누어 확인합니다.", C.red, C.softRed],
      ["SKIPPED", "의존 조건 미충족 또는 실행 대상 제외", "필수 선행 노드 상태와 ON_COMPLETE 등 엣지 조건을 확인합니다.", C.muted, C.soft],
    ];
    rows.forEach(([status, meaning, reading, accent, fill], index) => {
      const rowY = y + 14 + index * 190;
      addRect(slide, `p14-row-${index}`, M, rowY, CONTENT_W, 160, fill, { radius: "rounded-xl" });
      addText(slide, `p14-status-${index}`, status, M + 24, rowY + 22, 160, 34, { fontSize: 22, bold: true, color: accent, typeface: MONO });
      addText(slide, `p14-meaning-title-${index}`, "실행 의미", M + 215, rowY + 20, 110, 22, { fontSize: 13, bold: true, color: accent });
      addText(slide, `p14-meaning-${index}`, meaning, M + 215, rowY + 49, CONTENT_W - 245, 42, { fontSize: 17, bold: true, color: C.ink });
      addText(slide, `p14-reading-title-${index}`, "운영 해석", M + 215, rowY + 99, 110, 20, { fontSize: 13, bold: true, color: accent });
      addText(slide, `p14-reading-${index}`, reading, M + 315, rowY + 96, CONTENT_W - 345, 48, { fontSize: 15, color: C.body, lineSpacing: 1.16 });
    });
    addCallout(slide, "p14-callout", "위반 0건은 오류가 아닐 수 있습니다. 반대로 SUCCESS라도 규칙 표본과 설명력이 충분한지는 별도로 검토합니다.", M, y + 608, CONTENT_W, 94, C.softAmber, C.amber);
    addNotes(slide);
  }

  // 15. Result to change
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "04 · REVIEW TO CHANGE", "분석 결과는 다섯 책임 단계를 거쳐 변경됩니다", "발굴 결과를 곧바로 원본에 적용하지 않고, 해석·결정·편집·효과 검증·보고를 서로 다른 작업 화면과 책임으로 분리합니다.", 15, C.amber);
    addVerticalFlow(slide, [
      { title: "결과 분석", kicker: "M04002", body: "유형, 관계·군집, 규칙, 위반과 실제 Run 파라미터를 함께 해석합니다.", accent: C.blue, fill: C.softBlue },
      { title: "규칙 결정", kicker: "M05001", body: "발굴 후보를 선정·제외하고 사용자 규칙을 검증해 규칙 마스터를 관리합니다.", accent: C.violet, fill: C.softViolet },
      { title: "오류 수정", kicker: "M05002", body: "원본 기준 작업본을 검사하고 INITDN$ 편집본에서 셀 값을 수정합니다.", accent: C.amber, fill: C.softAmber },
      { title: "효과·DML", kicker: "M05003", body: "수정 전후 효과를 비교하고 버전 관리된 운영 반영 DML을 검증·실행합니다.", accent: C.red, fill: C.softRed },
      { title: "결과 보고", kicker: "M06001 · M06002", body: "고정형·통합 또는 맞춤형 보고서로 분석과 에디팅 이력을 공유합니다.", accent: C.green, fill: C.softGreen },
    ], y + 4, { name: "change", itemHeight: 112, gap: 20 });
    addCallout(slide, "p15-callout", "각 단계가 분리되어 있기 때문에 규칙 후보의 품질 문제와 실제 데이터 변경 위험을 서로 다른 지점에서 통제할 수 있습니다.", M, y + 686, CONTENT_W, 96, C.soft, C.navy);
    addNotes(slide);
  }

  // 16. Original/edit separation
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "04 · EDITING & OPERATIONAL APPLY", "원본·편집본·운영 반영을 세 층으로 분리합니다", "탐지 결과가 원본을 직접 바꾸지 않도록 검사 기준, 사용자 편집, 운영 반영을 서로 다른 데이터와 승인 단계로 관리합니다.", 16, C.red);
    const nodes = [];
    const items = [
      ["기준 작업본", "INITUP$", "규칙을 적용해 현재 위반 여부를 검사하는 원본 기준 스냅샷", C.blue, C.softBlue],
      ["사용자 편집본", "INITDN$", "검토자가 오류 값을 수정하고 변경 사유와 세션을 기록하는 편집 테이블", C.amber, C.softAmber],
      ["운영 반영", "VERSIONED DML", "효과 검증을 통과한 변경만 버전 DML로 생성·검증·승인 후 실행", C.red, C.softRed],
    ];
    items.forEach(([label, code, desc, accent, fill], index) => {
      const nodeY = y + 30 + index * 218;
      const node = addRect(slide, `p16-node-${index}`, M + 48, nodeY, CONTENT_W - 96, 174, fill, { radius: "rounded-xl", lineFill: accent, lineWidth: 1 });
      nodes.push(node);
      addText(slide, `p16-label-${index}`, label, M + 76, nodeY + 24, 180, 24, { fontSize: 15, bold: true, color: accent });
      addText(slide, `p16-code-${index}`, code, M + 76, nodeY + 61, 250, 38, { fontSize: 26, bold: true, color: C.ink, typeface: MONO });
      addText(slide, `p16-desc-${index}`, desc, M + 330, nodeY + 42, CONTENT_W - 400, 92, { fontSize: 16, color: C.body, lineSpacing: 1.22, valign: "middle" });
    });
    for (let index = 0; index < nodes.length - 1; index += 1) {
      slide.shapes.connect(nodes[index], nodes[index + 1], { kind: "straight", fromSide: "bottom", toSide: "top", line: { style: "solid", fill: C.amber, width: 3 }, tail: { type: "arrow", width: "med", length: "med" } });
      addText(slide, `p16-gate-${index}`, index === 0 ? "사람의 검토·수정" : "효과 검증·권한·실행 확인", M + 220, y + 198 + index * 218, CONTENT_W - 440, 24, { fontSize: 12, bold: true, color: C.amber, align: "center" });
    }
    addCallout(slide, "p16-audit", "감사 이력 · 편집 세션, 수정 전후 값, 규칙 근거, DML 버전과 실행 결과를 다시 추적할 수 있어야 합니다.", M, y + 690, CONTENT_W, 92, C.softGreen, C.green);
    addNotes(slide);
  }

  // 17. Menu map overview
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "05 · MENU MAP", "24개 업무 메뉴는 네 책임 영역으로 구성됩니다", "메인 홈을 제외한 활성 업무 화면을 업무 단계에 따라 묶었습니다. 관리자 메뉴 노출과 API 실행 권한은 서버 역할 검사를 기준으로 합니다.", 17, C.blue);
    const groups = [
      ["01", "업무 설계·대상 준비", "4", "프로젝트·시나리오·파일·Target 테이블", C.blue, C.softBlue],
      ["02", "모델 설정·통합 실행", "6", "4단계 Job, Flow 설계와 Run 분석", C.teal, C.softTeal],
      ["03", "규칙 결정·수정·보고", "5", "규칙 마스터, 편집, 운영 반영, 보고서", C.amber, C.softAmber],
      ["04", "리소스·개인·관리자 운영", "9", "모델/API, 개인 설정, DB·시스템·공지", C.violet, C.softViolet],
    ];
    groups.forEach(([no, title, count, desc, accent, fill], index) => {
      const gy = y + 20 + index * 183;
      addRect(slide, `p17-group-${index}`, M, gy, CONTENT_W, 150, fill, { radius: "rounded-xl" });
      addNumberCircle(slide, `p17-num-${index}`, no, M + 24, gy + 50, accent, 48);
      addText(slide, `p17-title-${index}`, title, M + 98, gy + 25, 320, 36, { fontSize: 24, bold: true, color: C.ink });
      addText(slide, `p17-desc-${index}`, desc, M + 98, gy + 75, 390, 54, { fontSize: 16, color: C.body, lineSpacing: 1.18 });
      addText(slide, `p17-count-${index}`, count, W - M - 92, gy + 34, 70, 54, { fontSize: 38, bold: true, color: accent, align: "right" });
      addText(slide, `p17-count-label-${index}`, "개 메뉴", W - M - 96, gy + 94, 74, 24, { fontSize: 12, bold: true, color: accent, align: "right" });
    });
    addCallout(slide, "p17-auth", "보안 경계 · 화면에서 메뉴를 숨기는 것은 편의 기능입니다. 실제 관리자 기능은 서버의 관리자 역할 검사를 통과해야 합니다.", M, y + 726, CONTENT_W, 72, C.softRed, C.red);
    addNotes(slide, [MENU_SOURCE + " (active menu structure, accessed 2026-08-26)"]);
  }

  // 18. Menus 1-8
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "05 · MENU MAP · 1/3", "업무 범위와 4단계 모델 작업을 준비합니다", "프로젝트·시나리오·대상 데이터 준비에서 규칙 발굴 4단계 Job 설정까지의 메뉴입니다.", 18, C.blue);
    const rows = [
      ["M01001", "프로젝트 설정", "데이터 에디팅 업무의 최상위 범위를 등록·조회·수정합니다."],
      ["M01002", "시나리오 정의", "프로젝트 안의 실행 목적·설명·기준을 관리합니다."],
      ["M02001", "파일 업로드 관리", "CSV·Excel을 Target DB 작업 테이블로 적재하고 구조를 확인합니다."],
      ["M02002", "대상 테이블 선정", "Target DB 테이블을 관리 대상으로 등록하고 기본 Job·Flow를 준비합니다."],
      ["M03001", "컬럼 유형 분석", "RULE·MODEL·FINAL과 사용자 확정 최종 유형을 구분합니다."],
      ["M03002", "컬럼 상관 분석", "유형별 지표, 관계 매트릭스, 네트워크와 군집을 생성합니다."],
      ["M03003", "자동 규칙 발굴", "Apriori와 LASSO·Symbolic 규칙 후보를 발굴합니다."],
      ["M03004", "규칙 위반 탐지", "범주형·연속형 규칙의 위반 후보와 상세 행을 찾습니다."],
    ];
    rows.forEach((row, index) => addMenuRow(slide, `p18-menu-${index}`, y + 8 + index * 88, ...row, index < 4 ? C.blue : C.teal, index % 2 ? C.white : C.soft));
    addNotes(slide, [MENU_SOURCE + " (menu codes and labels, accessed 2026-08-26)"]);
  }

  // 19. Menus 9-15
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "05 · MENU MAP · 2/3", "실행 결과를 결정·수정·보고로 연결합니다", "Flow 실행과 결과 분석, 규칙 결정, 편집, 운영 반영과 보고서 메뉴입니다.", 19, C.amber);
    const rows = [
      ["M04001", "규칙 발굴 실행", "Job을 DAG로 연결해 통합 Flow를 설계·검증·실행합니다."],
      ["M04002", "규칙 발굴 분석", "Flow Run의 4단계 결과와 실제 실행 맥락을 해석합니다."],
      ["M05001", "에디팅 규칙 관리", "발굴 후보를 선정·제외하고 최종·사용자 규칙을 관리합니다."],
      ["M05002", "에디팅 오류 수정", "활성 규칙으로 기준본을 검사하고 편집본의 오류 값을 수정합니다."],
      ["M05003", "에디팅 운영 반영", "수정 효과, 버전 DML, 실행과 감사 이력을 관리합니다."],
      ["M06001", "기본형 보고서", "설계·분석·에디팅 결과를 고정형·통합 보고서로 제공합니다."],
      ["M06002", "맞춤형 보고서", "보고 블록을 용지와 순서에 맞춰 재사용 가능한 템플릿으로 만듭니다."],
    ];
    rows.forEach((row, index) => addMenuRow(slide, `p19-menu-${index}`, y + 14 + index * 99, ...row, index < 2 ? C.violet : index < 5 ? C.amber : C.green, index % 2 ? C.white : C.soft));
    addCallout(slide, "p19-callout", "업무 승인·데이터 수정·운영 실행·결과 공유는 서로 다른 메뉴와 이력으로 분리됩니다.", M, y + 700, CONTENT_W, 78, C.softAmber, C.amber);
    addNotes(slide, [MENU_SOURCE + " (menu codes and labels, accessed 2026-08-26)"]);
  }

  // 20. Menus 16-24
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "05 · MENU MAP · 3/3", "리소스·개인 환경·관리자 기능을 운영합니다", "실행 리소스와 모델 학습, 개인 설정, Target DB·시스템·공지 관리 메뉴입니다.", 20, C.violet);
    const rows = [
      ["M90001", "내부 모델 등록", "Target DB 프로시저·패키지·모델 객체를 실행 리소스로 등록합니다."],
      ["M90002", "외부 모델 등록", "내부 Python·외부 JSON API·OML 리소스 계약을 관리합니다."],
      ["M90003", "모델 학습 관리", "공통 OML 모델의 학습·검증·활성화·롤백 이력을 관리합니다."],
      ["M91001", "나의 회원정보", "계정 정보와 개인 API Key 상태를 관리합니다."],
      ["M91002", "내 시스템 설정", "언어·표시·계정과 사용자별 설정을 관리합니다."],
      ["M99001", "DB 접속 정보 설정", "관리자가 Target DB 연결을 등록·테스트·초기화합니다."],
      ["M99002", "데이터베이스관리", "Target DB 객체·데이터·컬럼·소스·SQL을 탐색합니다."],
      ["M99003", "System Management", "초기화·테이블 점검·사용자 승인 등 시스템을 운영합니다."],
      ["M99004", "공지사항 관리", "공지와 첨부 파일을 등록·수정·삭제합니다."],
    ];
    rows.forEach((row, index) => addMenuRow(slide, `p20-menu-${index}`, y + 4 + index * 79, ...row, index < 3 ? C.violet : index < 5 ? C.teal : C.red, index % 2 ? C.white : C.soft));
    addNotes(slide, [MENU_SOURCE + " (menu codes and labels, accessed 2026-08-26)"]);
  }

  // 21. Operational checks
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "06 · SAFE OPERATION", "실행 전후에 세 가지 기준을 확인합니다", "실행 컨텍스트, 상태와 품질, 수정·반영 안전성을 분리해 점검하면 잘못된 대상 실행과 성급한 운영 변경을 줄일 수 있습니다.", 21, C.green);
    const checks = [
      ["01", "실행 전 컨텍스트", ["현재 사용자, 역할과 Target DB 확인", "프로젝트·시나리오·대상 테이블 범위 확인", "Flow Validate의 단계·포트·SAME_RUN 확인"], C.blue, C.softBlue],
      ["02", "상태와 품질 분리", ["SUCCESS와 업무 승인을 구분", "FAILED의 부분 완료 메시지를 유형별 확인", "위반 0건이 정상 결과일 가능성 확인"], C.amber, C.softAmber],
      ["03", "수정·반영 안전성", ["탐지 결과가 원본을 자동 수정하지 않음", "수정본 효과 검증 후 버전 DML 검증", "운영 반영 전 권한·실행 확인·감사 이력 점검"], C.green, C.softGreen],
    ];
    checks.forEach(([no, title, bullets, accent, fill], index) => {
      const cardY = y + 18 + index * 236;
      addRect(slide, `p21-card-${index}`, M, cardY, CONTENT_W, 205, fill, { radius: "rounded-xl" });
      addNumberCircle(slide, `p21-num-${index}`, no, M + 24, cardY + 28, accent, 48);
      addText(slide, `p21-title-${index}`, title, M + 98, cardY + 31, 330, 34, { fontSize: 24, bold: true, color: C.ink });
      addBullets(slide, `p21-bullets-${index}`, bullets, M + 98, cardY + 88, CONTENT_W - 134, 96, { fontSize: 16, spaceAfter: 8 });
    });
    addCallout(slide, "p21-callout", "운영 체크는 오류 대응 절차가 아니라 실행 전에 범위와 책임을 확정하는 기본 업무 절차입니다.", M, y + 714, CONTENT_W, 76, C.soft, C.navy);
    addNotes(slide);
  }

  // 22. Security boundaries
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "06 · SECURITY BOUNDARIES", "인증·권한·비밀 값은 서버 경계에서 판단합니다", "브라우저 저장 값이나 메뉴 숨김을 보안 근거로 사용하지 않고, 서버 세션과 시스템 DB 조회를 기준으로 사용자와 관리자 권한을 확인합니다.", 22, C.red);
    addBand(slide, "p22-auth", y + 12, "인증·인가 기준", "서버 세션 쿠키와 시스템 DB 조회가 사용자 ID와 역할의 기준입니다. GET/POST 파라미터, 임의 헤더, sessionStorage·localStorage는 권한 근거가 아닙니다.", C.blue, C.softBlue, { height: 164, titleSize: 22, bodySize: 16 });
    addBand(slide, "p22-admin", y + 194, "관리자 기능", "관리자 메뉴 숨김은 보조 UI일 뿐입니다. 관리자 API는 서버의 관리자 역할 검사 또는 전역 관리자 정책을 통과해야 합니다.", C.violet, C.softViolet, { height: 148, titleSize: 22, bodySize: 16 });
    addBand(slide, "p22-secret", y + 360, "비밀번호·키·지갑", "DB·지갑 비밀번호, 외부 API Key, 관리자 인증 값은 암호화·세션·권한 경계에서 처리하며 도움말·브라우저 응답·JS에 남기지 않습니다.", C.red, C.softRed, { height: 164, titleSize: 22, bodySize: 16 });
    addBand(slide, "p22-external", y + 542, "EXTERNAL_API 인증 값", "런타임 바인드 화면에서 입력되어 브라우저 메모리와 실행 요청에 포함됩니다. 현재 경로는 서버 비밀 저장소의 값을 자동으로 조회하지 않습니다.", C.amber, C.softAmber, { height: 164, titleSize: 22, bodySize: 16 });
    addCallout(slide, "p22-callout", "공개 도움말과 소개서는 논리적인 흐름만 설명하며 실제 DB 접속 정보, 내부 비밀 값과 인증 자격 증명을 포함하지 않습니다.", M, y + 718, CONTENT_W, 72, C.softGreen, C.green);
    addNotes(slide);
  }

  // 23. Glossary
  {
    const slide = deck.slides.add();
    slide.background.fill = C.white;
    const y = addHeader(slide, "06 · GLOSSARY", "핵심 용어는 실행 맥락과 변경 책임을 설명합니다", "화면과 결과를 읽을 때 반복해서 등장하는 여섯 용어를 하나의 기준으로 정리했습니다.", 23, C.teal);
    const terms = [
      ["JOB", "데이터 작업", "실행 객체와 파라미터, 대상·결과 계약을 저장한 재사용 실행 단위", C.blue, C.softBlue],
      ["FLOW RUN", "통합 실행 맥락", "하나의 DAG 실행에서 실제 파라미터와 모든 Node Run을 묶는 추적 기준", C.violet, C.softViolet],
      ["ARTIFACT", "단계 결과 계약", "후행 노드와 분석·보고가 참조할 테이블, 모델, JSON과 실행 메시지", C.teal, C.softTeal],
      ["LATEST_MASTER", "최신 확정 기준", "사용자 확정값을 보존한 최신 컬럼 유형 등 단계가 참조하는 마스터", C.green, C.softGreen],
      ["SAME_RUN", "동일 Run 의존", "현재 Flow Run에서 성공한 선행 노드 아티팩트만 필수 입력으로 사용하는 계약", C.amber, C.softAmber],
      ["INITUP$ / INITDN$", "원본 기준본 / 편집본", "검사 기준 작업본과 사용자 수정이 이루어지는 편집 테이블을 분리하는 패턴", C.red, C.softRed],
    ];
    terms.forEach(([code, title, desc, accent, fill], index) => {
      const rowY = y + 10 + index * 120;
      addRect(slide, `p23-term-${index}`, M, rowY, CONTENT_W, 98, fill, { radius: "rounded-lg" });
      addText(slide, `p23-code-${index}`, code, M + 20, rowY + 18, 180, 24, { fontSize: 14, bold: true, color: accent, typeface: MONO });
      addText(slide, `p23-title-${index}`, title, M + 20, rowY + 53, 220, 28, { fontSize: 19, bold: true, color: C.ink });
      addText(slide, `p23-desc-${index}`, desc, M + 268, rowY + 20, CONTENT_W - 292, 60, { fontSize: 15, color: C.body, lineSpacing: 1.18, valign: "middle" });
    });
    addNotes(slide);
  }

  // 24. Back cover / synthesis
  {
    const slide = deck.slides.add();
    slide.background.fill = C.navy;
    addRect(slide, "back-left", 0, 0, 18, H, C.teal);
    addRect(slide, "back-logo-panel", M, 68, 500, 158, C.white, { radius: "rounded-xl" });
    addImage(slide, "back-product-logo", productLogo, "image/png", M + 20, 82, 460, 130, "contain", "인뎁스 IN-DEPS 제품 로고");
    addText(slide, "back-kicker", "THE IN-DEPS OPERATING MODEL", M, 300, 520, 28, { fontSize: 14, bold: true, color: "#7AC7D0" });
    addText(slide, "back-title", "근거를 만들고\n사람이 결정하며\n변경을 추적합니다", M, 362, 620, 205, { fontSize: 48, bold: true, color: C.white, lineSpacing: 1.05 });
    addText(slide, "back-body", "데이터 선정부터 규칙 발굴, Flow 실행, 결과 해석, 편집과 운영 반영까지 — IN-DEPS는 분석과 변경 사이의 책임을 분리하면서 하나의 Run과 감사 이력으로 업무를 연결합니다.", M, 620, 600, 145, { fontSize: 21, color: "#D9E3F1", lineSpacing: 1.34 });
    const values = [["설명 가능한 근거", C.blue2], ["검토 가능한 결정", "#4DB8B0"], ["통제 가능한 변경", "#79B391"], ["재현 가능한 이력", "#B7A8E2"]];
    values.forEach(([label, color], index) => {
      const vy = 823 + index * 54;
      addRect(slide, `back-dot-${index}`, M, vy + 5, 14, 14, color, { geometry: "ellipse" });
      addText(slide, `back-value-${index}`, label, M + 30, vy, 300, 28, { fontSize: 18, bold: true, color: C.white });
    });
    addRect(slide, "back-init-panel", W - M - 184, 998, 184, 64, C.white, { radius: "rounded-lg" });
    addImage(slide, "back-init-logo", initLogo, "image/png", W - M - 170, 1006, 156, 48, "contain", "INIT 인아이티 회사 로고");
    addText(slide, "back-format", "A4 PRINT EDITION · 2026", M, 1025, 230, 20, { fontSize: 10, bold: true, color: "#98A9C0" });
    addNotes(slide);
  }

  for (const [index, slide] of deck.slides.items.entries()) {
    const stem = `page-${String(index + 1).padStart(2, "0")}`;
    const png = await deck.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(`${RENDER_DIR}/${stem}.png`, new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(`${RENDER_DIR}/${stem}.layout.json`, await layout.text());
  }

  const montage = await deck.export({ format: "webp", montage: true, scale: 0.55 });
  await fs.writeFile(`${RENDER_DIR}/booklet-montage.webp`, new Uint8Array(await montage.arrayBuffer()));

  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(FINAL_PPTX);
  console.log(JSON.stringify({ slideCount: deck.slides.items.length, pptx: FINAL_PPTX, renderDir: RENDER_DIR }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
