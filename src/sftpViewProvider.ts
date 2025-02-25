import * as vscode from 'vscode';
import { SftpManager } from './sftpManager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { time } from 'console';
import { StatusBarManager } from './statusBarManager';
import { getLocaleText } from './i18n';

interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    remotePath: string;
}

// 配置文件名
const CONFIG_FILE_NAME = 'sftp-tools.json';

export class SftpServersProvider implements vscode.TreeDataProvider<ServerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerItem | undefined | null | void> = new vscode.EventEmitter<ServerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private activeServer?: string;  // 添加激活服务器标记
    private configFilePath: string = '';
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor() {
        this.initConfigFilePath();
        // 监听配置文件变化
        this.watchConfigFile();
    }

    private initConfigFilePath() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const vscodePath = path.join(workspaceFolder.uri.fsPath, '.vscode');
            this.configFilePath = path.join(vscodePath, CONFIG_FILE_NAME);
        }
    }

    private watchConfigFile() {
        // 清除之前的监听
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            // 监听配置文件变化
            const pattern = new vscode.RelativePattern(
                path.join(workspaceFolder.uri.fsPath, '.vscode'), 
                CONFIG_FILE_NAME
            );
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
            this.fileWatcher.onDidChange(() => this.refresh());
            this.fileWatcher.onDidCreate(() => this.refresh());
            this.fileWatcher.onDidDelete(() => this.refresh());
        }
    }

    // 从文件加载服务器配置
    private loadServersFromFile(): ServerConfig[] {
        try {
            if (this.configFilePath && fs.existsSync(this.configFilePath)) {
                const configContent = fs.readFileSync(this.configFilePath, 'utf8');
                return JSON.parse(configContent).servers || [];
            }
        } catch (error) {
            console.error('Failed to load configuration:', error);
        }
        return [];
    }

    // 将服务器配置保存到文件
    private saveServersToFile(servers: ServerConfig[]): boolean {
        try {
            if (this.configFilePath) {
                // 确保 .vscode 目录存在
                const vscodePath = path.dirname(this.configFilePath);
                if (!fs.existsSync(vscodePath)) {
                    fs.mkdirSync(vscodePath, { recursive: true });
                }
                
                const configData = { servers };
                fs.writeFileSync(this.configFilePath, JSON.stringify(configData, null, 2), 'utf8');
                return true;
            }
        } catch (error) {
            console.error('Failed to save configuration:', error);
        }
        return false;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ServerItem): Thenable<ServerItem[]> {
        if (!element) {
            const servers: ServerConfig[] = this.loadServersFromFile();
            return Promise.resolve(
                servers.map(server => new ServerItem(
                    server.name,
                    vscode.TreeItemCollapsibleState.None,
                    server,
                    false,
                    this.activeServer === server.name  // 传递激活状态
                ))
            );
        }
        return Promise.resolve([]);
    }

    async addServer() {
        const servers: ServerConfig[] = this.loadServersFromFile();
        const i18n = getLocaleText();

        // 验证服务器名称
        const validateServerName = (name: string): string | undefined => {
            if (!name) {
                return i18n.settings.serverNameRequired;
            }
            if (servers.some(s => s.name === name)) {
                return i18n.settings.serverNameExists;
            }
            return undefined;
        };

        const name = await vscode.window.showInputBox({
            prompt: i18n.settings.enterServerName,
            validateInput: validateServerName
        });
        if (!name) { return; }

        const host = await vscode.window.showInputBox({ 
            prompt: i18n.settings.enterHost
        });
        if (!host) { return; }

        const port = await vscode.window.showInputBox({ 
            prompt: i18n.settings.enterPort,
            value: '22'
        });
        if (!port) { return; }

        const username = await vscode.window.showInputBox({ 
            prompt: i18n.settings.enterUsername
        });
        if (!username) { return; }

        // 选择认证方式
        const authType = await vscode.window.showQuickPick(
            [
                { label: i18n.settings.authPassword, value: 'password' },
                { label: i18n.settings.authPrivateKey, value: 'privateKey' }
            ],
            { placeHolder: i18n.settings.selectAuthType }
        );
        if (!authType) { return; }

        let password: string | undefined;
        let privateKeyPath: string | undefined;
        let passphrase: string | undefined;

        if (authType.value === 'password') {
            password = await vscode.window.showInputBox({ 
                prompt: i18n.settings.enterPassword,
                password: true
            });
            if (!password) { return; }
        } else {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: i18n.settings.selectPrivateKey,
                filters: {
                    'All files': ['*']
                }
            });
            if (!result || result.length === 0) { return; }
            privateKeyPath = result[0].fsPath;

            // 询问是否需要密码短语
            const needPassphrase = await vscode.window.showQuickPick(
                [i18n.settings.yes, i18n.settings.no],
                { placeHolder: i18n.settings.needPassphrase }
            );
            if (!needPassphrase) { return; }

            if (needPassphrase === i18n.settings.yes) {
                passphrase = await vscode.window.showInputBox({
                    prompt: i18n.settings.enterPassphrase,
                    password: true
                });
                if (!passphrase) { return; }
            }
        }

        const remotePath = await vscode.window.showInputBox({ 
            prompt: i18n.settings.enterRemotePath,
            value: '/'
        });
        if (!remotePath) { return; }

        servers.push({
            name,
            host,
            port: parseInt(port),
            username,
            ...(password ? { password } : {}),
            ...(privateKeyPath ? { privateKeyPath } : {}),
            ...(passphrase ? { passphrase } : {}),
            remotePath
        });

        this.saveServersToFile(servers);
        this.refresh();
    }

    async editServer(serverItem: ServerItem) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers: ServerConfig[] = config.get('servers') || [];
        const index = servers.findIndex(s => s.name === serverItem.label);
        
        if (index === -1) { return; }

        const server = servers[index];
        const name = await vscode.window.showInputBox({ 
            prompt: 'Enter server name',
            value: server.name
        });
        if (!name) { return; }

        // ... 类似的输入其他字段 ...

        servers[index] = {
            ...server,
            name
            // ... 更新其他字段 ...
        };

        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
    }

    async deleteServer(serverItem: ServerItem) {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to delete server "${serverItem.label}"?`,
            'Yes',
            'No'
        );

        if (answer !== 'Yes') {
            return;
        }

        const servers: ServerConfig[] = this.loadServersFromFile();
        const newServers = servers.filter(s => s.name !== serverItem.label);
        this.saveServersToFile(newServers);
        this.refresh();
        
        // 通知设置页面（如果已打开）
        vscode.commands.executeCommand('sftp-tools.settingsUpdated', newServers);
    }

    // 添加设置激活服务器的方法
    setActiveServer(serverName: string) {
        this.activeServer = serverName;
        this.refresh();
    }

    // 添加新方法
    async connectSSH(serverItem: ServerItem) {
        const server = serverItem.config;
        const i18n = getLocaleText();
        
        try {
            // 构建 SSH 连接命令
            let sshCommand = `ssh ${server.username}@${server.host}`;
            if (server.port && server.port !== 22) {
                sshCommand += ` -p ${server.port}`;
            }
            if (server.privateKeyPath) {
                sshCommand += ` -i "${server.privateKeyPath}"`;
            }

            // 创建新的终端
            const terminal = vscode.window.createTerminal({
                name: `SSH: ${server.name}`,
                shellPath: 'ssh',
                shellArgs: [
                    `${server.username}@${server.host}`,
                    ...(server.port && server.port !== 22 ? ['-p', server.port.toString()] : []),
                    ...(server.privateKeyPath ? ['-i', server.privateKeyPath] : [])
                ]
            });

            // 显示终端并聚焦
            terminal.show();

            // 如果是密码认证，提示用户输入密码
            if (!server.privateKeyPath && server.password) {
                // 等待终端准备就绪
                await new Promise(resolve => setTimeout(resolve, 1000));
                // 自动输入密码（可选，因为有些用户可能不希望密码自动输入）
                const autoInputPassword = await vscode.window.showInformationMessage(
                    i18n.messages.autoInputPasswordPrompt,
                    i18n.settings.yes,
                    i18n.settings.no
                );
                
                if (autoInputPassword === i18n.settings.yes) {
                    terminal.sendText(server.password, true);
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(i18n.messages.sshConnectionFailed.replace('{0}', error.message));
        }
    }
}

export class ServerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly config: ServerConfig,
        public readonly isEmptyMessage: boolean = false,
        public readonly isActive: boolean = false
    ) {
        super(label, collapsibleState);
        
        if (!isEmptyMessage) {
            this.tooltip = `${this.label} (${config.host})`;
            this.description = config.host;
            this.contextValue = isActive ? 'activeServer' : 'server';
            this.command = {
                command: 'sftp-tools.connectServer',
                title: 'Connect to Server',
                arguments: [{ ...this }]  // 创建一个副本以避免循环引用
            };

            // 设置激活状态的图标
            if (isActive) {
                this.iconPath = new vscode.ThemeIcon('check');
                this.description = `${config.host} (已连接)`;
            }
        } else {
            this.tooltip = '请添加新的服务器配置';
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}

export class SftpExplorerProvider implements vscode.TreeDataProvider<ExplorerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExplorerItem | undefined | null | void> = new vscode.EventEmitter<ExplorerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ExplorerItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private sftpManager: SftpManager = new SftpManager();
    private currentServer?: ServerConfig;
    private remoteFiles = new Map<string, {
        remotePath: string;
        serverConfig: ServerConfig;
        tempPath?: string;
        tempDir?: string;  // 添加临时目录记录
    }>();
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private serversProvider: SftpServersProvider;  // 添加引用
    private statusBar: StatusBarManager = StatusBarManager.getInstance();
    private hasActiveOperations: boolean = false;
    private i18n = getLocaleText();

    constructor(serversProvider: SftpServersProvider) {  // 通过构造函数注入
        this.serversProvider = serversProvider;
        this.outputChannel = vscode.window.createOutputChannel('SFTP Tools');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        // 监听配置变化
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sftp-tools.servers')) {
                this.updateCurrentServer();
            }
        });

        // 监听 VS Code 关闭事件
        vscode.workspace.onDidCloseTextDocument(doc => {
            const fileInfo = this.remoteFiles.get(doc.uri.toString());
            if (fileInfo?.tempPath) {
                try {
                    fs.unlinkSync(fileInfo.tempPath);
                    console.log(`Cleaned up temp file: ${fileInfo.tempPath}`);
                } catch (error) {
                    console.error('Failed to cleanup temp file:', error);
                }
            }
        });
    }

    private async updateCurrentServer() {
        if (this.currentServer) {
            const config = vscode.workspace.getConfiguration('sftp-tools');
            const servers: ServerConfig[] = config.get('servers') || [];
            const updatedServer = servers.find(s => s.name === this.currentServer?.name);
            
            if (updatedServer) {
                this.currentServer = updatedServer;
                // 重新连接到更新后的服务器
                await this.connectToServer(updatedServer);
            } else {
                // 如果服务器被删除，清除当前连接
                this.currentServer = undefined;
                this.sftpManager.disconnect();
                this.refresh();
            }
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async connectToServer(server: ServerConfig) {
        try {
            this.statusBar.showProgress(this.i18n.status.connecting);
            await this.sftpManager.connect(server);
            this.currentServer = server;
            this.serversProvider.setActiveServer(server.name);
            this.refresh();
            this.statusBar.showMessage(this.i18n.status.connected, 'info');
        } catch (error: any) {
            vscode.window.showErrorMessage(this.i18n.messages.operationFailed.replace('{0}', error.message));
        }
    }

    async disconnectServer() {
        if (this.currentServer) {
            this.sftpManager.disconnect();
            this.currentServer = undefined;
            this.serversProvider.setActiveServer('');
            this.refresh();
            this.log(this.i18n.status.disconnected, 'info');
        }
    }

    getTreeItem(element: ExplorerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ExplorerItem): Promise<ExplorerItem[]> {
        if (!this.currentServer) {
            return [];
        }

        try {
            const path = element ? element.path : this.currentServer.remotePath;
            const files = await this.sftpManager.listFiles(path);
            
            return files.map(file => new ExplorerItem(
                file.filename,
                file.longname.startsWith('d') ? 
                    vscode.TreeItemCollapsibleState.Collapsed : 
                    vscode.TreeItemCollapsibleState.None,
                `${path}/${file.filename}`.replace(/\/+/g, '/'),
                file.longname.startsWith('d')
            ));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to list files: ${error.message}`);
            return [];
        }
    }

    // 替换 showMessage 方法
    private log(message: string, type: 'info' | 'warning' | 'error' = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
        this.outputChannel.show(true);  // true 表示保持焦点在编辑器
    }

    async openFile(item: ExplorerItem, isDoubleClick = false) {
        try {
            this.log(`[${this.currentServer?.name}] Opening file: ${item.path}`, 'info');
            
            if (!this.currentServer) {
                throw new Error('No server connected');
            }
            
            // 创建临时文件
            const tmpDir = path.join(os.tmpdir(), 'sftp-tools');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            // 保持远程目录结构
            const remoteDir = path.dirname(item.path);
            const tempWorkDir = path.join(tmpDir, this.currentServer.name, remoteDir);
            if (!fs.existsSync(tempWorkDir)) {
                fs.mkdirSync(tempWorkDir, { recursive: true });
            }
            
            const tempPath = path.join(tempWorkDir, item.label);
            
            // 获取并写入文件内容
            const content = await this.sftpManager.readFile(item.path);
            fs.writeFileSync(tempPath, content);
            
            this.log(`[${this.currentServer.name}] Created temp file: ${tempPath}`, 'info');

            // 打开文件
            const doc = await vscode.workspace.openTextDocument(tempPath);
            
            // 存储文件信息
            this.remoteFiles.set(doc.uri.toString(), {
                remotePath: item.path,
                serverConfig: this.currentServer,
                tempPath: tempPath,
                tempDir: tmpDir  // 记录临时根目录
            });
            
            // 设置语言
            await vscode.languages.setTextDocumentLanguage(doc, this.getLanguageId(item.label));
            
            // 显示文档
            await vscode.window.showTextDocument(doc, {
                preview: !isDoubleClick,
                preserveFocus: !isDoubleClick
            });
            
            // 设置上下文
            await vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', true);
            
        } catch (error: any) {
            this.log(`[${this.currentServer?.name}] Failed to open file: ${error.message}`, 'error');
            vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
        }
    }

    private getLanguageId(filename: string): string {
        // 根据文件扩展名返回语言ID
        const ext = filename.split('.').pop()?.toLowerCase();
        // 添加更多文件类型支持
        const langMap: { [key: string]: string } = {
            'js': 'javascript',
            'ts': 'typescript',
            'json': 'json',
            'md': 'markdown',
            'txt': 'plaintext',
            // ... 添加更多映射
        };
        return langMap[ext || ''] || 'plaintext';
    }

    private getServerDisplayName(server: ServerConfig): string {
        return `${server.name} (${server.host}:${server.port})`;
    }

    private setOperationStatus(active: boolean) {
        this.hasActiveOperations = active;
        vscode.commands.executeCommand('setContext', 'sftp-tools.hasActiveOperations', active);
    }

    cancelOperations() {
        this.sftpManager.cancelOperations();
        this.setOperationStatus(false);
        this.statusBar.showMessage('操作已取消', 'info');
    }

    async uploadFile(document: vscode.TextDocument) {
        try {
            this.setOperationStatus(true);
            const uri = document.uri.toString();
            const fileInfo = this.remoteFiles.get(uri);
            
            if (!fileInfo) {
                // 如果不是远程文件，使用工作区路径上传
                this.log(`[${this.currentServer?.name}] 开始上传本地文件: ${document.uri.fsPath}`, 'info');
                await this.uploadToServer(document, this.currentServer!);
                return;
            }

            // 如果是临时文件，去除临时目录前缀
            let localPath = document.uri.fsPath;
            if (fileInfo.tempDir && localPath.startsWith(fileInfo.tempDir)) {
                localPath = localPath.substring(fileInfo.tempDir.length);
            }

            const serverDisplay = this.getServerDisplayName(fileInfo.serverConfig);
            this.statusBar.showProgress(this.i18n.status.uploading);
            this.log(`[${this.currentServer?.name}] 开始上传文件:
本地路径: ${localPath}
远程路径: ${fileInfo.remotePath}`, 'info');

            await this.sftpManager.writeFile(fileInfo.remotePath, document.getText());
            
            this.log(`[${this.currentServer?.name}] 文件上传成功: ${fileInfo.remotePath}`, 'info');
            this.statusBar.showMessage(`文件已上传到 [${serverDisplay}]`, 'info');
        } finally {
            this.setOperationStatus(false);
        }
    }

    // 清理临时文件
    private cleanupTempFiles() {
        for (const fileInfo of this.remoteFiles.values()) {
            if (fileInfo.tempPath && fs.existsSync(fileInfo.tempPath)) {
                try {
                    fs.unlinkSync(fileInfo.tempPath);
                    console.log(`Cleaned up temp file: ${fileInfo.tempPath}`);
                } catch (error) {
                    console.error('Failed to cleanup temp file:', error);
                }
            }
        }
    }

    isRemoteFile(uri: string): boolean {
        const fileInfo = this.remoteFiles.get(uri);
        if (fileInfo) {
            // 更新上传按钮的标题
            const serverDisplay = this.getServerDisplayName(fileInfo.serverConfig);
            vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', true);
            // 更新命令标题
            vscode.commands.executeCommand('setCommand', 'sftp-tools.uploadFile', {
                title: `Upload to [${this.currentServer?.name}]`,
                tooltip: `Upload to [${this.currentServer?.name}]`
            });
            return true;
        }
        return false;
    }

    getFileInfo(uri: string) {
        return this.remoteFiles.get(uri);
    }

    // 获取所有服务器配置
    public getServers(): ServerConfig[] {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        return config.get('servers') || [];
    }

    // 上传到指定服务器
    async uploadToServer(document: vscode.TextDocument, serverConfig: ServerConfig) {
        try {
            this.statusBar.showProgress(this.i18n.status.uploading);
            this.log(`[${serverConfig.name}] ${this.i18n.status.uploading}`, 'info');

            // 连接到指定服务器
            const tempManager = new SftpManager();
            await tempManager.connect(serverConfig);

            let relativePath;
            const fileInfo = this.remoteFiles.get(document.uri.toString());
            
            if (fileInfo) {
                relativePath = fileInfo.remotePath;
            } else {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error(this.i18n.status.noWorkspace);
                }
                
                // 获取相对于工作区的路径
                const relativeToWorkspace = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
                // 拼接到服务器配置的远程路径
                relativePath = path.posix.join(serverConfig.remotePath, relativeToWorkspace.replace(/\\/g, '/'));
            }

            // 确保远程目录存在
            const remoteDir = path.dirname(relativePath);
            try {
                await tempManager.mkdir(remoteDir, true);
                this.log(`[${serverConfig.name}] ${this.i18n.status.directoryCreated}: ${remoteDir}`, 'info');
            } catch (err: any) {
                this.log(`[${serverConfig.name}] ${this.i18n.status.directoryCreateFailed}: ${err.message}`, 'warning');
            }

            await tempManager.writeFile(relativePath, document.getText());
            
            this.log(`[${serverConfig.name}] ${this.i18n.status.uploadSuccess}: ${relativePath}`, 'info');
            this.statusBar.showMessage(this.i18n.status.uploadSuccess, 'info');

            // 断开连接
            tempManager.disconnect();
            
            // 刷新文件浏览器
            this.refresh();

        } catch (error: any) {
            this.log(`[${serverConfig.name}] Failed to upload file: ${error.message}`, 'error');
            this.statusBar.showMessage(`上传失败: ${error.message}`, 'error');
        }
    }

    // 上传到所有服务器
    async uploadToAllServers(document: vscode.TextDocument) {
        const servers = this.getServers();
        if (servers.length === 0) {
            vscode.window.showInformationMessage(this.i18n.messages.noServersConfigured);
            return;
        }

        let successCount = 0;
        let failCount = 0;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: this.i18n.status.uploading,
            cancellable: false
        }, async (progress) => {
            const total = servers.length;
            
            for (let i = 0; i < servers.length; i++) {
                const server = servers[i];
                progress.report({ 
                    message: `${this.i18n.status.uploading} ${server.name} (${i + 1}/${total})`,
                    increment: (100 / total)
                });

                try {
                    await this.uploadToServer(document, server);
                    successCount++;
                } catch (error: any) {
                    failCount++;
                    this.log(this.i18n.messages.operationFailed.replace('{0}', `${server.name}: ${error.message}`), 'error');
                }
            }
        });

        if (failCount === 0) {
            vscode.window.showInformationMessage(this.i18n.messages.uploadComplete);
        } else {
            vscode.window.showWarningMessage(
                this.i18n.messages.uploadPartialSuccess.replace('{0}', successCount.toString()).replace('{1}', failCount.toString())
            );
        }
    }

    async downloadRemoteFile(item: ExplorerItem) {
        try {
            this.setOperationStatus(true);
            if (!this.currentServer) {
                throw new Error('No server connected');
            }

            this.log(`[${this.currentServer.name}] 开始下载文件: ${item.path}`, 'info');
            this.statusBar.showProgress(this.i18n.status.downloading);

            // 获取文件内容
            const content = await this.sftpManager.readFile(item.path);

            // 计算相对路径：从远程根路径到文件的相对路径
            let relativePath = item.path;
            if (item.path.startsWith(this.currentServer.remotePath)) {
                relativePath = item.path.substring(this.currentServer.remotePath.length);
            }
            // 确保路径分隔符正确且移除开头的斜杠
            relativePath = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');

            // 获取工作区根目录
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let localPath: string;

            if (workspaceFolder) {
                // 如果有工作区，使用工作区路径
                localPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            } else {
                // 如果没有工作区，让用户选择保存位置
                const defaultPath = path.join(os.homedir(), relativePath);
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultPath),
                    filters: {
                        'All Files': ['*']
                    }
                });

                if (!uri) {
                    return; // 用户取消了保存
                }
                localPath = uri.fsPath;
            }

            // 确保目标目录存在
            const targetDir = path.dirname(localPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 写入文件
            await vscode.workspace.fs.writeFile(vscode.Uri.file(localPath), Buffer.from(content));
            
            this.log(`[${this.currentServer.name}] 文件下载成功:
远程路径: ${item.path}
本地路径: ${localPath}`, 'info');
            this.statusBar.showMessage(`文件已下载到: ${localPath}`, 'info');
        } finally {
            this.setOperationStatus(false);
        }
    }
    
    async deleteRemoteFile(item: ExplorerItem) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const showConfirmDialog = config.get('showConfirmDialog', true);
        
        let shouldDelete = true;
        if (showConfirmDialog) {
            const result = await vscode.window.showWarningMessage(
                getLocaleText().messages.confirmDelete.replace('{0}', path.basename(item.path)),
                getLocaleText().settings.yes,
                getLocaleText().settings.no
            );
            shouldDelete = (result === getLocaleText().settings.yes);
        }
        
        if (!shouldDelete) {
            return;
        }
        
        try {
            this.setOperationStatus(true);
            if (!this.currentServer) {
                throw new Error(getLocaleText().messages.noServer);
            }

            if (item.isDirectory) {
                await this.sftpManager.rmdir(item.path, true);
                this.log(`[${this.currentServer.name}] ${getLocaleText().status.directoryDeleted}: ${item.path}`, 'info');
            } else {
                await this.sftpManager.deleteFile(item.path);
                this.log(`[${this.currentServer.name}] ${getLocaleText().status.fileDeleted}: ${item.path}`, 'info');
            }

            this.refresh();
        } catch (error: any) {
            this.log(`[${this.currentServer?.name}] ${getLocaleText().messages.operationFailed.replace('{0}', error.message)}`, 'error');
            vscode.window.showErrorMessage(getLocaleText().messages.operationFailed.replace('{0}', error.message));
        } finally {
            this.setOperationStatus(false);
        }
    }

    // 获取当前活动的服务器
    public getCurrentServer(): ServerConfig | undefined {
        return this.currentServer;
    }

    disconnectAllServers() {
        this.sftpManager.disconnect();
        this.currentServer = undefined;
        this.remoteFiles.clear();
        this.refresh();
    }

    // 添加上传目录的方法
    async uploadDirectory(folderUri: vscode.Uri, serverConfig: ServerConfig) {
        const i18n = getLocaleText();
        try {
            this.statusBar.showProgress(i18n.status.uploading);
            this.log(`[${serverConfig.name}] ${i18n.status.uploadingDirectory}: ${folderUri.fsPath}`, 'info');

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error(i18n.status.noWorkspace);
            }

            // 计算相对路径
            const relativePath = path.relative(workspaceFolder.uri.fsPath, folderUri.fsPath);
            const remoteBasePath = path.join(serverConfig.remotePath, relativePath).replace(/\\/g, '/');

            // 连接到服务器
            const tempManager = new SftpManager();
            await tempManager.connect(serverConfig);

            // 创建远程目录
            await tempManager.mkdir(remoteBasePath, true);

            // 递归上传文件
            const uploadFiles = async (localDir: string, remoteDir: string) => {
                const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(localDir));
                
                for (const [name, type] of files) {
                    const localPath = path.join(localDir, name);
                    const remotePath = path.join(remoteDir, name).replace(/\\/g, '/');

                    if (type === vscode.FileType.Directory) {
                        await tempManager.mkdir(remotePath, true);
                        await uploadFiles(localPath, remotePath);
                    } else {
                        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
                        await tempManager.writeFile(remotePath, content.toString());
                    }
                }
            };

            await uploadFiles(folderUri.fsPath, remoteBasePath);
            
            this.log(`[${serverConfig.name}] ${i18n.status.uploadDirectorySuccess}: ${remoteBasePath}`, 'info');
            this.statusBar.showMessage(i18n.status.uploadSuccess, 'info');

            tempManager.disconnect();
            this.refresh();
        } catch (error: any) {
            this.log(`[${serverConfig.name}] ${i18n.messages.operationFailed.replace('{0}', error.message)}`, 'error');
            this.statusBar.showMessage(i18n.messages.operationFailed.replace('{0}', error.message), 'error');
        }
    }
}

export class ExplorerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly path: string,
        public readonly isDirectory: boolean
    ) {
        super(label, collapsibleState);
        this.tooltip = this.path;
        
        this.contextValue = isDirectory ? 'directory' : 'file';
        if (!isDirectory) {
            this.command = {
                command: 'sftp-tools.openFile',
                title: 'Open File',
                arguments: [this]
            };
        }
    }
} 