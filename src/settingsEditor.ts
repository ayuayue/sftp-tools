import * as vscode from 'vscode';
import { ServerItem } from './sftpViewProvider';
import path from 'path';

export class SettingsEditorProvider {
    public static readonly viewType = 'sftp-tools.settingsEditor';
    private _view?: vscode.WebviewPanel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
    }

    private async deleteRemoteFile(fileUri: vscode.Uri) {
        const confirmDelete = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this remote file?',
            'Yes', 'No'
        );
        if (confirmDelete === 'Yes') {
            // 这里调用删除文件的 API
            // 例如: await this.sftpClient.delete(fileUri);
            vscode.window.showInformationMessage(`Deleted remote file: ${fileUri.fsPath}`);
        }
    }

    private async downloadRemoteFile(fileUri: vscode.Uri) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }
        const localPath = path.join(workspaceFolder.uri.fsPath, fileUri.fsPath.split('/').pop()!);
        // 这里调用下载文件的 API
        // 例如: await this.sftpClient.download(fileUri, localPath);
        vscode.window.showInformationMessage(`Downloaded remote file to: ${localPath}`);
    }

    public async showSettingsEditor(serverToEdit?: ServerItem) {
        if (this._view) {
            this._view.reveal(vscode.ViewColumn.One);
            
            if (serverToEdit) {
                this._view.webview.postMessage({ 
                    command: 'editServer',
                    serverName: serverToEdit.label 
                });
            }
            return;
        }

        this._view = vscode.window.createWebviewPanel(
            'sftpSettings',
            'SFTP Tools Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers = config.get('servers') || [];
        
        this._view.webview.html = this._getHtmlForWebview();
        
        setTimeout(() => {
            this._view?.webview.postMessage({ command: 'loadSettings', servers });
            if (serverToEdit) {
                this._view?.webview.postMessage({ 
                    command: 'editServer',
                    serverName: serverToEdit.label 
                });
            }
        }, 100);

        this._view.onDidDispose(() => {
            this._view = undefined;
        });

        this._view.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.command) {
                    case 'saveSettings':
                        await this._saveSettings(message.servers);
                        vscode.window.showInformationMessage('Settings saved successfully!');
                        break;
                    case 'confirmDelete':
                        const confirmDeleteAnswer = await vscode.window.showWarningMessage(
                            'Are you sure you want to delete this server?',
                            'Yes',
                            'No'
                        );
                        if (confirmDeleteAnswer === 'Yes') {
                            this._view?.webview.postMessage({
                                command: 'deleteConfirmed',
                                index: message.index
                            });
                        }
                        break;
                    case 'setPaths':
                        await this._setPaths(message.localPath, message.remotePath, message.serverId);
                        break;
                    default:
                        const errorAnswer = await vscode.window.showWarningMessage(
                            'Invalid command received. Please check your input.',
                            'OK'
                        );
                        this._view?.webview.postMessage({ command: 'error', message: errorAnswer });
                }
            } catch (error) {
                console.error('Error handling message:', error);
                vscode.window.showErrorMessage('Failed to save settings');
            }
        });
    }

    public async _saveSettings(servers: any[]) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
    }

    private async _setPaths(localPath: string, remotePath: string, serverId?: string) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers = config.get('servers') as Array<{
            id: string;
            localPath: string;
            remotePath: string;
        }> || [];
        
        if (serverId) {
            const serverIndex = servers.findIndex(s => s.id === serverId);
            if (serverIndex !== -1) {
                servers[serverIndex].localPath = localPath;
                servers[serverIndex].remotePath = remotePath;
                await config.update('servers', servers, vscode.ConfigurationTarget.Global);
            }
        } else {
            await config.update('localPath', localPath, vscode.ConfigurationTarget.Global);
            await config.update('remotePath', remotePath, vscode.ConfigurationTarget.Global);
        }
        
        vscode.window.showInformationMessage('Paths set successfully!');
    }

    private _getHtmlForWebview(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>SFTP Settings</title>
                <style>
                    body { 
                        padding: 20px; 
                        min-height: 100vh;
                        margin: 0;
                        box-sizing: border-box;
                    }
                    .server-form { margin-bottom: 20px; }
                    input, button { margin: 5px 0; }
                    .server-list { margin-top: 20px; }
                    .server-item { 
                        border: 1px solid var(--vscode-input-border); 
                        padding: 10px; 
                        margin: 10px 0; 
                    }
                    .form-group {
                        margin-bottom: 10px;
                    }
                    .form-group label {
                        display: block;
                        margin-bottom: 5px;
                    }
                    .form-group input {
                        width: 100%;
                        padding: 5px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                    }
                    .actions {
                        margin-top: 10px;
                        display: flex;
                        justify-content: flex-end;
                    }
                    .global-actions {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        background: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 4px;
                        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    }
                    .server-list {
                        margin-bottom: 80px;
                    }
                    
                    /* 空状态样式 */
                    .empty-state {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        text-align: center;
                        width: 100%;
                        max-width: 400px;
                    }
                    
                    .empty-state-text {
                        font-size: 14px;
                        margin-bottom: 8px;
                        color: var(--vscode-foreground);
                    }
                    
                    .empty-state-tip {
                        font-size: 13px;
                        color: var(--vscode-descriptionForeground);
                        opacity: 0.8;
                        margin-bottom: 6px;
                    }
                    
                    .highlight {
                        color: var(--vscode-textLink-foreground);
                        font-weight: 500;
                    }
                    .settings-section {
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        padding: 16px;
                        margin-bottom: 20px;
                    }
                    .settings-section label {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    
                    h1 {
                        color: var(--vscode-foreground);
                        font-size: 24px;
                        margin-bottom: 24px;
                        border-bottom: 1px solid var(--vscode-input-border);
                        padding-bottom: 12px;
                    }
                    
                    .settings-section {
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        padding: 16px;
                        margin-bottom: 20px;
                        background-color: var(--vscode-editor-background);
                    }
                    
                    .settings-section h3 {
                        color: var(--vscode-foreground);
                        font-size: 16px;
                        margin: 0 0 16px 0;
                        padding-bottom: 8px;
                        border-bottom: 1px solid var(--vscode-input-border);
                    }
                    
                    .settings-section label {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        color: var(--vscode-foreground);
                        font-size: 14px;
                        cursor: pointer;
                        padding: 4px 0;
                    }
                    
                    .settings-section input[type="checkbox"] {
                        width: 16px;
                        height: 16px;
                        cursor: pointer;
                    }
                    
                    .server-list {
                        margin-top: 24px;
                    }
                    
                    .server-list h3 {
                        color: var(--vscode-foreground);
                        font-size: 16px;
                        margin: 0 0 16px 0;
                    }
                    
                    .empty-state {
                        text-align: center;
                        padding: 32px;
                        background-color: var(--vscode-editor-background);
                        border-radius: 4px;
                        margin: 16px 0;
                    }
                    
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        transition: background-color 0.2s;
                    }
                    
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>SFTP 设置</h1>
                    <div class="settings-section">
                        <h3>通用设置</h3>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="showConfirmDialog" ${vscode.workspace.getConfiguration('sftp-tools').get('showConfirmDialog', true) ? 'checked' : ''}>
                                删除文件时显示确认对话框
                            </label>
                        </div>
                    </div>
                    <div class="server-section">
                        <h3>服务器管理</h3>
                        <div id="serverList" class="server-list"></div>
                        <div id="emptyState" class="empty-state">
                            <p>还没有配置任何服务器</p>
                            <button id="addServerBtn">添加服务器</button>
                        </div>
                    </div>
                </div>
                <div class="global-actions" id="globalActions">
                    <button id="saveSettingsBtn">保存全部</button>
                </div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    let servers = [];

                    document.getElementById('addServerBtn').addEventListener('click', addServer);
                    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
                    document.getElementById('showConfirmDialog').addEventListener('change', (e) => {
                        vscode.postMessage({
                            type: 'updateSetting',
                            setting: 'showConfirmDialog',
                            value: e.target.checked
                        });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'loadSettings':
                                servers = message.servers || [];
                                renderServers();
                                break;
                            case 'editServer':
                                const serverItem = document.querySelector('[data-server-name="'+message.serverName+'"]');
                                if (serverItem) {
                                    serverItem.scrollIntoView({ behavior: 'smooth' });
                                    serverItem.classList.add('highlight');
                                    setTimeout(() => serverItem.classList.remove('highlight'), 2000);
                                }
                                break;
                            case 'deleteConfirmed':
                                servers.splice(message.index, 1);
                                renderServers();
                                break;
                        }
                    });

                    function renderServers() {
                        const serverList = document.getElementById('serverList');
                        const emptyState = document.getElementById('emptyState');
                        
                        if (servers.length === 0) {
                            serverList.style.display = 'none';
                            emptyState.style.display = 'block';
                        } else {
                            serverList.style.display = 'block';
                            emptyState.style.display = 'none';
                            
                            serverList.innerHTML = servers.map((server, index) => {
                                const serverDiv = document.createElement('div');
                                serverDiv.className = 'server-item';
                                serverDiv.dataset.serverName = server.name;
                                serverDiv.innerHTML = \`
                                    <div class="server-form">
                                        <div class="form-group">
                                            <label>Name:</label>
                                            <input type="text" value="\${server.name}" data-index="\${index}" data-field="name">
                                        </div>
                                        <div class="form-group">
                                            <label>Host:</label>
                                            <input type="text" value="\${server.host}" data-index="\${index}" data-field="host">
                                        </div>
                                        <div class="form-group">
                                            <label>Port:</label>
                                            <input type="number" value="\${server.port}" data-index="\${index}" data-field="port">
                                        </div>
                                        <div class="form-group">
                                            <label>Username:</label>
                                            <input type="text" value="\${server.username}" data-index="\${index}" data-field="username">
                                        </div>
                                        <div class="form-group">
                                            <label>Password:</label>
                                            <input type="password" value="\${server.password}" data-index="\${index}" data-field="password">
                                        </div>
                                        <div class="form-group">
                                            <label>本地工作区目录:</label>
                                            <input type="text" value="\${server.localPath}" data-index="\${index}" data-field="localPath" placeholder="输入本地工作区目录">
                                        </div>
                                        <div class="form-group">
                                            <label>远程目录:</label>
                                            <input type="text" value="\${server.remotePath}" data-index="\${index}" data-field="remotePath" placeholder="输入远程目录">
                                        </div>
                                        <div class="actions">
                                            <button class="deleteBtn" data-index="\${index}">Delete</button>
                                        </div>
                                    </div>
                                \`;

                                serverDiv.querySelectorAll('input').forEach(input => {
                                    input.addEventListener('change', (e) => {
                                        const target = e.target;
                                        const index = parseInt(target.dataset.index);
                                        const field = target.dataset.field;
                                        updateServer(index, field, target.value);
                                    });
                                });

                                serverDiv.querySelector('.deleteBtn').addEventListener('click', () => {
                                    deleteServer(index);
                                });

                                return serverDiv.outerHTML;
                            }).join('');
                        }

                        document.querySelectorAll('.server-item input').forEach(input => {
                            input.addEventListener('change', (e) => {
                                const target = e.target;
                                const index = parseInt(target.dataset.index);
                                const field = target.dataset.field;
                                updateServer(index, field, target.value);
                            });
                        });

                        document.querySelectorAll('.deleteBtn').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const index = parseInt(btn.dataset.index);
                                deleteServer(index);
                            });
                        });
                    }

                    function updateServer(index, field, value) {
                        servers[index][field] = value;
                    }

                    function addServer() {
                        console.log('Adding server');
                        servers.push({
                            name: '',
                            host: '',
                            port: 22,
                            username: '',
                            password: '',
                            localPath: '',
                            remotePath: '/'
                        });
                        renderServers();
                    }

                    async function deleteServer(index) {
                        vscode.postMessage({
                            command: 'confirmDelete',
                            index: index
                        });
                    }

                    function saveSettings() {
                        console.log('Saving settings:', servers);
                        vscode.postMessage({
                            command: 'saveSettings',
                            servers: servers
                        });
                    }
                </script>
            </body>
            </html>`;
    }

    private async handleMessage(message: any) {
        switch (message.type) {
            case 'updateSetting':
                await vscode.workspace.getConfiguration('sftp-tools').update(
                    message.setting,
                    message.value,
                    vscode.ConfigurationTarget.Global
                );
                vscode.commands.executeCommand('sftp-tools.refreshServers');
                break;
            case 'saveSettings':
                try {
                    await this._saveSettings(message.servers);
                    vscode.commands.executeCommand('sftp-tools.disconnectAllServers');
                    vscode.commands.executeCommand('sftp-tools.refreshServers');
                    vscode.window.showInformationMessage('设置已保存');
                } catch (error: any) {
                    vscode.window.showErrorMessage(`保存失败: ${error.message}`);
                }
                break;
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 