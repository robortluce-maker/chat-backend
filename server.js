const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 内存数据库（实际生产中可写入 local JSON 文件或 SQLite）
const templates = {
    'default': {
        tplId: 'default',
        name: '通用默认模板',
        bg: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
        agentName: '官方高级顾问',
        welcome: '您好！欢迎点击咨询，请问有什么可以帮您？'
    }
};

let adminSocket = null;

io.on('connection', (socket) => {
    
    // 管理后台登录
    socket.on('register_admin', () => {
        adminSocket = socket;
        console.log('✅ 客服管理后台已上线');
    });

    // 用户打开广告落地页
    socket.on('register_user', (data) => {
        socket.userId = data.userId;
        // 如果后台在线，将用户进场事件（含是否重访、重访次数）发送给管理后台
        if (adminSocket) {
            adminSocket.emit('user_connected', data);
        }
    });

    // 用户发消息给管理端
    socket.on('user_send_message', (data) => {
        if (adminSocket) {
            adminSocket.emit('receive_user_message', data);
        }
    });

    // 管理端发消息给用户
    socket.on('admin_send_message', (data) => {
        io.emit('receive_admin_message', data);
    });

    // 模板管理：保存模板
    socket.on('save_template', (tplData) => {
        templates[tplData.tplId] = tplData;
    });

    // 模板管理：拉取模板列表
    socket.on('get_templates', (callback) => {
        callback(templates);
    });

    // 用户端获取单个模板配置
    socket.on('get_template_detail', (tplId, callback) => {
        callback(templates[tplId] || templates['default']);
    });
});

server.listen(3000, () => {
    console.log('🚀 聊天后端服务已启动在 3000 端口');
});