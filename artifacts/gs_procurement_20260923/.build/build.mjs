import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation, PresentationFile} from '@oai/artifact-tool';
import {gs} from './gs.mjs';
import {procurement} from './procurement.mjs';
import {sources} from './sources.mjs';

const workspaceDir='D:/work/data-editing-system/artifacts/gs_procurement_20260923';
const tmp=path.join(workspaceDir,'.build');
const font='Malgun Gothic';
const theme={ink:'#152F43',accent:'#0D6E75',muted:'#526676',line:'#CAD5DB',pale:'#F3F6F8'};
const allDecks=[gs,procurement];
const only=process.argv.find(a=>a.startsWith('--only='))?.split('=')[1];
const sample=process.argv.includes('--sample');
const render=process.argv.includes('--render');
function txt(slide,text,x,y,w,h,size,color=theme.ink,bold=false){
 const box=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 box.text=text;
 box.text.style={typeface:font,fontSize:size,bold,color,autoFit:'none',wrap:true,verticalAlignment:'middle'};
 return box;
}
function cover(p,d){
 const sl=p.slides.add(); sl.background.fill='#FFFFFF';
 txt(sl,'INIT Data Editing System  인뎁스',70,92,1460,60,30,theme.accent,true);
 txt(sl,d.title,70,225,1460,120,66,theme.ink,true);
 txt(sl,d.subtitle,74,390,1450,150,32);
 txt(sl,d.context,74,655,1450,130,25,theme.muted);
 txt(sl,'실행 작업 · 담당 역할 · 산출물 · 완료 기준',74,810,1400,38,23,theme.accent);
 sl.speakerNotes.textFrame.setText('사용자 요청: 첫 GS 인증과 나라장터 상품 등록을 위한 실무 지침서. 발표용이 아닌 독립적으로 읽고 실행할 문서. 회사는 30명 규모 소기업, 첫 제품 버전, 판매가격 없음. 내부망 설치형 영구 라이선스 선택. 가격·일정·지원 정책은 승인 전 제안이다. 조사일: 2026-09-23.');
}
function addTable(p,sl,data,number,total,key){
 txt(sl,data.title,70,44,1460,75,42,theme.ink,true);
 txt(sl,data.subtitle,73,130,1450,55,25,theme.muted);
 const heads=data.heads??['업무·확인 항목','실행 내용','담당·산출물·완료 기준'];
 const matrix=[heads,...data.rows];
 const width=1460, columns=heads.length;
 const widths=data.widths??(columns===2?[490,970]:[280,810,370]);
 const bodySize=data.bodySize??24;
 const top=205, header=58, rowH=data.rowHeight??104;
 const h=header+rowH*data.rows.length;
 const table=sl.tables.add({rows:matrix.length,columns,left:70,top,width,height:h,columnWidths:widths,values:matrix});
 table.styleOptions={headerRow:false,bandedRows:false};
 table.borders.assign({style:'solid',fill:theme.line,width:0.7});
 table.cells.block({row:0,column:0,rowCount:matrix.length,columnCount:columns}).assign({
  textStyle:{typeface:font,fontSize:bodySize,color:theme.ink,autoFit:'none'},
  margins:{left:16,right:16,top:12,bottom:10},anchor:'center'
 });
 for(let r=0;r<matrix.length;r++){
  table.rows[r].height=r===0?header:rowH;
  for(let c=0;c<columns;c++){
   const cell=table.getCell(r,c);
   cell.fill=r===0?theme.ink:(r%2===0?theme.pale:'#FFFFFF');
   cell.text.style={typeface:font,fontSize:r===0?23:bodySize,color:r===0?'#FFFFFF':theme.ink,bold:r===0||c===0,autoFit:'none'};
  }
 }
 const refs=(data.refs??[]).map(id=>`${id}: ${sources[id].title} (${sources[id].date})\n${sources[id].url}`).join('\n\n');
 const foot=data.refs?.length?`근거 ${data.refs.join(' · ')}  / 공식 URL은 부록·슬라이드 노트`:'내부 실행안 · 수치와 정책 제안은 회사 승인 후 적용';
 txt(sl,foot,74,808,1380,30,17,theme.muted);
 txt(sl,`인뎁스  ${key}  ·  2026.09.23`,74,852,1260,27,17,theme.muted);
 txt(sl,`${String(number).padStart(2,'0')} / ${total}`,1410,847,120,33,19,theme.muted);
 sl.speakerNotes.textFrame.setText([
  `문서: ${key} 실무매뉴얼\n페이지 ${number}: ${data.title}`,
  '공식 요건은 표시된 출처를 적용한다. 별도 출처가 없는 실행·정책·시험·일정·금액은 작성자가 제안하는 내부 준비안이다. 계약 및 기관의 현행 양식과 조건을 최종 확인한다.',
  data.note??'',
  refs?`근거 자료 (조회 기준 2026-09-23)\n${refs}`:''
 ].filter(Boolean).join('\n\n'));
 return table;
}
function sourceSlides(d){
 const used=[...new Set(d.slides.flatMap(s=>s.refs??[]))];
 const out=[];
 for(let i=0;i<used.length;i+=4){
  const ids=used.slice(i,i+4);
  out.push({title:`공식 근거·자료 링크 ${Math.floor(i/4)+1}`,subtitle:'조회 기준 2026.09.23 / 시행일·문서명으로 현행본 확인',heads:['자료 ID · 문서·기준일','원문 위치와 확인할 내용'],widths:[620,840],bodySize:21,rowHeight:133,
    rows:ids.map(id=>[`${id}  ${sources[id].title}\n${sources[id].date}`,sources[id].url]),refs:ids,
    note:'법령은 공개 정부 문서다. TTA·KTC 및 기타 사이트는 절차·기준 확인용으로 연결한다. 첨부 다운로드가 실패하거나 내용이 비어 있는 자료는 입수·검토 완료로 취급하지 않는다. KTC 예시·재인증 첨부는 공개 안내 페이지에서 존재를 확인했으며 신청 시 최신 파일을 기관에서 수령해야 한다.'});
 }
 return out;
}
for(const d of allDecks){
 if(only&&d.key!==only)continue;
 const p=Presentation.create({slideSize:{width:1600,height:900}});
 const content=[...d.slides,...sourceSlides(d)];
 const total=content.length+1;
 cover(p,d);
 const owners=[];
 for(let i=0;i<content.length;i++){
  const sl=p.slides.add();sl.background.fill='#FFFFFF';
  addTable(p,sl,content[i],i+2,total,d.key);owners.push(i+2);
 }
 await fs.writeFile(path.join(tmp,`${d.key}.content.json`),JSON.stringify({title:d.title,total,slides:content},null,2),'utf8');
 await fs.writeFile(path.join(tmp,`${d.key}.proto.json`),JSON.stringify(p.toProto()),'utf8');
 const candidate=path.join(tmp,`${d.key}.candidate.pptx`);
 await(await PresentationFile.exportPptx(p)).save(candidate);
 console.log(`${d.key}: exported ${total} slides`);
 const imageDir=path.join(tmp,`render-${d.key}`);await fs.mkdir(imageDir,{recursive:true});
 const indices=sample?[0,1,14,total-1]:Array.from({length:total},(_,i)=>i);
 if(sample||render){
  for(const idx of indices){
   const sl=p.slides.items[idx];
   const preview=await p.export({slide:sl,format:'png',scale:1});
   await fs.writeFile(path.join(imageDir,`${String(idx+1).padStart(3,'0')}.png`),new Uint8Array(await preview.arrayBuffer()));
   const lay=await sl.export({format:'layout'});
   await fs.writeFile(path.join(imageDir,`${String(idx+1).padStart(3,'0')}.layout.json`),await lay.text());
   if(idx%10===0)console.log(`${d.key}: rendered ${idx+1}/${total}`);
  }
 }
 await fs.writeFile(path.join(tmp,`${d.key}.metadata.json`),JSON.stringify({total,owners,candidate,font},null,2));
}
