import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'fabric-auth-demo.login',
        async () => {
            try {
                // Step 1: Get Microsoft session
                const session = await vscode.authentication.getSession(
                    'my-msal',
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
}

export function deactivate() {}
