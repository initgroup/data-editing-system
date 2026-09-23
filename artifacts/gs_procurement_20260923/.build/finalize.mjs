import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const skill='C:/Users/kse/.codex/plugins/cache/openai-primary-runtime/presentations/26.915.20218/skills/presentations';
const work='D:/work/data-editing-system/artifacts/gs_procurement_20260923';
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const python='C:/Users/kse/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
for(const [key,name] of [['GS','01_인뎁스_GS인증_실무매뉴얼_20260923_v1.1.pptx'],['G2B','02_인뎁스_나라장터_상품화등록_실무매뉴얼_20260923.pptx']]){
 if(process.argv.includes('--only=G2B')&&key!=='G2B')continue;
 const m=JSON.parse(await fs.readFile(path.join(work,'.build',`${key}.metadata.json`),'utf8'));
 const requiredOwners=key==='G2B'?m.owners.filter(n=>n<=47):m.owners;
 const result=await finalizePresentation({
  workspaceDir:work,candidatePath:m.candidate,finalPath:path.join(work,'output',name),
  pythonExecutable:python,
  integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit',...requiredOwners.flatMap(n=>['--require-native-table-slide',String(n)])],
  explicitTotalSlideCount:m.total,requiredNativeTableOwnerSlides:requiredOwners,
  fontPolicy:{basis:'design',families:[m.font]},verifyArtifactToolImport:true,
  receiptPath:path.join(work,'.build',`${key}.final-validation.json`)
 });
 console.log(JSON.stringify({key,finalPath:result.finalPath,receipt:result.receiptPath,packageFindings:result.packageIntegrity.findingCount,layoutFindings:result.presentationLayout.findingCount}));
}
