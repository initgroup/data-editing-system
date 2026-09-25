const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");

function designerFixture(source = {}) {
    const fields = new Map();
    const field = (selector) => {
        if (!fields.has(selector)) fields.set(selector, { value: "" });
        return fields.get(selector);
    };
    const common = { createPageHelper: () => ({}) };
    const requests = [];
    const sandbox = {
        window: { MCOMMON: common }, MCOMMON: common,
        document: { getElementById: () => null }, URLSearchParams,
        PageManager: { createHelper: () => ({ getContainerEl: field }) },
        API_BASE_URL: "/api", alert() {},
        CommonUtils: { request: async (url, options) => {
            requests.push({ url, options });
            return { status: "success", data: source };
        } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/MCOM_FLOW_WORK.js"), "utf8"), sandbox);
    const designer = common.createFlowWorkPage({ pageCode: "M04001", flowType: "INTEGRATED_EDITING_SCENARIO" });
    designer.getFlowNode = () => null;
    return { designer, field, requests };
}

function sourceNode() {
    return { nodeKey: "source-discover", nodeType: "M03003", refMenuCode: "M03003",
        nodeName: "Discover", execSourceType: "WEB_API", execMethod: "UNIFIED_EDITING_DISCOVER",
        params: [{ itemName: "P_RANDOM_STATE", itemDefault: 0 }, { itemName: "P_OPTION", itemDefault: false }],
        outputs: [{ port: "mixed-rules", artifact: "MIXED_XAI_RULES" }],
        refWorkJobId: null, refObjectId: null, positionLeft: 0, positionTop: 0 };
}

test("FLOW import binds a same-name job only when its execution contract matches", () => {
    const { designer } = designerFixture();
    const job = { MENU_CODE: "M03003", JOB_NAME: "Discover", EXEC_SOURCE_TYPE: "WEB_API" };
    designer.flowRegisteredJobs = [
        { ...job, WORK_JOB_ID: 1, EXEC_METHOD: "INTEGRATED_RULE_DISCOVER" },
        { ...job, WORK_JOB_ID: 2, EXEC_METHOD: "MIXED_XAI_RULE_DISCOVER" },
        { ...job, WORK_JOB_ID: 3, EXEC_METHOD: "UNIFIED_EDITING_DISCOVER", EXEC_SPEC_JSON: '{"saved":"unified"}' }
    ];
    const node = sourceNode();
    const graph = designer.createImportedFlowDraft({ NODES: [node], EDGES: [] });
    assert.equal(graph.nodes[0].refWorkJobId, 3);
    assert.equal(graph.nodes[0].execMethod, "UNIFIED_EDITING_DISCOVER");
    assert.equal(graph.nodes[0].execSpecJson, '{"saved":"unified"}');
    assert.equal(graph.nodes[0].params[0].itemDefault, 0);
    assert.equal(graph.nodes[0].params[1].itemDefault, false);
    assert.equal(graph.nodes[0].outputs[0].artifact, "MIXED_XAI_RULES");
    assert.equal(node.refWorkJobId, null);

    designer.flowRegisteredJobs = [{ ...job, WORK_JOB_ID: 4, EXEC_SOURCE_TYPE: "DB_OBJECT", EXEC_METHOD: "UNIFIED_EDITING_DISCOVER" }];
    assert.equal(designer.findCurrentJobForImportedNode(node), null);
});

test("FLOW import leaves incompatible jobs unbound and preserves edge and parameter overrides", () => {
    const { designer } = designerFixture();
    designer.flowRegisteredJobs = [{ WORK_JOB_ID: 1, MENU_CODE: "M03003", JOB_NAME: "Discover", EXEC_METHOD: "INTEGRATED_RULE_DISCOVER" }];
    const discover = sourceNode();
    const detect = { ...sourceNode(), nodeKey: "source-detect", nodeType: "M03004", refMenuCode: "M03004", nodeName: "Detect", execMethod: "UNIFIED_EDITING_DETECT" };
    const graph = designer.createImportedFlowDraft({ NODES: [discover, detect], EDGES: [{ fromNodeKey: discover.nodeKey, toNodeKey: detect.nodeKey, fromPort: "mixed-rules", toPort: "mixed-rules" }] });
    assert.equal(graph.nodes[0].refWorkJobId, "");
    assert.equal(graph.nodes[0].execMethod, discover.execMethod);
    assert.equal(graph.nodes[1].refWorkJobId, "");
    assert.equal(graph.edges[0].fromNodeKey, graph.nodes[0].nodeKey);
    assert.equal(graph.edges[0].toNodeKey, graph.nodes[1].nodeKey);
    assert.equal(graph.nodes[0].params[0].itemDefault, 0);
});

test("importing a saved FLOW preserves its process type through the actual import handler", async () => {
    for (const [type, selection] of [["UNIFIED_EDITING_SCENARIO", "UNIFIED"], ["MIXED_XAI_SCENARIO", "MIXED_XAI"], ["INTEGRATED_EDITING_SCENARIO", "LEGACY"]]) {
        const { designer, field, requests } = designerFixture({ FLOW_NAME: "Source", FLOW_TYPE: type, NODES: [sourceNode()], EDGES: [], USE_YN: "Y" });
        field("#importFlowProject-M04001").value = "1";
        field("#importFlowScenario-M04001").value = "2";
        field("#importFlowSource-M04001").value = "3";
        field("#flowProcessTemplate-M04001").value = "LEGACY";
        // Keep the actual newFlow reset and import handler; replace only layout
        // operations outside this contract test.
        for (const method of ["renderDashedConnectionMode", "setSampleFlowState", "renderFlowVersions", "updateFlowCopyButton", "updateWorkContextSummary", "scheduleFitFlowCanvas", "closeFlowImportDialog"]) designer[method] = () => {};
        let rendered;
        designer.renderFlowCanvasFromData = (nodes, edges) => { rendered = { nodes, edges }; };
        await designer.importSelectedFlow();
        assert.equal(requests.length, 1);
        assert.match(requests[0].url, /import-flows\/3\?projectId=1&scenarioId=2$/);
        assert.equal(designer.flowType, type);
        assert.equal(field("#flowProcessTemplate-M04001").value, selection);
        assert.equal(field("#flowId-M04001").value, "NEW");
        assert.equal(field("#flowName-M04001").value, "Copy of Source");
        assert.equal(rendered.nodes[0].execMethod, "UNIFIED_EDITING_DISCOVER");
        assert.equal(field("#confirmFlowImport-M04001").disabled, false);
    }
});
