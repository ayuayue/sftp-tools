import * as vscode from 'vscode';
import { getLocaleText } from './i18n';

export class StatusBarManager {
    private static instance: StatusBarManager;
    private statusBarItem: vscode.StatusBarItem;
    private i18n = getLocaleText();

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    }

    public static getInstance(): StatusBarManager {
        if (!StatusBarManager.instance) {
            StatusBarManager.instance = new StatusBarManager();
        }
        return StatusBarManager.instance;
    }

    public showMessage(message: string, type: 'info' | 'error' | 'warning' = 'info', timeout: number = 3000) {
        let icon = '$(info)';
        switch (type) {
            case 'error':
                icon = '$(error)';
                break;
            case 'warning':
                icon = '$(warning)';
                break;
            case 'info':
                icon = '$(check)';
                break;
        }

        this.statusBarItem.text = `${icon} ${message}`;
        this.statusBarItem.show();

        setTimeout(() => {
            this.statusBarItem.hide();
        }, timeout);
    }

    public showProgress(message: string) {
        this.statusBarItem.text = `$(sync~spin) ${message}`;
        this.statusBarItem.show();
    }

    public hideProgress() {
        this.statusBarItem.hide();
    }

    public clear(): void {
        this.statusBarItem.text = '';
        this.statusBarItem.hide();
    }
} 