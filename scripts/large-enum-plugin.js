export default async (context) => {
    function seededRandom(seed) {
        let state = seed;
        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    const transitionCount = 50000;
    const samplesPerValue = 500;
    const enumLabels = ['idle', 'running', 'waiting', 'blocked', 'ready', 'suspended', 'terminated', 'init'];
    
    const timeData = new Float64Array(transitionCount * samplesPerValue);
    const valueData = new Float32Array(transitionCount * samplesPerValue);
    
    const localRandom = seededRandom(12345);
    let currentTime = 0;
    let index = 0;
    
    for (let t = 0; t < transitionCount; t++) {
        const enumValue = Math.floor(localRandom() * enumLabels.length);
        const segmentDuration = 0.001 + localRandom() * 0.005;
        const sampleInterval = segmentDuration / samplesPerValue;
        
        for (let s = 0; s < samplesPerValue; s++) {
            timeData[index] = currentTime;
            valueData[index] = enumValue;
            index++;
            currentTime += sampleInterval;
        }
    }
    
    const timeSeq = {
        length: timeData.length,
        min: timeData[0],
        max: timeData[timeData.length - 1],
        valueAt: (i) => timeData[i],
    };
    
    const valueSeq = {
        length: valueData.length,
        min: 0,
        max: enumLabels.length - 1,
        valueAt: (i) => valueData[i],
        convertedValueAt: (i) => enumLabels[valueData[i]] ?? 'unknown',
    };
    
    const source = {
        name: ['Large Enum (25M)'],
        signal: () => Promise.resolve({
            source,
            time: timeSeq,
            values: valueSeq,
            renderHint: 'enum',
        }),
    };
    
    context.signalSources.add([source]);
    context.createRows({ channels: [await source.signal()] });
};
