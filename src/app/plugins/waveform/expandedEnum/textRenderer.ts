import { formatValueForDisplay, type RenderContext, type RenderBounds, type Signal, type SignalMetadata } from '@voltex-viewer/plugin-api';
import type { ExpandedSegment } from './layout';
import { topHeightRatio, trapezoidHeightRatio } from './animation';

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

            let displayText = formatValueForDisplay(
                "convertedValueAt" in signal.values
                    ? signal.values.convertedValueAt(seg.startBufferIndex)
                    : seg.value,
                metadata.display
            );

            if (displayText === "null") continue;

            const textX = Math.max(padding, segStartX + padding);
            const availableWidth = Math.max(0, segEndX - textX - padding);

            if (availableWidth <= 0) continue;

            const textMetrics = utils.measureText(displayText);
            const textWidth = textMetrics.renderWidth;

            if (textWidth > availableWidth) {
                const availableForText = availableWidth - ellipsisWidth;
                if (availableForText <= 0) continue;

                const avgCharWidth = textWidth / displayText.length;
                const estimatedLength = Math.floor(availableForText / avgCharWidth);

                let left = Math.max(1, estimatedLength - 5);
                let right = Math.min(displayText.length - 1, estimatedLength + 5);
                let bestLength = 0;

                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const truncatedWidth = utils.measureText(displayText.substring(0, mid)).renderWidth;
                    if (truncatedWidth <= availableForText) {
                        bestLength = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }

                if (bestLength === 0) continue;
                displayText = displayText.substring(0, bestLength) + '...';
            }

            utils.drawText(
                displayText,
                textX,
                y,
                { width: bounds.width, height: bounds.height },
                {
                    fillStyle: '#ffffff',
                    strokeStyle: '#000000',
                    strokeWidth: 2
                }
            );
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
        let accumulatedX = segments[0].expandedStartX;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const startTime = signal.time.valueAt(seg.startBufferIndex);
            const currentTopX = startTime * pxPerSecond - offset;
            let expandedX = accumulatedX;
            if (i === 0 && expandedX > currentTopX) {
                expandedX = currentTopX;
            }
            textBoundaryX.push(currentTopX + (expandedX - currentTopX) * progress);
            accumulatedX += seg.expandedWidth;
        }

        const lastSeg = segments[segments.length - 1];
        const lastEndTime = signal.time.valueAt(lastSeg.endBufferIndex);
        const lastCurrentTopEndX = lastEndTime * pxPerSecond - offset;
        let lastExpandedEndX = accumulatedX;
        if (lastExpandedEndX < lastCurrentTopEndX) {
            lastExpandedEndX = lastCurrentTopEndX;
        }
        textBoundaryX.push(lastCurrentTopEndX + (lastExpandedEndX - lastCurrentTopEndX) * progress);

        return textBoundaryX;
    }
}
