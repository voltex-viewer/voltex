import './index.css';
import { WaveformState } from './WaveformState';
import { Renderer } from './Renderer';
import { VerticalSidebar } from './VerticalSidebar';

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
});