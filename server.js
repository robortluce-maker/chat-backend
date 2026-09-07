const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储所有生成的广告模板数据（内存存储）
const templates = {};
// 存储在线客户端信息
const clients = {};

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 1. 管理员初始化连接
  socket.on('admin_init', () => {
    socket.join('admin_room');
    // 把已有客户和所有已保存的模板同步发给管理员
    socket.emit('update_client_list', clients);
    socket.emit('init_templates_list', templates);
  });

  // 2. 管理员创建并保存新模板
  socket.on('create_template', (tplData) => {
    templates[tplData.id] = tplData;
    console.log('成功保存模板:', tplData.id);
    // 广播给管理页面更新列表
    io.to('admin_room').emit('template_created', tplData);
  });

  // 3. 客户进入聊天页初始化（带有 tplId 参数）
  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    
    // 如果找到了对应模板，发给客户端；如果没有，发默认配置
    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };
    
    // 把模板属性（头像、背景图、招呼语）实时推送给客户页面
    socket.emit('init_template_data', config);

    // 记录在线客户
    clients[socket.id] = {
      id: socket.id,
      tplId: tplId,
      messages: []
    };

    // 提醒后台更新在线客户列表
    io.to('admin_room').emit('update_client_list', clients);
  });

  // 4. 客户发送消息
  socket.on('send_client_msg', (data) => {
    if (clients[socket.id]) {
      clients[socket.id].messages.push({ sender: 'client', text: data.msg });
    }
    io.to('admin_room').emit('receive_client_msg', {
      clientId: socket.id,
      msg: data.msg
    });
  });

  // 5. 管理员回复消息
  socket.on('send_admin_msg', (data) => {
    if (clients[data.clientId]) {
      clients[data.clientId].messages.push({ sender: 'admin', text: data.msg });
    }
    io.to(data.clientId).emit('receive_admin_msg', { msg: data.msg });
  });

  // 6. 客户离线
  socket.on('disconnect', () => {
    if (clients[socket.id]) {
      delete clients[socket.id];
      io.to('admin_room').emit('update_client_list', clients);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`聊天后端服务已运行在端口 ${PORT}`);
});
