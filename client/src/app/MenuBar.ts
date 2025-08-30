export function setupMenuBar() {
    const menuItems = document.querySelectorAll('.menu-item');
    const submenuItems = document.querySelectorAll('.submenu-item');

    // Close all menus
    function closeAllMenus() {
        menuItems.forEach(item => item.classList.remove('active'));
    }

    // Handle menu item clicks
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = item.classList.contains('active');
            closeAllMenus();
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // Handle submenu item clicks
    submenuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.getAttribute('data-action');
            closeAllMenus();
            
            switch (action) {
                case 'open':
                    handleFileOpen();
                    break;
                case 'exit':
                    handleAppExit();
                    break;
            }
        });
    });

    // Close menus when clicking outside
    document.addEventListener('click', closeAllMenus);

    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            handleFileOpen();
        }
    });
}

function handleFileOpen() {
    // Send message to main process to open file dialog
    if (window.waveformApi) {
        window.waveformApi.openFileDialog();
    }
}

function handleAppExit() {
    // Send message to main process to quit app
    if (window.waveformApi) {
        window.waveformApi.quitApp();
    }
}
