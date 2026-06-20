const MenuRenderer = {
    pageMap: {},
    activeFlyout: null,
    activeOutsideHandler: null,

    render(navId, onPageClick) {
        const nav = document.getElementById(navId);
        const sourceMenus = window.MENU_CONFIG || [];
        const menus = this.filterByRole(sourceMenus);

        if (!nav) return;

        nav.innerHTML = '';
        this.pageMap = {};
        this.collectPageMap(sourceMenus);

        menus
            .filter(menu => menu.enabled !== false)
            .forEach(menu => {
                const element = menu.type === 'folder'
                    ? this.createFolder(menu, onPageClick)
                    : this.createPageLink(menu, onPageClick, true);

                if (element) nav.appendChild(element);
            });
        window.MENU_PAGE_MAP = this.pageMap;
        this.bindControls();
    },

    collectPageMap(menus) {
        (menus || []).forEach(menu => {
            if (menu.page) this.pageMap[menu.page] = menu;
            if (Array.isArray(menu.children)) this.collectPageMap(menu.children);
        });
    },

    createPageLink(menu, onPageClick, isRoot = false) {
        if (!menu.page || menu.enabled === false) return null;

        const link = document.createElement('a');
        link.href = '#';
        link.dataset.page = menu.page;
        link.dataset.title = menu.title || menu.label;
        link.title = menu.title || menu.label || menu.page;
        link.className = isRoot
            ? 'block p-3 hover:bg-slate-700 flex items-center gap-2'
            : 'block p-3 pl-10 hover:bg-slate-700 text-sm text-slate-300';

        if (menu.active) {
            link.classList.add('menu-active');
        }

        if (menu.iconClass) {
            const icon = document.createElement('i');
            icon.className = `${menu.iconClass} menu-page-icon`;
            link.appendChild(icon);
        }

        const label = document.createElement('span');
        label.textContent = menu.label;
        link.appendChild(label);

        link.addEventListener('click', onPageClick);
        return link;
    },

    createFolder(menu, onPageClick) {
        const children = this.filterByRole(menu.children || []).filter(child => child.enabled !== false);
        if (children.length === 0) return null;

        const folder = document.createElement('div');
        folder.className = 'menu-folder';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full flex items-center justify-between p-3 hover:bg-slate-800 transition-colors group';
        button.title = menu.label || menu.key || '';

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'flex items-center gap-3';

        if (menu.iconClass) {
            const icon = document.createElement('i');
            icon.className = menu.iconClass;
            labelWrapper.appendChild(icon);
        }

        const label = document.createElement('span');
        label.textContent = menu.label;
        labelWrapper.appendChild(label);

        const arrow = document.createElement('i');
        arrow.className = 'fas fa-chevron-down text-xs transition-transform duration-300';

        button.appendChild(labelWrapper);
        button.appendChild(arrow);
        button.dataset.folderToggleBound = "Y";

        const submenu = document.createElement('div');
        submenu.className = 'submenu bg-slate-800 hidden';
        button.addEventListener('click', (event) => {
            if (document.body.classList.contains('sidebar-user-collapsed')) {
                event.stopPropagation();
                this.toggleCollapsedFlyout(folder, button, children, onPageClick);
                return;
            }
            this.closeCollapsedFlyouts();
            submenu.classList.toggle('hidden');
            arrow.classList.toggle('rotate-180');
        });

        children.forEach(child => {
            const link = this.createPageLink(child, onPageClick);
            if (link) {
                link.addEventListener('click', () => this.closeCollapsedFlyouts());
                submenu.appendChild(link);
            }
        });

        folder.appendChild(button);
        folder.appendChild(submenu);

        return folder;
    },

    getCurrentRoleCode() {
        try {
            const user = JSON.parse(sessionStorage.getItem("initLoginUser") || "{}");
            return String(user.roleCode || "USER").toUpperCase();
        } catch {
            return "USER";
        }
    },

    isAllowed(menu) {
        if (menu.enabled === false) return false;
        const roles = Array.isArray(menu.roles) ? menu.roles.map(role => String(role).toUpperCase()) : null;
        return !roles || roles.includes(this.getCurrentRoleCode());
    },

    filterByRole(menus) {
        return menus.filter(menu => this.isAllowed(menu));
    },

    bindControls() {
        const expandButton = document.getElementById('btnExpandAllMenus');
        const collapseButton = document.getElementById('btnCollapseAllMenus');

        if (expandButton) {
            expandButton.addEventListener('click', () => this.expandAll());
        }

        if (collapseButton) {
            collapseButton.addEventListener('click', () => this.collapseAll());
        }
    },

    expandAll() {
        document.querySelectorAll('#mainNav .submenu').forEach(submenu => {
            submenu.classList.remove('hidden');
        });

        document.querySelectorAll('#mainNav .menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.add('rotate-180');
        });
    },

    collapseAll() {
        document.querySelectorAll('#mainNav .submenu').forEach(submenu => {
            submenu.classList.add('hidden');
            submenu.classList.remove('sidebar-flyout-menu');
            submenu.style.removeProperty('top');
        });

        document.querySelectorAll('#mainNav .menu-folder .fa-chevron-down').forEach(icon => {
            icon.classList.remove('rotate-180');
        });
    },

    toggleCollapsedFlyout(folder, button, children, onPageClick) {
        const isOpen = folder.classList.contains('is-flyout-open');
        this.closeCollapsedFlyouts();
        if (isOpen) return;

        const rect = button.getBoundingClientRect();
        const flyout = document.createElement('div');
        flyout.className = 'sidebar-flyout-portal';
        flyout.style.top = `${Math.max(8, Math.min(window.innerHeight - 220, rect.top))}px`;
        flyout.style.left = `${Math.max(64, rect.right)}px`;

        children.forEach(child => {
            const link = this.createPageLink(child, onPageClick);
            if (!link) return;
            link.addEventListener('click', () => this.closeCollapsedFlyouts());
            flyout.appendChild(link);
        });

        folder.classList.add('is-flyout-open');
        document.body.appendChild(flyout);
        this.activeFlyout = flyout;

        const onOutsideClick = (event) => {
            if (folder.contains(event.target) || flyout.contains(event.target)) return;
            this.closeCollapsedFlyouts();
            document.removeEventListener('click', onOutsideClick, true);
        };
        this.activeOutsideHandler = onOutsideClick;
        setTimeout(() => document.addEventListener('click', onOutsideClick, true), 0);
    },

    closeCollapsedFlyouts() {
        if (this.activeOutsideHandler) {
            document.removeEventListener('click', this.activeOutsideHandler, true);
            this.activeOutsideHandler = null;
        }
        if (this.activeFlyout) {
            this.activeFlyout.remove();
            this.activeFlyout = null;
        }
        document.querySelectorAll('#mainNav .menu-folder.is-flyout-open').forEach(folder => {
            folder.classList.remove('is-flyout-open');
        });
        document.querySelectorAll('#mainNav .submenu.sidebar-flyout-menu').forEach(submenu => {
            submenu.classList.add('hidden');
            submenu.classList.remove('sidebar-flyout-menu');
            submenu.style.removeProperty('top');
        });
    }
};

window.MenuRenderer = MenuRenderer;
