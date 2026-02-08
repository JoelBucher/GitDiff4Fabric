import * as vscode from 'vscode';

export class GitStatusProvider implements vscode.TreeDataProvider<GitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private activeWorkspaceId: string | undefined;

    refresh(workspaceId?: string): void {
        this.activeWorkspaceId = workspaceId;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitItem): vscode.TreeItem { return element; }

    async getChildren(): Promise<GitItem[]> {
        if (!this.activeWorkspaceId) return [];

        const session = await vscode.authentication.getSession('microsoft', 
            ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: false });
        
        if (!session) return [];

        try {
            const statusRes = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${this.activeWorkspaceId}/git/status`, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });

            if (statusRes.status === 404) return [new GitItem("Git not configured", "error")];

            const statusData: any = await statusRes.json();
            const changes = statusData.changes || [];

            if (changes.length === 0) return [new GitItem("Synced with Git", "check")];

            return changes.map((c: any) => {
                const meta = c.itemMetadata.itemIdentifier;
                return new GitItem(
                    `${meta.itemDisplayName} (${c.conflictType || 'Changed'})`,
                    'file-code',
                    meta.objectId
                );
            });
        } catch (err) {
            return [new GitItem("Failed to fetch status", "warning")];
        }
    }
}

class GitItem extends vscode.TreeItem {
    constructor(label: string, icon: string, public readonly objectId?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}