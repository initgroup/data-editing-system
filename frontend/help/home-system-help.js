(function() {
    const NODE_RELATIONSHIPS = Object.freeze({
        "workspace": ["session-api"],
        "session-api": ["target-context", "orchestrator"],
        "target-context": ["orchestrator", "job-contract"],
        "orchestrator": ["job-contract"],
        "job-contract": ["internal-model", "oml-python", "api-resource"],
        "internal-model": ["stage-1"],
        "oml-python": [],
        "api-resource": ["stage-2", "stage-3", "stage-4"],
        "stage-1": ["stage-2"],
        "stage-2": ["stage-3"],
        "stage-3": ["stage-4"],
        "stage-4": ["run-artifacts"],
        "run-artifacts": ["analysis"],
        "analysis": ["editing"],
        "editing": ["reports"]
    });

    const state = {
        guide: null,
        content: null,
        controller: null,
        observer: null,
        activeNodeId: "",
        lastFocusedElement: null,
        architectureExpanded: false,
        architectureBackground: [],
        architectureReturnFocus: null,
        detailBackground: [],
        detailCloseTimer: null
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, "&#096;");
    }

    function list(items, className = "") {
        const values = (items || []).filter(Boolean);
        if (!values.length) return "";
        return `<ul class="${escapeAttr(className)}">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }

    function getNodes() {
        return state.guide?.architecture?.nodes || {};
    }

    function getNode(nodeId) {
        return getNodes()[nodeId] || null;
    }

    function getRelatedNodeIds(nodeId) {
        const related = new Set(NODE_RELATIONSHIPS[nodeId] || []);
        Object.entries(NODE_RELATIONSHIPS).forEach(([sourceId, targetIds]) => {
            if (targetIds.includes(nodeId)) related.add(sourceId);
        });
        return related;
    }

    function restoreInertState(stateKey) {
        (state[stateKey] || []).forEach(({ element, hadInert, ariaHidden }) => {
            if (!element?.isConnected) return;
            if (hadInert) element.setAttribute("inert", "");
            else element.removeAttribute("inert");
            if (ariaHidden === null) element.removeAttribute("aria-hidden");
            else element.setAttribute("aria-hidden", ariaHidden);
        });
        state[stateKey] = [];
    }

    function setInertState(stateKey, elements) {
        restoreInertState(stateKey);
        state[stateKey] = Array.from(new Set(elements.filter(Boolean))).map((element) => ({
            element,
            hadInert: element.hasAttribute("inert"),
            ariaHidden: element.getAttribute("aria-hidden")
        }));
        state[stateKey].forEach(({ element }) => {
            element.setAttribute("inert", "");
            element.setAttribute("aria-hidden", "true");
        });
    }

    function getModalBackground(excludedElements) {
        const excluded = new Set(excludedElements.filter(Boolean));
        const header = document.querySelector("body > header");
        const main = document.getElementById("helpMain");
        return [
            header,
            ...Array.from(main?.children || []).filter((element) => !excluded.has(element))
        ].filter(Boolean);
    }

    function getFocusableElements(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll(
            "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length);
    }

    function renderNode(nodeId, extraClass = "") {
        const node = getNode(nodeId);
        if (!node) return "";
        const labels = state.guide?.labels || {};
        const shape = node.shape || "rounded";
        const symbol = node.symbol || "•";
        return `
            <button type="button"
                    class="system-help-node tone-${escapeAttr(node.tone || "slate")} ${escapeAttr(extraClass)}"
                    data-system-node="${escapeAttr(nodeId)}"
                    aria-haspopup="dialog"
                    aria-controls="systemNodeDetailLayer"
                    aria-label="${escapeAttr(`${node.title}. ${labels.openDetail || "Open details"}`)}">
                <span class="system-help-node-kicker">${escapeHtml(node.kicker || "")}</span>
                <span class="system-help-node-main">
                    <span class="system-help-node-shape shape-${escapeAttr(shape)}" aria-hidden="true"><span>${escapeHtml(symbol)}</span></span>
                    <span class="system-help-node-copy">
                        <strong>${escapeHtml(node.title)}</strong>
                        <small>${escapeHtml(node.summary || "")}</small>
                    </span>
                </span>
                ${node.artifact ? `<span class="system-help-node-artifact">${escapeHtml(node.artifact)}</span>` : ""}
                <span class="system-help-node-action">${escapeHtml(labels.openDetail || "View details")} <b aria-hidden="true">↗</b></span>
            </button>
        `;
    }

    function renderConnector(fromId, toId, label = "", direction = "horizontal") {
        return `
            <div class="system-help-connector is-${escapeAttr(direction)}"
                 data-system-connects="${escapeAttr(`${fromId} ${toId}`)}"
                 aria-hidden="true">
                <span>${escapeHtml(label)}</span>
            </div>
        `;
    }

    function renderResourceRoute(nodeIds, label, modifier) {
        return `
            <div class="home-system-model-route ${escapeAttr(modifier || "")}"
                 data-system-connects="${escapeAttr(nodeIds.join(" "))}">
                <span>${escapeHtml(label || "")}</span>
            </div>
        `;
    }

    function renderLinearFlow(nodeIds, connectorLabel = "") {
        return nodeIds.map((nodeId, index) => {
            const nextId = nodeIds[index + 1];
            return `${renderNode(nodeId)}${nextId ? renderConnector(nodeId, nextId, connectorLabel) : ""}`;
        }).join("");
    }

    function getMenuConfig() {
        if (Array.isArray(window.MENU_CONFIG)) return window.MENU_CONFIG;
        try {
            if (Array.isArray(window.opener?.MENU_CONFIG)) return window.opener.MENU_CONFIG;
        } catch (_error) {
            // Cross-window access can fail after the opener changes origin.
        }
        return [];
    }

    function buildMenuGroups() {
        const menuMap = state.guide?.menuMap || {};
        const localizedGroups = menuMap.groups || {};
        const pages = state.content?.pages || {};
        const groups = [];

        getMenuConfig().filter((item) => item?.enabled !== false).forEach((item) => {
            if (item.type === "page" && item.page) {
                const page = pages[item.page] || pages[String(item.page).toUpperCase()] || {};
                const groupText = localizedGroups.home || {};
                groups.push({
                    key: "home",
                    title: groupText.title || page.group || item.label,
                    description: groupText.description || page.summary || "",
                    roles: item.roles || [],
                    pages: [{ config: item, page }]
                });
                return;
            }

            if (item.type !== "folder") return;
            const groupText = localizedGroups[item.key] || {};
            const children = (item.children || [])
                .filter((child) => child?.enabled !== false && child?.page)
                .map((child) => ({
                    config: child,
                    page: pages[child.page] || pages[String(child.page).toUpperCase()] || {}
                }));
            groups.push({
                key: item.key,
                title: groupText.title || item.label || item.key,
                description: groupText.description || "",
                roles: item.roles || [],
                pages: children
            });
        });
        return groups;
    }

    function getMenuCount() {
        return buildMenuGroups().reduce((total, group) => total + group.pages.length, 0);
    }

    function renderHero(page) {
        const hero = state.guide.hero || {};
        const labels = hero.metrics || {};
        const menuCount = getMenuCount();
        const header = document.querySelector("body > header");
        if (!header) return;
        header.className = "home-system-help-hero";
        header.innerHTML = `
            <div class="home-system-help-hero-inner">
                <div class="home-system-help-hero-copy">
                    <span class="home-system-help-eyebrow">${escapeHtml(hero.eyebrow || "System guide")}</span>
                    <h1 id="helpTitle">${escapeHtml(page.title)}</h1>
                    <p id="helpSummary">${escapeHtml(page.summary || "")}</p>
                    <div class="meta" id="helpMeta">
                        ${(hero.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
                    </div>
                </div>
                <div class="home-system-help-metrics" aria-label="${escapeAttr(hero.metricAriaLabel || "System guide summary")}">
                    <div><strong>${escapeHtml(menuCount)}</strong><span>${escapeHtml(labels.menus || "Menus")}</span></div>
                    <div><strong>4</strong><span>${escapeHtml(labels.stages || "Core stages")}</span></div>
                    <div><strong>3</strong><span>${escapeHtml(labels.executionPaths || "Execution paths")}</span></div>
                    <div><strong>1</strong><span>${escapeHtml(labels.runContext || "Connected run")}</span></div>
                </div>
            </div>
        `;
    }

    function renderSectionHeading(eyebrow, title, description, id) {
        return `
            <header class="home-system-help-section-heading">
                <span>${escapeHtml(eyebrow || "")}</span>
                <h2 id="${escapeAttr(id)}">${escapeHtml(title || "")}</h2>
                <p>${escapeHtml(description || "")}</p>
            </header>
        `;
    }

    function renderOverview() {
        const overview = state.guide.homeOverview || {};
        return `
            <section id="home-overview" class="home-system-help-section" aria-labelledby="home-overview-title">
                ${renderSectionHeading(overview.eyebrow, overview.title, overview.description, "home-overview-title")}
                <div class="home-system-help-overview-grid">
                    ${(overview.cards || []).map((card, index) => `
                        <article class="home-system-help-overview-card tone-${escapeAttr(card.tone || "slate")}">
                            <span class="home-system-help-card-index">${String(index + 1).padStart(2, "0")}</span>
                            <div>
                                <h3>${escapeHtml(card.title)}</h3>
                                <p>${escapeHtml(card.description || "")}</p>
                                ${list(card.points, "home-system-help-compact-list")}
                            </div>
                        </article>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderJourney() {
        const journey = state.guide.journey || {};
        return `
            <section id="work-journey" class="home-system-help-section is-soft" aria-labelledby="work-journey-title">
                ${renderSectionHeading(journey.eyebrow, journey.title, journey.description, "work-journey-title")}
                <ol class="home-system-help-journey">
                    ${(journey.steps || []).map((step, index) => `
                        <li>
                            <span class="home-system-help-journey-number">${index + 1}</span>
                            <div>
                                <strong>${escapeHtml(step.title)}</strong>
                                <p>${escapeHtml(step.description || "")}</p>
                                <small>${escapeHtml((step.menuCodes || []).join(" · "))}</small>
                            </div>
                        </li>
                    `).join("")}
                </ol>
            </section>
        `;
    }

    function renderArchitecture() {
        const architecture = state.guide.architecture || {};
        const labels = state.guide.labels || {};
        const bandLabels = architecture.bandLabels || {};
        return `
            <section id="system-architecture" class="home-system-help-section home-system-architecture" aria-labelledby="system-architecture-title">
                <div class="home-system-architecture-sticky-head">
                    ${renderSectionHeading(architecture.eyebrow, architecture.title, architecture.description, "system-architecture-title")}
                    <div class="home-system-architecture-toolbar">
                        <div class="home-system-architecture-legend" aria-label="${escapeAttr(architecture.legendAriaLabel || "Artifact legend")}">
                            ${(architecture.legend || []).map((item) => `
                                <span><i class="shape-${escapeAttr(item.shape || "square")}" aria-hidden="true"></i>${escapeHtml(item.label)}</span>
                            `).join("")}
                        </div>
                        <button type="button" id="systemArchitectureExpandButton" class="home-system-help-outline-button"
                                aria-expanded="false" aria-haspopup="dialog" aria-controls="system-architecture">
                            <span aria-hidden="true">⛶</span>
                            <b>${escapeHtml(labels.expandDiagram || "Expand diagram")}</b>
                        </button>
                    </div>
                </div>

                <figure class="home-system-architecture-figure">
                    <figcaption>${escapeHtml(architecture.hint || "")}</figcaption>
                    <div id="systemArchitectureCanvas" class="home-system-architecture-canvas">
                        <div class="home-system-architecture-band">
                            <span class="home-system-architecture-band-label">${escapeHtml(bandLabels.context || "Context")}</span>
                            <div class="home-system-flow-row is-three">
                                ${renderLinearFlow(["workspace", "session-api", "target-context"], architecture.labels?.secureContext || "")}
                            </div>
                        </div>

                        ${renderConnector("session-api", "orchestrator", architecture.labels?.validatedContext || "", "vertical")}

                        <div class="home-system-architecture-band is-orchestrator">
                            <span class="home-system-architecture-band-label">${escapeHtml(bandLabels.orchestration || "Orchestration")}</span>
                            ${renderNode("orchestrator", "is-wide")}
                        </div>

                        ${renderConnector("orchestrator", "job-contract", architecture.labels?.executionPlan || "", "vertical")}

                        <div class="home-system-architecture-band is-routing">
                            <span class="home-system-architecture-band-label">${escapeHtml(bandLabels.execution || "Execution routing")}</span>
                            ${renderNode("job-contract", "is-wide")}
                            <div class="home-system-branch-label"
                                 data-system-connects="job-contract internal-model oml-python api-resource">
                                <span>${escapeHtml(architecture.labels?.selectExecutionPath || "")}</span>
                            </div>
                            <div class="home-system-model-paths">
                                <div class="home-system-model-path">
                                    ${renderNode("internal-model")}
                                    ${renderResourceRoute(["internal-model", "stage-1"], architecture.labels?.defaultStage1 || "Default stage 1", "is-default")}
                                </div>
                                <div class="home-system-model-path">
                                    ${renderNode("oml-python")}
                                    ${renderResourceRoute(["job-contract", "oml-python"], architecture.labels?.optionalResource || "Optional Job resource", "is-optional")}
                                </div>
                                <div class="home-system-model-path">
                                    ${renderNode("api-resource")}
                                    ${renderResourceRoute(["api-resource", "stage-2", "stage-3", "stage-4"], architecture.labels?.defaultStages2To4 || "Default stages 2–4", "is-default")}
                                </div>
                            </div>
                        </div>

                        <div class="home-system-architecture-band is-stages">
                            <span class="home-system-architecture-band-label">${escapeHtml(bandLabels.stages || "Four-stage editing flow")}</span>
                            <div class="home-system-flow-row is-four">
                                ${renderNode("stage-1")}
                                ${renderConnector("stage-1", "stage-2", architecture.labels?.latestMaster || "LATEST_MASTER")}
                                ${renderNode("stage-2")}
                                ${renderConnector("stage-2", "stage-3", architecture.labels?.sameRun || "SAME_RUN")}
                                ${renderNode("stage-3")}
                                ${renderConnector("stage-3", "stage-4", architecture.labels?.sameRun || "SAME_RUN")}
                                ${renderNode("stage-4")}
                            </div>
                        </div>

                        ${renderConnector("stage-4", "run-artifacts", architecture.labels?.resultContract || "", "vertical")}

                        <div class="home-system-architecture-band is-outcomes">
                            <span class="home-system-architecture-band-label">${escapeHtml(bandLabels.outcomes || "Review and application")}</span>
                            <div class="home-system-flow-row is-four">
                                ${renderLinearFlow(["run-artifacts", "analysis", "editing", "reports"], architecture.labels?.traceableResult || "")}
                            </div>
                        </div>
                    </div>
                    <aside id="systemArchitecturePreview" class="home-system-architecture-preview" aria-live="polite">
                        <span>${escapeHtml(labels.hoverPreview || "Hover or focus an object")}</span>
                        <strong>${escapeHtml(architecture.previewTitle || architecture.title || "")}</strong>
                        <p>${escapeHtml(architecture.previewDescription || architecture.hint || "")}</p>
                    </aside>
                </figure>
            </section>
        `;
    }

    function renderMenuPageCard(item) {
        const menuMap = state.guide.menuMap || {};
        const page = item.page || {};
        const config = item.config || {};
        const pageCode = page.pageCode || config.page || "-";
        const roles = Array.from(new Set([...(config.roles || [])]));
        const features = (page.purpose || []).filter(Boolean).slice(0, 2);
        return `
            <article class="home-system-menu-card">
                <header>
                    <span>${escapeHtml(pageCode)}</span>
                    ${roles.includes("ADMIN") ? `<em>${escapeHtml(menuMap.adminLabel || "ADMIN")}</em>` : ""}
                </header>
                <h4>${escapeHtml(page.title || page.label || config.title || config.label || pageCode)}</h4>
                <p>${escapeHtml(page.summary || "")}</p>
                ${list(features, "home-system-menu-features")}
            </article>
        `;
    }

    function renderMenuMap() {
        const menuMap = state.guide.menuMap || {};
        const groups = buildMenuGroups();
        return `
            <section id="menu-map" class="home-system-help-section" aria-labelledby="menu-map-title">
                ${renderSectionHeading(menuMap.eyebrow, menuMap.title, menuMap.description, "menu-map-title")}
                <div class="home-system-menu-map">
                    ${groups.map((group) => `
                        <details class="home-system-menu-group" open>
                            <summary>
                                <span>
                                <strong role="heading" aria-level="3">${escapeHtml(group.title)}</strong>
                                    <small>${escapeHtml(group.description || "")}</small>
                                </span>
                                <b>${escapeHtml(group.pages.length)} ${escapeHtml(menuMap.countLabel || "menus")}</b>
                            </summary>
                            <div class="home-system-menu-grid">
                                ${group.pages.map(renderMenuPageCard).join("")}
                            </div>
                        </details>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderOperatingGuide(renderCacheVersions, page, implementation) {
        const operating = state.guide.operating || {};
        const labels = state.guide.labels || {};
        const technical = typeof renderCacheVersions === "function"
            ? renderCacheVersions(page.pageCode, implementation)
            : "";
        return `
            <section id="operating-guide" class="home-system-help-section is-soft" aria-labelledby="operating-guide-title">
                ${renderSectionHeading(operating.eyebrow, operating.title, operating.description, "operating-guide-title")}
                <div class="home-system-operating-grid">
                    ${(operating.cards || []).map((card) => `
                        <article>
                            <span>${escapeHtml(card.kicker || "")}</span>
                            <h3>${escapeHtml(card.title)}</h3>
                            ${list(card.points, "home-system-help-compact-list")}
                        </article>
                    `).join("")}
                </div>
                ${operating.privacyNote ? `<aside class="home-system-privacy-note"><strong>${escapeHtml(operating.privacyTitle || "")}</strong><p>${escapeHtml(operating.privacyNote)}</p></aside>` : ""}
                ${technical ? `<details class="home-system-technical"><summary>${escapeHtml(labels.technicalInfo || "Technical information")}</summary>${technical}</details>` : ""}
            </section>
        `;
    }

    function renderNavigation() {
        const labels = state.guide.navigation || {};
        const items = [
            ["home-overview", labels.home || "Home"],
            ["work-journey", labels.journey || "Workflow"],
            ["system-architecture", labels.architecture || "Architecture"],
            ["menu-map", labels.menus || "Menus"],
            ["operating-guide", labels.operations || "Operations"]
        ];
        return `
            <nav class="home-system-help-nav" aria-label="${escapeAttr(labels.ariaLabel || "Help contents")}">
                ${items.map(([id, label], index) => `<a href="#${id}" ${index === 0 ? "class=\"is-active\"" : ""}>${escapeHtml(label)}</a>`).join("")}
            </nav>
        `;
    }

    function renderDetailLayer() {
        const labels = state.guide.labels || {};
        return `
            <div id="systemNodeDetailLayer" class="home-system-detail-layer" hidden>
                <div class="home-system-detail-backdrop" data-detail-close aria-hidden="true"></div>
                <section class="home-system-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="systemNodeDetailTitle" tabindex="-1">
                    <header>
                        <div>
                            <span id="systemNodeDetailKicker"></span>
                            <h2 id="systemNodeDetailTitle"></h2>
                        </div>
                        <button type="button" class="home-system-detail-close" data-detail-close aria-label="${escapeAttr(labels.close || "Close")}">×</button>
                    </header>
                    <div id="systemNodeDetailBody" class="home-system-detail-body" role="document" tabindex="0"
                         aria-label="${escapeAttr(labels.detailContent || "Detail content")}"></div>
                    <footer>
                        <span>${escapeHtml(labels.detailFooter || "")}</span>
                        <button type="button" class="home-system-detail-done" data-detail-close>${escapeHtml(labels.close || "Close")}</button>
                    </footer>
                </section>
            </div>
        `;
    }

    function renderDetailSection(title, items, ordered = false) {
        const values = (items || []).filter(Boolean);
        if (!values.length) return "";
        const tag = ordered ? "ol" : "ul";
        return `
            <section class="home-system-detail-section">
                <h3>${escapeHtml(title)}</h3>
                <${tag}>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>
            </section>
        `;
    }

    function openNodeDetail(nodeId, trigger) {
        const node = getNode(nodeId);
        const layer = document.getElementById("systemNodeDetailLayer");
        if (!node || !layer) return;
        const labels = state.guide.labels || {};
        if (state.detailCloseTimer) {
            window.clearTimeout(state.detailCloseTimer);
            state.detailCloseTimer = null;
        }
        state.lastFocusedElement = trigger || document.activeElement;
        document.getElementById("systemNodeDetailKicker").textContent = node.kicker || "";
        document.getElementById("systemNodeDetailTitle").textContent = node.title || "";
        const detailBody = document.getElementById("systemNodeDetailBody");
        detailBody.innerHTML = `
            <p class="home-system-detail-lead">${escapeHtml(node.detail?.overview || node.summary || "")}</p>
            ${node.artifact ? `<div class="home-system-detail-artifact"><span>${escapeHtml(labels.artifact || "Artifact")}</span><strong>${escapeHtml(node.artifact)}</strong></div>` : ""}
            <div class="home-system-detail-grid">
                ${renderDetailSection(labels.callFlow || "Call flow", node.detail?.callFlow, true)}
                ${renderDetailSection(labels.algorithm || "Algorithm", node.detail?.algorithm, true)}
                ${renderDetailSection(labels.inputs || "Inputs", node.detail?.inputs)}
                ${renderDetailSection(labels.outputs || "Outputs", node.detail?.outputs)}
                ${renderDetailSection(labels.checks || "Checks", node.detail?.checks)}
            </div>
        `;
        detailBody.scrollTop = 0;
        layer.hidden = false;
        document.body.classList.add("home-system-detail-open");
        setInertState("detailBackground", getModalBackground([layer]));
        detailBody.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            layer.classList.add("is-open");
        });
    }

    function closeNodeDetail() {
        const layer = document.getElementById("systemNodeDetailLayer");
        if (!layer || layer.hidden) return false;
        if (state.detailCloseTimer) return true;
        layer.classList.remove("is-open");
        document.body.classList.remove("home-system-detail-open");
        state.detailCloseTimer = window.setTimeout(() => {
            layer.hidden = true;
            restoreInertState("detailBackground");
            state.lastFocusedElement?.focus?.({ preventScroll: true });
            state.lastFocusedElement = null;
            state.detailCloseTimer = null;
        }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
        return true;
    }

    function setActiveNode(nodeId) {
        const canvas = document.getElementById("systemArchitectureCanvas");
        const preview = document.getElementById("systemArchitecturePreview");
        if (!canvas) return;
        state.activeNodeId = nodeId || "";
        const related = nodeId ? getRelatedNodeIds(nodeId) : new Set();
        canvas.querySelectorAll("[data-system-node]").forEach((element) => {
            const currentId = element.dataset.systemNode;
            element.classList.toggle("is-active", currentId === nodeId);
            element.classList.toggle("is-related", related.has(currentId));
        });
        canvas.querySelectorAll("[data-system-connects]").forEach((element) => {
            const ids = String(element.dataset.systemConnects || "").split(/\s+/);
            element.classList.toggle("is-active", Boolean(nodeId) && ids.includes(nodeId));
        });
        canvas.classList.toggle("has-active-node", Boolean(nodeId));
        if (!preview) return;
        if (!nodeId) {
            const architecture = state.guide?.architecture || {};
            preview.querySelector("span").textContent = state.guide?.labels?.hoverPreview || "";
            preview.querySelector("strong").textContent = architecture.previewTitle || architecture.title || "";
            preview.querySelector("p").textContent = architecture.previewDescription || architecture.hint || "";
            return;
        }
        const node = getNode(nodeId);
        preview.querySelector("span").textContent = node?.kicker || "";
        preview.querySelector("strong").textContent = node?.title || "";
        preview.querySelector("p").textContent = node?.summary || "";
    }

    function toggleArchitectureExpanded(forceValue) {
        const section = document.getElementById("system-architecture");
        const button = document.getElementById("systemArchitectureExpandButton");
        if (!section || !button) return;
        const nextValue = typeof forceValue === "boolean" ? forceValue : !state.architectureExpanded;
        if (nextValue === state.architectureExpanded) return;
        if (nextValue) state.architectureReturnFocus = document.activeElement;
        state.architectureExpanded = nextValue;
        section.classList.toggle("is-expanded", nextValue);
        document.body.classList.toggle("home-system-architecture-expanded", nextValue);
        button.setAttribute("aria-expanded", String(nextValue));
        button.querySelector("b").textContent = nextValue
            ? (state.guide.labels?.collapseDiagram || "Exit expanded view")
            : (state.guide.labels?.expandDiagram || "Expand diagram");
        if (nextValue) {
            section.setAttribute("role", "dialog");
            section.setAttribute("aria-modal", "true");
            section.setAttribute("tabindex", "-1");
            setInertState(
                "architectureBackground",
                getModalBackground([section, document.getElementById("systemNodeDetailLayer")])
            );
            section.scrollTop = 0;
            button.focus({ preventScroll: true });
            return;
        }
        section.removeAttribute("role");
        section.removeAttribute("aria-modal");
        section.removeAttribute("tabindex");
        restoreInertState("architectureBackground");
        const returnFocus = state.architectureReturnFocus?.isConnected ? state.architectureReturnFocus : button;
        state.architectureReturnFocus = null;
        returnFocus.focus({ preventScroll: true });
    }

    function trapFocusWithin(container, event) {
        if (!container || event.key !== "Tab") return false;
        const focusable = getFocusableElements(container);
        if (!focusable.length) {
            event.preventDefault();
            container.focus?.();
            return true;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeIndex = focusable.indexOf(document.activeElement);
        if (activeIndex === -1) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
        return true;
    }

    function trapDialogFocus(event) {
        const layer = document.getElementById("systemNodeDetailLayer");
        if (!layer || layer.hidden) return false;
        return trapFocusWithin(layer, event);
    }

    function trapArchitectureFocus(event) {
        if (!state.architectureExpanded) return false;
        return trapFocusWithin(document.getElementById("system-architecture"), event);
    }

    function bindInteractions() {
        const signal = state.controller.signal;
        const canvas = document.getElementById("systemArchitectureCanvas");
        canvas?.addEventListener("pointerover", (event) => {
            const node = event.target.closest("[data-system-node]");
            const previousNode = event.relatedTarget?.closest?.("[data-system-node]");
            if (!node || previousNode === node) return;
            setActiveNode(node.dataset.systemNode);
        }, { signal });
        canvas?.addEventListener("pointerout", (event) => {
            const node = event.target.closest("[data-system-node]");
            const nextNode = event.relatedTarget?.closest?.("[data-system-node]");
            if (!node || nextNode === node) return;
            if (!nextNode) setActiveNode("");
        }, { signal });
        canvas?.addEventListener("pointerleave", () => setActiveNode(""), { signal });
        canvas?.addEventListener("focusin", (event) => {
            const node = event.target.closest("[data-system-node]");
            if (node) setActiveNode(node.dataset.systemNode);
        }, { signal });
        canvas?.addEventListener("focusout", (event) => {
            if (!canvas.contains(event.relatedTarget)) setActiveNode("");
        }, { signal });
        canvas?.addEventListener("click", (event) => {
            const node = event.target.closest("[data-system-node]");
            if (node) openNodeDetail(node.dataset.systemNode, node);
        }, { signal });

        document.getElementById("systemArchitectureExpandButton")?.addEventListener("click", () => toggleArchitectureExpanded(), { signal });
        document.getElementById("systemNodeDetailLayer")?.addEventListener("click", (event) => {
            if (event.target.closest("[data-detail-close]")) closeNodeDetail();
        }, { signal });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (closeNodeDetail()) return;
                if (state.architectureExpanded) toggleArchitectureExpanded(false);
            }
            if (!trapDialogFocus(event)) trapArchitectureFocus(event);
        }, { signal });

        if ("IntersectionObserver" in window) {
            state.observer = new IntersectionObserver((entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
                if (!visible) return;
                document.querySelectorAll(".home-system-help-nav a").forEach((link) => {
                    link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`);
                });
            }, { rootMargin: "-20% 0px -65%", threshold: [0.05, 0.3, 0.6] });
            document.querySelectorAll("#helpMain > section[id]").forEach((section) => state.observer.observe(section));
        }
    }

    function reset() {
        state.controller?.abort();
        state.observer?.disconnect();
        if (state.detailCloseTimer) window.clearTimeout(state.detailCloseTimer);
        restoreInertState("detailBackground");
        restoreInertState("architectureBackground");
        const architecture = document.getElementById("system-architecture");
        architecture?.removeAttribute("role");
        architecture?.removeAttribute("aria-modal");
        architecture?.removeAttribute("tabindex");
        state.controller = null;
        state.observer = null;
        state.guide = null;
        state.content = null;
        state.activeNodeId = "";
        state.lastFocusedElement = null;
        state.architectureExpanded = false;
        state.architectureReturnFocus = null;
        state.detailCloseTimer = null;
        document.body.classList.remove(
            "is-home-system-help",
            "home-system-detail-open",
            "home-system-architecture-expanded"
        );
        const header = document.querySelector("body > header.home-system-help-hero");
        if (header) {
            header.className = "";
            header.innerHTML = `
                <h1 id="helpTitle"></h1>
                <p id="helpSummary"></p>
                <div class="meta" id="helpMeta"></div>
            `;
        }
        document.getElementById("helpMain")?.classList.remove("home-system-help-main");
    }

    function render({ page, content, ui, implementation, renderCacheVersions }) {
        reset();
        state.guide = page.systemGuide;
        state.content = content;
        state.controller = new AbortController();
        document.body.classList.add("is-home-system-help");
        document.documentElement.dataset.menuCode = "home";
        document.title = `${page.title} ${ui?.helpWord || "Help"} - INIT Data Editing System`;
        renderHero(page);

        const main = document.getElementById("helpMain");
        main.className = "home-system-help-main";
        main.innerHTML = `
            ${renderNavigation()}
            ${renderOverview()}
            ${renderJourney()}
            ${renderArchitecture()}
            ${renderMenuMap()}
            ${renderOperatingGuide(renderCacheVersions, page, implementation)}
            ${renderDetailLayer()}
        `;
        bindInteractions();
    }

    window.HomeSystemHelp = { render, reset };
})();
