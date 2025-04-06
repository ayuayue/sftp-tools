import * as ssh2 from 'ssh2';
import * as path from 'path';

export class SftpManager {
    private client: ssh2.Client | null = null;
    private sftp: ssh2.SFTPWrapper | null = null;
    private isCancelled: boolean = false;
    private _backupPath: string = 'backup-sftp';

    // 添加公共 getter
    public get backupPath(): string {
        return this._backupPath;
    }

    cancelOperations() {
        this.isCancelled = true;
        if (this.client) {
            this.disconnect();
        }
    }

    private checkCancelled() {
        if (this.isCancelled) {
            throw new Error('Operation cancelled');
        }
    }

    async connect(serverConfig: any): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client = new ssh2.Client();

            this.client.on('ready', () => {
                this.client!.sftp((err: any, sftp: any) => {
                    if (err) {
                        reject(err);
                    }
                    this.sftp = sftp;
                    resolve();
                });
            }).on('error', (err: any) => {
                reject(err);
            });

            const connectConfig: any = {
                host: serverConfig.host,
                port: serverConfig.port,
                username: serverConfig.username
            };

            // 如果提供了私钥文件路径，使用私钥认证
            if (serverConfig.privateKeyPath) {
                try {
                    const fs = require('fs');
                    connectConfig.privateKey = fs.readFileSync(serverConfig.privateKeyPath);
                    if (serverConfig.passphrase) {
                        connectConfig.passphrase = serverConfig.passphrase;
                    }
                } catch (error: any) {
                    reject(new Error(`读取私钥文件失败: ${error.message}`));
                    return;
                }
            } else if (serverConfig.password) {
                // 否则使用密码认证
                connectConfig.password = serverConfig.password;
            } else {
                reject(new Error('未提供认证信息'));
                return;
            }

            this.client.connect(connectConfig);
        });
    }

    async listFiles(path: string): Promise<ssh2.FileEntry[]> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.sftp.readdir(path, (err: any, list: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                list.sort((a: ssh2.FileEntry, b: ssh2.FileEntry) => {
                    // 首先判断是否为目录
                    const aIsDir = a.longname.startsWith('d');
                    const bIsDir = b.longname.startsWith('d');
                    
                    // 如果两个都是目录或都是文件，按名称排序
                    if (aIsDir === bIsDir) {
                        return a.filename.localeCompare(b.filename);
                    }
                    
                    // 如果 a 是目录而 b 不是，a 排在前面
                    return aIsDir ? -1 : 1;
                });
                resolve(list);
            });
        });
    }

    async readFile(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.checkCancelled();

            this.sftp.readFile(path, 'utf8', (err: any, data: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }

    async writeFile(remotePath: string, content: string | Buffer): Promise<void> {
        if (!this.sftp) {
            throw new Error('SFTP connection not established');
        }
        return new Promise((resolve, reject) => {
            this.sftp!.writeFile(remotePath, content, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    async deleteFile(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }
    
            this.sftp.unlink(path, (err: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    async mkdir(path: string, recursive: boolean = false): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            if (recursive) {
                // 递归创建目录
                const parts = path.split('/').filter(p => p);
                let current = '';
                const promises = parts.map(part => {
                    current += '/' + part;
                    return new Promise(resolve => {
                        this.sftp!.mkdir(current, err => {
                            // 忽略目录已存在的错误
                            resolve(null);
                        });
                    });
                });
                
                Promise.all(promises)
                    .then(() => resolve())
                    .catch(reject);
            } else {
                this.sftp.mkdir(path, err => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            }
        });
    }
    async rmdir(path: string, recursive: boolean = false): Promise<void> {
        return new Promise(async (resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            try {
                // 先检查路径是否存在
                const stats = await this.stat(path);
                if (!stats.isDirectory()) {
                    reject(new Error('Path is not a directory'));
                    return;
                }

                if (recursive) {
                    // 列出目录内容
                    const files = await this.listFiles(path);
                    
                    // 递归删除所有内容
                    for (const file of files) {
                        const fullPath = `${path}/${file.filename}`;
                        
                        // 跳过 . 和 ..
                        if (file.filename === '.' || file.filename === '..') {
                            continue;
                        }

                        if (file.longname.startsWith('d')) {
                            // 是目录，递归删除
                            await this.rmdir(fullPath, true);
                        } else {
                            // 是文件，直接删除
                            await this.deleteFile(fullPath);
                        }
                    }
                }

                // 删除目录本身
                this.sftp.rmdir(path, (err) => {
                    if (err) {
                        reject(new Error(`Failed to remove directory: ${err.message}`));
                        return;
                    }
                    resolve();
                });
            } catch (err: any) {
                reject(new Error(`Failed to delete directory: ${err.message}`));
            }
        });
    }
    disconnect() {
        if (this.client) {
            this.client.end();
            this.client = null;
            this.sftp = null;
        }
    }
    async stat(path: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.sftp.stat(path, (err, stats) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(stats);
            });
        });
    }
    async readFileAsBuffer(path: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.checkCancelled();

            this.sftp.readFile(path, (err: any, data: Buffer) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }

    /**
     * 备份远程文件
     * @param remotePath 原始文件路径
     * @param backupBasePath 备份基础路径
     * @returns 备份后的文件路径
     */
    async backupFile(remotePath: string, backupBasePath: string): Promise<string> {
        if (!this.sftp) {
            throw new Error('SFTP not connected');
        }

        // 生成备份路径
        const now = new Date();
        const datePath = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        const timePath = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        
        // 构建备份目录路径
        const backupDir = path.posix.join(
            backupBasePath,
            this._backupPath,
            datePath
        );

        // 获取原始文件名
        const fileName = path.basename(remotePath);
        // 构建备份文件路径
        const backupPath = path.posix.join(backupDir, `${fileName}.${timePath}`);

        try {
            // 创建备份目录
            await this.mkdir(backupDir, true);

            // 读取原文件内容
            const content = await this.readFileAsBuffer(remotePath);

            // 写入备份文件
            await this.writeFile(backupPath, content);

            return backupPath;
        } catch (error: any) {
            throw new Error(`备份文件失败: ${error.message}`);
        }
    }

    /**
     * 递归备份目录
     * @param remotePath 原始目录路径
     * @param backupBasePath 备份基础路径
     * @returns 备份后的目录路径
     */
    async backupDirectory(remotePath: string, backupBasePath: string): Promise<string> {
        if (!this.sftp) {
            throw new Error('SFTP not connected');
        }

        // 生成备份路径
        const now = new Date();
        const datePath = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        const timePath = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        
        // 构建备份目录路径
        const backupDir = path.posix.join(
            backupBasePath,
            this._backupPath,
            datePath
        );

        // 获取原始目录名
        const dirName = path.basename(remotePath);
        // 构建备份目录路径
        const backupPath = path.posix.join(backupDir, `${dirName}.${timePath}`);

        try {
            // 创建备份目录
            await this.mkdir(backupPath, true);

            // 递归复制目录内容
            await this.copyDirectory(remotePath, backupPath);

            return backupPath;
        } catch (error: any) {
            throw new Error(`备份目录失败: ${error.message}`);
        }
    }

    /**
     * 递归复制目录
     */
    private async copyDirectory(srcPath: string, destPath: string): Promise<void> {
        // 读取源目录内容
        const files = await this.listFiles(srcPath);
        
        for (const file of files) {
            const srcFilePath = path.posix.join(srcPath, file.filename);
            const destFilePath = path.posix.join(destPath, file.filename);

            // 跳过 . 和 ..
            if (file.filename === '.' || file.filename === '..') {
                continue;
            }

            if (file.longname.startsWith('d')) {
                // 是目录，递归复制
                await this.mkdir(destFilePath, true);
                await this.copyDirectory(srcFilePath, destFilePath);
            } else {
                // 是文件，直接复制
                const content = await this.readFileAsBuffer(srcFilePath);
                await this.writeFile(destFilePath, content);
            }
        }
    }
} 