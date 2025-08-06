import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { setupMainMenu } from './main_menu';
import path from 'path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
    app.quit();
}

let rustProcess: ReturnType<typeof spawn> | null = null;

const startRustServer = () => {
    // Dynamically resolve the Rust server binary path for dev and packaged modes
    let exe: string;
    if (app.isPackaged) {
        exe = process.platform === 'win32'
            ? path.resolve(process.resourcesPath, 'server.exe')
            : path.resolve(process.resourcesPath, 'server');
    } else {
        // In development, use the debug build
        exe = process.platform === 'win32'
            ? path.resolve(__dirname, '../../../server/target/debug/server.exe')
            : path.resolve(__dirname, '../../../server/target/debug/server');
    }

    const rust = spawn(exe, [], {
        cwd: path.dirname(exe),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });
    rust.on('error', (err) => {
        console.error('Failed to start Rust server:', err);
    });
    if (rust.stdout) {
        rust.stdout.on('data', (data) => {
            console.log(`[Rust server] ${data.toString().trim()}`);
        });
    }
    if (rust.stderr) {
        rust.stderr.on('data', (data) => {
            console.error(`[Rust server] ${data.toString().trim()}`);
        });
    }
    rustProcess = rust;
};

const stopRustServer = () => {
    if (rustProcess) {
        rustProcess.kill();
        rustProcess = null;
    }
};

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: app.isPackaged 
            ? path.join(process.resourcesPath, 'assets', 'icon.ico')
            : path.join(__dirname, '../../assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }

    // Set up the main menu with File->Open
    setupMainMenu(mainWindow);

    // Open the DevTools only in development
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    // Start Rust server unless --no-server flag is passed
    if (!process.argv.includes('--no-server')) {
        startRustServer();
    }
    createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopRustServer();
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
