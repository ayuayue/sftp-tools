import * as vscode from 'vscode';
import { ServerItem } from './sftpViewProvider';
import path from 'path';
import { getLocaleText } from './i18n';

declare global {
    interface Window {
        acquireVsCodeApi(): any;
    }
}

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
                        try {
                            // 验证密钥文件配置
                            const servers = message.servers;
                            for (let i = 0; i < servers.length; i++) {
                                const server = servers[i];
                                if (!server.password && !server.privateKeyPath) {
                                    throw new Error(`服务器 "${server.name}" 未配置认证信息，请配置密码或密钥文件`);
                                }
                            }
                            await this._saveSettings(message.servers);
                            vscode.commands.executeCommand('sftp-tools.disconnectAllServers');
                            vscode.commands.executeCommand('sftp-tools.refreshServers');
                            vscode.window.showInformationMessage('设置已保存');
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`保存失败: ${error.message}`);
                        }
                        break;
                    case 'selectKeyFile':
                        try {
                            const result = await vscode.window.showOpenDialog({
                                canSelectFiles: true,
                                canSelectFolders: false,
                                canSelectMany: false,
                                title: '选择私钥文件',
                                filters: {
                                    'All files': ['*']
                                }
                            });
                            
                            if (result && result.length > 0) {
                                const path = result[0].fsPath;
                                // 发送选择的文件路径回 webview
                                this._view?.webview.postMessage({
                                    command: 'keyFileSelected',
                                    index: message.index,
                                    path: path
                                });
                            }
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`选择文件失败: ${error.message}`);
                        }
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

    public async _setPaths(localPath: string, remotePath: string, serverId?: string) {
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

    public _getHtmlForWebview(): string {
        const i18n = getLocaleText();
        const nonce = getNonce();
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers = config.get('servers') || [];
        const serversJson = JSON.stringify(servers);
        
        const htmlContent = /* html */`<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>${i18n.settings.title}</title>
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
                        box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                        z-index: 100;
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

                    /* 添加服务器按钮样式 */
                    .add-server-btn {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    }
                    .add-server-btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .key-input-group {
                        display: flex;
                        gap: 8px;
                    }
                    .select-key-btn {
                        white-space: nowrap;
                        padding: 4px 8px;
                    }
                    .auth-type {
                        width: 100%;
                        padding: 5px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                    }
                    .key-group, .password-group {
                        margin-top: 8px;
                    }
                    
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 2px;
                        cursor: pointer;
                        font-size: 13px;
                        line-height: 18px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                    }
                    
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    button:active {
                        background-color: var(--vscode-button-background);
                        transform: translateY(1px);
                    }
                    
                    button.secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    
                    button.secondary:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    
                    .deleteBtn {
                        background-color: var(--vscode-errorForeground);
                    }
                    
                    .deleteBtn:hover {
                        background-color: color-mix(in srgb, var(--vscode-errorForeground) 85%, black);
                    }
                </style>
            </head>
            <body>
                <div id="content">
                    <button id="addServerBtn" class="add-server-btn">
                        <span class="codicon codicon-add"></span>
                        添加服务器
                    </button>
                    <div id="serverList" class="server-list"></div>
                    <div id="emptyState" class="empty-state">
                        <div class="empty-state-text">${i18n.settings.emptyTip}</div>
                        <div class="empty-state-tip">
                            ${i18n.settings.clickAddServerTip}
                        </div>
                        <div class="empty-state-tip">
                            配置完成后点击 <span class="highlight">保存全部</span> 按钮保存更改
                        </div>
                    </div>
                </div>
                <div class="global-actions" id="globalActions">
                    <button id="saveSettingsBtn">${i18n.settings.saveAll}</button>
                </div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    let servers = ${serversJson};

                    // 添加消息处理
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'loadSettings':
                                servers = message.servers;
                                renderServers();
                                break;
                            case 'keyFileSelected':
                                // 更新服务器配置
                                updateServer(message.index, 'privateKeyPath', message.path);
                                renderServers();
                                break;
                        }
                    });

                    document.getElementById('addServerBtn').addEventListener('click', addServer);
                    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

                    // 初始化显示
                    renderServers();
                    updateEmptyState();

                    function getServerHtml(server, index) {
                        return \`
                            <div class="server-item">
                                <div class="form-group">
                                    <label>${i18n.settings.serverName}:</label>
                                    <input type="text" value="\${server.name || ''}" data-index="\${index}" data-field="name" placeholder="输入服务器名称">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.host}:</label>
                                    <input type="text" value="\${server.host || ''}" data-index="\${index}" data-field="host" placeholder="输入主机地址">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.port}:</label>
                                    <input type="number" value="\${server.port || 22}" data-index="\${index}" data-field="port" placeholder="22">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.username}:</label>
                                    <input type="text" value="\${server.username || ''}" data-index="\${index}" data-field="username" placeholder="输入用户名">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.authType}:</label>
                                    <select class="auth-type" data-index="\${index}">
                                        <option value="password" \${!server.privateKeyPath ? 'selected' : ''}>${i18n.settings.authPassword}</option>
                                        <option value="privateKey" \${server.privateKeyPath ? 'selected' : ''}>${i18n.settings.authPrivateKey}</option>
                                    </select>
                                </div>
                                <div class="form-group password-group" \${server.privateKeyPath ? 'style="display:none;"' : ''}>
                                    <label>${i18n.settings.password}:</label>
                                    <input type="password" value="\${server.password || ''}" data-index="\${index}" data-field="password" placeholder="输入密码">
                                </div>
                                <div class="form-group key-group" \${!server.privateKeyPath ? 'style="display:none;"' : ''}>
                                    <label>${i18n.settings.privateKey}:</label>
                                    <div class="key-input-group">
                                        <input type="text" value="\${server.privateKeyPath || ''}" data-index="\${index}" data-field="privateKeyPath" placeholder="选择私钥文件" readonly>
                                        <button class="select-key-btn" data-index="\${index}">选择文件</button>
                                    </div>
                                    <div class="form-group passphrase-group">
                                        <label>${i18n.settings.passphrase}:</label>
                                        <input type="password" value="\${server.passphrase || ''}" data-index="\${index}" data-field="passphrase" placeholder="如果私钥需要密码短语，请输入">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.localPath}:</label>
                                    <input type="text" value="\${server.localPath || ''}" data-index="\${index}" data-field="localPath" placeholder="输入本地工作区目录">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.remotePath}:</label>
                                    <input type="text" value="\${server.remotePath || '/'}" data-index="\${index}" data-field="remotePath" placeholder="输入远程目录">
                                </div>
                                <div class="actions">
                                    <button class="deleteBtn" data-index="\${index}">删除</button>
                                </div>
                            </div>
                        \`;
                    }

                    function renderServers() {
                        const serverList = document.getElementById('serverList');
                        serverList.innerHTML = servers.map((server, index) => getServerHtml(server, index)).join('');

                        // 重新绑定事件
                        document.querySelectorAll('.server-item input').forEach(input => {
                            input.addEventListener('change', (e) => {
                                const target = e.target;
                                const index = parseInt(target.dataset.index);
                                const field = target.dataset.field;
                                updateServer(index, field, target.value);
                            });
                        });

                        // 绑定认证方式切换事件
                        document.querySelectorAll('.auth-type').forEach(select => {
                            select.addEventListener('change', (e) => {
                                const target = e.target;
                                const index = parseInt(target.dataset.index);
                                const serverItem = target.closest('.server-item');
                                const passwordGroup = serverItem.querySelector('.password-group');
                                const keyGroup = serverItem.querySelector('.key-group');

                                if (target.value === 'password') {
                                    passwordGroup.style.display = 'block';
                                    keyGroup.style.display = 'none';
                                    // 清除密钥相关的值
                                    updateServer(index, 'privateKeyPath', '');
                                    updateServer(index, 'passphrase', '');
                                } else {
                                    passwordGroup.style.display = 'none';
                                    keyGroup.style.display = 'block';
                                    // 清除密码
                                    updateServer(index, 'password', '');
                                }
                            });
                        });

                        // 绑定选择密钥文件按钮事件
                        document.querySelectorAll('.select-key-btn').forEach(btn => {
                            btn.addEventListener('click', async (e) => {
                                const index = parseInt(btn.dataset.index);
                                const serverItem = btn.closest('.server-item');
                                const keyPathInput = serverItem.querySelector('[data-field="privateKeyPath"]');

                                // 发送消息给 VS Code 来打开文件选择对话框
                                vscode.postMessage({
                                    command: 'selectKeyFile',
                                    index: index
                                });
                            });
                        });

                        document.querySelectorAll('.deleteBtn').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const index = parseInt(btn.dataset.index);
                                deleteServer(index);
                            });
                        });

                        updateEmptyState();
                    }

                    function updateEmptyState() {
                        const emptyState = document.getElementById('emptyState');
                        const serverList = document.getElementById('serverList');
                        if (servers.length === 0) {
                            emptyState.style.display = 'block';
                            serverList.style.display = 'none';
                        } else {
                            emptyState.style.display = 'none';
                            serverList.style.display = 'block';
                        }
                    }

                    function updateServer(index, field, value) {
                        servers[index][field] = value;
                    }

                    function addServer() {
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

                    function deleteServer(index) {
                        servers.splice(index, 1);
                        renderServers();
                    }

                    function saveSettings() {
                        vscode.postMessage({
                            command: 'saveSettings',
                            servers: servers
                        });
                    }
                </script>
            </body>
            </html>`;
            
        return htmlContent;
    }

    public async handleMessage(message: any) {
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
                    // 验证密钥文件配置
                    const servers = message.servers;
                    for (let i = 0; i < servers.length; i++) {
                        const server = servers[i];
                        if (!server.password && !server.privateKeyPath) {
                            throw new Error(`服务器 "${server.name}" 未配置认证信息，请配置密码或密钥文件`);
                        }
                    }
                    await this._saveSettings(message.servers);
                    vscode.commands.executeCommand('sftp-tools.disconnectAllServers');
                    vscode.commands.executeCommand('sftp-tools.refreshServers');
                    vscode.window.showInformationMessage('设置已保存');
                } catch (error: any) {
                    vscode.window.showErrorMessage(`保存失败: ${error.message}`);
                }
                break;
            case 'selectKeyFile':
                try {
                    const result = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        title: '选择私钥文件',
                        filters: {
                            'All files': ['*']
                        }
                    });
                    
                    if (result && result.length > 0) {
                        const path = result[0].fsPath;
                        this._view?.webview.postMessage({
                            command: 'keyFileSelected',
                            index: message.index,
                            path: path
                        });
                        // 更新服务器配置
                        this._view?.webview.postMessage({
                            command: 'updateServer',
                            index: message.index,
                            field: 'privateKeyPath',
                            value: path
                        });
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`选择文件失败: ${error.message}`);
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