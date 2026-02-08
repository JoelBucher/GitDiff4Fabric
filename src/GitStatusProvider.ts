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

    async getChildren(element?: GitItem): Promise<GitItem[]> {
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
            const workspaceHead = statusData["workspaceHead"];

            const items: GitItem[] = [];

            // 1. Add the Workspace HEAD info with a Git Branch icon
            if (workspaceHead) {
                items.push(new GitItem(
                    `HEAD: ${workspaceHead.substring(0, 7)}`, 
                    'git-branch', 
                    undefined, 
                    'header'
                ));
            }

            // 2. Add the "Checkout" Button as a clickable Tree Item
            const checkoutBtn = new GitItem(
                "Checkout Fabric Workspace HEAD", 
                "cloud-download", 
                undefined, 
                "button"
            );

            checkoutBtn.command = {
                command: 'git-diff-4-fabric.checkoutHead',
                title: 'Checkout HEAD',
                // Pass both the workspaceId AND the hash
                arguments: [this.activeWorkspaceId, workspaceHead] 
            };
            // Give it a color highlight if supported by the theme
            checkoutBtn.description = "Update local items";
            items.push(checkoutBtn);

            // Add a separator or label if there are changes
            if (changes.length > 0) {
                items.push(new GitItem("--- Pending Changes ---", "diff"));
                
                const changeItems = changes.map((c: any) => {
                    const meta = c.itemMetadata.itemIdentifier;
                    return new GitItem(
                        `${meta.itemDisplayName} (${c.conflictType || 'Changed'})`,
                        'file-code',
                        meta.objectId
                    );
                });
                items.push(...changeItems);
            } else {
                items.push(new GitItem("Synced with Git", "check"));
            }

            return items;
        } catch (err) {
            return [new GitItem("Failed to fetch status", "warning")];
        }
    }
}

class GitItem extends vscode.TreeItem {
    constructor(
        label: string, 
        icon: string, 
        public readonly objectId?: string,
        contextValue?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = contextValue; // Useful for styling or menus
    }
}