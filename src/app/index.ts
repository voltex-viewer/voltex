import './index.css';
import { WaveformState } from "@voltex-viewer/plugin-api";
import { Renderer } from './Renderer';
import { VerticalSidebar } from './VerticalSidebar';
import { createMenuBar } from './MenuBar';

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('root');
    if (!root) return;
    root.classList.add('waveform-root');

    // Create main content wrapper
    const mainContent = document.createElement('div');
    mainContent.className = 'waveform-main-content';
    root.appendChild(mainContent);

    // Animation frame management
    let renderRequested = false;
    let renderer: Renderer | null = null;
    
    // Create sidebar with callback to resize canvas when state changes
    const verticalSidebar = new VerticalSidebar(root, () => {
        if (renderer) {
            renderer.resizeCanvases();
        }
    });

    // --- Main waveform container (for time axis and channel rows) ---
    const waveformContainer = document.createElement('div');
    waveformContainer.className = 'waveform-container';
    mainContent.appendChild(waveformContainer);

    // Create single canvas that will render everything
    const mainCanvas = document.createElement('canvas');
    mainCanvas.className = 'waveform-main-canvas';
    waveformContainer.appendChild(mainCanvas);

    const state: WaveformState = {
        offset: 0,
        pxPerSecond: 200,
    }

    function requestRender() {
        function doRender() {
            if (renderer) {
                const rerequest = renderer.render();
                renderRequested = rerequest;
                if (rerequest) {
                    requestAnimationFrame(doRender);
                }
            }
        }
        if (!renderRequested) {
            renderRequested = true;
            requestAnimationFrame(doRender);
        }
    }

    renderer = new Renderer(state, mainCanvas, verticalSidebar, requestRender);

    await renderer.loadPlugins();

    // Initial resize and event wiring
    renderer.resizeCanvases();
    window.addEventListener('resize', () => renderer.resizeCanvases());
    requestRender();

    // Add drag and drop file handling
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        await renderer.pluginManager.loadFiles(...Array.from(e.dataTransfer?.files || []))
    });

    // Create and insert menu bar first
    document.body.insertBefore(
        createMenuBar([
            {
                label: 'File',
                items: [
                    {
                        label: 'Open...',
                        accelerator: 'Ctrl+O',
                        action: async () => {
                            try {
                                // Show file picker
                                const fileHandles = await window.showOpenFilePicker({
                                    multiple: false,
                                    types: renderer.pluginManager.getFileOpenTypes(),
                                });
                                
                                const files = await Promise.all(fileHandles.map(fh => fh.getFile()));
                                await renderer.pluginManager.loadFiles(...files);
                            } catch (error) {
                                if (error instanceof Error && error.name === 'AbortError') {
                                    // User cancelled the file picker
                                    return;
                                }
                                throw error;
                            }
                        }
                    },
                    {
                        label: 'Save As...',
                        accelerator: 'Ctrl+S',
                        action: async () => {
                            try {
                                // Show file picker
                                const fileHandle = await window.showSaveFilePicker({
                                    types: renderer.pluginManager.getFileSaveTypes(),
                                });

                                const writable = await fileHandle.createWritable({ keepExistingData: false });
                                const handled = await renderer.pluginManager.handleFileSave(fileHandle.name, writable);
                                
                                if (!handled) {
                                    await writable.close();
                                    throw Error(`No plugin found to handle file`);
                                }
                            } catch (error) {
                                if (error instanceof Error && error.name === 'AbortError') {
                                    // User cancelled the file picker
                                    return;
                                }
                                throw error;
                            }
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Export Config...',
                        action: async () => {
                            try {
                                const configManager = renderer.pluginManager.getConfigManager();
                                const configs = configManager.exportAllConfigs();
                                
                                const json = JSON.stringify(configs, null, 2);
                                const blob = new Blob([json], { type: 'application/json' });
                                
                                const fileHandle = await window.showSaveFilePicker({
                                    suggestedName: 'voltex-config.json',
                                    types: [{
                                        description: 'JSON Config File',
                                        accept: { 'application/json': ['.json'] }
                                    }]
                                });
                                
                                const writable = await fileHandle.createWritable();
                                await writable.write(blob);
                                await writable.close();
                            } catch (error) {
                                if (error instanceof Error && error.name === 'AbortError') {
                                    return;
                                }
                                throw error;
                            }
                        }
                    },
                    {
                        label: 'Import Config...',
                        action: async () => {
                            try {
                                const fileHandles = await window.showOpenFilePicker({
                                    multiple: false,
                                    types: [{
                                        description: 'JSON Config File',
                                        accept: { 'application/json': ['.json'] }
                                    }]
                                });
                                
                                const file = await fileHandles[0].getFile();
                                const text = await file.text();
                                const configs = JSON.parse(text);
                                
                                const configManager = renderer.pluginManager.getConfigManager();
                                configManager.importAllConfigs(configs);
                            } catch (error) {
                                if (error instanceof Error && error.name === 'AbortError') {
                                    return;
                                }
                                const message = error instanceof Error ? error.message : String(error);
                                alert(`Error importing configuration: ${message}`);
                            }
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Exit',
                        action: () => {
                            if (window.waveformApi) {
                                window.waveformApi.quitApp();
                            }
                        }
                    }
                ]
            },
            {
                label: 'Help',
                items: [
                    {
                        label: 'View Commit on GitHub',
                        action: () => {
                            const commitHash = __GIT_COMMIT_HASH__;
                            if (commitHash && commitHash !== 'unknown') {
                                const url = `https://github.com/voltex-viewer/voltex/commit/${commitHash}`;
                                if (window.waveformApi) {
                                    window.waveformApi.openExternalUrl(url);
                                } else {
                                    window.open(url, '_blank');
                                }
                            }
                        }
                    }
                ]
            }
        ]),
        document.body.firstChild);
});