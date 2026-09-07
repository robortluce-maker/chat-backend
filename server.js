const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e7
});

const templates = {};
const clients = {}; // 存储 key 为 "userUuid_tplId" 的客户实例

// 为每个模板创建独立的编号计数器
const templateCounters = {};

function getNextClientNumber(tplId) {
  if (!templateCounters[tplId]) {
    templateCounters[tplId] = 1;
  }
  return templateCounters[tplId]++;
}

io.on('connection', (socket) => {

  socket.on('admin_init', () => {
    socket.join('admin_room');
    socket.emit('update_client_list', clients);
    socket.emit('init_templates_list', templates);
  });

  socket.on('create_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = tplData;
      // 初始化该新模板的计数器从 1 开始
      templateCounters[tplData.id] = 1;
      io.to('admin_room').emit('template_created', tplData);
    }
  });

  socket.on('delete_template', (tplId) => {
    delete templates[tplId];
    delete templateCounters[tplId];
    for (let sessionKey in clients) {
      if (clients[sessionKey].tplId === tplId) {
        delete clients[sessionKey];
      }
    }
    io.to('admin_room').emit('template_deleted', tplId);
    io.to('admin_room').emit('update_client_list', clients);
  });

  // 访客连接初始化
  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    const userUuid = (data && data.userUuid) ? data.userUuid : socket.id;

    const sessionKey = `${userUuid}_${tplId}`;

    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };

    socket.emit('init_template_data', config);

    let client = clients[sessionKey];

    if (!client) {
      // 获取当前模板独有的自增编号（每个模板都从 1 开始）
      const clientNum = getNextClientNumber(tplId);

      client = {
        sessionKey: sessionKey,
        uuid: userUuid,
        socketId: socket.id,
        name: `访客 ${clientNum}`,
        tplId: tplId,
        tag: '',
        unread: true,
        messages: []
      };
      clients[sessionKey] = client;
    } else {
      // 老访客重连，保留原本在该模板下的编号和消息
      client.socketId = socket.id;
      client.unread = true;
    }

    if (config.welcome) {
      client.messages.push({ sender: 'admin', text: config.welcome });
    }

    socket.join(sessionKey);

    io.to('admin_room').emit('client_joined', { client, sessionKey });
    io.to('admin_room').emit('update_client_list', clients);
  });

  socket.on('send_client_msg', (data) => {
    const sessionKey = `${data.userUuid}_${data.tplId}`;
    if (clients[sessionKey]) {
      clients[sessionKey].messages.push({ sender: 'client', text: data.msg });
      clients[sessionKey].unread = true;

      io.to('admin_room').emit('receive_client_msg', {
        sessionKey: sessionKey,
        msg: data.msg
      });
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('send_admin_msg', (data) => {
    const sessionKey = data.sessionKey;
    if (clients[sessionKey]) {
      clients[sessionKey].messages.push({ sender: 'admin', text: data.msg });
      if (clients[sessionKey].socketId) {
        io.to(clients[sessionKey].socketId).emit('receive_admin_msg', { msg: data.msg });
      }
    }
  });

  socket.on('mark_read', (sessionKey) => {
    if (clients[sessionKey]) {
      clients[sessionKey].unread = false;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('update_client_tag', (data) => {
    if (clients[data.sessionKey]) {
      clients[data.sessionKey].tag = data.tag;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('delete_client', (sessionKey) => {
    delete clients[sessionKey];
    io.to('admin_room').emit('update_client_list', clients);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后端已在端口 ${PORT} 启动`));
