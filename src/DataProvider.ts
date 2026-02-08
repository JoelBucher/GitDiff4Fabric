import * as vscode from 'vscode';

export class MyDataProvider implements vscode.TreeDataProvider<TreeItem> {
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    // This is where you define your sidebar items
    return Promise.resolve([
      new TreeItem("Run Analysis", vscode.TreeItemCollapsibleState.None, {
        command: 'myExtension.runAnalysis',
        title: 'Run Analysis'
      }),
      new TreeItem("Settings", vscode.TreeItemCollapsibleState.None)
    ]);
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }
}