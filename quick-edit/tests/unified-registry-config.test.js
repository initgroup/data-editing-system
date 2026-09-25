const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const presets = JSON.parse(fs.readFileSync(path.join(root, "frontend/config/M90002.python-api-presets.json"), "utf8"));
const unified = presets.groups.find((group) => group.groupName === "Unified Editing Python API").resources;

function setup(saved = [], failCatalog = false) {
    const requests = [], alerts = [];
    const sandbox = { window: {}, API_BASE_URL: "/api", PageManager: { createHelper: () => ({ getContainerEl: () => null }) },
        alert: (value) => alerts.push(value), CommonMessage: { confirm: async () => true },
        fetch: async () => ({ ok: true, json: async () => structuredClone(presets) }),
        CommonUtils: { request: async (url, options) => {
            requests.push({ url, ...options });
            if (url.endsWith("/api-objects")) {
                if (failCatalog) throw new Error("Catalog unavailable");
                return { data: saved };
            }
            if (url.endsWith("/save")) return { objectId: 101, skipped: options.body.apiObject.objectName === "UNIFIED_EDITING_DETECT" };
            return { data: {} };
        } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/js/M90002.js"), "utf8"), sandbox);
    const page = sandbox.window.M90002;
    page.renderObjectTree = page.loadApiObject = () => {};
    return { page, requests, alerts };
}

test("initial registry CONFIG includes all unified stages and preserves existing and disabled registrations", async () => {
    const saved = [
        { objectId: 1, objectName: "UNIFIED_EDITING_PROFILE", useYn: "N", description: "Keep disabled" },
        { objectId: 2, objectName: "UNIFIED_EDITING_RELATION", useYn: "Y", description: "Keep custom defaults" }
    ];
    const { page, requests, alerts } = setup(saved);
    await page.createDefaultApiObjects();
    const posts = requests.filter((request) => request.method === "POST");
    assert.equal(posts.length, presets.defaultObjectNames.length - saved.length);
    for (const resource of unified) assert.ok(presets.defaultObjectNames.includes(resource.objectName));
    assert.deepEqual(posts.map((request) => request.body.apiObject.objectName).filter((name) => name.startsWith("UNIFIED_")), ["UNIFIED_EDITING_DISCOVER", "UNIFIED_EDITING_DETECT"]);
    for (const request of posts) {
        assert.equal(request.body.createOnly, true);
        assert.equal(request.body.apiObject.objectId, "");
    }
    assert.match(alerts.at(-1), /4/); // five candidates minus a concurrent registration
    assert.deepEqual(saved.map((row) => row.useYn), ["N", "Y"]);
});

test("catalog failure stops registration without treating every preset as missing", async () => {
    const { page, requests, alerts } = setup([], true);
    await page.createDefaultApiObjects();
    assert.equal(requests.filter((request) => request.method === "POST").length, 0);
    assert.equal(alerts.at(-1), "Catalog unavailable");
});

test("all unified reset presets restore their own endpoint, output and parameters without re-enabling a saved object", async () => {
    const { page, requests } = setup();
    await page.loadPresets();
    page.applyApiState = (object, rows) => { page.apiObject = object; page.rows = rows; };
    for (const resource of unified) {
        page.apiObject = { objectId: 17, objectName: resource.objectName, useYn: "N", endpoint: "edited" };
        page.selectedNodeKey = "SAVED:17";
        await page.resetApiObject();
        assert.equal(page.apiObject.objectId, 17);
        assert.equal(page.apiObject.useYn, "N");
        assert.equal(page.apiObject.endpoint, resource.endpoint);
        assert.equal(page.apiObject.resultName, resource.output.resultTableName);
        assert.deepEqual(Array.from(page.rows, (row) => row.key), [...resource.details].sort((a, b) => a.order - b.order).map((row) => row.key));
    }
    assert.equal(requests.length, 0); // reset edits the form only
});

test("zero, false and empty values survive CONFIG import and generated API contracts", () => {
    const { page } = setup();
    page.rows = page.createRowsFromPreset({ details: [0, false, ""].map((value, index) => ({ key: `INPUT.P_${index}`, value: "IN NUMBER", defaultValue: value })) });
    page.collectApiObject = () => ({ objectType: "INTERNAL_API", objectName: "UNIFIED_EDITING_DETECT" });
    assert.deepEqual(Array.from(page.buildContract().details, (row) => row.defaultValue), [0, false, ""]);
});
