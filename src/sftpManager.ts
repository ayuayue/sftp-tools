import * as ssh2 from 'ssh2';

export class SftpManager {
    private client: ssh2.Client | null = null;
    private sftp: ssh2.SFTPWrapper | null = null;
    private isCancelled: boolean = false;

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
                    return a.filename.localeCompare(b.filename);
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
} 