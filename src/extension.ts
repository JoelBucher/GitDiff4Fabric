import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

interface WorkspacePick extends vscode.QuickPickItem {
    id: string;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'fabric-auth-demo.login',
        async () => {
            try {
                // Step 1: Get Microsoft session
                const session = await vscode.authentication.getSession(
                    'microsoft',
                    ['https://analysis.windows.net/powerbi/api/.default'],
                    { createIfNone: true }
                );

                if (!session) {
                    vscode.window.showErrorMessage('Login failed.');
                    return;
                }

                const token = session.accessToken;

                // Step 2: Call Fabric (Power BI) API
                const response = await fetch(
                    'https://api.powerbi.com/v1.0/myorg/groups',
                    {
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    }
                );

                if (!response.ok) {
                    const text = await response.text();
                    vscode.window.showErrorMessage(
                        `API error: ${response.status} ${text}`
                    );
                    return;
                }

                const data = await response.json();

                // Step 3: Show result
                const workspaceCount = data.value?.length ?? 0;

                vscode.window.showInformationMessage(
                    `Logged in as ${session.account.label}. Found ${workspaceCount} workspaces.`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(
                    `Error: ${err.message || err}`
                );
            }
        }
    );

    context.subscriptions.push(disposable);

    const downloadCommand = vscode.commands.registerCommand('fabric-auth-demo.downloadNotebooks', async () => {
        try {
            // 1. Get Session
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: true }
            );

            // 2. Fetch Workspaces
            const wsResponse = await fetch('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const wsData: any = await wsResponse.json();
            const workspaces = wsData.value || [];

            // 3. User selects Workspace
            const selectedWs = await vscode.window.showQuickPick(
                workspaces.map((ws: any) => ({ 
                    label: ws.name, 
                    description: ws.id, // Good for the user to see
                    id: ws.id 
                })),
                { placeHolder: 'Select a workspace' }
            ) as WorkspacePick | undefined; // Cast the result

            if (!selectedWs) return;

            // 4. Fetch Notebooks (In Fabric, these are "items" of type "Notebook")
            // Note: Using the Fabric API endpoint
            const itemsResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items`, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const itemsData: any = await itemsResponse.json();
            const notebooks = (itemsData.value || []).filter((i: any) => i.type === 'Notebook');

            if (notebooks.length === 0) {
                vscode.window.showInformationMessage('No notebooks found in this workspace.');
                return;
            }

            // 5. Download each notebook
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Please open a folder in VS Code first.');
                return;
            }

            const downloadFolder = path.join(workspaceFolder, 'fabric_notebooks');
            if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);

            for (const nb of notebooks) {
                // Fetch the notebook definition
                const defResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items/${nb.id}/getDefinition`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                
                // Note: Fabric returns definition as base64 parts. 
                // For simplicity, we're saving the metadata. 
                // Real .ipynb conversion requires parsing the 'parts' array.
                const fileData = await defResponse.json();
                fs.writeFileSync(
                    path.join(downloadFolder, `${nb.displayName}.json`), 
                    JSON.stringify(fileData, null, 2)
                );
            }

            vscode.window.showInformationMessage(`Downloaded ${notebooks.length} notebooks to /fabric_notebooks`);

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
        }
    });

    context.subscriptions.push(downloadCommand);
}

export function deactivate() {}
