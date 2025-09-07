import * as t from 'io-ts';
import { PluginConfigSchema } from '../../PluginConfigManager';

export interface ConfigUIOptions {
    onUpdate: (newConfig: any) => void;
    onReset?: () => void;
}

export class ConfigUIGenerator {
    static generateConfigUI(configSchema: PluginConfigSchema, options: ConfigUIOptions): HTMLElement {
        const container = document.createElement('div');
        
        // Apply different styling based on embedded option
        container.style.cssText = `
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #e5e7eb;
        `;

        const form = document.createElement('form');
        form.style.cssText = 'display: flex; flex-direction: column;';

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
        resetButton.style.cssText = `
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
        `;
        resetButton.addEventListener('mouseover', () => {
            resetButton.style.background = '#374151';
        });
        resetButton.addEventListener('mouseout', () => {
            resetButton.style.background = '#4b5563';
        });
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
        const fieldContainer = document.createElement('div');
        fieldContainer.style.cssText = `
            display: flex; 
            align-items: center; 
            justify-content: space-between; 
            padding: 8px 0;
            border-bottom: 1px solid #374151;
        `;

        const label = document.createElement('label');
        label.textContent = this.formatFieldName(key);
        label.style.cssText = `
            font-size: 13px;
            font-weight: 500;
            color: #d1d5db;
            flex: 1;
            text-align: left;
        `;
        fieldContainer.appendChild(label);

        const input = this.createInputForType(schema, values[key]);
        input.style.cssText = `
            padding: 6px 10px;
            background: #374151;
            border: 1px solid #6b7280;
            border-radius: 4px;
            color: #e5e7eb;
            font-size: 13px;
            min-width: 120px;
            text-align: right;
        `;

        // Override text alignment for select elements
        if (input.tagName === 'SELECT') {
            input.style.textAlign = 'left';
        }
        
        // Make number inputs smaller and left-aligned
        if (input.type === 'number') {
            input.style.minWidth = '60px';
            input.style.width = '60px';
            input.style.textAlign = 'left';
        }

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

    private static createInputForType(schema: t.Type<any>, currentValue: any): HTMLInputElement | HTMLSelectElement {
        const schemaName = schema.name;

        if (schemaName === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentValue || '';
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
            input.style.cssText = `
                width: 18px;
                height: 18px;
                cursor: pointer;
            `;
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
