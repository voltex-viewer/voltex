import { type PluginContext, RenderMode, type WithDefaults, type SignalMetadata, DEFAULT_VALUE, Row } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';

const signalPropertyRuleSchema = t.partial({
    color: t.string,
    renderMode: t.union([
        t.literal(RenderMode.Lines),
        t.literal(RenderMode.Discrete),
        t.literal(RenderMode.Dots),
        t.literal(RenderMode.Enum),
        t.literal(RenderMode.ExpandedEnum),
    ]),
    display: t.union([t.literal('decimal'), t.literal('hex')]),
});

const signalPropertyConfigSchema = t.type({
    rules: t.array(t.type({
        pattern: t.string,
        useRegex: t.boolean,
        properties: signalPropertyRuleSchema,
    })),
});

type SignalPropertyConfig = t.TypeOf<typeof signalPropertyConfigSchema>;

const defaultConfig: SignalPropertyConfig = {
    rules: [],
};

export default (context: PluginContext): void => {
    const config = context.loadConfig(signalPropertyConfigSchema, defaultConfig);

    const applyRules = (rows: Row[]) => {
        for (const row of rows) {
            for (const signal of row.signals) {
                const signalName = signal.source.name.join('.');

                const metadata: WithDefaults<SignalMetadata> = {
                    color: DEFAULT_VALUE,
                    renderMode: DEFAULT_VALUE,
                    display: DEFAULT_VALUE,
                };

                for (const rule of config.rules) {
                    let matches = false;

                    if (rule.useRegex) {
                        try {
                            const regex = new RegExp(rule.pattern, 'i');
                            matches = regex.test(signalName);
                        } catch (e) {
                            console.error(`Invalid regex pattern: ${rule.pattern}`, e);
                            continue;
                        }
                    } else {
                        matches = signalName.toLowerCase().includes(rule.pattern.toLowerCase());
                    }

                    if (matches) {
                        if (rule.properties.color !== undefined) {
                            metadata.color = rule.properties.color;
                        }
                        if (rule.properties.renderMode !== undefined) {
                            metadata.renderMode = rule.properties.renderMode;
                        }
                        if (rule.properties.display !== undefined) {
                            metadata.display = rule.properties.display;
                        }
                    }
                }
                
                context.signalMetadata.set(signal, metadata);
            }
        }
    };

    context.onRowsChanged((event) => {
        applyRules(event.added);
    });

    context.onConfigChanged((pluginName, _newConfig) => {
        if (pluginName === '@voltex-viewer/signal-properties-plugin') {
            applyRules(context.getRows());
        }
    });
};
