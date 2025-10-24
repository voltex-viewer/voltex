import './index.css';
import { WaveformState } from "@voltex-viewer/plugin-api";
import { Renderer } from './Renderer';
import { VerticalSidebar } from './VerticalSidebar';
import { createMenuBar } from './MenuBar';

document.addEventListener('DOMContentLoaded', async () => {
    await document.fonts.load('16px "Open Sans"');

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

        for (const file of Array.from(e.dataTransfer?.files || [])) {
            const handled = await renderer.pluginManager.handleFileOpen(file);
            
            if (!handled) {
                console.warn(`No plugin found to handle file: ${file.name}`);
            }
        }
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

                                const file = await fileHandles[0].getFile();
                                
                                const handled = await renderer.pluginManager.handleFileOpen(file);
                                
                                if (!handled) {
                                    throw Error(`No plugin found to handle file: ${file.name}`);
                                }
                            } catch (error) {
                                if (error.name === 'AbortError') {
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
                                if (error.name === 'AbortError') {
                                    // User cancelled the file picker
                                    return;
                                }
                                throw error;
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