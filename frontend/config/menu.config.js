window.MENU_CONFIG = [
    {
        type: 'page',
        page: 'home',
        title: 'INIT Data Editing System',
        label: 'Main Home',
        iconClass: 'fas fa-house text-teal-300',
        active: false,
        enabled: true
    },
    {
        type: 'folder',
        key: 'project',
        label: 'Project Management',
        iconClass: 'fas fa-folder-tree text-sky-400',
        enabled: true,
        children: [
            {
                page: 'M01001',
                title: 'Project Settings',
                label: 'Project Settings',
                iconClass: 'fas fa-folder-plus text-sky-300',
                enabled: true
            },
            {
                page: 'M01002',
                title: 'Scenario Definition',
                label: 'Scenario Definition',
                iconClass: 'fas fa-route text-sky-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'data-prep',
        label: 'Data Preparation & Exploration',
        iconClass: 'fas fa-database text-emerald-400',
        enabled: true,
        children: [
            {
                page: 'M02001',
                title: 'File Upload Management',
                label: 'File Upload',
                iconClass: 'fas fa-file-arrow-up text-emerald-300',
                enabled: true
            },
            {
                page: 'M02002',
                title: 'Target Data Selection',
                label: 'Target Data',
                iconClass: 'fas fa-table text-emerald-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'rule-discovery',
        label: 'Editing Model Setup',
        iconClass: 'fas fa-lightbulb text-amber-400',
        enabled: true,
        children: [
            {
                page: 'M03001',
                title: 'Column Type Analysis',
                label: 'Column Type Analysis',
                iconClass: 'fas fa-chart-column text-amber-300',
                enabled: true
            },
            {
                page: 'M03002',
                title: 'Column Correlation Analysis',
                label: 'Column Correlation Analysis',
                iconClass: 'fas fa-link text-amber-300',
                enabled: true
            },
            {
                page: 'M03003',
                title: 'Automatic Rule Discovery',
                label: 'Automatic Rule Discovery',
                iconClass: 'fas fa-wand-magic-sparkles text-amber-300',
                enabled: true
            },
            {
                page: 'M03004',
                title: 'Rule Violation Detection',
                label: 'Rule Violation Detection',
                iconClass: 'fas fa-triangle-exclamation text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-flow',
        label: 'Editing Rule Discovery',
        iconClass: 'fas fa-diagram-project text-blue-300',
        enabled: true,
        children: [
            {
                page: 'M04001',
                title: 'Rule Discovery Execution',
                label: 'Rule Discovery Execution',
                iconClass: 'fas fa-wave-square text-amber-300',
                enabled: true
            },
            {
                page: 'M04002',
                title: 'Rule Discovery Analysis',
                label: 'Rule Discovery Analysis',
                iconClass: 'fas fa-chart-simple text-amber-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'edit-master',
        label: 'Editing Execution Management',
        iconClass: 'fas fa-clipboard-check text-violet-400',
        enabled: true,
        children: [
            {
                page: 'M05001',
                title: 'Editing Rule Management',
                label: 'Rule Decision & Master',
                iconClass: 'fas fa-list-check text-violet-300',
                enabled: true
            },
            {
                page: 'M05002',
                title: 'Editing Error Correction',
                label: 'Editing Error Correction',
                iconClass: 'fas fa-triangle-exclamation text-lime-300',
                enabled: true
            },
            {
                page: 'M05003',
                title: 'Editing Production Deployment',
                label: 'Editing Production Deployment',
                iconClass: 'fas fa-circle-check text-cyan-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'model-resource',
        label: 'Model Resources',
        iconClass: 'fas fa-brain text-pink-400',
        enabled: true,
        children: [
            {
                page: 'M90001',
                title: 'Internal Model',
                label: 'Internal Model',
                iconClass: 'fas fa-microchip text-pink-300',
                enabled: true
            },
            {
                page: 'M90002',
                title: 'External Model',
                label: 'External Model',
                iconClass: 'fas fa-code text-pink-300',
                enabled: true
            },
            {
                page: 'M90003',
                title: 'Model Training',
                label: 'Model Training',
                iconClass: 'fas fa-graduation-cap text-pink-300',
                roles: ['ADMIN'],
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'system-setting',
        label: 'My Environment Settings',
        iconClass: 'fas fa-sliders text-slate-300',
        enabled: true,
        children: [
            {
                page: 'M91001',
                title: 'My Account',
                label: 'My Account',
                iconClass: 'fas fa-user text-slate-300',
                enabled: true
            },
            {
                page: 'M91002',
                title: 'My System Settings',
                label: 'My System Settings',
                iconClass: 'fas fa-sliders text-slate-300',
                enabled: true
            }
        ]
    },
    {
        type: 'folder',
        key: 'admin-setting',
        label: 'Admin Settings',
        iconClass: 'fas fa-user-shield text-red-300',
        roles: ['ADMIN'],
        enabled: true,
        children: [
            {
                page: 'M99001',
                title: 'DB Connection Settings',
                label: 'DB Connection Settings',
                iconClass: 'fas fa-plug text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99002',
                title: 'Database Management',
                label: 'Database Management',
                iconClass: 'fas fa-server text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99003',
                title: 'System Management',
                label: 'System Management',
                iconClass: 'fas fa-user-shield text-red-300',
                roles: ['ADMIN'],
                enabled: true
            },
            {
                page: 'M99004',
                title: 'Notice Management',
                label: 'Notice Management',
                iconClass: 'fas fa-bullhorn text-slate-300',
                roles: ['ADMIN'],
                enabled: true
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M03001', 'M03002', 'M03003', 'M03004', 'M04001', 'M04002', 'M05001', 'M05002', 'M05003', 'M06001', 'M06002', 'M07001', 'M07002', 'M07003', 'M90001', 'M90002', 'M90003', 'M91001', 'M91002', 'M99001', 'M99002', 'M99003', 'M99004'],
    scriptPages: ['home', 'login', 'M01001', 'M01002', 'M02001', 'M02002', 'M03001', 'M03002', 'M03003', 'M03004', 'M04001', 'M04002', 'M05001', 'M05002', 'M05003', 'M06001', 'M06002', 'M07001', 'M07002', 'M07003', 'M90001', 'M90002', 'M90003', 'M91001', 'M91002', 'M99001', 'M99002', 'M99003', 'M99004']
};
