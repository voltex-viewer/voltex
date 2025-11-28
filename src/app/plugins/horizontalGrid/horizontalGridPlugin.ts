import { PluginContext, RenderMode, Row } from '@voltex-viewer/plugin-api';
import { HorizontalGridRenderObject } from './horizontalGridRenderObject';
import { HorizontalGridLabelRenderObject } from './horizontalGridLabelRenderObject';

export interface GridLinePosition {
    value: number;
    y: number;
}

export function calculateGridLinePositions(
    row: Row,
    bounds: { height: number }
): GridLinePosition[] {
    if (!row || !row.signals || row.signals.length === 0) {
        return [];
    }
    
    // Calculate the value range for all signals in this row
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    for (const signal of row.signals) {
        minValue = Math.min(minValue, signal.values.min);
        maxValue = Math.max(maxValue, signal.values.max);
    }
    
    if (minValue === Infinity || maxValue === -Infinity || minValue === maxValue) {
        return [];
    }
    
    const valueRange = maxValue - minValue;
    const gridSpacing = getGridSpacing(valueRange, bounds.height);
    
    // Transform from signal value space to pixel space
    const yScale = row.yScale || 1.0;
    const yOffset = row.yOffset || 0.0;
    
    // Calculate grid line positions
    const startValue = Math.ceil(minValue / gridSpacing) * gridSpacing;
    const endValue = Math.floor(maxValue / gridSpacing) * gridSpacing;
    
    let positions: GridLinePosition[] = [];
    
    for (let value = startValue; value <= endValue; value += gridSpacing) {
        // Convert signal value to screen Y position
        // Match the shader transformation: (bounds.height / 2) - (value + yOffset) * yScale * bounds.height / 2
        const normalizedValue = (value + yOffset) * yScale;
        const y = (bounds.height / 2) - (normalizedValue * bounds.height / 2);
        
        // Only include if the line is within bounds
        if (y >= 0 && y <= bounds.height) {
            positions.push({ value, y });
        }
    }

    const actualSpacing = bounds.height / (positions.length - 1);
    if (actualSpacing < 30 && positions.length > 2) {
        // Remove all positions except the two outer
        positions = [positions[0], positions[positions.length - 1]];
    }
    
    return positions;
}

function getGridSpacing(valueRange: number, rowHeight: number): number {
    if (valueRange <= 0 || rowHeight <= 0) return 1;
    
    const minPixelSpacing = 40; // Minimum pixels between labels
    
    // Calculate how many grid lines we can fit
    const maxGridLines = Math.floor(rowHeight / minPixelSpacing);

    // Ensure we have at least 2 grid lines but not too many
    const targetGridCount = Math.max(2, Math.min(maxGridLines, 10));
    
    const rawSpacing = valueRange / targetGridCount;
    
    // Find the nearest "nice" number for grid spacing
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawSpacing)));
    const normalized = rawSpacing / magnitude;
    
    let niceSpacing: number;
    // Prefer round numbers more aggressively
    if (normalized <= 1.5) {
        niceSpacing = 1;
    } else if (normalized <= 3) {
        niceSpacing = 2;
    } else if (normalized <= 7) {
        niceSpacing = 5;
    } else {
        niceSpacing = 10;
    }
    
    return niceSpacing * magnitude;
}

export default (context: PluginContext): void => {
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            if (row.signals.length > 0) {
                // Create a closed-over function that knows about this specific row
                const calculateGridPositionsForRow = (bounds: { height: number }) => 
                    calculateGridLinePositions(row, bounds);
                const visible = () => row.signals.some(s => context.signalMetadata.get(s).renderMode != RenderMode.Enum);

                // Add grid lines with lower z-index
                new HorizontalGridRenderObject(row.mainArea, calculateGridPositionsForRow, visible);
                // Add labels with higher z-index to render on top
                new HorizontalGridLabelRenderObject(row.mainArea, calculateGridPositionsForRow, visible);
            }
        }
    });
}
