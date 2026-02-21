export function getGridSpacing(pxPerSecond: number): number {
    const targetPx = 2500;
    
    const candidates = [
        1e-18,
        1e-17,
        1e-16,
        1e-15,
        1e-14,
        1e-13,
        1e-12,
        1e-11,
        1e-10,
        1e-9,
        1e-8,
        1e-7,
        1e-6,
        1e-5,
        1e-4,
        1e-3,
        1e-2,
        1e-1,
        1,
        10, // 10 seconds
        60, // 1 minute
        600, // 10 minutes
        3600, // 1 hour
        43200, // 12 hours
        86400, // 1 day
        864000, // 10 days
        8640000, // 100 days
        31536000, // 1 year
        315360000, // 10 years
        3153600000 // 100 years
    ];
    
    return candidates.reduce((best, spacing) => {
        const px = spacing * pxPerSecond;
        
        return Math.abs(px - targetPx) < Math.abs(best * pxPerSecond - targetPx) ? spacing : best;
    }, candidates[0]);
}
