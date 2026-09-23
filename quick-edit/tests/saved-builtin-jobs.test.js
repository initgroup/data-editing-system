const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const methods = {
    MIXED_XAI_PROFILE: "mixed-xai-profile",
    MIXED_XAI_RELATION: "mixed-xai-relation",
    MIXED_XAI_RULE_DISCOVER: "mixed-xai-rule-discover",
    MIXED_XAI_RULE_DETECT: "mixed-xai-rule-detect"
};

async function setup(method = "MIXED_XAI_PROFILE") {
    const elements = new Map();
    const element = (selector) => {
        if (!elements.has(selector)) elements.set(selector, { value: "", innerHTML: "" });
        return elements.get(selector);
    };
    const sandbox = { window: {}, PageManager: { createHelper: () => ({ getContainerEl: element }) },
        CommonUtils: { request() { throw new Error("Unexpected API call"); } }, API_BASE_URL: "/api" };
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/MCOM_DATA_WORK.js"), "utf8"), sandbox);
    const page = sandbox.window.MCOMMON.createDataWorkPage({ pageCode: "M03001" });
    for (const name of ["renderTargetTablePickerList", "renderJobs", "renderCurrentJob", "updateWorkContextSummary", "renderParameters", "resetEditableDataGrid", "setResultTableSql", "setDefaultUserSql"]) page[name] = () => {};
    page.setEditorValue = page.setFieldValue = (selector, value) => { element(selector).value = value; };
    page.selectedProjectId = 1;
    page.selectedScenarioId = 2;
    const endpoint = `/api/mlAnalysis/${methods[method]}`;
    const spec = JSON.stringify({ adapter: "INTERNAL_PYTHON_API", method, endpoint, serviceUrl: endpoint,
        output: { resultCreateYn: "T", resultOwner: "OWNER", resultTableName: "INIT$_TB_XAI_RUN", persistMode: "SERVICE_MANAGED" } });
    const job = { PROFILE_JOB_ID: 10, PROJECT_ID: 1, SCENARIO_ID: 2, OWNER_NAME: "OWNER", TABLE_NAME: "INITUP$T",
        JOB_NAME: "Saved Job", JOB_GROUP: "M03001", EXEC_SOURCE_TYPE: "WEB_API", EXEC_RESOURCE_ID: null,
        EXEC_METHOD: method, EXEC_SPEC_JSON: spec, EXEC_OBJECT_TYPE: "WEB_API", EXEC_OBJECT_NAME: "Saved_Custom_Name",
        EXEC_OBJECT_LABEL: "저장한 이름 <script>", EXEC_PLSQL: '{"note":"keep my saved note"}',
        RESULT_CREATE_YN: "T", RESULT_OWNER: "OWNER", RESULT_TABLE_NAME: "INIT$_TB_XAI_RUN",
        PARAMS: [{ itemName: "P_SAMPLE_ROWS", itemValue: "NUMBER", itemDefault: "1234", itemOrder: 1 }] };
    await page.applyJob(job);
    return { page, job, element };
}

test("saved builtin selector identifies all four loaded mixed jobs without creating registry rows", async () => {
    for (const method of Object.keys(methods)) {
        const { page, element } = await setup(method);
        page.renderWebApiResources();
        const select = element("#webApiMethod-M03001");
        assert.equal(select.value, method);
        assert.match(select.innerHTML, /data-saved-builtin="true"/);
        assert.match(select.innerHTML, /저장한 이름 &lt;script&gt;/);
        assert.doesNotMatch(select.innerHTML, /<script>/);
        assert.equal(page.omlResources.length, 0);
    }
});

test("save, own-option selection and forced Generate preserve builtin job spec, names and edited parameters", async () => {
    const { page, job, element } = await setup();
    page.renderWebApiResources();
    page.parameters[0].itemDefault = "2222";
    await page.handleWebApiMethodChange(job.EXEC_METHOD);
    page.generateExecutablePlsql(true);
    const payload = page.getJobPayload("DRAFT");
    assert.equal(payload.execResourceId, null);
    assert.equal(payload.execMethod, job.EXEC_METHOD);
    assert.equal(payload.execSpecJson, job.EXEC_SPEC_JSON);
    assert.equal(payload.execObjectName, job.EXEC_OBJECT_NAME);
    assert.equal(payload.execObjectLabel, job.EXEC_OBJECT_LABEL);
    assert.equal(payload.execPlsql, job.EXEC_PLSQL);
    assert.equal(payload.params[0].itemDefault, "2222");
    assert.equal(element("#execPlsqlEditor-M03001").value, job.EXEC_PLSQL);
    assert.equal(page.currentJob.execResourceId, "");
});

test("builtin restore cannot promote unsaved, mismatched or external method specs", async () => {
    const cases = [
        (page) => { page.savedJobSnapshot = null; },
        (page) => { page.currentJob.profileJobId = 11; },
        (page) => { page.savedJobSnapshot.profileJobId = page.currentJob.profileJobId = ""; },
        (page) => { page.currentJob.execResourceId = 5; },
        (page) => { page.savedJobSnapshot.execResourceId = 5; },
        (page) => { page.savedJobSnapshot.execMethod = page.currentJob.execMethod = "ARBITRARY_METHOD"; },
        (page) => { page.savedJobSnapshot.execSpecJson = page.currentJob.execSpecJson = JSON.stringify({ adapter: "HTTP", method: page.currentJob.execMethod, endpoint: "https://example.invalid" }); },
        (page) => { const spec = JSON.parse(page.currentJob.execSpecJson); spec.serviceUrl = "https://example.invalid"; page.savedJobSnapshot.execSpecJson = page.currentJob.execSpecJson = JSON.stringify(spec); },
        (page) => { page.currentJob.execSpecJson = "{}"; }
    ];
    for (const mutate of cases) {
        const { page } = await setup();
        mutate(page);
        assert.equal(page.getSavedBuiltinWebApiDefinition(page.currentJob.execMethod), null);
    }
});

test("later registry entries do not silently replace saved builtin specs, while explicit resource selection remains available", async () => {
    const { page, job } = await setup();
    const registeredSpec = JSON.stringify({ endpoint: "/api/mlAnalysis/mixed-xai-profile", output: { resultCreateYn: "T" } });
    page.omlResources = [{ OML_RESOURCE_ID: 99, EXEC_METHOD: job.EXEC_METHOD, RESOURCE_NAME: "Registered", RESOURCE_LABEL: "Registered", EXEC_API: "WEB_API", SPEC_JSON: registeredSpec }];
    page.enrichCurrentJobExecutionMetadata();
    page.renderWebApiResources();
    assert.equal(page.currentJob.execResourceId, "");
    assert.equal(page.getWebApiDefinition(job.EXEC_METHOD).specJson, job.EXEC_SPEC_JSON);
    assert.equal(page.getJobPayload("DRAFT").execResourceId, null);
    assert.equal(page.getWebApiDefinition("99").resourceId, 99);
    assert.equal(page.getWebApiDefinition("99").specJson, registeredSpec);
});
