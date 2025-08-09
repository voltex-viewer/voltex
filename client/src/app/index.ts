import './index.css';
import { WaveformState } from './WaveformState';
import { Renderer } from './Renderer';
import { VerticalSidebar } from './VerticalSidebar';

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('root');
    if (!root) return;
    root.classList.add('waveform-root');

    const verticalSidebar = new VerticalSidebar(root);

    // --- Hotbar ---
    const hotbar = document.createElement('div');
    hotbar.className = 'hotbar';
    
    // Play/Stop button
    const playPauseButton = document.createElement('button');
    playPauseButton.className = 'hotbar-button';
    playPauseButton.innerHTML = '<span class="hotbar-button-icon">▶</span>';
    playPauseButton.title = 'Play/Stop (Spacebar)';
    
    // Cursor button
    const cursorButton = document.createElement('button');
    cursorButton.className = 'hotbar-button';
    cursorButton.innerHTML = '<span class="hotbar-button-icon">⊥</span>';
    cursorButton.title = 'Cursor tool (C)';
    
    hotbar.appendChild(playPauseButton);
    hotbar.appendChild(cursorButton);
    root.appendChild(hotbar);

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

    // Hotbar button functionality
    let isPlaying = false;
    let cursorMode = false; // Start with cursor tool inactive
    
    playPauseButton.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            playPauseButton.innerHTML = '<span class="hotbar-button-icon">◼</span>';
        } else {
            playPauseButton.innerHTML = '<span class="hotbar-button-icon">▶</span>';
        }
    });
    
    cursorButton.addEventListener('click', () => {
        cursorMode = !cursorMode;
        if (cursorMode) {
            cursorButton.classList.add('active');
            console.log('Cursor tool activated');
        } else {
            cursorButton.classList.remove('active');
            console.log('Cursor tool deactivated');
        }
    });

    const renderer = new Renderer(state, mainCanvas, verticalSidebar, requestRender);

    // Add keyboard shortcuts for non-grouping features
    document.addEventListener('keydown', (e) => {
        // Spacebar: Toggle play/pause
        if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            playPauseButton.click();
        }
        
        // C key: Toggle cursor tool
        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            cursorButton.click();
        }
    });

    // Initial resize and event wiring
    renderer.resizeCanvases();
    window.addEventListener('resize', () => renderer.resizeCanvases());
    requestRender();
});