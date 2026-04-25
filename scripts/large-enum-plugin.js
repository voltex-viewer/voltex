export default async (context) => {
    function seededRandom(seed) {
        let state = seed;
        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    function createEnumSource(name, timeData, valueData, enumLabels) {
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
            name,
            signal: () => Promise.resolve({
                source,
                time: timeSeq,
                values: valueSeq,
                renderHint: 'enum',
            }),
        };

        return source;
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

    const sparseChangeSampleCount = timeData.length;
    const sparseChangeMiddleIndex = Math.floor(sparseChangeSampleCount / 2);
    const sparseChangeTimeData = timeData.slice();
    const sparseChangeValueData = new Float32Array(sparseChangeSampleCount);
    const sparseChangePlateauLength = 10_000_000;
    const sparseChangePlateauStart = sparseChangeMiddleIndex - sparseChangePlateauLength;
    const sparseChangePlateauEnd = sparseChangeMiddleIndex + sparseChangePlateauLength;
    const sparseChangeOuterValue = 2;
    const sparseChangeBaseValue = 0;
    const sparseChangeDifferentValue = 1;

    for (let i = 0; i < sparseChangeSampleCount; i++) {
        if (i === sparseChangeMiddleIndex) {
            sparseChangeValueData[i] = sparseChangeDifferentValue;
        } else if (i >= sparseChangePlateauStart && i < sparseChangePlateauEnd) {
            sparseChangeValueData[i] = sparseChangeBaseValue;
        } else {
            sparseChangeValueData[i] = sparseChangeOuterValue;
        }
    }

    const randomSource = createEnumSource(['Large Enum (25M)'], timeData, valueData, enumLabels);
    const sparseChangeSource = createEnumSource(
        ['Large Enum (25M, 10M Same, 1 Different, 10M Same)'],
        sparseChangeTimeData,
        sparseChangeValueData,
        enumLabels,
    );

    const sources = [randomSource, sparseChangeSource];

    context.rootRenderObject.addChild({
        render: () => true,
    });

    context.signalSources.add(sources);
    context.createRows(...await Promise.all(sources.map(async (source) => ({ channels: [await source.signal()] }))));
};
