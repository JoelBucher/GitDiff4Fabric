"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_fetch_1 = __importDefault(require("node-fetch"));
function activate(context) {
    const disposable = vscode.commands.registerCommand('fabric-auth-demo.login', async () => {
        try {
            // Step 1: Get Microsoft session
            const session = await vscode.authentication.getSession('my-msal', ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: true });
            if (!session) {
                vscode.window.showErrorMessage('Login failed.');
                return;
            }
            const token = session.accessToken;
            // Step 2: Call Fabric (Power BI) API
            const response = await (0, node_fetch_1.default)('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const text = await response.text();
                vscode.window.showErrorMessage(`API error: ${response.status} ${text}`);
                return;
            }
            const data = await response.json();
            // Step 3: Show result
            const workspaceCount = data.value?.length ?? 0;
            vscode.window.showInformationMessage(`Logged in as ${session.account.label}. Found ${workspaceCount} workspaces.`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error: ${err.message || err}`);
        }
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map