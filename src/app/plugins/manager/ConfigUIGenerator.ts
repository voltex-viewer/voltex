import * as t from 'io-ts';
import { PluginConfigSchema } from '../../PluginConfigManager';

export interface ConfigUIOptions {
    onUpdate: (newConfig: any) => void;
    onReset?: () => void;
}

export class ConfigUIGenerator {
    static generateConfigUI(configSchema: PluginConfigSchema, options: ConfigUIOptions): HTMLElement {
        const container = document.createElement('div');
        
        // Add comprehensive CSS styles
        container.innerHTML = `
            <style>
                .config-ui-root {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #e5e7eb;
                }
                .config-ui-form {
                    display: flex;
                    flex-direction: column;
                }
                .config-ui-field {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #374151;
                }
                .config-ui-label {
                    font-size: 13px;
                    font-weight: 500;
                    color: #d1d5db;
                    flex: 1;
                    text-align: left;
                }
                .config-ui-input {
                    padding: 6px 10px;
                    background: #374151;
                    border: 1px solid #6b7280;
                    border-radius: 4px;
                    color: #e5e7eb;
                    font-size: 13px;
                    min-width: 120px;
                    text-align: right;
                }
                .config-ui-input[type="button"] {
                    text-align: left;
                    transition: background-color 0.2s;
                }
                .config-ui-input[type="button"]:hover {
                    background: #4b5563;
                }
                .config-ui-input[type="button"]:focus {
                    outline: 2px solid #3b82f6;
                    outline-offset: -2px;
                }
                .config-ui-input[type="number"] {
                    min-width: 60px;
                    width: 60px;
                    text-align: left;
                }
                .config-ui-input select {
                    text-align: left;
                }
                .config-ui-checkbox {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }
                .config-ui-reset-btn {
                    width: 100%;
                    padding: 8px 16px;
                    background: #4b5563;
                    color: #e5e7eb;
                    border: 1px solid #6b7280;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    margin-top: 16px;
                    transition: background-color 0.2s;
                }
                .config-ui-reset-btn:hover {
                    background: #374151;
                }
                .config-ui-record-container {
                    margin-bottom: 8px;
                }
                .config-ui-record-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #374151;
                    cursor: pointer;
                    user-select: none;
                }
                .config-ui-record-header-title {
                    font-size: 13px;
                    font-weight: 500;
                    color: #d1d5db;
                    flex: 1;
                    text-align: left;
                }
                .config-ui-record-header-icon {
                    transition: transform 0.2s;
                    color: #9ca3af;
                }
                .config-ui-record-content {
                    padding: 0;
                }
            </style>
        `;
        container.className = 'config-ui-root';

        const form = document.createElement('form');
        form.className = 'config-ui-form';

        // Store current values
        const currentValues = { ...configSchema.config };

        // Generate form fields based on schema
        this.generateFormFields(configSchema.schema, currentValues, form, '', options);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
        });

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.textContent = 'Reset';
        resetButton.className = 'config-ui-reset-btn';
        resetButton.addEventListener('click', options.onReset);
        form.appendChild(resetButton);
        container.appendChild(form);

        return container;
    }

    private static generateFormFields(schema: t.Type<any>, values: any, container: HTMLElement, path: string, options: ConfigUIOptions): void {
        // Handle different io-ts types
        if ((schema as any)._tag === 'InterfaceType') {
            // Handle object/interface types
            const props = (schema as any).props;
            for (const [key, propSchema] of Object.entries(props)) {
                const fieldPath = path ? `${path}.${key}` : key;
                this.generateFormField(key, propSchema as t.Type<any>, values, container, fieldPath, options);
            }
        } else {
            // Handle primitive types at root level
            this.generateFormField('value', schema, values, container, path, options);
        }
    }

    private static generateFormField(
        key: string, 
        schema: t.Type<any>, 
        values: any, 
        container: HTMLElement, 
        path: string,
        options: ConfigUIOptions
    ): void {
        if ((schema as any)._tag === 'DictionaryType' || 
            (schema as any)._tag === 'RecordType') {
            this.generateRecordField(key, schema, values, container, path, options);
            return;
        }

        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'config-ui-field';

        const label = document.createElement('label');
        label.textContent = this.formatFieldName(key);
        label.className = 'config-ui-label';
        fieldContainer.appendChild(label);

        const input = this.createInputForType(schema, values[key]);
        input.className = 'config-ui-input';

        // Update values object when input changes
        input.addEventListener('change', () => {
            const newValue = this.getInputValue(input, schema);
            this.setNestedValue(values, path || key, newValue);
            // Trigger immediate update
            options.onUpdate(values);
        });

        input.addEventListener('input', () => {
            const newValue = this.getInputValue(input, schema);
            this.setNestedValue(values, path || key, newValue);
            // Trigger immediate update for text inputs
            if (input.type === 'text' || input.type === 'number') {
                options.onUpdate(values);
            }
        });

        fieldContainer.appendChild(input);
        container.appendChild(fieldContainer);
    }

    private static generateRecordField(
        key: string,
        schema: t.Type<any>,
        values: any,
        container: HTMLElement,
        path: string,
        options: ConfigUIOptions
    ): void {
        const recordContainer = document.createElement('div');
        recordContainer.className = 'config-ui-record-container';

        // Create collapsible header
        const header = document.createElement('div');
        header.className = 'config-ui-record-header';

        const headerTitle = document.createElement('span');
        headerTitle.textContent = this.formatFieldName(key);
        headerTitle.className = 'config-ui-record-header-title';

        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = '▼';
        collapseIcon.className = 'config-ui-record-header-icon';

        header.appendChild(headerTitle);
        header.appendChild(collapseIcon);

        // Create content area
        const content = document.createElement('div');
        content.className = 'config-ui-record-content';

        const currentRecord = values[key] || {};

        // Generate fields for each record entry
        Object.entries(currentRecord).forEach(([recordKey, recordValue]) => {
            this.generateKeybindingField(recordKey, recordValue as string | null, currentRecord, content, options, values, key);
        });

        // Toggle collapse functionality
        let isCollapsed = false;
        header.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        });

        recordContainer.appendChild(header);
        recordContainer.appendChild(content);
        container.appendChild(recordContainer);
    }

    private static generateKeybindingField(
        commandId: string,
        currentValue: string | null,
        recordValues: any,
        container: HTMLElement,
        options: ConfigUIOptions,
        allValues: any,
        recordKey: string
    ): void {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'config-ui-field';

        // Command label
        const label = document.createElement('span');
        label.textContent = this.formatCommandId(commandId);
        label.className = 'config-ui-label';
        fieldContainer.appendChild(label);

        // Keybinding input
        const input = document.createElement('button');
        input.type = 'button';
        input.textContent = currentValue || 'not set';
        input.className = 'config-ui-input';
        input.style.fontFamily = "'Courier New', monospace";
        input.style.fontSize = '11px';
        input.style.textAlign = 'left';
        input.style.cursor = 'pointer';

        // Make button record keybindings
        let isRecording = false;
        input.addEventListener('click', () => {
            if (!isRecording) {
                input.textContent = 'Press keys...';
                input.focus();
                isRecording = true;
            }
        });

        input.addEventListener('keydown', (e) => {
            if (isRecording) {
                e.preventDefault();
                
                // Don't set binding if only modifier keys are pressed
                const isModifierKey = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
                if (isModifierKey) {
                    return; // Wait for a non-modifier key
                }
                
                const keybinding = this.buildKeybindingString(e);
                input.textContent = keybinding;
                recordValues[commandId] = keybinding;
                options.onUpdate(allValues);
                input.blur();
                isRecording = false;
            }
        });

        input.addEventListener('blur', () => {
            if (isRecording) {
                isRecording = false;
                // If no new binding was set and button text is empty or 'Press keys...', clear the binding
                if (input.textContent === '' || input.textContent === 'Press keys...') {
                    recordValues[commandId] = null;
                    input.textContent = 'not set';
                    options.onUpdate(allValues);
                } else {
                    // Restore previous value if it exists
                    input.textContent = recordValues[commandId] || 'not set';
                }
            }
        });

        fieldContainer.appendChild(input);

        container.appendChild(fieldContainer);
    }

    private static buildKeybindingString(event: KeyboardEvent): string {
        const parts: string[] = [];
        if (event.ctrlKey) parts.push('ctrl');
        if (event.altKey) parts.push('alt');
        if (event.shiftKey) parts.push('shift');
        if (event.metaKey) parts.push('meta');
        parts.push(event.key.toLowerCase());
        return parts.join('+');
    }

    private static formatCommandId(commandId: string): string {
        // Convert "voltex.select-all-rows" to "Select All Rows"
        const withoutPrefix = commandId.replace(/^[^.]+\./, '');
        return withoutPrefix
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    private static createInputForType(schema: t.Type<any>, currentValue: any): HTMLInputElement | HTMLSelectElement {
        const schemaName = schema.name;

        if (schemaName === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentValue || 'not set';
            return input;
        } else if (schemaName === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = currentValue?.toString() || '0';
            return input;
        } else if (schemaName === 'boolean') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = currentValue || false;
            input.className = 'config-ui-checkbox';
            return input;
        } else if ((schema as any)._tag === 'UnionType') {
            // Handle union types (like enums)
            const select = document.createElement('select');
            const unionTypes = (schema as any).types;
            
            // Try to extract string literals from union
            for (const unionType of unionTypes) {
                if ((unionType as any)._tag === 'LiteralType') {
                    const option = document.createElement('option');
                    option.value = (unionType as any).value;
                    option.textContent = (unionType as any).value;
                    if ((unionType as any).value === currentValue) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
            }
            
            return select;
        } else {
            // Default to text input
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentValue?.toString() || '';
            return input;
        }
    }

    private static getInputValue(input: HTMLInputElement | HTMLSelectElement, schema: t.Type<any>): any {
        const schemaName = schema.name;

        if (schemaName === 'number') {
            return parseFloat((input as HTMLInputElement).value) || 0;
        } else if (schemaName === 'boolean') {
            return (input as HTMLInputElement).checked;
        } else {
            return input.value;
        }
    }

    private static setNestedValue(obj: any, path: string, value: any): void {
        const keys = path.split('.');
        let current = obj;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = value;
    }

    private static formatFieldName(name: string): string {
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
}
