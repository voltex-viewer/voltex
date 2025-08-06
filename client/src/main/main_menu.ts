import { Menu, dialog, BrowserWindow } from 'electron';

export function setupMainMenu(mainWindow: BrowserWindow) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              filters: [
                { name: 'Waveform Files', extensions: ['json', 'mf4'] },
                { name: 'All Files', extensions: ['*'] }
              ],
              properties: ['openFile']
            });
            if (!canceled && filePaths.length > 0) {
              // Send the file path to the renderer via IPC
              mainWindow.webContents.send('open-waveform-file', filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}
