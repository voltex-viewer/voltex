interface MenuAction {
    label: string;
    accelerator?: string;
    action: () => void;
}

interface MenuSeparator {
    type: 'separator';
}

interface MenuDefinition {
    label: string;
    items: (MenuAction | MenuSeparator)[];
}

export function createMenuBar(menuDefinition: MenuDefinition[]): HTMLElement {
    const menuBar = document.createElement('div');
    menuBar.className = 'menu-bar';

    const menuItems: HTMLElement[] = [];
    const acceleratorMap = new Map<string, () => void>();

    function closeAllMenus() {
        menuItems.forEach(item => item.classList.remove('active'));
    }

    // Build accelerator map from menu definition
    function buildAcceleratorMap(menus: MenuDefinition[]) {
        menus.forEach(menu => {
            menu.items.forEach(item => {
                if ('accelerator' in item && item.accelerator) {
                    acceleratorMap.set(item.accelerator.toLowerCase(), item.action);
                }
            });
        });
    }

    buildAcceleratorMap(menuDefinition);

    menuDefinition.forEach(menu => {
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';
        
        const menuLabel = document.createElement('span');
        menuLabel.textContent = menu.label;
        menuItem.appendChild(menuLabel);

        const submenu = document.createElement('div');
        submenu.className = 'submenu';

        menu.items.forEach(item => {
            if ('type' in item && item.type === 'separator') {
                const separator = document.createElement('div');
                separator.className = 'submenu-separator';
                submenu.appendChild(separator);
            } else {
                const menuAction = item as MenuAction;
                const submenuItem = document.createElement('div');
                submenuItem.className = 'submenu-item';

                const labelSpan = document.createElement('span');
                labelSpan.textContent = menuAction.label;
                submenuItem.appendChild(labelSpan);

                if (menuAction.accelerator) {
                    const acceleratorSpan = document.createElement('span');
                    acceleratorSpan.className = 'accelerator';
                    acceleratorSpan.textContent = menuAction.accelerator;
                    submenuItem.appendChild(acceleratorSpan);
                }

                submenuItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeAllMenus();
                    menuAction.action();
                });

                submenu.appendChild(submenuItem);
            }
        });

        menuItem.appendChild(submenu);
        menuItems.push(menuItem);

        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = menuItem.classList.contains('active');
            closeAllMenus();
            if (!isActive) {
                menuItem.classList.add('active');
            }
        });

        menuBar.appendChild(menuItem);
    });

    // Close menus when clicking outside
    document.addEventListener('click', closeAllMenus);

    // Handle keyboard shortcuts using accelerator map
    document.addEventListener('keydown', (e) => {
        const acceleratorKey = buildAcceleratorKey(e);
        const action = acceleratorMap.get(acceleratorKey);
        if (action) {
            e.preventDefault();
            action();
        }
    });

    function buildAcceleratorKey(e: KeyboardEvent): string {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        if (e.metaKey) parts.push('meta');
        parts.push(e.key.toLowerCase());
        return parts.join('+');
    }

    return menuBar;
}
