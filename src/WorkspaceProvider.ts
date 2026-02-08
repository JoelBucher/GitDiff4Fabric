import * as vscode from 'vscode';

export class WorkspaceProvider implements vscode.TreeDataProvider<WorkspaceItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WorkspaceItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkspaceItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkspaceItem): Promise<WorkspaceItem[]> {
        // We only have one level (Workspaces), so if element exists, return empty
        if (element) return [];

        try {
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: true }
            );

            const response = await fetch('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });

            if (!response.ok) throw new Error('Failed to fetch');

            const data: any = await response.json();
            
            return data.value.map((ws: any) => new WorkspaceItem(
                ws.name,
                ws.id,
                vscode.TreeItemCollapsibleState.None
            ));
        } catch (err) {
            vscode.window.showErrorMessage(`Fabric Workspace Error: ${err}`);
            return [];
        }
    }
}

export class WorkspaceItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly workspaceId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.description = '';
        this.tooltip = `Workspace: ${this.label}`;

        this.iconPath = new vscode.ThemeIcon('repo');
        
        // This 'contextValue' matches the 'when' clause in package.json
        this.contextValue = 'workspace';

        this.command = {
            command: 'pbiWorkspaces.selectWorkspace',
            title: 'Select Workspace',
            arguments: [this]
        };
    }
}