import { MeasureInfo, PluginContext } from '../../Plugin';

export default (context: PluginContext): void => {
    const profiler = context.renderProfiler;

    const frameData: Array<{ timestamp: number; frameTime: number }> = [];
    const flameGraphData: MeasureInfo[][][] = [];
    let firstFrameTimestamp = 0;
    const maxFrames = 1000;
    const maxFlameGraphs = 100;
    let minFrameTime = Infinity;
    let maxFrameTime = -Infinity;
    const flameGraphSources: Array<{ name: string[]; source: any }> = [];
    
    // Create signal source for frame time data
    const signalSource = {
        name: ['Profiler', 'Frame Time (ms)'],
        discrete: false,
        signal: () => {
            return {
                source: signalSource,
                data: (index: number) => {
                    if (index < 0 || index >= frameData.length) {
                        return [0, 0] as [number, number];
                    }
                    const frameEntry = frameData[index];
                    return [frameEntry.timestamp, frameEntry.frameTime] as [number, number];
                },
                get length() {
                    return frameData.length;
                },
                get minTime() {
                    return frameData.length > 0 ? frameData[0].timestamp : 0;
                },
                get maxTime() {
                    return frameData.length > 0 ? frameData[frameData.length - 1].timestamp : 0;
                },
                get minValue() {
                    return frameData.length === 0 ? 0 : (minFrameTime === Infinity ? 0 : minFrameTime);
                },
                get maxValue() {
                    return frameData.length === 0 ? 0 : (maxFrameTime === -Infinity ? 0 : maxFrameTime);
                }
            };
        }
    };
    
    // Function to create or update flame graph sources based on current depth
    const updateFlameGraphSources = () => {
        // Find the maximum depth from all flame graph data
        const maxDepth = Math.max(0, ...flameGraphData.map(entry => entry.length));

        for (let depth = 0; depth < maxDepth; depth++) {
            if (!flameGraphSources[depth]) {
                const depthSource = {
                    name: ['Profiler', `Depth ${depth}`],
                    discrete: true,
                    signal: () => {
                        // Use the start time of the first measure entry (root of the stack)
                        let firstMeasurementTime = 0;
                        if (flameGraphData.length > 0 && flameGraphData[0].length > 0 && flameGraphData[0][0].length > 0) {
                            firstMeasurementTime = flameGraphData[0][0][0].startTime;
                        }

                        // Generate timeline data showing when measures are active at this depth
                        const timelineData: Array<{ timestamp: number; active: number }> = [];
                        const nameToIdMap = new Map<string, number>();
                        const idToNameMap = new Map<number, string>();
                        let nextId = 0;
                        
                        for (const entry of flameGraphData) {
                            const measures = entry[depth] || [];
                            
                            // For each measure at this depth, add start/end points
                            for (const measure of measures) {
                                // Get or assign a unique ID for this measure name
                                if (!nameToIdMap.has(measure.name)) {
                                    nameToIdMap.set(measure.name, nextId);
                                    idToNameMap.set(nextId, measure.name);
                                    nextId++;
                                }
                                const measureId = nameToIdMap.get(measure.name)!;
                                
                                const relativeStart = (measure.startTime - firstMeasurementTime) / 1000;
                                const relativeEnd = (measure.endTime - firstMeasurementTime) / 1000;
                                
                                timelineData.push({ timestamp: relativeStart, active: measureId });
                                timelineData.push({ timestamp: relativeEnd, active: measureId });
                            }
                        }
                        
                        return {
                            source: depthSource,
                            valueTable: idToNameMap,
                            data: (index: number) => {
                                if (index < 0 || index >= timelineData.length) {
                                    return [0, 0] as [number, number];
                                }
                                const entry = timelineData[index];
                                return [entry.timestamp, entry.active] as [number, number];
                            },
                            get length() {
                                return timelineData.length;
                            },
                            get minTime() {
                                return timelineData.length > 0 ? timelineData[0].timestamp : 0;
                            },
                            get maxTime() {
                                return timelineData.length > 0 ? timelineData[timelineData.length - 1].timestamp : 0;
                            },
                            get minValue() {
                                return 0;
                            },
                            get maxValue() {
                                return Math.max(1, nextId - 1);
                            }
                        };
                    }
                };
                
                flameGraphSources[depth] = { name: depthSource.name, source: depthSource };
                context.signalSources.add(depthSource);
            }
        }
    };
    
    context.signalSources.add(signalSource);
    
    // Hook into render cycle to capture frame data
    context.onBeforeRender(() => {
        const lastFrame = profiler.lastFrame;
        if (lastFrame) {
            // Initialize first frame timestamp
            if (frameData.length === 0) {
                firstFrameTimestamp = lastFrame.endTime;
            }
            
            // Calculate relative timestamp from first frame
            const relativeTimestamp = (lastFrame.endTime - firstFrameTimestamp) / 1000; // Convert to seconds
            
            frameData.push({ timestamp: relativeTimestamp, frameTime: lastFrame.frameTime });
            
            // Store flame graph data if available up to a limit
            flameGraphData.push(lastFrame.measures);
            if (flameGraphData.length > maxFlameGraphs) {
                flameGraphData.shift();
            }
            
            // Update flame graph sources when we have new data
            updateFlameGraphSources();
            
            // Update running min/max values
            minFrameTime = Math.min(minFrameTime, lastFrame.frameTime);
            maxFrameTime = Math.max(maxFrameTime, lastFrame.frameTime);
            
            if (frameData.length > maxFrames) {
                const removedFrame = frameData.shift()!;
                // Update first frame timestamp when we remove the oldest frame
                if (frameData.length > 0) {
                    // Recalculate firstFrameTimestamp based on the new first frame
                    const newFirstFrame = frameData[0];
                    firstFrameTimestamp = lastFrame.endTime - (newFirstFrame.timestamp * 1000);
                }
                
                // If we removed the min or max value, we need to recompute
                if (removedFrame.frameTime === minFrameTime || removedFrame.frameTime === maxFrameTime) {
                    minFrameTime = Infinity;
                    maxFrameTime = -Infinity;
                    for (const frame of frameData) {
                        minFrameTime = Math.min(minFrameTime, frame.frameTime);
                        maxFrameTime = Math.max(maxFrameTime, frame.frameTime);
                    }
                }
            }
        }
        return false; // Don't request additional renders
    });
    
    context.addSidebarEntry({
        title: 'Profiler',
        iconHtml: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>`,
        renderContent: () => {
            const container = document.createElement('div');
            container.style.padding = '10px';
            
            const updateStats = () => {
                const avgTime = frameData.length > 0 ? 
                    frameData.reduce((sum: number, frame: { timestamp: number; frameTime: number }) => sum + frame.frameTime, 0) / frameData.length : 0;
                const fps = avgTime > 0 ? 1000 / avgTime : 0;
                const frameCount = frameData.length;
                
                const minTime = frameData.length === 0 ? 0 : (minFrameTime === Infinity ? 0 : minFrameTime);
                const maxTime = frameData.length === 0 ? 0 : (maxFrameTime === -Infinity ? 0 : maxFrameTime);
                
                container.innerHTML = `
                    <div style="margin-bottom: 15px;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #fff;">Render Performance</h3>
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>Average Frame Time:</span>
                                <span style="font-weight: bold; color: ${avgTime > 16.67 ? '#ff6b6b' : '#51cf66'};">${avgTime.toFixed(2)} ms</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Average FPS:</span>
                                <span style="font-weight: bold; color: ${fps < 60 ? '#ff6b6b' : '#51cf66'};">${fps.toFixed(1)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Min Frame Time:</span>
                                <span style="font-weight: bold;">${minTime.toFixed(2)} ms</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Max Frame Time:</span>
                                <span style="font-weight: bold;">${maxTime.toFixed(2)} ms</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Frames Recorded:</span>
                                <span style="font-weight: bold;">${frameCount}/1000</span>
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <div style="font-size: 11px; color: #aaa; margin-bottom: 5px;">
                            Target: 60 FPS (16.67ms), Smooth: 30 FPS (33.33ms)
                        </div>
                        <div style="
                            width: 100%;
                            height: 8px;
                            background: #333;
                            border-radius: 4px;
                            overflow: hidden;
                        ">
                            <div style="
                                width: ${Math.min(100, (fps / 60) * 100)}%;
                                height: 100%;
                                background: ${fps >= 60 ? '#51cf66' : fps >= 30 ? '#ffd43b' : '#ff6b6b'};
                                transition: width 0.3s ease;
                            "></div>
                        </div>
                    </div>
                    <button id="add-profiler-signal" style="
                        width: 100%;
                        padding: 8px;
                        background: #007acc;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        margin-bottom: 8px;
                    ">Add Frame Time Signal to Waveform</button>
                    <button id="add-flamegraph-signals" style="
                        width: 100%;
                        padding: 8px;
                        background: #ff6b35;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        margin-bottom: 8px;
                    ">Add All Flame Graph Depths</button>
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 8px;">
                        Flame graphs: ${flameGraphData.length}/${maxFlameGraphs} stored<br/>
                        Depth levels: ${flameGraphSources.length}
                    </div>
                `;
                
                const button = container.querySelector('#add-profiler-signal') as HTMLButtonElement;
                if (button) {
                    button.addEventListener('click', () => {
                        // Find the profiler signal source and add it to waveform
                        const profilerSource = context.signalSources.available.find(
                            source => source.name.length === 2 && 
                                     source.name[0] === 'Profiler' && 
                                     source.name[1] === 'Frame Time (ms)'
                        );
                        if (profilerSource) {
                            context.createRows({ channels: [profilerSource.signal()] });
                            context.requestRender();
                        }
                    });
                }
                
                const flameGraphButton = container.querySelector('#add-flamegraph-signals') as HTMLButtonElement;
                if (flameGraphButton) {
                    flameGraphButton.addEventListener('click', () => {
                        // Find all flame graph depth sources and add them to waveform
                        const depthSources = context.signalSources.available.filter(
                            source => source.name.length === 2 && 
                                     source.name[0] === 'Profiler' && 
                                     source.name[1].startsWith('Depth ')
                        );
                        
                        if (depthSources.length > 0) {
                            // Create one row per signal
                            for (const source of depthSources) {
                                context.createRows({ channels: [source.signal()] });
                            }
                            context.requestRender();
                        }
                    });
                }
            };
            
            updateStats();
            
            // Update stats periodically
            const interval = setInterval(updateStats, 1000);
            
            // Clean up interval when container is removed
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.removedNodes.forEach((node) => {
                        if (node === container || (node as Element)?.contains?.(container)) {
                            clearInterval(interval);
                            observer.disconnect();
                        }
                    });
                });
            });
            
            if (container.parentNode) {
                observer.observe(container.parentNode, { childList: true, subtree: true });
            }
            
            return container;
        }
    });
};
