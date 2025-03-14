import * as vscode from 'vscode';
import { getLocaleText } from '../i18n';

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('SFTP Tools');
        // 创建时就显示输出面板
        this.outputChannel.show(true);
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 记录日志信息
     * @param message 日志消息
     * @param type 日志类型
     * @param serverName 可选的服务器名称
     */
    public log(message: string, type: 'info' | 'warning' | 'error' = 'info', serverName?: string | undefined): void {
        const timestamp = new Date().toLocaleTimeString();
        const serverInfo = serverName ? `[${serverName}] ` : '';
        const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${serverInfo}${message}`;
        
        this.outputChannel.appendLine(logMessage);
        
        // 对于错误类型的日志，自动显示输出面板
        if (type === 'error') {
            this.show(false);
        }
        
        // 在控制台也输出一份，方便调试
        console.log(logMessage);
    }

    /**
     * 显示输出面板
     * @param preserveFocus 是否保持编辑器焦点
     */
    public show(preserveFocus: boolean = true): void {
        this.outputChannel.show(preserveFocus);
    }

    /**
     * 清除日志
     */
    public clear(): void {
        this.outputChannel.clear();
    }

    /**
     * 销毁输出通道
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }

    /**
     * 显示欢迎信息
     */
    public showWelcome(): void {
        const welcomeMessage = `
 ═══════════════
║   SFTP Tools 
║
║  欢迎使用 SFTP Tools！                
║                                       
║  ✨ 轻松管理远程服务器               
║  ⚡ 便捷的文件传输                     
║  🔄 实时文件同步                     
║                                       
║  快速开始：                          
║  1. 配置服务器信息                   
║  2. 连接远程服务器                   
║  3. 开始文件管理
════════════════
`;
        
        this.outputChannel.appendLine(welcomeMessage);
        this.outputChannel.appendLine('');
        this.log(getLocaleText().home.isActive, 'info');
        
        // 2秒后显示准备就绪消息
        setTimeout(() => {
            this.log(getLocaleText().home.isReady, 'info');
        }, 2000);
        
        this.show(true);
    }
} 