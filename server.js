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
const clients = {}; // 按 userUuid 存储客户信息
let clientCounter = 1;

io.on('connection', (socket) => {

  socket.on('admin_init', () => {
    socket.join('admin_room');
    socket.emit('update_client_list', clients);
    socket.emit('init_templates_list', templates);
  });

  socket.on('create_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = tplData;
      io.to('admin_room').emit('template_created', tplData);
    }
  });

  socket.on('delete_template', (tplId) => {
    delete templates[tplId];
    io.to('admin_room').emit('template_deleted', tplId);
  });

  // 访客连接初始化（通过 userUuid 识别老访客）
  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    const userUuid = (data && data.userUuid) ? data.userUuid : socket.id;

    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };

    socket.emit('init_template_data', config);

    let client = clients[userUuid];

    if (!client) {
      // 全新访客：分配新编号
      client = {
        uuid: userUuid,
        socketId: socket.id,
        name: `访客 ${clientCounter++}`,
        tplId: tplId,
        tag: '',
        unread: true, // 标注未读状态以亮灯
        messages: []
      };
      clients[userUuid] = client;
    } else {
      // 老访客重连：更新 Socket ID 和模板
      client.socketId = socket.id;
      client.tplId = tplId;
      client.unread = true; // 重新打开页面标记未读
    }

    // 将预设打招呼放入历史记录
    if (config.welcome) {
      client.messages.push({ sender: 'admin', text: config.welcome });
    }

    socket.join(userUuid);

    // 通知管理员有新访客上线/重新访问，触发声音与绿灯
    io.to('admin_room').emit('client_joined', { client, uuid: userUuid });
    io.to('admin_room').emit('update_client_list', clients);
  });

  socket.on('send_client_msg', (data) => {
    const userUuid = data.userUuid;
    if (clients[userUuid]) {
      clients[userUuid].messages.push({ sender: 'client', text: data.msg });
      clients[userUuid].unread = true;

      io.to('admin_room').emit('receive_client_msg', {
        uuid: userUuid,
        msg: data.msg
      });
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('send_admin_msg', (data) => {
    const userUuid = data.uuid;
    if (clients[userUuid]) {
      clients[userUuid].messages.push({ sender: 'admin', text: data.msg });
      if (clients[userUuid].socketId) {
        io.to(clients[userUuid].socketId).emit('receive_admin_msg', { msg: data.msg });
      }
    }
  });

  socket.on('mark_read', (uuid) => {
    if (clients[uuid]) {
      clients[uuid].unread = false;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('update_client_tag', (data) => {
    if (clients[data.uuid]) {
      clients[data.uuid].tag = data.tag;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('delete_client', (uuid) => {
    delete clients[uuid];
    io.to('admin_room').emit('update_client_list', clients);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后端已在端口 ${PORT} 启动`));
