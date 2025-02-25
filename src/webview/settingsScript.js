// 全局变量
const vscode = acquireVsCodeApi();
let servers = {{serversJson}};
let activeServerIndex = 0;
let showDeleteConfirm = {{showDeleteConfirm}};
let activeTab = 'general';

// 添加消息处理
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'loadSettings':
            servers = message.servers || [];
            activeServerIndex = 0;
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
        command: 'updateGeneralSetting',
        setting: 'showConfirmDialog',
        value: showDeleteConfirm
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
        
        if (tabId === 'general') {
            document.getElementById('generalSettingsPanel').classList.add('active');
        } else if (tabId === 'servers') {
            document.getElementById('serversSettingsPanel').classList.add('active');
            renderServerNav();
            renderServerPanels();
        }
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
        li.innerHTML = `
            <span class="server-nav-item-icon">🖥️</span>
            <span class="server-nav-item-name">${server.name || '未命名服务器'}</span>
        `;
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
    return `
        <div class="server-item">
            <div class="box-section">
                <div class="box-header">服务器名称</div>
                <div class="form-group">
                    <input type="text" class="server-name-input" style="width: 100%;" value="${server.name || ''}" data-index="${index}" data-field="name" placeholder="输入服务器名称">
                </div>
            </div>
            
            <div class="box-section">
                <div class="box-header">主机设置</div>
                <div class="form-group">
                    <label>主机地址:</label>
                    <input type="text" value="${server.host || ''}" data-index="${index}" data-field="host" placeholder="输入主机地址">
                </div>
                <div class="form-group">
                    <label>端口:</label>
                    <input type="number" value="${server.port || 22}" data-index="${index}" data-field="port" placeholder="输入端口">
                </div>
                <div class="form-group">
                    <label>用户名:</label>
                    <input type="text" value="${server.username || ''}" data-index="${index}" data-field="username" placeholder="输入用户名">
                </div>
            </div>
            
            <div class="box-section">
                <div class="box-header">认证方式</div>
                <div class="auth-options">
                    <div class="auth-option ${!server.privateKeyPath ? 'active' : ''}" data-auth="password" data-index="${index}">
                        密码认证
                    </div>
                    <div class="auth-option ${server.privateKeyPath ? 'active' : ''}" data-auth="key" data-index="${index}">
                        密钥文件
                    </div>
                </div>
                
                <div class="form-group password-group" ${server.privateKeyPath ? 'style="display:none;"' : ''}>
                    <label>密码:</label>
                    <input type="password" value="${server.password || ''}" data-index="${index}" data-field="password" placeholder="输入密码">
                </div>
                
                <div class="form-group key-group" ${!server.privateKeyPath ? 'style="display:none;"' : ''}>
                    <label>私钥文件:</label>
                    <div class="key-file-selector">
                        <input type="text" value="${server.privateKeyPath || ''}" data-index="${index}" data-field="privateKeyPath" placeholder="输入或选择私钥文件路径">
                        <button class="select-key-file-btn" data-index="${index}">选择私钥文件</button>
                    </div>
                </div>
                <div class="form-group passphrase-group" ${!server.privateKeyPath ? 'style="display:none;"' : ''}>
                    <label>密码短语:</label>
                    <input type="password" value="${server.passphrase || ''}" data-index="${index}" data-field="passphrase" placeholder="输入私钥密码短语">
                </div>
            </div>
            
            <div class="box-section">
                <div class="box-header">路径设置</div>
                <div class="form-group">
                    <label>本地工作区目录:</label>
                    <input type="text" value="${server.localPath || ''}" data-index="${index}" data-field="localPath" placeholder="输入本地工作区目录,/ 为当前工作区">
                </div>
                <div class="form-group">
                    <label>远程目录:</label>
                    <input type="text" value="${server.remotePath || '/'}" data-index="${index}" data-field="remotePath" placeholder="输入远程路径">
                </div>
            </div>
            <div class="actions">
                <button class="delete-btn" data-index="${index}">
                    <span class="button-icon">🗑️</span>
                    删除
                </button>
            </div>
        </div>
    `;
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
                    navItem.textContent = value || '未命名服务器';
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
        localPath: '',
        remotePath: '/'
    });
    activeServerIndex = servers.length - 1; // 选中新添加的服务器
    render();
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