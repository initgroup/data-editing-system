const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const presets = JSON.parse(fs.readFileSync(path.join(root, "frontend/config/M90002.python-api-presets.json"), "utf8"));
const unified = presets.groups.find((group) => group.groupName === "Unified Editing Python API").resources;

for (const language of ["ko", "en"]) {
    test(`all four unified jobs restore actual settings controls and saved defaults (${language})`, async () => {
        const browser = await chromium.launch({ headless: true });
        try {
            const tab = await browser.newPage();
            await tab.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
            await tab.goto("http://unified-settings.test/");
            for (const [index, resource] of unified.entries()) {
                const code = `M0300${index + 1}`;
                const commonPack = JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/MCOM_DATA_WORK.${language}.json`), "utf8"));
                const pagePack = language === "ko" ? JSON.parse(fs.readFileSync(path.join(root, `frontend/i18n/pages/${code}.ko.json`), "utf8")) : {};
                const html = fs.readFileSync(path.join(root, "frontend/pages/MCOM_DATA_WORK.html"), "utf8").replaceAll("__PAGE_CODE__", code);
                await tab.setContent(html);
                await tab.evaluate(({ code, commonPack, pagePack }) => {
                    window.PageManager = { createHelper: () => ({ getContainerEl: (selector) => document.querySelector(selector) }) };
                    window.API_BASE_URL = "/api";
                    window.CommonUtils = { getRuntimeSetting: (_key, fallback) => fallback };
                    window.CommonMessage = { success() {}, warning() {}, error(message) { throw new Error(message); } };
                    window[`${code}_WORK_UI_LABELS`] = { ...commonPack.labels, ...pagePack.labels };
                    window[`${code}_PAGE_I18N`] = { messages: { ...commonPack.messages, ...pagePack.messages } };
                }, { code, commonPack, pagePack });
                await tab.addScriptTag({ path: path.join(root, "frontend/js/MCOM_DATA_WORK.js") });
                await tab.addScriptTag({ path: path.join(root, `frontend/js/${code}.js`) });
                const result = await tab.evaluate(async ({ code, resource }) => {
                    const page = window[code];
                    // Skip unrelated database grids, but use the real template,
                    // applyJob, renderCurrentJob, selector and label rendering.
                    for (const name of ["renderTargetTablePickerList", "renderJobs", "updateWorkContextSummary", "resetEditableDataGrid", "setResultTableSql", "setDefaultUserSql", "renderDataEditTarget"]) page[name] = () => {};
                    page.selectedProjectId = 1;
                    page.selectedScenarioId = 2;
                    const spec = JSON.stringify({ adapter: "INTERNAL_PYTHON_API", method: resource.objectName, endpoint: resource.endpoint, serviceUrl: resource.endpoint, output: resource.output });
                    const params = resource.details.filter((row) => row.key.startsWith("INPUT.")).map((row, index) => ({ itemName: row.key.slice(6), itemValue: row.value, itemDesc: row.comment, itemDefault: row.defaultValue, itemOrder: index + 1 }));
                    const job = { PROFILE_JOB_ID: 10, PROJECT_ID: 1, SCENARIO_ID: 2, JOB_GROUP: code, JOB_NAME: "Saved unified job", OWNER_NAME: "OWNER", TABLE_NAME: "SOURCE", EXEC_SOURCE_TYPE: "WEB_API", EXEC_RESOURCE_ID: null, EXEC_METHOD: resource.objectName, EXEC_SPEC_JSON: spec, EXEC_OBJECT_NAME: resource.objectName, EXEC_OBJECT_LABEL: resource.label, RESULT_CREATE_YN: "T", RESULT_OWNER: "OWNER", RESULT_TABLE_NAME: resource.output.resultTableName, EXEC_PLSQL: '{"saved":true}', PARAMS: params };
                    await page.applyJob(job);
                    page.applyUiLabels();
                    const selector = document.querySelector(`#webApiMethod-${code}`);
                    const initial = selector.value;
                    // Late catalog load must not promote the existing saved job
                    // to a new registry definition with different defaults.
                    const latestSpec = JSON.stringify({ ...JSON.parse(spec), timeoutSec: 999 });
                    page.omlResources = [{ OML_RESOURCE_ID: 99, EXEC_API: "WEB_API", EXEC_METHOD: resource.objectName, RESOURCE_NAME: resource.objectName, SPEC_JSON: latestSpec }];
                    page.renderWebApiResources();
                    page.renderCurrentJob();
                    page.applyUiLabels();
                    const rerendered = selector.value;
                    const hint = document.querySelector(`[data-execution-hint="${code}"]`).textContent;
                    const generateLabel = document.querySelector(`#generateScriptLabel-${code}`).textContent;
                    page.parameters[0].itemDefault = "USER_CHANGE";
                    await page.handleWebApiMethodChange(selector.value);
                    const edited = page.parameters[0].itemDefault;
                    page.generateExecutablePlsql(true);
                    const payload = page.getJobPayload("DRAFT");
                    await page.refreshParameters();
                    const restored = page.parameters[0].itemDefault;
                    // A genuinely registered job selects its numeric ID.
                    await page.applyJob({ ...job, EXEC_RESOURCE_ID: 99 });
                    const registered = selector.value;
                    page.generateExecutablePlsql(true);
                    const registeredPayload = page.getJobPayload("DRAFT");
                    window.CommonUtils.request = async () => ({ resource: page.omlResources[0], data: [{ itemName: "P_SAMPLE_ROWS", itemValue: "NUMBER", itemDefault: "123" }] });
                    await page.handleWebApiMethodChange("99");
                    const reselectedPayload = page.getJobPayload("DRAFT");
                    const imports = [];
                    for (const resourceId of [null, 99]) {
                        const source = { ...job, EXEC_RESOURCE_ID: resourceId, PARAMS: [...params,
                            { itemName: "P_ZERO", itemValue: "NUMBER", itemDefault: 0 },
                            { itemName: "P_FALSE", itemValue: "BOOLEAN", itemDefault: false }] };
                        window.CommonUtils.request = async (url) => {
                            if (url.includes("/import-jobs/")) return { data: source };
                            throw new Error(`Unexpected import request: ${url}`);
                        };
                        for (const [id, value] of [["importProject", "1"], ["importScenario", "2"], ["importJobSource", "10"]]) {
                            document.querySelector(`#${id}-${code}`).innerHTML = `<option value="${value}">${value}</option>`;
                        }
                        await page.importSelectedJob();
                        page.applyUiLabels();
                        imports.push({ selected: selector.value, payload: page.getJobPayload("DRAFT"),
                            saved: page.getSavedJobSnapshot(), runDisabled: document.querySelector(`#runNow-${code}`).disabled });
                    }
                    let release;
                    window.CommonUtils.request = () => new Promise((resolve) => { release = resolve; });
                    const pending = page.loadWebApiParameters(99);
                    await page.applyJob(job);
                    release({ resource: page.omlResources[0], data: [{ itemName: "STALE", itemDefault: "bad" }] });
                    await pending;
                    const afterLateResponse = page.getJobPayload("DRAFT");
                    return { initial, rerendered, hint, generateLabel, edited, payload, restored, registered, registeredPayload, reselectedPayload, imports, afterLateResponse, spec, latestSpec, params };
                }, { code, resource });
                assert.equal(result.initial, resource.objectName, code);
                assert.equal(result.rerendered, resource.objectName, code);
                assert.equal(result.hint, commonPack.labels.savedBuiltinExecutableHint);
                assert.equal(result.generateLabel, commonPack.labels.generateApiSpec);
                assert.equal(result.edited, "USER_CHANGE");
                assert.equal(result.payload.execResourceId, null);
                assert.equal(result.payload.execMethod, resource.objectName);
                assert.equal(result.payload.execPlsql, '{"saved":true}');
                assert.equal(result.payload.resultTableName, resource.output.resultTableName);
                assert.equal(result.payload.params.length, result.params.length);
                assert.equal(result.restored, result.params[0].itemDefault);
                assert.equal(result.registered, "99");
                assert.equal(result.registeredPayload.execSpecJson, result.spec);
                assert.equal(result.registeredPayload.execPlsql, '{"saved":true}');
                assert.equal(result.reselectedPayload.execSpecJson, result.latestSpec);
                assert.equal(result.reselectedPayload.params[0].itemDefault, "123");
                assert.equal(result.afterLateResponse.execResourceId, null);
                assert.equal(result.afterLateResponse.execSpecJson, result.spec);
                assert.equal(result.afterLateResponse.params.length, result.params.length);
                for (const [index, imported] of result.imports.entries()) {
                    assert.equal(imported.selected, index ? "99" : resource.objectName);
                    assert.equal(imported.payload.profileJobId, null);
                    assert.equal(imported.saved, null);
                    assert.equal(imported.runDisabled, true);
                    assert.equal(imported.payload.execResourceId, index ? 99 : null);
                    assert.equal(imported.payload.execSpecJson, result.spec);
                    assert.equal(imported.payload.execPlsql, '{"saved":true}');
                    assert.equal(imported.payload.execMethod, resource.objectName);
                    assert.equal(imported.payload.params.at(-2).itemDefault, 0);
                    assert.equal(imported.payload.params.at(-1).itemDefault, false);
                }
            }
        } finally { await browser.close(); }
    });
}
