import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface PolicyNode {
    type: 'category' | 'file' | 'rule';
    label: string;
    description?: string;
    tooltip?: string | vscode.MarkdownString;
    iconPath?: vscode.ThemeIcon;
    children?: PolicyNode[];
    filePath?: string;
    ruleName?: string;
    enabled?: boolean;
}

export class PolicyTreeProvider implements vscode.TreeDataProvider<PolicyNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<PolicyNode | undefined | void> = new vscode.EventEmitter<PolicyNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<PolicyNode | undefined | void> = this._onDidChangeTreeData.event;

    private nodes: PolicyNode[] = [];

    constructor(private harnessDir: string) {
        this.loadPolicies();
    }

    refresh(): void {
        this.loadPolicies();
        this._onDidChangeTreeData.fire();
    }

    private loadPolicies(): void {
        this.nodes = [];

        // Load policies
        const policiesDir = path.join(this.harnessDir, 'policies');
        if (fs.existsSync(policiesDir)) {
            const policyFiles = fs.readdirSync(policiesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            if (policyFiles.length > 0) {
                const policyNodes: PolicyNode[] = [];
                for (const file of policyFiles) {
                    const filePath = path.join(policiesDir, file);
                    const rules = this.parsePolicyFile(filePath);
                    policyNodes.push({
                        type: 'file',
                        label: file,
                        description: `${rules.length} rules`,
                        iconPath: new vscode.ThemeIcon('file-code'),
                        filePath,
                        children: rules
                    });
                }
                this.nodes.push({
                    type: 'category',
                    label: 'Policies',
                    description: `(${policyFiles.length})`,
                    iconPath: new vscode.ThemeIcon('shield'),
                    children: policyNodes
                });
            }
        }

        // Load semantic rules
        const semanticDir = path.join(this.harnessDir, 'semantic-rules');
        if (fs.existsSync(semanticDir)) {
            const semanticFiles = fs.readdirSync(semanticDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            if (semanticFiles.length > 0) {
                const semanticNodes: PolicyNode[] = [];
                for (const file of semanticFiles) {
                    const filePath = path.join(semanticDir, file);
                    const rules = this.parseSemanticFile(filePath);
                    semanticNodes.push({
                        type: 'file',
                        label: file,
                        description: `${rules.length} rules`,
                        iconPath: new vscode.ThemeIcon('file-code'),
                        filePath,
                        children: rules
                    });
                }
                this.nodes.push({
                    type: 'category',
                    label: 'Semantic Rules',
                    description: `(${semanticFiles.length})`,
                    iconPath: new vscode.ThemeIcon('symbol-rule'),
                    children: semanticNodes
                });
            }
        }
    }

    private parsePolicyFile(filePath: string): PolicyNode[] {
        const rules: PolicyNode[] = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            let currentRule: { name?: string; action?: string; enabled?: boolean } | null = null;
            
            for (const line of lines) {
                // Match rule name
                const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
                if (nameMatch) {
                    if (currentRule && currentRule.name) {
                        rules.push(this.createRuleNode(currentRule.name, currentRule.action, currentRule.enabled, filePath));
                    }
                    currentRule = { name: nameMatch[1].trim(), action: 'allow', enabled: true };
                }
                
                // Match action
                const actionMatch = line.match(/^\s*action:\s*(.+)$/);
                if (actionMatch && currentRule) {
                    currentRule.action = actionMatch[1].trim();
                }
                
                // Match enabled
                const enabledMatch = line.match(/^\s*enabled:\s*(.+)$/);
                if (enabledMatch && currentRule) {
                    currentRule.enabled = enabledMatch[1].trim().toLowerCase() !== 'false';
                }
            }
            
            // Add last rule
            if (currentRule && currentRule.name) {
                rules.push(this.createRuleNode(currentRule.name, currentRule.action, currentRule.enabled, filePath));
            }
        } catch (error) {
            console.error(`Failed to parse policy file ${filePath}:`, error);
        }
        
        return rules;
    }

    private parseSemanticFile(filePath: string): PolicyNode[] {
        const rules: PolicyNode[] = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            let currentRule: { name?: string; action?: string; enabled?: boolean } | null = null;
            
            for (const line of lines) {
                const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
                if (nameMatch) {
                    if (currentRule && currentRule.name) {
                        rules.push(this.createRuleNode(currentRule.name, currentRule.action, currentRule.enabled, filePath));
                    }
                    currentRule = { name: nameMatch[1].trim(), action: 'allow', enabled: true };
                }
                
                const actionMatch = line.match(/^\s*action:\s*(.+)$/);
                if (actionMatch && currentRule) {
                    currentRule.action = actionMatch[1].trim();
                }
                
                const enabledMatch = line.match(/^\s*enabled:\s*(.+)$/);
                if (enabledMatch && currentRule) {
                    currentRule.enabled = enabledMatch[1].trim().toLowerCase() !== 'false';
                }
            }
            
            if (currentRule && currentRule.name) {
                rules.push(this.createRuleNode(currentRule.name, currentRule.action, currentRule.enabled, filePath));
            }
        } catch (error) {
            console.error(`Failed to parse semantic file ${filePath}:`, error);
        }
        
        return rules;
    }

    private createRuleNode(name: string, action?: string, enabled?: boolean, filePath?: string): PolicyNode {
        const isEnabled = enabled !== false;
        const icon = isEnabled 
            ? (action === 'deny' ? 'error' : action === 'warn' ? 'warning' : 'check')
            : 'circle-slash';
        
        const color = isEnabled
            ? (action === 'deny' ? 'errorForeground' : action === 'warn' ? 'list.warningForeground' : 'testing.iconPassed')
            : 'disabledForeground';
        
        return {
            type: 'rule',
            label: name,
            description: action || 'allow',
            iconPath: new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)),
            tooltip: `${name}\nAction: ${action || 'allow'}\nEnabled: ${isEnabled}`,
            filePath,
            ruleName: name,
            enabled: isEnabled
        };
    }

    getTreeItem(element: PolicyNode): vscode.TreeItem {
        const collapsibleState = element.children && element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(element.label, collapsibleState);
        
        if (element.description) {
            item.description = element.description;
        }
        if (element.tooltip) {
            item.tooltip = element.tooltip;
        }
        if (element.iconPath) {
            item.iconPath = element.iconPath;
        }
        if (element.filePath) {
            item.command = {
                command: 'agentRuntime.openPolicyFile',
                title: 'Open Policy File',
                arguments: [element.filePath]
            };
        }

        return item;
    }

    getChildren(element?: PolicyNode): Thenable<PolicyNode[]> {
        if (!element) {
            return Promise.resolve(this.nodes);
        }
        return Promise.resolve(element.children || []);
    }

    async toggleRuleEnabled(filePath: string, ruleName: string): Promise<void> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            let inTargetRule = false;
            let enabledLineIndex = -1;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
                if (nameMatch && nameMatch[1].trim() === ruleName) {
                    inTargetRule = true;
                } else if (inTargetRule && line.match(/^\s*-\s*name:/)) {
                    break;
                }
                
                if (inTargetRule) {
                    const enabledMatch = line.match(/^(\s*enabled:\s*)(.+)$/);
                    if (enabledMatch) {
                        enabledLineIndex = i;
                        const currentValue = enabledMatch[2].trim().toLowerCase() !== 'false';
                        lines[i] = `${enabledMatch[1]}${!currentValue}`;
                        break;
                    }
                }
            }
            
            if (enabledLineIndex === -1 && inTargetRule) {
                // No enabled field found, add it after the name line
                for (let i = 0; i < lines.length; i++) {
                    const nameMatch = lines[i].match(/^\s*-\s*name:\s*(.+)$/);
                    if (nameMatch && nameMatch[1].trim() === ruleName) {
                        lines.splice(i + 1, 0, '    enabled: false');
                        break;
                    }
                }
            }
            
            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
            this.refresh();
            vscode.window.showInformationMessage(`Rule "${ruleName}" toggled`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to toggle rule: ${error}`);
        }
    }
}