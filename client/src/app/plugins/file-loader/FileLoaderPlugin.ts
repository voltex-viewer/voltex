import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { PluginContext, SignalSource } from '../../Plugin';
import { InMemorySignal } from '../../Signal';
import { TraceReaderClient } from '../../../generated/tracereader.client';

export default (context: PluginContext): void => {
    // Only set up file loading in Electron environment
    if (context.getEnvironment() === 'electron' && (window as any).waveformApi) {
        (window as any).waveformApi.onOpenWaveformFile(async (filePath: string) => {
            const transport = new GrpcWebFetchTransport({ baseUrl: "http://localhost:50051" });
            const client = new TraceReaderClient(transport);
            try {
                const loadResp = await client.loadWaveformFile({ path: filePath });
                if (loadResp.response.error) {
                    alert('File Open Error: ' + (loadResp.response.error || 'Unknown error'));
                    return;
                }
                context.signalSources.add(...loadResp.response.channels.map(ch => {
                    const source: SignalSource = {
                        name: [
                            filePath.split('/').pop() || filePath,
                            ch.name
                        ],
                        discrete: false,
                        signal: () => new InMemorySignal(source, ch.data.map(d => [d.t, d.v]))
                    };
                    return source;
                }));
            } catch (err: any) {
                alert('gRPC Error: ' + (err?.message || String(err)));
            }
        });
    }
}
