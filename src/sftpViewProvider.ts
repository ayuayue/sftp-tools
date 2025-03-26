import * as vscode from 'vscode';
import { SftpManager } from './sftpManager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { StatusBarManager } from './statusBarManager';
import { getLocaleText } from './i18n';
import { Logger } from './utils/logger';
import { SettingsEditor } from './settingsEditor';

// 定义 ServerConfig 接口
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
    private _view?: vscode.WebviewPanel;
    private settingsEditor: SettingsEditor;
    constructor() {
        this.initConfigFilePath();
        // 监听配置文件变化
        this.watchConfigFile();
        this.settingsEditor = new SettingsEditor();
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
    public loadServersFromFile(): ServerConfig[] {
        try {
            if (this.configFilePath && fs.existsSync(this.configFilePath)) {
                const configContent = fs.readFileSync(this.configFilePath, 'utf8');
                console.log('Loaded servers from file:', configContent);
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
    private logger: Logger = Logger.getInstance();
    private statusBarItem: vscode.StatusBarItem;
    private serversProvider: SftpServersProvider;  // 添加引用
    private statusBar: StatusBarManager = StatusBarManager.getInstance();
    private hasActiveOperations: boolean = false;
    private i18n = getLocaleText();
    private settingsEditor: SettingsEditor;

    constructor(serversProvider: SftpServersProvider) {  // 通过构造函数注入
        this.serversProvider = serversProvider;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        
        // 初始化时显示日志面板
        this.logger.show(true);

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
                    this.logger.log(`Cleaned up temp file: ${fileInfo.tempPath}`, 'info');
                } catch (error) {
                    this.logger.log(`Failed to cleanup temp file: ${fileInfo.tempPath}`, 'error');
                }
            }
        });

        this.settingsEditor = new SettingsEditor();
    }

    private async updateCurrentServer() {
        if (this.currentServer) {
            const servers: ServerConfig[] = this.serversProvider.loadServersFromFile();
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
            
            // 连接时显示日志
            this.logger.log(this.i18n.status.connected, 'info', server.name);
            this.logger.show(true);
        } catch (error: any) {
            // 错误时自动显示日志
            this.logger.log(error.message, 'error', server.name);
            vscode.window.showErrorMessage(this.i18n.messages.operationFailed.replace('{0}', error.message));
        }
    }

    async disconnectServer(): Promise<void> {
        if (this.sftpManager) {
            await this.sftpManager.disconnect();
            this.sftpManager = new SftpManager();
        }
        // 清空当前服务器
        this.currentServer = undefined;
        // 清空远程文件列表
        this.remoteFiles.clear();
        // 刷新视图
        this._onDidChangeTreeData.fire();
        // 更新状态栏
        this.statusBar.clear();
        // 更新服务器面板状态
        this.serversProvider.setActiveServer('');
        // 记录日志
        this.logger.log(this.i18n.status.disconnected, 'info');
    }

    getTreeItem(element: ExplorerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ExplorerItem): Promise<ExplorerItem[]> {
        // 如果没有连接到服务器，返回空数组
        if (!this.currentServer || !this.sftpManager) {
            return [];
        }

        try {
            if (!element) {
                // 根目录
                return this.getRemoteFiles(this.currentServer.remotePath);
            } else {
                // 子目录
                return this.getRemoteFiles(element.path);
            }
        } catch (error: any) {
            // 如果获取文件列表失败，可能是连接断开了
            this.logger.log(`获取远程文件列表失败: ${error.message}`, 'error');
            // 断开连接并清空显示
            this.disconnectServer();
            return [];
        }
    }

    async openFile(item: ExplorerItem, nonPreview: boolean = false) {
        try {
            if (!this.currentServer) {
                throw new Error(this.i18n.messages.noServer);
            }

            // 创建临时文件
            const tempDir = path.join(os.tmpdir(), 'sftp-tools');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // 使用原始文件名创建临时文件，保留扩展名
            const fileName = path.basename(item.path);
            const tempPath = path.join(tempDir, fileName);

            // 读取远程文件内容
            const content = await this.sftpManager.readFileAsBuffer(item.path);
            
            // 写入临时文件
            fs.writeFileSync(tempPath, content);

            // 打开文件
            const uri = vscode.Uri.file(tempPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: !nonPreview });

            // 记录文件信息
            this.remoteFiles.set(uri.toString(), {
                remotePath: item.path,
                serverConfig: this.currentServer,
                tempPath: tempPath
            });

        } catch (error: any) {
            this.logger.log(`[${this.currentServer?.name}] ${this.i18n.messages.operationFailed.replace('{0}', error.message)}`, 'error');
            vscode.window.showErrorMessage(this.i18n.messages.operationFailed.replace('{0}', error.message));
        }
    }

    // 添加辅助方法判断是否是二进制文件
    private isBinaryFile(ext: string): boolean {
        const binaryExtensions = [
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',  // 压缩文件
            '.exe', '.dll', '.so', '.dylib',               // 可执行文件
            '.pdf', '.doc', '.docx', '.xls', '.xlsx',      // 文档
            '.jpg', '.jpeg', '.png', '.gif', '.bmp',       // 图片
            '.mp3', '.mp4', '.avi', '.mov',                // 媒体文件
            '.iso', '.bin', '.dat'                         // 其他二进制
        ];
        return binaryExtensions.includes(ext);
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
            'php': 'php',
            'html': 'html',
            'css': 'css',
            'less': 'less',
            'sass': 'sass',
            'scss': 'scss',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'toml': 'toml',
            'ini': 'ini',
            'conf': 'ini',
            'cfg': 'ini',
            'go': 'go',
            'java': 'java',
            'kt': 'kotlin',
            'kts': 'kotlin',
            'py': 'python',
            'rb': 'ruby',
            'sh': 'bash',
            'sql': 'sql',
            'log': 'log',
            'csv': 'csv',
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
                this.logger.log(`[${this.currentServer?.name}] 开始上传本地文件: ${document.uri.fsPath}`, 'info');
                await this.uploadToServer(document, this.currentServer!);
                return;
            }

            const serverDisplay = this.getServerDisplayName(fileInfo.serverConfig);
            this.statusBar.showProgress(this.i18n.status.uploading);
            this.logger.log(`[${this.currentServer?.name}] 开始上传文件: ${fileInfo.remotePath}`, 'info');

            // 根据文件类型选择不同的读取方式
            let content: Buffer;
            if (this.isTextFile(document.languageId)) {
                content = Buffer.from(document.getText());
            } else {
                content = Buffer.from(await vscode.workspace.fs.readFile(document.uri));
            }

            await this.sftpManager.writeFile(fileInfo.remotePath, content);
            
            this.logger.log(`[${this.currentServer?.name}] 文件上传成功: ${fileInfo.remotePath}`, 'info');
            this.statusBar.showMessage(`文件已上传到 [${serverDisplay}]`, 'info');
        } finally {
            this.setOperationStatus(false);
        }
    }

    // 辅助方法：判断是否是文本文件
    private isTextFile(languageId: string): boolean {
        const textLanguages = [
            'plaintext', 'text', 'markdown', 'html', 'xml', 'json', 'javascript', 
            'typescript', 'css', 'less', 'scss', 'yaml', 'ini', 'properties'
        ];
        return textLanguages.some(lang => languageId.includes(lang));
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
        return this.serversProvider.loadServersFromFile();
    }

    // 上传到当前服务器
    async uploadToCurrentServer(uri: vscode.Uri) {
        if (!this.currentServer) {
            throw new Error(this.i18n.messages.noServer);
        }
        const content = await vscode.workspace.fs.readFile(uri);
        await this.uploadFileContent(uri, content, this.currentServer);
    }

    // 上传到指定服务器
    async uploadToServer(document: vscode.TextDocument, serverConfig: ServerConfig) {
        const content = await vscode.workspace.fs.readFile(document.uri);
        await this.uploadFileContent(document.uri, content, serverConfig);
    }

    // 上传到所有服务器
    async uploadToAllServers(document: vscode.TextDocument) {
        const servers = this.getServers();
        const content = await vscode.workspace.fs.readFile(document.uri);
        
        let successCount = 0;
        let failCount = 0;

        for (const server of servers) {
            try {
                await this.uploadFileContent(document.uri, content, server);
                successCount++;
            } catch (error: any) {
                failCount++;
                this.logger.log(`[${server.name}] ${this.i18n.messages.operationFailed.replace('{0}', error.message)}`, 'error');
            }
        }

        // 显示上传结果
        this.logger.log(this.i18n.messages.uploadPartialSuccess
            .replace('{0}', successCount.toString())
            .replace('{1}', failCount.toString()), 
            failCount > 0 ? 'warning' : 'info'
        );
    }

    async downloadRemoteFile(item: ExplorerItem) {
        try {
            this.setOperationStatus(true);
            if (!this.currentServer) {
                throw new Error('No server connected');
            }

            // 获取工作区根目录
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error(this.i18n.status.noWorkspace);
            }

            // 计算相对路径：从远程根路径到文件的相对路径
            let relativePath = item.path;
            if (item.path.startsWith(this.currentServer.remotePath)) {
                relativePath = item.path.substring(this.currentServer.remotePath.length);
            }
            // 确保路径分隔符正确且移除开头的斜杠
            relativePath = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');

            // 构建本地路径
            const localPath = path.join(workspaceFolder.uri.fsPath, relativePath);

            this.logger.log(`[${this.currentServer.name}] 开始下载文件: ${item.path}`, 'info');
            this.statusBar.showProgress(this.i18n.status.downloading);

            // 获取文件内容（作为 Buffer）
            const content = await this.sftpManager.readFileAsBuffer(item.path);

            // 确保目标目录存在
            const targetDir = path.dirname(localPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 写入文件
            await vscode.workspace.fs.writeFile(vscode.Uri.file(localPath), content);
            
            this.logger.log(`[${this.currentServer.name}] 文件下载成功: ${localPath}`, 'info');
            this.statusBar.showMessage(this.i18n.status.downloadSuccess, 'info');

        } catch (error: any) {
            this.logger.log(`[${this.currentServer?.name}] 下载失败: ${error.message}`, 'error');
            vscode.window.showErrorMessage(`下载失败: ${error.message}`);
        } finally {
            this.setOperationStatus(false);
        }
    }
    
    async deleteRemoteFile(item: ExplorerItem) {
        const settings = this.settingsEditor.getSettings();
        const showConfirmDialog = settings.showConfirmDialog;
        
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

            // 检查是否是备份目录
            if (item.path.includes(this.sftpManager.backupPath)) {
                const answer = await vscode.window.showWarningMessage(
                    getLocaleText().messages.backupDirDelete,
                    getLocaleText().messages.backupDirDeleteConfirm,
                    getLocaleText().messages.backupDirDeleteCancel
                );
                
                if (answer !== getLocaleText().messages.backupDirDeleteConfirm) {
                    return;
                }
            } else {
                // 不是备份目录，正常备份
                await this.handleFileBackup(item.path, item.isDirectory);
            }

            if (item.isDirectory) {
                await this.sftpManager.rmdir(item.path, true);
                this.logger.log(`[${this.currentServer.name}] ${getLocaleText().status.directoryDeleted}: ${item.path}`, 'info');
            } else {
                await this.sftpManager.deleteFile(item.path);
                this.logger.log(`[${this.currentServer.name}] ${getLocaleText().status.fileDeleted}: ${item.path}`, 'info');
            }

            this.refresh();
        } catch (error: any) {
            this.logger.log(`[${this.currentServer?.name}] ${getLocaleText().messages.operationFailed.replace('{0}', error.message)}`, 'error');
            vscode.window.showErrorMessage(getLocaleText().messages.operationFailed.replace('{0}', error.message));
        } finally {
            this.setOperationStatus(false);
        }
    }

    // 获取当前活动的服务器
    public getCurrentServer(): ServerConfig | undefined {
        return this.currentServer;
    }

    disconnectAllServers(): void {
        this.disconnectServer();
    }

    // 添加上传目录的方法
    async uploadDirectory(folderUri: vscode.Uri, serverConfig: ServerConfig) {
        const i18n = getLocaleText();
        try {
            this.statusBar.showProgress(i18n.status.uploading);
            this.logger.log(`[${serverConfig.name}] ${i18n.status.uploadingDirectory}: ${folderUri.fsPath}`, 'info');

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

            // 检查远程目录是否存在，如果存在则备份
            try {
                await tempManager.stat(remoteBasePath);
                // 如果目录存在，先备份
                await this.handleFileBackup(remoteBasePath, true);
            } catch (error) {
                // 目录不存在，不需要备份
            }

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
                        // 读取文件内容为 Buffer
                        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
                        // 直接传输 Buffer，不进行字符串转换
                        await tempManager.writeFile(remotePath, Buffer.from(content));
                        
                        // 记录上传日志
                        this.logger.log(`[${serverConfig.name}] Uploaded: ${remotePath}`, 'info');
                    }
                }
            };

            await uploadFiles(folderUri.fsPath, remoteBasePath);
            
            this.logger.log(`[${serverConfig.name}] ${i18n.status.uploadDirectorySuccess}: ${remoteBasePath}`, 'info');
            this.statusBar.showMessage(i18n.status.uploadSuccess, 'info');

            tempManager.disconnect();
            this.refresh();
        } catch (error: any) {
            this.logger.log(`[${serverConfig.name}] ${i18n.messages.operationFailed.replace('{0}', error.message)}`, 'error');
            this.statusBar.showMessage(i18n.messages.operationFailed.replace('{0}', error.message), 'error');
        }
    }

    // 添加新方法处理文件内容上传
    async uploadFileContent(uri: vscode.Uri, content: Uint8Array, serverConfig: ServerConfig) {
        const tempManager = new SftpManager();
        try {
            this.setOperationStatus(true);
            this.statusBar.showProgress(this.i18n.status.uploading);
            
            // 连接到目标服务器
            await tempManager.connect(serverConfig);

            let remotePath: string;
            const fileInfo = this.remoteFiles.get(uri.toString());
            
            if (fileInfo) {
                // 如果是已知的远程文件，使用其远程路径
                remotePath = fileInfo.remotePath;
            } else {
                // 如果是本地文件，计算相对路径
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error(this.i18n.status.noWorkspace);
                }
                
                // 计算相对于工作区的路径
                const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                // 拼接到服务器配置的远程路径
                remotePath = path.posix.join(serverConfig.remotePath, relativePath.replace(/\\/g, '/'));
            }

            // 确保远程目录存在
            const remoteDir = path.dirname(remotePath);
            await tempManager.mkdir(remoteDir, true);

            // 检查文件是否存在，只在文件存在时才备份
            let needBackup = false;
            try {
                await tempManager.stat(remotePath);
                needBackup = true;
            } catch (error) {
                needBackup = false;
            }

            // 如果需要备份，则使用临时管理器进行备份
            if (needBackup) {
                try {
                    // 使用新的配置系统
                    const settings = this.settingsEditor.getSettings();
                    const backupPath = settings.uploadOrDeleteBackup;
                    if (backupPath && backupPath.trim() !== '') {
                        const backupFilePath = await tempManager.backupFile(remotePath, backupPath);
                        this.logger.log(this.i18n.messages.fileBackedUp.replace('{0}', backupFilePath), 'info');
                    }
                } catch (error: any) {
                    this.logger.log(this.i18n.messages.backupFailed.replace('{0}', error.message), 'warning');
                }
            }

            // 上传文件内容
            await tempManager.writeFile(remotePath, Buffer.from(content));
            
            this.logger.log(`[${serverConfig.name}] ${this.i18n.status.uploadSuccess}: ${remotePath}`, 'info');
            this.statusBar.showMessage(this.i18n.status.uploadSuccess, 'info');
            
            // 刷新文件浏览器
            this.refresh();
        } catch (error: any) {
            this.logger.log(`[${serverConfig.name}] Failed to upload file: ${error.message}`, 'error');
            this.statusBar.showMessage(`上传失败: ${error.message}`, 'error');
            throw error;
        } finally {
            tempManager.disconnect();
            this.setOperationStatus(false);
        }
    }

    /**
     * 处理文件备份
     */
    private async handleFileBackup(remotePath: string, isDirectory: boolean = false): Promise<string | null> {
        const settings = this.settingsEditor.getSettings();
        const backupPath = settings.uploadOrDeleteBackup;
        const i18n = getLocaleText();
        
        // 修改判断条件，确保空字符串时不执行备份
        if (!backupPath || backupPath.trim() === '') {
            this.logger.log(i18n.messages.backupDisabled, 'info');
            return null;
        }

        this.logger.log(i18n.messages.backupPathSet.replace('{0}', backupPath), 'info');

        try {
            let backupFilePath: string;
            if (isDirectory) {
                backupFilePath = await this.sftpManager.backupDirectory(remotePath, backupPath);
                this.logger.log(i18n.messages.directoryBackedUp.replace('{0}', backupFilePath), 'info');
            } else {
                backupFilePath = await this.sftpManager.backupFile(remotePath, backupPath);
                this.logger.log(i18n.messages.fileBackedUp.replace('{0}', backupFilePath), 'info');
            }
            return backupFilePath;
        } catch (error: any) {
            this.logger.log(i18n.messages.backupFailed.replace('{0}', error.message), 'warning');
            return null;
        }
    }

    private async getRemoteFiles(path: string): Promise<ExplorerItem[]> {
        const files = await this.sftpManager.listFiles(path);
        return files.map(file => new ExplorerItem(
            file.filename,
            file.longname.startsWith('d') ? 
                vscode.TreeItemCollapsibleState.Collapsed : 
                vscode.TreeItemCollapsibleState.None,
            `${path}/${file.filename}`.replace(/\/+/g, '/'),
            file.longname.startsWith('d')
        ));
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