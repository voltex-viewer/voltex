/* eslint-disable @typescript-eslint/no-explicit-any */
// This file extensively uses io-ts runtime type introspection which requires accessing
// internal properties (_tag, props, types, etc.) that aren't exposed in TypeScript types.
import * as t from 'io-ts';
import { PluginConfigSchema } from '../../pluginConfigManager';

export interface ConfigUIOptions {
    onUpdate: (newConfig: unknown) => void;
    onReset?: () => void;
}

export class ConfigUIGenerator {
    static updateConfigUI(container: HTMLElement, configSchema: PluginConfigSchema): void {
        const form = container.querySelector('.config-ui-form');
        if (!form) return;

        this.updateFormFields(form as HTMLElement, configSchema.schema, configSchema.config, '');
    }

    private static updateFormFields(container: HTMLElement, schema: t.Type<any>, values: any, path: string): void {
        if ((schema as any)._tag === 'InterfaceType') {
            const props = (schema as any).props;
            for (const [key, propSchema] of Object.entries(props)) {
                const fieldPath = path ? `${path}.${key}` : key;
                const fieldValue = values[key];
                this.updateFormField(container, key, propSchema as t.Type<any>, fieldValue, fieldPath);
            }
        }
    }

    private static updateFormField(container: HTMLElement, key: string, schema: t.Type<any>, value: any, _path: string): void {
        if ((schema as any)._tag === 'DictionaryType' || 
            (schema as any)._tag === 'RecordType' ||
            (schema as any)._tag === 'InterfaceType') {
            return;
        }

        const fieldElements = container.querySelectorAll('.config-ui-field');
        for (const fieldElement of Array.from(fieldElements)) {
            const label = fieldElement.querySelector('.config-ui-label');
            if (label?.textContent === this.formatFieldName(key)) {
                const input = fieldElement.querySelector('.config-ui-input') as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
                if (input && document.activeElement !== input) {
                    this.updateInputValue(input, schema, value);
                }
                break;
            }
        }
    }

    private static updateInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLButtonElement, schema: t.Type<any>, value: any): void {
        const schemaName = schema.name;

        if (schemaName === 'number' && input instanceof HTMLInputElement) {
            if (input.value !== value?.toString()) {
                input.value = value?.toString() || '0';
            }
        } else if (schemaName === 'boolean' && input instanceof HTMLInputElement) {
            if (input.checked !== value) {
                input.checked = value || false;
            }
        } else if ((schemaName === 'Keybinding' || 
                   ((schema as any)._tag === 'RefinementType' && (schema as any).name === 'Keybinding')) &&
                   input instanceof HTMLButtonElement) {
            const displayValue = value || 'not set';
            if (input.textContent !== displayValue) {
                input.textContent = displayValue;
            }
        } else if (input instanceof HTMLInputElement && input.type === 'text') {
            if (input.value !== (value || '')) {
                input.value = value || '';
            }
        } else if (input instanceof HTMLSelectElement) {
            if (input.value !== value) {
                input.value = value;
            }
        }
    }

    static generateConfigUI(configSchema: PluginConfigSchema, options: ConfigUIOptions): HTMLElement {
        const container = document.createElement('div');
        
        // Add comprehensive CSS styles
        container.innerHTML = `
            <style>
                .config-ui-root {
                    color: #e5e7eb;
                }
                .config-ui-form {
                    display: flex;
                    flex-direction: column;
                }
                .config-ui-form * {
                    box-sizing: border-box;
                }
                .config-ui-field {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 6px 0;
                    gap: 8px;
                }
                .config-ui-field-with-clear {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    min-width: 0;
                }
                .config-ui-clear-button {
                    padding: 4px 6px;
                    background: transparent;
                    color: #6b7280;
                    border: none;
                    cursor: pointer;
                    font-size: 12px;
                    transition: color 0.15s;
                    min-width: auto;
                    flex-shrink: 0;
                    line-height: 1;
                }
                .config-ui-clear-button.hidden {
                    visibility: hidden;
                    pointer-events: none;
                }
                .config-ui-clear-button:hover {
                    color: #ef4444;
                }
                .config-ui-label {
                    font-size: 12px;
                    font-weight: 400;
                    color: #d1d5db;
                    min-width: 0;
                    flex-shrink: 0;
                    width: 120px;
                }
                .config-ui-input {
                    padding: 4px 8px;
                    background: #253345;
                    border: 1px solid #374151;
                    border-radius: 2px;
                    color: #e5e7eb;
                    font-size: 12px;
                    min-width: 0;
                    flex: 1;
                }
                .config-ui-input:hover {
                    background: #2a3a4f;
                    border-color: #4b5563;
                }
                .config-ui-input:focus {
                    outline: 1px solid #3b82f6;
                    outline-offset: -1px;
                    background: #253345;
                    border-color: #3b82f6;
                }
                .config-ui-input[type="button"] {
                    text-align: left;
                    transition: background-color 0.15s;
                    cursor: pointer;
                }
                .config-ui-input[type="button"]:hover {
                    background: #2a3a4f;
                }
                .config-ui-input[type="button"]:focus {
                    outline: 1px solid #3b82f6;
                    outline-offset: -1px;
                }
                .config-ui-input[type="number"] {
                    min-width: 80px;
                    text-align: left;
                }
                .config-ui-input select {
                    text-align: left;
                }
                .config-ui-checkbox {
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                    margin: 0;
                    accent-color: #3b82f6;
                    flex-shrink: 0;
                }
                .action-button {
                    width: 100%;
                    padding: 8px 12px;
                    background: #374151;
                    color: #e5e7eb;
                    border: 1px solid #4b5563;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    margin-top: 12px;
                    transition: all 0.2s;
                }
                .action-button:hover {
                    background: #4b5563;
                    border-color: #6b7280;
                }
                .config-ui-record-container {
                    margin-bottom: 8px;
                }
                .config-ui-record-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 6px 0;
                    cursor: pointer;
                    user-select: none;
                }
                .config-ui-record-header-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: #cccccc;
                }
                .config-ui-record-header-icon {
                    transition: transform 0.15s;
                    color: #858585;
                    font-size: 10px;
                }
                .config-ui-record-content {
                    padding: 0 0 8px 16px;
                }
                .config-ui-array-container {
                    margin-bottom: 8px;
                }
                .config-ui-array-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #374151;
                }
                .config-ui-array-header-left {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex: 1;
                }
                .config-ui-array-header-title {
                    font-size: 13px;
                    font-weight: 500;
                    color: #d1d5db;
                    cursor: pointer;
                    user-select: none;
                }
                .config-ui-array-header-icon {
                    transition: transform 0.2s;
                    color: #9ca3af;
                    cursor: pointer;
                }
                .config-ui-array-add-button {
                    padding: 4px 12px;
                    background: #374151;
                    color: #e5e7eb;
                    border: 1px solid #4b5563;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                }
                .config-ui-array-add-button:hover {
                    background: #4b5563;
                    border-color: #6b7280;
                }
                .config-ui-array-content {
                    padding: 0;
                }
                .config-ui-array-item {
                    border: 1px solid #374151;
                    border-radius: 2px;
                    padding: 8px;
                    margin: 4px 0;
                    background: #111827;
                }
                .config-ui-array-item-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    padding-bottom: 6px;
                    border-bottom: 1px solid #374151;
                }
                .config-ui-array-item-title {
                    font-size: 11px;
                    color: #858585;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .config-ui-array-item-controls {
                    display: flex;
                    gap: 4px;
                }
                .config-ui-array-item-button {
                    padding: 2px 6px;
                    background: transparent;
                    color: #858585;
                    border: none;
                    cursor: pointer;
                    font-size: 11px;
                    transition: color 0.15s;
                }
                .config-ui-array-item-button:hover {
                    color: #cccccc;
                }
                .config-ui-array-item-button.delete:hover {
                    color: #ef4444;
                }
                .config-ui-array-item-fields {
                    display: flex;
                    flex-direction: column;
                }
            </style>
        `;
        container.className = 'config-ui-root';

        const form = document.createElement('form');
        form.className = 'config-ui-form';

        // Store current values - deep copy to avoid mutating the original config
        const currentValues = JSON.parse(JSON.stringify(configSchema.config));

        // Generate form fields based on schema
        this.generateFormFields(configSchema.schema, currentValues, currentValues, form, '', options);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
        });

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.textContent = 'Reset';
        resetButton.className = 'action-button';
        if (options.onReset) {
            resetButton.addEventListener('click', options.onReset);
        }
        form.appendChild(resetButton);
        container.appendChild(form);

        return container;
    }

    private static generateFormFields(schema: t.Type<any>, values: any, rootValues: any, container: HTMLElement, path: string, options: ConfigUIOptions): void {
        // Handle different io-ts types
        if ((schema as any)._tag === 'InterfaceType') {
            // Handle object/interface types
            const props = (schema as any).props;
            for (const [key, propSchema] of Object.entries(props)) {
                const fieldPath = path ? `${path}.${key}` : key;
                const fieldValue = values[key];
                this.generateFormField(key, propSchema as t.Type<any>, fieldValue, values, rootValues, container, fieldPath, options);
            }
        } else {
            // Handle primitive types at root level
            this.generateFormField('value', schema, values, values, rootValues, container, path, options);
        }
    }

    private static generateFormField(
        key: string, 
        schema: t.Type<any>,
        value: any,
        parentValues: any,
        rootValues: any,
        container: HTMLElement, 
        path: string,
        options: ConfigUIOptions
    ): void {
        // Check if this is an array type
        if ((schema as any)._tag === 'ArrayType') {
            this.generateArraySection(key, schema, value, parentValues, rootValues, container, path, options);
            return;
        }

        // Check if this is a dictionary/record type (for dynamic keys)
        if ((schema as any)._tag === 'DictionaryType' || 
            (schema as any)._tag === 'RecordType') {
            this.generateCollapsibleSection(key, schema, value, parentValues, rootValues, container, path, options, true);
            return;
        }

        // Check if this is a partial type (unwrap and treat as interface)
        if ((schema as any)._tag === 'PartialType') {
            this.generateCollapsibleSection(key, schema, value, parentValues, rootValues, container, path, options, false);
            return;
        }

        // Check if this is a nested interface type
        if ((schema as any)._tag === 'InterfaceType') {
            this.generateCollapsibleSection(key, schema, value, parentValues, rootValues, container, path, options, false);
            return;
        }

        // Generate a simple field for primitive types
        this.generateSimpleField(key, schema, value, parentValues, rootValues, container, path, options, false);
    }

    private static generateSimpleField(
        key: string,
        schema: t.Type<any>,
        value: any,
        parentValues: any,
        rootValues: any,
        container: HTMLElement,
        path: string,
        options: ConfigUIOptions,
        allowClear: boolean = false
    ): void {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'config-ui-field';

        const label = document.createElement('label');
        label.textContent = this.formatFieldName(key);
        label.className = 'config-ui-label';
        fieldContainer.appendChild(label);

        if (allowClear) {
            const inputContainer = document.createElement('div');
            inputContainer.className = 'config-ui-field-with-clear';

            const input = this.createInputForType(schema, value);
            input.className = 'config-ui-input';

            const clearButton = document.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'config-ui-clear-button';
            if (value === undefined) {
                clearButton.classList.add('hidden');
            }
            clearButton.textContent = '✕';
            clearButton.title = 'Clear field';

            const updateValue = () => {
                const newValue = this.getInputValue(input, schema);
                parentValues[key] = newValue;
                clearButton.classList.remove('hidden');
                options.onUpdate(rootValues);
            };

            input.addEventListener('change', updateValue);
            input.addEventListener('input', () => {
                if (input instanceof HTMLInputElement && (input.type === 'text' || input.type === 'number')) {
                    updateValue();
                }
            });

            clearButton.addEventListener('click', () => {
                delete parentValues[key];
                clearButton.classList.add('hidden');
                if (input instanceof HTMLInputElement) {
                    if (input.type === 'checkbox') {
                        input.checked = false;
                    } else {
                        input.value = '';
                    }
                } else if (input instanceof HTMLSelectElement) {
                    input.value = '';
                } else if (input instanceof HTMLButtonElement) {
                    input.textContent = 'not set';
                }
                options.onUpdate(rootValues);
            });

            inputContainer.appendChild(input);
            inputContainer.appendChild(clearButton);
            fieldContainer.appendChild(inputContainer);
        } else {
            const input = this.createInputForType(schema, value);
            input.className = 'config-ui-input';

            input.addEventListener('change', () => {
                const newValue = this.getInputValue(input, schema);
                parentValues[key] = newValue;
                options.onUpdate(rootValues);
            });

            input.addEventListener('input', () => {
                const newValue = this.getInputValue(input, schema);
                parentValues[key] = newValue;
                if (input instanceof HTMLInputElement && (input.type === 'text' || input.type === 'number')) {
                    options.onUpdate(rootValues);
                }
            });

            fieldContainer.appendChild(input);
        }

        container.appendChild(fieldContainer);
    }

    private static generateArraySection(
        key: string,
        schema: t.Type<any>,
        value: any,
        parentValues: any,
        rootValues: any,
        container: HTMLElement,
        path: string,
        options: ConfigUIOptions
    ): void {
        const arrayContainer = document.createElement('div');
        arrayContainer.className = 'config-ui-array-container';

        // Create array header with collapse toggle and add button
        const header = document.createElement('div');
        header.className = 'config-ui-array-header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'config-ui-array-header-left';

        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = '▼';
        collapseIcon.className = 'config-ui-array-header-icon';

        const headerTitle = document.createElement('span');
        headerTitle.textContent = this.formatFieldName(key);
        headerTitle.className = 'config-ui-array-header-title';

        headerLeft.appendChild(collapseIcon);
        headerLeft.appendChild(headerTitle);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.textContent = '+ Add';
        addButton.className = 'config-ui-array-add-button';

        header.appendChild(headerLeft);
        header.appendChild(addButton);

        // Create content area
        const content = document.createElement('div');
        content.className = 'config-ui-array-content';

        const currentArray = Array.isArray(value) ? value : [];
        
        if (!parentValues[key]) {
            parentValues[key] = currentArray;
        }

        const itemSchema = (schema as any).type;

        // Function to render all array items
        const renderArrayItems = () => {
            content.innerHTML = '';
            const arr = parentValues[key];
            arr.forEach((item: any, index: number) => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'config-ui-array-item';

                // Item header with index and controls
                const itemHeader = document.createElement('div');
                itemHeader.className = 'config-ui-array-item-header';

                const itemTitle = document.createElement('div');
                itemTitle.className = 'config-ui-array-item-title';
                itemTitle.textContent = `Item ${index + 1}`;

                const itemControls = document.createElement('div');
                itemControls.className = 'config-ui-array-item-controls';

                // Move up button
                if (index > 0) {
                    const moveUpButton = document.createElement('button');
                    moveUpButton.type = 'button';
                    moveUpButton.textContent = '↑';
                    moveUpButton.className = 'config-ui-array-item-button';
                    moveUpButton.addEventListener('click', () => {
                        const temp = arr[index];
                        arr[index] = arr[index - 1];
                        arr[index - 1] = temp;
                        renderArrayItems();
                        options.onUpdate(rootValues);
                    });
                    itemControls.appendChild(moveUpButton);
                }

                // Move down button
                if (index < arr.length - 1) {
                    const moveDownButton = document.createElement('button');
                    moveDownButton.type = 'button';
                    moveDownButton.textContent = '↓';
                    moveDownButton.className = 'config-ui-array-item-button';
                    moveDownButton.addEventListener('click', () => {
                        const temp = arr[index];
                        arr[index] = arr[index + 1];
                        arr[index + 1] = temp;
                        renderArrayItems();
                        options.onUpdate(rootValues);
                    });
                    itemControls.appendChild(moveDownButton);
                }

                // Delete button
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.textContent = '✕';
                deleteButton.className = 'config-ui-array-item-button delete';
                deleteButton.addEventListener('click', () => {
                    arr.splice(index, 1);
                    renderArrayItems();
                    options.onUpdate(rootValues);
                });
                itemControls.appendChild(deleteButton);

                itemHeader.appendChild(itemTitle);
                itemHeader.appendChild(itemControls);
                itemContainer.appendChild(itemHeader);

                // Item fields
                const itemFields = document.createElement('div');
                itemFields.className = 'config-ui-array-item-fields';

                // Generate fields for the item
                if ((itemSchema as any)._tag === 'InterfaceType') {
                    const props = (itemSchema as any).props;
                    Object.entries(props).forEach(([propKey, propSchema]) => {
                        this.generateFormField(
                            propKey,
                            propSchema as t.Type<any>,
                            item[propKey],
                            item,
                            rootValues,
                            itemFields,
                            `${path}.${index}.${propKey}`,
                            options
                        );
                    });
                } else if ((itemSchema as any)._tag === 'PartialType') {
                    const props = (itemSchema as any).props;
                    Object.entries(props).forEach(([propKey, propSchema]) => {
                        this.generateSimpleField(
                            propKey,
                            propSchema as t.Type<any>,
                            item[propKey],
                            item,
                            rootValues,
                            itemFields,
                            `${path}.${index}.${propKey}`,
                            options,
                            true
                        );
                    });
                } else {
                    // Handle primitive array items
                    this.generateSimpleField(
                        `value`,
                        itemSchema,
                        item,
                        arr,
                        rootValues,
                        itemFields,
                        `${path}.${index}`,
                        {
                            ...options,
                            onUpdate: (_newConfig) => {
                                arr[index] = arr['value'];
                                delete arr['value'];
                                options.onUpdate(rootValues);
                            }
                        }
                    );
                }

                itemContainer.appendChild(itemFields);
                content.appendChild(itemContainer);
            });
        };

        renderArrayItems();

        // Add button functionality
        addButton.addEventListener('click', () => {
            const arr = parentValues[key];
            // Create a default item based on schema
            let newItem: any;
            if ((itemSchema as any)._tag === 'InterfaceType') {
                newItem = {};
                const props = (itemSchema as any).props;
                Object.entries(props).forEach(([propKey, propSchema]) => {
                    newItem[propKey] = this.getDefaultValueForSchema(propSchema as t.Type<any>);
                });
            } else {
                newItem = this.getDefaultValueForSchema(itemSchema);
            }
            arr.push(newItem);
            renderArrayItems();
            options.onUpdate(rootValues);
        });

        // Toggle collapse functionality
        let isCollapsed = false;
        const toggleCollapse = () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        };
        collapseIcon.addEventListener('click', toggleCollapse);
        headerTitle.addEventListener('click', toggleCollapse);

        arrayContainer.appendChild(header);
        arrayContainer.appendChild(content);
        container.appendChild(arrayContainer);
    }

    private static getDefaultValueForSchema(schema: t.Type<any>): any {
        const schemaName = schema.name;
        const schemaTag = (schema as any)._tag;

        if (schemaName === 'string' || schemaName === 'Keybinding') {
            return '';
        } else if (schemaName === 'number') {
            return 0;
        } else if (schemaName === 'boolean') {
            return false;
        } else if (schemaTag === 'ArrayType') {
            return [];
        } else if (schemaTag === 'InterfaceType') {
            const obj: any = {};
            const props = (schema as any).props;
            Object.entries(props).forEach(([key, propSchema]) => {
                obj[key] = this.getDefaultValueForSchema(propSchema as t.Type<any>);
            });
            return obj;
        } else if (schemaTag === 'UnionType') {
            // For union types, try to get the first literal value
            const types = (schema as any).types;
            for (const type of types) {
                if ((type as any)._tag === 'LiteralType') {
                    return (type as any).value;
                }
            }
            return '';
        } else if (schemaTag === 'PartialType') {
            // For partial types, return an empty object
            return {};
        } else {
            return null;
        }
    }

    private static generateCollapsibleSection(
        key: string,
        schema: t.Type<any>,
        value: any,
        parentValues: any,
        rootValues: any,
        container: HTMLElement,
        path: string,
        options: ConfigUIOptions,
        isDictionary: boolean
    ): void {
        const sectionContainer = document.createElement('div');
        sectionContainer.className = 'config-ui-record-container';

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

        const currentValue = value || {};
        
        if (!parentValues[key]) {
            parentValues[key] = currentValue;
        }

        if (isDictionary) {
            // Generate fields for each entry in the dictionary
            Object.entries(currentValue).forEach(([entryKey, entryValue]) => {
                const entrySchema = (schema as any).codomain || t.string;
                this.generateFormField(entryKey, entrySchema, entryValue, currentValue, rootValues, content, `${path}.${entryKey}`, options);
            });
        } else {
            // Generate fields for each property in the interface or partial
            const props = (schema as any).props;
            const isPartial = (schema as any)._tag === 'PartialType';
            
            Object.entries(props).forEach(([propKey, propSchema]) => {
                const propValue = currentValue[propKey];
                this.generateSimpleField(propKey, propSchema as t.Type<any>, propValue, currentValue, rootValues, content, `${path}.${propKey}`, options, isPartial);
            });
        }

        // Toggle collapse functionality
        let isCollapsed = false;
        header.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        });

        sectionContainer.appendChild(header);
        sectionContainer.appendChild(content);
        container.appendChild(sectionContainer);
    }

    private static formatFieldName(name: string): string {
        // Handle command IDs like "voltex.select-all-rows"
        if (name.includes('.') && name.includes('-')) {
            const withoutPrefix = name.replace(/^[^.]+\./, '');
            return withoutPrefix
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        
        // Handle camelCase
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
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

    private static createInputForType(schema: t.Type<any>, currentValue: any): HTMLInputElement | HTMLSelectElement | HTMLButtonElement {
        const schemaName = schema.name;

        // Check if this is a branded Keybinding type
        if (schemaName === 'Keybinding' || 
            ((schema as any)._tag === 'RefinementType' && (schema as any).name === 'Keybinding')) {
            // Create a button for keybinding capture
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = currentValue || 'not set';
            button.style.fontFamily = "'Consolas', 'Monaco', monospace";
            button.style.fontSize = '11px';
            button.style.textAlign = 'left';
            button.style.cursor = 'pointer';
            
            // Make button record keybindings
            let isRecording = false;
            button.addEventListener('click', () => {
                if (!isRecording) {
                    button.textContent = 'Press keys...';
                    button.focus();
                    isRecording = true;
                }
            });
            
            button.addEventListener('keydown', (e) => {
                if (isRecording) {
                    e.preventDefault();
                    
                    // Don't set binding if only modifier keys are pressed
                    const isModifierKey = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
                    if (isModifierKey) {
                        return; // Wait for a non-modifier key
                    }
                    
                    const keybinding = this.buildKeybindingString(e);
                    button.textContent = keybinding;
                    button.blur();
                    isRecording = false;
                    // Note: The change event will be triggered by the input event listener
                    button.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            
            button.addEventListener('blur', () => {
                if (isRecording) {
                    isRecording = false;
                    // Restore previous value if no new binding was set
                    if (button.textContent === '' || button.textContent === 'Press keys...') {
                        button.textContent = currentValue || 'not set';
                    }
                }
            });
            
            return button;
        } else if (schemaName === 'string') {
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

    private static getInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLButtonElement, schema: t.Type<any>): any {
        const schemaName = schema.name;

        if (schemaName === 'number') {
            return parseFloat((input as HTMLInputElement).value) || 0;
        } else if (schemaName === 'boolean') {
            return (input as HTMLInputElement).checked;
        } else if ((schemaName === 'Keybinding' || 
                   ((schema as any)._tag === 'RefinementType' && (schema as any).name === 'Keybinding')) &&
                   input instanceof HTMLButtonElement) {
            return input.textContent === 'not set' ? '' : input.textContent;
        } else if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
            return input.value;
        } else {
            return '';
        }
    }

}

