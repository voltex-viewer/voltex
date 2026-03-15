import { formatValueForDisplay, type RenderContext, type RenderBounds, type Signal, type SignalMetadata } from '@voltex-viewer/plugin-api';
import type { ExpandedSegment } from './layout';
import { topHeightRatio, trapezoidHeightRatio } from './animation';
import { drawTruncatedText } from '../waveformRenderObject';

export class ExpandedEnumTextRenderer {
    render(
        context: RenderContext,
        bounds: RenderBounds,
        segments: ExpandedSegment[],
        signal: Signal,
        metadata: SignalMetadata,
        progress: number
    ): void {
        if (segments.length === 0) return;

        const { render, state } = context;
        const { utils } = render;

        const topHeight = bounds.height * topHeightRatio;
        const trapezoidHeight = bounds.height * trapezoidHeightRatio;
        const bottomHeight = bounds.height * (1 - topHeightRatio - trapezoidHeightRatio);
        const bottomY = topHeight + trapezoidHeight;

        const padding = 5;
        const ellipsisWidth = utils.measureText('...').renderWidth;
        const baselineMetrics = utils.measureText('Ag');
        const y = bottomY + (bottomHeight - baselineMetrics.renderHeight) / 2;

        const textBoundaryX = this.computeTextBoundaries(segments, signal, state.pxPerSecond, state.offset, progress);

        for (let segIndex = 0; segIndex < segments.length; segIndex++) {
            const seg = segments[segIndex];
            const segStartX = textBoundaryX[segIndex];
            const segEndX = textBoundaryX[segIndex + 1];

            const segWidth = segEndX - segStartX;
            if (segWidth < padding * 2 + 10) continue;

            const displayText = formatValueForDisplay(
                "convertedValueAt" in signal.values
                    ? signal.values.convertedValueAt(seg.startBufferIndex)
                    : seg.value,
                metadata.display
            );

            if (displayText === "null") continue;

            const textX = Math.max(padding, segStartX + padding);
            const availableWidth = Math.max(0, segEndX - textX - padding);

            if (availableWidth <= 0) continue;

            drawTruncatedText(utils, displayText, textX, y, availableWidth, ellipsisWidth, bounds);
        }
    }

    private computeTextBoundaries(
        segments: ExpandedSegment[],
        signal: Signal,
        pxPerSecond: number,
        offset: number,
        progress: number
    ): number[] {
        const textBoundaryX: number[] = [];

        for (const seg of segments) {
            const startTime = signal.time.valueAt(seg.startBufferIndex);
            const topX = startTime * pxPerSecond - offset;
            textBoundaryX.push(topX + (seg.renderStartX - topX) * progress);
        }

        const lastSeg = segments[segments.length - 1];
        const lastEndTime = signal.time.valueAt(lastSeg.endBufferIndex);
        const lastTopX = lastEndTime * pxPerSecond - offset;
        textBoundaryX.push(lastTopX + (lastSeg.renderEndX - lastTopX) * progress);

        return textBoundaryX;
    }
}
