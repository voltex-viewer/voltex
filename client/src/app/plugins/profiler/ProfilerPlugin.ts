import { PluginContext } from '../../Plugin';
import { RenderProfiler } from '../../RenderProfiler';

let profiler: RenderProfiler | null = null;

export default (context: PluginContext): void => {
    profiler = new RenderProfiler();
    profiler.setContext(context);
    
    // Hook into render cycle to measure frame times
    context.onBeforeRender(() => {
        profiler?.startFrame();
        return false; // Don't request additional renders
    });
    
    context.onAfterRender(() => {
        profiler?.endFrame();
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
                const avgTime = profiler?.getAverageFrameTime() || 0;
                const fps = profiler?.getCurrentFPS() || 0;
                const frameCount = profiler?.getFrameData().length || 0;
                const frameTimes = profiler?.getFrameTimes() || [];
                
                let minTime = Infinity;
                let maxTime = -Infinity;
                for (const time of frameTimes) {
                    minTime = Math.min(minTime, time);
                    maxTime = Math.max(maxTime, time);
                }
                if (minTime === Infinity) minTime = 0;
                if (maxTime === -Infinity) maxTime = 0;
                
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
                `;
                
                const button = container.querySelector('#add-profiler-signal') as HTMLButtonElement;
                if (button && profiler) {
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

export function getProfiler(): RenderProfiler | null {
    return profiler;
}
