export class WaveformState {
    offset = 0; // in pixels (float for smooth dragging)
    isDragging = false;
    dragStartX = 0;
    dragStartOffset = 0;
    lastDragX = 0;
    lastDragTime = 0;
    velocity = 0;
    animationFrame: number | null = null;
    decay = 0.85; // friction per frame (faster decay)
    minVelocity = 0.1; // px/frame threshold to stop
    canvasWidth = 800;
    labelWidth = 100;
    isResizingLabel = false;
    resizeStartX = 0;
    resizeStartWidth = 110;
    minLabelWidth = 40;
    maxLabelWidth = 400;
    
    // This is set by WaveformLabelHandler to prevent dragging during row resize
    isResizingRowHeight = false;
    
    constructor() { }
}
