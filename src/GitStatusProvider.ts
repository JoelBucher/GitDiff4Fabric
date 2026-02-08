import * as vscode from 'vscode';

function changeToIcon(workspaceChange: string){
    switch(workspaceChange){
        case "Added":
            return "+"
        case "Modified":
            return "M"
        default:
            return "M"
    }
}

export class GitStatusProvider implements vscode.TreeDataProvider<GitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private activeWorkspaceId: string | undefined;
    private cachedChanges: any[] = []; // Store changes to show when folder expands

    refresh(workspaceId?: string): void {
        this.activeWorkspaceId = workspaceId;
        this.cachedChanges = []; // Reset cache
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitItem): vscode.TreeItem { return element; }

    async getChildren(element?: GitItem): Promise<GitItem[]> {
        if (!this.activeWorkspaceId) return [];

        // --- PHASE 2: Handle Nested Items ---
        // If 'element' exists and it's our 'changes-parent', return the sub-items
        if (element && element.contextValue === 'changes-parent') {
            return this.cachedChanges.map((c: any) => {
                const name = c.itemMetadata.displayName;
                const workspaceChange = c.itemMetadata.workspaceChange;
                const objectId = c.itemMetadata.itemIdentifier.objectId;
                console.log(c)

                return new GitItem(
                    `[${changeToIcon(workspaceChange)}] ${name}`,
                    'file-code',
                    objectId
                );
            });
        }

        // --- PHASE 1: Handle Root Items ---
        const session = await vscode.authentication.getSession('microsoft', 
            ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: false });
        
        if (!session) return [];

        try {
            const statusRes = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${this.activeWorkspaceId}/git/status`, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });

            if (statusRes.status === 404) return [new GitItem("Git not configured", "error")];

            const statusData: any = await statusRes.json();
            this.cachedChanges = statusData.changes || [];
            const workspaceHead = statusData["workspaceHead"];

            const items: GitItem[] = [];

            // 1. HEAD Info
            if (workspaceHead) {
                items.push(new GitItem(`HEAD: ${workspaceHead.substring(0, 7)}`, 'git-branch', undefined, 'header'));
            }

            // 2. Checkout Button
            const checkoutBtn = new GitItem("Checkout Fabric Workspace HEAD", "cloud-download", undefined, "button");
            checkoutBtn.command = {
                command: 'git-diff-4-fabric.checkoutHead',
                title: 'Checkout HEAD',
                arguments: [this.activeWorkspaceId, workspaceHead] 
            };
            items.push(checkoutBtn);

            // 3. Nested "Changes" Block
            if (this.cachedChanges.length > 0) {
                const changesFolder = new GitItem(
                    `Changes (${this.cachedChanges.length})`, 
                    'list-unordered', 
                    undefined, 
                    'changes-parent'
                );
                // Make it collapsible so it can contain children
                changesFolder.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                items.push(changesFolder);
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
        this.contextValue = contextValue;
    }
}