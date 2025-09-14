import './index.css';
import { WaveformState } from './WaveformState';
import { Renderer } from './Renderer';
import { VerticalSidebar } from './VerticalSidebar';
import { createMenuBar } from './MenuBar';

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('root');
    if (!root) return;
    root.classList.add('waveform-root');

    const verticalSidebar = new VerticalSidebar(root);

    // --- Main waveform container (for time axis and channel rows) ---
    const waveformContainer = document.createElement('div');
    waveformContainer.className = 'waveform-container';
    root.appendChild(waveformContainer);

    // Create single canvas that will render everything
    const mainCanvas = document.createElement('canvas');
    mainCanvas.className = 'waveform-main-canvas';
    waveformContainer.appendChild(mainCanvas);

    const state = new WaveformState();

    // Animation frame management
    let renderRequested = false;
    function requestRender() {
        function doRender() {
            const rerequest = renderer.render();
            renderRequested = rerequest;
            if (rerequest) {
                requestAnimationFrame(doRender);
            }
        }
        if (!renderRequested) {
            renderRequested = true;
            requestAnimationFrame(doRender);
        }
    }

    const renderer = new Renderer(state, mainCanvas, verticalSidebar, requestRender);

    // Initial resize and event wiring
    renderer.resizeCanvases();
    window.addEventListener('resize', () => renderer.resizeCanvases());
    requestRender();

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
                                    excludeAcceptAllOption: true,
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
                                    excludeAcceptAllOption: true,
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
            }
        ]),
        document.body.firstChild);
});