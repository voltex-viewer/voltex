import './index.css';
import { WaveformState } from './WaveformState';
import { SignalParams } from './SignalParams';
import { Renderer } from './Renderer';
import { ZoomHandler } from './ZoomHandler';
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
    const signal = new SignalParams();

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

    const renderer = new Renderer(state, signal, waveformContainer, mainCanvas, verticalSidebar, requestRender);
    
    const zoomHandler = new ZoomHandler(state, signal, () => requestRender());
    root.addEventListener('wheel', (e) => zoomHandler.handleZoom(e), { passive: false });

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

    // Horizontal drag-to-scroll logic
    mainCanvas.addEventListener('mousedown', (e) => {
        // Don't start panning if we're resizing a label or row height
        if (state.isResizingLabel || state.isResizingRowHeight) return;
        
        // Don't start panning if clicking in the label area
        const rect = mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < state.labelWidth) return;
        
        state.isDragging = true;
        state.dragStartX = e.clientX;
        state.dragStartOffset = state.offset;
        state.lastDragX = e.clientX;
        state.lastDragTime = performance.now();
        state.velocity = 0;
        if (state.animationFrame !== null) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!state.isDragging || state.isResizingLabel || state.isResizingRowHeight) return;
        const now = performance.now();
        state.offset = state.dragStartOffset - (e.clientX - state.dragStartX);
        state.velocity = (e.clientX - state.lastDragX) / (now - state.lastDragTime + 0.0001);
        state.lastDragX = e.clientX;
        state.lastDragTime = now;
        requestRender();
    });
    window.addEventListener('mouseup', () => {
        if (!state.isDragging) return;
        state.isDragging = false;
        let pxPerFrame = state.velocity * 16.67;
        if (Math.abs(pxPerFrame) > state.minVelocity) {
            function animate() {
                pxPerFrame *= state.decay;
                state.offset = state.offset - pxPerFrame;
                requestRender();
                if (Math.abs(pxPerFrame) > state.minVelocity) {
                    state.animationFrame = requestAnimationFrame(animate);
                } else {
                    state.animationFrame = null;
                }
            }
            state.animationFrame = requestAnimationFrame(animate);
        }
    });
});