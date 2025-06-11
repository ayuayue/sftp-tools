import * as vscode from "vscode";
import { ServerItem } from "./sftpViewProvider";
import path from "path";
import { getLocaleText } from "./i18n";
import * as fs from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { WorkspaceConfig } from "./types";

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
  workspacePath: string;
}

declare global {
  interface Window {
    acquireVsCodeApi(): any;
  }
}

// 配置文件名
const CONFIG_FILE_NAME = "sftp-tools.json";

export class SettingsEditor {
  private config: WorkspaceConfig = {
    servers: [],
    settings: {
      showConfirmDialog: true,
      uploadOrDeleteBackup: '',
      enableAutoUpload: false // 修正属性名并添加默认值
    }
  };

  public static readonly viewType = "sftp-tools.settingsEditor";
  private _view?: vscode.WebviewPanel;
  private configFilePath: string = "";

  constructor(private readonly _extensionUri?: vscode.Uri) {
    this.initConfigFilePath();
    this.initConfig();
  }

  private initConfig() {
    try {
      // 1. 先从 VSCode 配置中读取现有设置
      const vscodeConfig = vscode.workspace.getConfiguration('sftp-tools');
      const showConfirmDialog = vscodeConfig.get('showConfirmDialog', true);
      const uploadOrDeleteBackup = vscodeConfig.get('uploadOrDeleteBackup', '');
      // 读取新的配置项，如果不存在则使用默认值 false
      const enableAutoUpload = vscodeConfig.get('enableAutoUpload', false);

      // 2. 初始化默认配置
      this.config = {
        servers: [],
        settings: {
          showConfirmDialog,
          uploadOrDeleteBackup,
          enableAutoUpload // 添加新的配置项
        }
      };

      // 3. 尝试从文件加载配置
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const loadedConfig = JSON.parse(content);
        // 合并配置，保留已有设置
        this.config = {
          servers: loadedConfig.servers || [],
          settings: {
            ...this.config.settings,
            ...loadedConfig.settings
          }
        };
      }

      // 4. 保存配置到文件
      this.saveConfig();

      // 5. 清除 VSCode 配置中的设置
      vscodeConfig.update('showConfirmDialog', undefined, true);
      vscodeConfig.update('uploadOrDeleteBackup', undefined, true);
      vscodeConfig.update('useGlobalConfig', undefined, true);
      vscodeConfig.update('enableAutoUpload', undefined, true); // 清理旧的或迁移的 VSCode 配置

    } catch (error) {
      console.error('Failed to initialize config:', error);
    }
  }

  private initConfigFilePath() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "未找到工作区文件夹，请确保打开了一个工作区。"
      );
      return;
    }
    // 创建 .vscode 文件夹（如果不存在）
    const vscodePath = path.join(workspaceFolder.uri.fsPath, ".vscode");
    if (!fs.existsSync(vscodePath)) {
      fs.mkdirSync(vscodePath, { recursive: true });
    }
    this.configFilePath = path.join(vscodePath, CONFIG_FILE_NAME);
    // 检查是否需要迁移旧版本配置
    this.migrateFromOldConfig();
  }

  // 从旧版本配置迁移
  private migrateFromOldConfig(): void {
    try {
      // 如果新配置文件已经存在，则不进行迁移
      if (fs.existsSync(this.configFilePath)) {
        return;
      }

      // 获取旧版本配置
      const config = vscode.workspace.getConfiguration("sftp-tools");
      const oldServers = config.get("servers");

      // 如果存在旧配置，则迁移
      if (oldServers && Array.isArray(oldServers) && oldServers.length > 0) {
        console.log("Migrating old sftp-tools configuration...");

        // 保存到新配置文件
        this.saveServersToFile(oldServers);

        // 显示迁移成功消息
        vscode.window.showInformationMessage(
          getLocaleText().status.configMigrated ||
            "已成功将旧版配置迁移到新版格式。"
        );
        vscode.commands.executeCommand("sftp-tools.refreshServers");
        vscode.workspace.getConfiguration("sftp-tools").update("servers", []);
      }
    } catch (error) {
      console.error("Failed to migrate configuration:", error);
    }
  }

  // 从文件加载服务器配置
  private loadServersFromFile(): ServerConfig[] {
    try {
      if (this.configFilePath && fs.existsSync(this.configFilePath)) {
        const configContent = fs.readFileSync(this.configFilePath, "utf8");
        const servers = JSON.parse(configContent).servers || [];
        // 确保每个服务器对象都包含必要的字段
        return servers.map((server: any) => ({
          name: server.name || "",
          host: server.host || "",
          port: server.port || 22,
          username: server.username || "",
          password: server.password || undefined,
          privateKeyPath: server.privateKeyPath || undefined,
          passphrase: server.passphrase || undefined,
          workspacePath: server.workspacePath || "/",
          remotePath: server.remotePath || "/",
        }));
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("加载配置失败: " + error.message);
    }
    return [];
  }

  // 将服务器配置保存到文件
  private saveServersToFile(servers: ServerConfig[]): boolean {
    try {
      if (this.configFilePath) {
        const configData = { servers };
        fs.writeFileSync(
          this.configFilePath,
          JSON.stringify(configData, null, 2),
          "utf8"
        );
        return true;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("保存配置失败: " + error.message);
    }
    return false;
  }

  public async showSettingsEditor(serverToEdit?: ServerItem) {
    if (this._view) {
      this._view.reveal(vscode.ViewColumn.One);
      return;
    }

    // 检查 _extensionUri 是否存在
    if (!this._extensionUri) {
        throw new Error('Extension URI is not available');
    }

    this._view = vscode.window.createWebviewPanel(
      "sftpSettings",
      "SFTP Tools Settings",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri!, "out"),
          vscode.Uri.joinPath(this._extensionUri!, "src", "webview"),
        ],
      }
    );

    const servers = this.loadServersFromFile();
    this._view.webview.html = this.getWebviewContent();

    setTimeout(() => {
      this._view?.webview.postMessage({
        command: "loadSettings",
        servers,
        serverToEdit,
      });
    }, 100);

    this._view.onDidDispose(() => {
      this._view = undefined;
    });

    this._view.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.command) {
          case "loadSettings":
            let servers;
            try {
              servers = message.servers; // 解析 JSON 字符串为数组
            } catch (error: any) {
              throw new Error("解析服务器配置失败: " + error.message);
            }
            if (!Array.isArray(JSON.parse(servers))) {
              throw new Error("服务器配置无效，必须是数组");
            }
            if (this._view) {
              this._view.webview.postMessage({
                command: "saveSettings",
                servers: JSON.stringify(servers),
              });
            }
            console.log("Received servers:", message.servers);
            break;
          case "saveSettings":
            try {
              const servers = message.servers; // 解析 JSON 字符串为数组
              if (!Array.isArray(servers)) {
                throw new Error("服务器配置无效，必须是数组");
              }
              // 验证密钥文件配置
              for (let i = 0; i < servers.length; i++) {
                const server = servers[i];
                if (!server.password && !server.privateKeyPath) {
                  throw new Error(
                    `服务器 "${server.name}" 未配置认证信息，请配置密码或密钥文件`
                  );
                }
              }
              this.saveServersToFile(servers);
              vscode.commands.executeCommand(
                "sftp-tools.disconnectAllServers"
              );
              vscode.commands.executeCommand("sftp-tools.refreshServers");
              vscode.window.showInformationMessage(
                getLocaleText().status.settingsSaved
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(`保存失败: ${error.message}`);
            }
            break;
          case "selectKeyFile":
            try {
              const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: getLocaleText().settings.selectPrivateKey,
                filters: {
                  "All files": ["*"],
                },
              });

              if (result && result.length > 0) {
                const path = result[0].fsPath;
                // 发送选择的文件路径回 webview
                this._view?.webview.postMessage({
                  command: "keyFileSelected",
                  index: message.index,
                  path: path,
                });
              }
            } catch (error: any) {
              vscode.window.showErrorMessage(`选择文件失败: ${error.message}`);
            }
            break;
          case "confirmDelete":
            const i18n = getLocaleText();
            const answer = await vscode.window.showWarningMessage(
              i18n.settings.deleteConfirm,
              i18n.settings.yes,
              i18n.settings.no
            );
            if (answer === i18n.settings.yes) {
              // 用户确认删除，通知 webview
              this._view?.webview.postMessage({
                command: "deleteConfirmed",
                index: message.index,
              });
            }
            break;
          case "deleteConfirmed":
            this.removeServer(message.index);
            break;
          case "updateOtherSetting":
            try {
                // 更新我们的配置系统
                this.updateSettings({ [message.setting]: message.value });
                vscode.commands.executeCommand("sftp-tools.refreshServers");
                vscode.window.showInformationMessage(getLocaleText().status.settingsSaved);
            } catch (error: any) {
                vscode.window.showErrorMessage(getLocaleText().messages.settingsSaveFailed);
            }
            break;
          default:
            const errorAnswer = await vscode.window.showWarningMessage(
              "Invalid command received. Please check your input.",
              "OK"
            );
            this._view?.webview.postMessage({
              command: "error",
              message: errorAnswer,
            });
        }
      } catch (error: any) {
        vscode.window.showErrorMessage("Failed to save settings" + error.message);
      }
    });
  }

  private getWebviewContent(): string {
    const i18n = getLocaleText();
    const nonce = getNonce();
    const serversJson = JSON.stringify(this.loadServersFromFile());

    // 读取全局配置
    // const config = vscode.workspace.getConfiguration("sftp-tools"); // 不再需要从 vscode config 读取这些
    // const showDeleteConfirm = config.get("showConfirmDialog", true);
    // const uploadOrDeleteBackup = config.get("uploadOrDeleteBackup", "");
    const settings = this.getSettings(); // 从我们自己的配置系统中获取

    // 修改 CSP 策略
    const csp = `
            default-src 'none';
            style-src 'unsafe-inline';
            script-src 'nonce-${nonce}';
            frame-src 'none';
            sandbox allow-scripts;
        `;

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="zh-cn">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="${csp.replace(
              /\s+/g,
              " "
            )}">
            <title>${i18n.settings.title}</title>
            <style>
                :root {
                    --container-padding: 20px;
                    --input-padding-vertical: 6px;
                    --input-padding-horizontal: 12px;
                }
                
                body, html {
                    height: 100%;
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                }
                
                .app-container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    padding: 20px;
                    box-sizing: border-box;
                }

                .settings-section {
                    margin-bottom: 20px;
                }

                .form-group {
                    margin-bottom: 15px;
                }

                .form-group label {
                    display: block;
                    margin-bottom: 5px;
                }

                .form-group input[type="text"] {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }

                .form-group input[type="checkbox"] {
                    margin-right: 8px;
                }

                .description {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                    margin-top: 5px;
                }

                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                }

                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                /* 头部样式 */
                .header {
                    padding: 10px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: var(--vscode-sideBar-background);
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                /* 设置选项卡样式 */
                .settings-tab-bar {
                    display: flex;
                    background-color: var(--vscode-sideBar-background);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    overflow-x: auto;
                }
                
                .settings-tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    white-space: nowrap;
                    border-bottom: 2px solid transparent;
                    color: var(--vscode-foreground);
                    opacity: 0.8;
                    transition: all 0.2s ease;
                }
                
                .settings-tab:hover {
                    opacity: 1;
                }
                
                .settings-tab.active {
                    border-bottom-color: var(--vscode-activityBar-activeBorder);
                    opacity: 1;
                    font-weight: 500;
                }
                
                /* 面板样式 */
                .settings-panel {
                    display: none;
                    padding: 20px;
                    width: 100%;
                }
                
                .settings-panel.active {
                    display: block;
                }
                
                /* 侧边栏样式 */
                .sidebar {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    width: 250px;
                    background-color: var(--vscode-sideBar-background);
                    border-right: 1px solid var(--vscode-panel-border);
                }
                
                /* 服务器设置面板特殊样式 */
                #serversSettingsPanel.active {
                    display: flex;
                    padding: 0;
                }
                
                /* 通用设置面板样式 */
                #otherSettingsPanel {
                    max-width: 800px;
                    margin: 0 auto;
                    background-color: var(--vscode-editor-background);
                }
                
                /* 修复服务器名称输入框样式 */
                .server-name-input {
                    width: 100%;
                    display: block;
                    margin-bottom: 0;
                }
                
                /* 确保两个面板完全分离 */
                #otherSettingsPanel,
                #serversSettingsPanel {
                    height: 100%;
                    overflow: auto;
                }
                
                /* 服务器导航项 */
                .server-nav {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    overflow-y: auto;
                }
                
                .server-nav-item {
                    padding: 8px 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    border-left: 3px solid transparent;
                }
                
                .server-nav-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .server-nav-item.active {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                    border-left-color: var(--vscode-activityBar-activeBorder);
                }
                
                .server-nav-item-icon {
                    margin-right: 8px;
                }
                
                /* 主内容区 */
                .main-content {
                    flex: 1;
                    padding: 20px;
                    overflow-y: auto;
                }
                
                /* 服务器卡片 */
                .server-item {
                    background-color: var(--vscode-editor-background);
                    border-radius: 6px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    padding: 0;
                    margin-bottom: 20px;
                }
                
                .box-section {
                    padding: 15px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .box-header {
                    font-weight: bold;
                    margin-bottom: 12px;
                    color: var(--vscode-foreground);
                    opacity: 0.8;
                }
                
                /* 表单元素 */
                .form-group {
                    margin-bottom: 12px;
                    display: flex;
                    flex-direction: column;
                }
                
                .form-group label {
                    margin-bottom: 4px;
                    font-size: 12px;
                    opacity: 0.8;
                }
                
                input[type="text"],
                input[type="password"],
                input[type="number"] {
                    padding: var(--input-padding-vertical) var(--input-padding-horizontal);
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 2px;
                }
                
                input[type="text"]:focus,
                input[type="password"]:focus,
                input[type="number"]:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                
                /* 认证选项 */
                .auth-options {
                    display: flex;
                    margin-bottom: 12px;
                }
                
                .auth-option {
                    padding: 6px 12px;
                    border: 1px solid var(--vscode-panel-border);
                    cursor: pointer;
                    border-radius: 3px;
                    margin-right: 8px;
                    opacity: 0.7;
                }
                
                .auth-option:hover {
                    opacity: 0.9;
                }
                
                .auth-option.active {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-color: var(--vscode-button-background);
                    opacity: 1;
                }
                
                /* 按钮样式 */
                button {
                    padding: 6px 12px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    border-radius: 2px;
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .add-server-btn {
                    margin-right: 8px;
                }
                
                .delete-btn {
                    background-color: var(--vscode-errorForeground);
                }
                
                .delete-btn:hover {
                    opacity: 0.8;
                }
                
                .button-icon {
                    margin-right: 6px;
                }
                
                /* 私钥文件选择器 */
                .key-file-selector {
                    display: flex;
                }
                
                .key-file-selector input {
                    flex: 1;
                    margin-right: 8px;
                }
                
                /* 操作栏 */
                .actions {
                    padding: 12px;
                    display: flex;
                    justify-content: flex-end;
                }
                
                /* 空状态 */
                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    opacity: 0.7;
                    text-align: center;
                }
                
                .empty-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                }
                
                .empty-state h2 {
                    margin-bottom: 12px;
                }
                
                .empty-state-tip {
                    margin-bottom: 8px;
                }
                
                /* 侧边栏头部 */
                .sidebar-header {
                    padding: 10px;
                    font-weight: bold;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                /* 侧边栏底部 */
                .sidebar-footer {
                    padding: 10px;
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                #addServerBtn {
                    width: 100%;
                    justify-content: center;
                }
                
                #saveSettingsBtn {
                    width: 100%;
                    justify-content: center;
                }
                
                /* 开关样式 */
                .setting-item {
                    display: flex;
                    align-items: center;
                    padding: 10px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    justify-content: space-between;
                }
                
                .setting-item-label {
                    flex: 1;
                }
                
                .setting-item-description {
                    margin-top: 4px;
                    font-size: 12px;
                    opacity: 0.8;
                }
                
                .toggle-switch {
                    position: relative;
                    display: inline-block;
                    width: 40px;
                    height: 20px;
                    margin-right: 8px;
                }
                
                .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: var(--vscode-checkbox-background);
                    transition: .4s;
                    border-radius: 10px;
                    border: 1px solid var(--vscode-checkbox-border);
                }
                
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 14px;
                    width: 14px;
                    left: 2px;
                    bottom: 2px;
                    background-color: var(--vscode-checkbox-foreground);
                    transition: .4s;
                    border-radius: 50%;
                }
                
                input:checked + .slider {
                    background-color: var(--vscode-inputOption-activeBackground);
                }
                
                input:checked + .slider:before {
                    transform: translateX(20px);
                }
            </style>
        </head>
        <body>
            <div class="app-container">
                <div class="header">
                    <h3>${i18n.settings.title}</h3>
                </div>
                
                <div class="settings-tab-bar">
                    <div class="settings-tab active" data-tab="servers">${
                      i18n.settings.serverSettings
                    }</div>
                    <div class="settings-tab" data-tab="other">${
                      i18n.settings.otherSettings
                    }</div>
                </div>
                
                <div class="content-container" style="flex: 1; overflow: hidden;">
                    
                    <!-- 服务器设置面板 -->
                    <div id="serversSettingsPanel" class="settings-panel active" style="height: 100%;">
                        <div class="sidebar">
                            <div class="sidebar-header">${
                              i18n.view.servers
                            }</div>
                            <ul class="server-nav" id="serverNav"></ul>
                            <div class="sidebar-footer" style="margin-top: auto;">
                                <button id="addServerBtn" class="add-server-btn">
                                    <span class="codicon codicon-add"></span>
                                    ${i18n.settings.addServer}
                                </button>
                                <button id="saveSettingsBtn" class="primary-btn">
                                    <span class="codicon codicon-save"></span>
                                    ${i18n.settings.saveAll}
                                </button>
                            </div>
                        </div>
                        
                        <div class="main-content">
                            <div id="serverPanels" class="server-list"></div>
                            <div id="emptyState" class="empty-state">
                                <div class="empty-icon">⚙️</div>
                                <h2>${i18n.settings.emptyTip}</h2>
                                <div class="empty-state-tip">
                                    ${i18n.settings.clickAddServerTip}
                                </div>
                                <div class="empty-state-tip">
                                    ${i18n.settings.clickSaveAllTip}
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- 通用设置面板 -->
                    <div id="otherSettingsPanel" class="settings-panel" style="padding: 20px; height: 100%;">
                        <div class="setting-item">
                            <div class="setting-item-label">
                                <div>${i18n.settings.showDeleteConfirm}</div>
                                <div class="setting-item-description">${
                                  i18n.settings.showDeleteConfirmDesc
                                }</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="showDeleteConfirmToggle" ${
                                  settings.showConfirmDialog ? "checked" : ""
                                }>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="setting-item">
                            <div class="setting-item-label">
                                <div>${i18n.settings.uploadOrDeleteBackup}</div>
                                <div class="setting-item-description">${
                                  i18n.settings.uploadOrDeleteBackupDesc
                                }</div>
                            </div>
                            <label class="">
                                <input type="text" id="uploadOrDeleteBackupToggle" value="${
                                  settings.uploadOrDeleteBackup
                                }">
                            </label>
                        </div>
                        <div class="setting-item">
                            <div class="setting-item-label">
                                <div>${i18n.settings.enableAutoUpload || 'Enable Auto Upload'}</div>
                                <div class="setting-item-description">${
                                  i18n.settings.enableAutoUploadDesc || 'Enable or disable file auto upload on save.'
                                }</div>
                                <div class="setting-item-description" style="margin-top: 5px;">${
                                  i18n.settings.autoUploadShortcutHint || ''
                                }</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enableAutoUploadToggle" ${
                                  settings.enableAutoUpload ? "checked" : ""
                                }>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            
            <script nonce="${nonce}">
                // 全局变量
                const vscode = acquireVsCodeApi();
                let servers = ${serversJson};
                let activeServerIndex = 0;
                // 从 settings 对象获取初始值
                let showDeleteConfirm = ${settings.showConfirmDialog};
                let uploadOrDeleteBackup = '${settings.uploadOrDeleteBackup}';
                let enableAutoUpload = ${settings.enableAutoUpload};
                let activeTab = 'servers';

                // 添加消息处理
                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('event listener ',message);
                    switch (message.command) {
                        case 'loadSettings':
                            servers = message.servers || [];
                            serverToEdit = message.serverToEdit || {}
                            activeServerIndex = 0;
                            for (let i = 0; i < servers.length; i++) {
                                console.log(servers[i],serverToEdit);
                                if(servers[i].name == serverToEdit.label){
                                    activeServerIndex = i;
                                    renderServerNav();
                                    break;
                                }
                            }
                            console.log(activeServerIndex);
                            render();
                            break;
                        case 'keyFileSelected':
                            if (message.index !== undefined && message.path) {
                                updateServer(message.index, 'privateKeyPath', message.path);
                                render();
                            }
                            break;
                        case 'deleteConfirmed':
                            removeServer(message.index);
                            break;
                    }
                });
                
                // 删除确认开关
                document.getElementById('showDeleteConfirmToggle').addEventListener('change', (e) => {
                    showDeleteConfirm = e.target.checked;
                    vscode.postMessage({
                        command: 'updateOtherSetting',
                        setting: 'showConfirmDialog',
                        value: showDeleteConfirm
                    });
                });

                // 上传或删除备份
                document.getElementById('uploadOrDeleteBackupToggle').addEventListener('change', (e) => {
                    uploadOrDeleteBackup = e.target.value;
                    vscode.postMessage({
                        command: 'updateOtherSetting',
                        setting: 'uploadOrDeleteBackup',
                        value: uploadOrDeleteBackup
                    });
                });

                // 快捷键上传开关
                document.getElementById('enableAutoUploadToggle').addEventListener('change', (e) => {
                    enableAutoUpload = e.target.checked;
                    vscode.postMessage({
                        command: 'updateOtherSetting',
                        setting: 'enableAutoUpload',
                        value: enableAutoUpload
                    });
                });
                
                // 选项卡切换
                document.querySelectorAll('.settings-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        // 更新选项卡状态
                        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        
                        // 更新面板显示
                        const tabId = tab.dataset.tab;
                        activeTab = tabId;
                        document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.remove('active'));
                        
                        // 确保面板存在再添加 active 类
                        const activePanel = document.getElementById(tabId + 'SettingsPanel');
                        if (activePanel) {
                            activePanel.classList.add('active');
                        } else {
                            console.error('No panel found for tab:', tabId); // 添加错误信息
                        }
                        render();
                    });
                });
                
                // 渲染服务器导航
                function renderServerNav() {
                    const serverNav = document.getElementById('serverNav');
                    serverNav.innerHTML = '';
                    
                    servers.forEach((server, index) => {
                        const li = document.createElement('li');
                        li.className = 'server-nav-item' + (index === activeServerIndex ? ' active' : '');
                        li.dataset.index = String(index);
                        li.innerHTML = \`
                            <span class="server-nav-item-icon">🖥️</span>
                            <span class="server-nav-item-name">\${server.name || '${
                              i18n.settings.enterServerName
                            }'}</span>
                        \`;
                        li.addEventListener('click', () => {
                            activeServerIndex = index;
                            renderServerNav();
                            renderServerPanels();
                        });
                        serverNav.appendChild(li);
                    });
                }
                
                // 渲染服务器面板
                function renderServerPanels() {
                    const serverPanels = document.getElementById('serverPanels');
                    serverPanels.innerHTML = '';
                    
                    if (servers.length > 0) {
                        const server = servers[activeServerIndex];
                        const panel = document.createElement('div');
                        panel.innerHTML = getServerHtml(server, activeServerIndex);
                        serverPanels.appendChild(panel);
                        
                        // 添加事件监听
                        attachInputListeners();
                        attachAuthTypeListeners();
                        attachKeyFileSelectListeners();
                    }
                }
                
                // 获取服务器HTML
                function getServerHtml(server, index) {
                    return \`
                        <div class="server-item">
                            <div class="box-section">
                                <div class="box-header">${
                                  i18n.settings.serverName
                                }</div>
                                <div class="form-group">
                                    <input type="text" class="server-name-input" style="width: 100%;" value="\${server.name || ''}" data-index="\${index}" data-field="name" placeholder="${
                                      i18n.settings.enterServerName
                                    }">
                                </div>
                            </div>
                            <div class="box-section">
                                <div class="box-header">${
                                  i18n.settings.host
                                }</div>
                                <div class="form-group">
                                    <label>${i18n.settings.host}:</label>
                                    <input type="text" value="\${server.host || ''}" data-index="\${index}" data-field="host" placeholder="${
                                      i18n.settings.enterHost
                                    }">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.port}:</label>
                                    <input type="number" value="\${server.port || 22}" data-index="\${index}" data-field="port" placeholder="${
                                      i18n.settings.enterPort
                                    }">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.username}:</label>
                                    <input type="text" value="\${server.username || ''}" data-index="\${index}" data-field="username" placeholder="${
                                      i18n.settings.enterUsername
                                    }">
                                </div>
                            </div>
                            <div class="box-section">
                                <div class="box-header">${
                                  i18n.settings.authType
                                }</div>
                                <div class="auth-options">
                                    <div class="auth-option \${!server.privateKeyPath ? 'active' : ''}" data-auth="password" data-index="\${index}">
                                        ${i18n.settings.authPassword}
                                    </div>
                                    <div class="auth-option \${server.privateKeyPath ? 'active' : ''}" data-auth="key" data-index="\${index}">
                                        ${i18n.settings.authPrivateKey}
                                    </div>
                                </div>
                                <div class="form-group password-group" style="display: \${!server.privateKeyPath ? '' : 'none'};">
                                    <label>${i18n.settings.password}:</label>
                                    <input type="password" value="\${server.password || ''}" data-index="\${index}" data-field="password" placeholder="${
                                      i18n.settings.enterPassword
                                    }">
                                </div>
                                <div class="form-group key-group" style="display: \${server.privateKeyPath ? '' : 'none'};">
                                    <label>${i18n.settings.privateKey}:</label>
                                    <div class="key-file-selector">
                                        <input type="text" value="\${server.privateKeyPath || ''}" data-index="\${index}" data-field="privateKeyPath" placeholder="${
                                          i18n.settings.enterPrivateKeyPath
                                        }">
                                        <button class="select-key-file-btn" data-index="\${index}">${
                                          i18n.settings.selectPrivateKey
                                        }</button>
                                    </div>
                                </div>
                                <div class="form-group passphrase-group" style="display: \${server.privateKeyPath ? '' : 'none'};">
                                    <label>${i18n.settings.passphrase}:</label>
                                    <input type="password" value="\${server.passphrase || ''}" data-index="\${index}" data-field="passphrase" placeholder="${
                                      i18n.settings.enterPassphrase
                                    }">
                                </div>
                            </div>
                            <div class="box-section">
                                <div class="box-header">${
                                  i18n.settings.paths
                                }</div>
                                <div class="form-group">
                                    <label>${i18n.settings.localPath}:</label>
                                    <input type="text" value="\${server.localPath || '/'}" data-index="\${index}" data-field="localPath" placeholder="${
                                      i18n.settings.enterLocalPath
                                    }" onpaste="return true;">
                                </div>
                                <div class="form-group">
                                    <label>${i18n.settings.remotePath}:</label>
                                    <input type="text" value="\${server.remotePath || '/'}" data-index="\${index}" data-field="remotePath" placeholder="${
                                      i18n.settings.enterRemotePath
                                    }" onpaste="return true;">
                                </div>
                            </div>
                            <div class="actions" style="margin-top: auto;">
                                <button class="delete-btn" data-index="\${index}">
                                    <span class="button-icon">🗑️</span>
                                    ${i18n.settings.delete}
                                </button>
                            </div>
                        </div>
                    \`;
                }
                
                // 绑定认证类型切换监听
                function attachAuthTypeListeners() {
                    document.querySelectorAll('.auth-option').forEach(option => {
                        option.addEventListener('click', function() {
                            const authType = this.dataset.auth;
                            const serverIndex = parseInt(this.dataset.index);
                            
                            // 更新UI
                            document.querySelectorAll('.auth-option').forEach(opt => {
                                opt.classList.remove('active');
                            });
                            this.classList.add('active');
                            
                            if (authType === 'password') {
                                document.querySelector('.password-group').style.display = '';
                                document.querySelector('.key-group').style.display = 'none';
                                document.querySelector('.passphrase-group').style.display = 'none';
                                updateServer(serverIndex, 'privateKeyPath', '');
                                updateServer(serverIndex, 'passphrase', '');
                            } else {
                                document.querySelector('.password-group').style.display = 'none';
                                document.querySelector('.key-group').style.display = '';
                                document.querySelector('.passphrase-group').style.display = '';
                                updateServer(serverIndex, 'password', '');
                            }
                        });
                    });
                }
                
                // 绑定密钥文件选择按钮
                function attachKeyFileSelectListeners() {
                    document.querySelectorAll('.select-key-file-btn').forEach(btn => {
                        btn.addEventListener('click', function() {
                            const index = parseInt(this.dataset.index);
                            vscode.postMessage({
                                command: 'selectKeyFile',
                                index: index
                            });
                        });
                    });
                }
                
                // 绑定输入框监听事件
                function attachInputListeners() {
                    document.querySelectorAll('input[data-field]').forEach(input => {
                        input.addEventListener('change', (e) => {
                            const field = e.target.dataset.field;
                            const index = parseInt(e.target.dataset.index);
                            const value = field === 'port' ? parseInt(e.target.value) : e.target.value;
                            
                            updateServer(index, field, value);
                            // 更新侧边栏的服务器名称
                            if (field === 'name') {
                                const navItem = document.querySelector('.server-nav-item[data-index="' + String(index) + '"] .server-nav-item-name');
                                if (navItem) {
                                    navItem.textContent = value || '${
                                      i18n.settings.enterServerName
                                    }';
                                }
                            }
                        });
                    });
                }
                
                // 更新服务器配置
                function updateServer(index, field, value) {
                    servers[index][field] = value;
                }
                
                // 添加服务器
                function addServer() {
                    servers.push({
                        name: '',
                        host: '',
                        port: 22,
                        username: '',
                        password: '',
                        localPath: '/',
                        remotePath: '/'
                    });
                    activeServerIndex = servers.length - 1; // 选中新添加的服务器
                    render();
                    vscode.postMessage({
                        command: 'loadSettings',
                        servers: JSON.stringify(servers)
                    });
                }
                // 删除服务器
                function removeServer(index) {
                    servers.splice(index, 1);
                    if (activeServerIndex >= servers.length) {
                        activeServerIndex = Math.max(0, servers.length - 1);
                    }
                    render();
                    // 通知后端删除了服务器
                    vscode.postMessage({
                        command: 'saveSettings',
                        servers: servers
                    });
                }
                
                // 更新空状态显示
                function updateEmptyState() {
                    const emptyState = document.getElementById('emptyState');
                    const serverPanels = document.getElementById('serverPanels');
                    if (servers.length === 0) {
                        emptyState.style.display = 'block';
                        serverPanels.style.display = 'none';
                    } else {
                        emptyState.style.display = 'none';
                        serverPanels.style.display = 'block';
                    }
                }
                
                // 保存设置
                function saveSettings() {
                    console.log(servers);
                    vscode.postMessage({
                        command: 'saveSettings',
                        servers: servers
                    });
                }
                
                // 主渲染函数
                function render() {
                    if (activeTab === 'servers') {
                        renderServerNav();
                        renderServerPanels();
                    }
                    updateEmptyState();
                }
                
                // 修改删除服务器的处理方式
                document.addEventListener('click', function(e) {
                    if (e.target.classList.contains('delete-btn') || e.target.parentElement.classList.contains('delete-btn')) {
                        const targetEl = e.target.classList.contains('delete-btn') ? e.target : e.target.parentElement;
                        const index = parseInt(targetEl.dataset.index);
                        // 使用 vscode API 而不是 confirm
                        vscode.postMessage({
                            command: 'confirmDelete',
                            index: index
                        });
                    }
                });
                
                // 初始化设置界面
                document.getElementById('addServerBtn').addEventListener('click', addServer);
                document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
                
                // 初始渲染
                render();
            </script>
        </body>
        </html>`;
    return htmlContent;
  }

  public async handleMessage(message: any) {
    switch (message.command) {
      case "updateSetting":
        await vscode.workspace
          .getConfiguration("sftp-tools")
          .update(
            message.setting,
            message.value,
            vscode.ConfigurationTarget.Global
          );
        vscode.commands.executeCommand("sftp-tools.refreshServers");
        break;
      case "saveSettings":
        try {
          const servers = JSON.parse(message.servers); // 解析 JSON 字符串为数组
          if (!Array.isArray(servers)) {
            throw new Error("服务器配置无效，必须是数组");
          }
          // 验证密钥文件配置
          for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            if (!server.password && !server.privateKeyPath) {
              throw new Error(
                `服务器 "${server.name}" 未配置认证信息，请配置密码或密钥文件`
              );
            }
          }
          this.saveServersToFile(servers);
          vscode.commands.executeCommand("sftp-tools.disconnectAllServers");
          vscode.commands.executeCommand("sftp-tools.refreshServers");
          vscode.window.showInformationMessage(
            getLocaleText().status.settingsSaved
          );
        } catch (error: any) {
          vscode.window.showErrorMessage(`保存失败: ${error.message}`);
        }
        break;
      case "selectKeyFile":
        try {
          const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: getLocaleText().settings.selectPrivateKey,
            filters: {
              "All files": ["*"],
            },
          });

          if (result && result.length > 0) {
            const path = result[0].fsPath;
            this._view?.webview.postMessage({
              command: "keyFileSelected",
              index: message.index,
              path: path,
            });
            // 更新服务器配置
            this._view?.webview.postMessage({
              command: "updateServer",
              index: message.index,
              field: "privateKeyPath",
              value: path,
            });
          }
        } catch (error: any) {
          vscode.window.showErrorMessage(`选择文件失败: ${error.message}`);
        }
        break;
      case "updateOtherSetting":
        try {
          // 更新我们的配置系统
          this.updateSettings({ [message.setting]: message.value });
          vscode.commands.executeCommand("sftp-tools.refreshServers");
          vscode.window.showInformationMessage(getLocaleText().status.settingsSaved);
        } catch (error: any) {
          vscode.window.showErrorMessage(getLocaleText().messages.settingsSaveFailed);
        }
        break;
      case "confirmDelete":
        const i18n = getLocaleText();
        const answer = await vscode.window.showWarningMessage(
          i18n.settings.deleteConfirm,
          i18n.settings.yes,
          i18n.settings.no
        );
        if (answer === i18n.settings.yes) {
          // 用户确认删除，通知 webview
          this._view?.webview.postMessage({
            command: "deleteConfirmed",
            index: message.index,
          });
        }
        break;
    }
  }

  // 通知设置页面配置已更新
  public notifySettingsUpdated(servers: any[]): void {
    if (this._view) {
      this._view.webview.postMessage({
        command: "loadSettings",
        servers,
      });
    }
  }

  // 从配置中删除服务器
  private removeServer(index: number): void {
    const servers = this.loadServersFromFile();
    servers.splice(index, 1);
    this.saveServersToFile(servers);
    vscode.commands.executeCommand("sftp-tools.disconnectAllServers");
    vscode.commands.executeCommand("sftp-tools.refreshServers");
  }

  private getConfigPath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("未找到工作区文件夹，请确保打开了一个工作区。");
    }
    const vscodePath = path.join(workspaceFolder.uri.fsPath, ".vscode");
    if (!fs.existsSync(vscodePath)) {
      fs.mkdirSync(vscodePath, { recursive: true });
    }
    return path.join(vscodePath, CONFIG_FILE_NAME);
  }

  private saveConfig() {
    try {
        const configPath = this.getConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 4));
    } catch (error) {
        throw new Error(getLocaleText().messages.settingsSaveFailed);
    }
  }

  // 获取或设置其他设置
  getSettings(): typeof this.config.settings {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const loadedConfig = JSON.parse(content);
        // 更新内存中的配置
        this.config = {
          servers: loadedConfig.servers || [],
          settings: {
            showConfirmDialog: loadedConfig.settings?.showConfirmDialog ?? true,
            uploadOrDeleteBackup: loadedConfig.settings?.uploadOrDeleteBackup ?? '',
            enableAutoUpload: loadedConfig.settings?.enableAutoUpload ?? false // 确保加载时包含默认值
          }
        };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return { ...this.config.settings };
  }

  updateSettings(settings: Partial<typeof this.config.settings>) {
    this.config.settings = { ...this.config.settings, ...settings };
    this.saveConfig();

    // 如果 enableShortcutUpload 设置发生变化，则更新上下文状态
    if (settings.hasOwnProperty('enableAutoUpload')) {
      vscode.commands.executeCommand('setContext', 'sftp-tools.enableShortcutUploadContext', settings.enableAutoUpload);
    }
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
