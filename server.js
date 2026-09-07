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
    // 同时清理该模板下的所有访客数据
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

    // 生成当前用户在这个模板下的“唯一标识会话 Key”
    const sessionKey = `${userUuid}_${tplId}`;

    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };

    socket.emit('init_template_data', config);

    let client = clients[sessionKey];

    if (!client) {
      // 场景 A：该用户在这个新模板下是“新访客” -> 分配在该模板下的新编号
      client = {
        sessionKey: sessionKey,
        uuid: userUuid,
        socketId: socket.id,
        name: `访客 ${clientCounter++}`,
        tplId: tplId,
        tag: '',
        unread: true,
        messages: []
      };
      clients[sessionKey] = client;
    } else {
      // 场景 B：该用户在这个模板下是“老访客” -> 重用原本的编号和记录
      client.socketId = socket.id;
      client.unread = true; // 再次进来点亮未读绿灯
    }

    // 每次进入自动加入对应欢迎语消息
    if (config.welcome) {
      client.messages.push({ sender: 'admin', text: config.welcome });
    }

    // 绑定 Socket 到这个唯一的 sessionKey 房间
    socket.join(sessionKey);

    // 通知管理员有访客上线
    io.to('admin_room').emit('client_joined', { client, sessionKey });
    io.to('admin_room').emit('update_client_list', clients);
  });

  // 收到客户端发送的消息
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

  // 客服后台发送消息
  socket.on('send_admin_msg', (data) => {
    const sessionKey = data.sessionKey;
    if (clients[sessionKey]) {
      clients[sessionKey].messages.push({ sender: 'admin', text: data.msg });
      if (clients[sessionKey].socketId) {
        io.to(clients[sessionKey].socketId).emit('receive_admin_msg', { msg: data.msg });
      }
    }
  });

  // 消除未读小绿灯
  socket.on('mark_read', (sessionKey) => {
    if (clients[sessionKey]) {
      clients[sessionKey].unread = false;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  // 更新备注标记
  socket.on('update_client_tag', (data) => {
    if (clients[data.sessionKey]) {
      clients[data.sessionKey].tag = data.tag;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  // 删除单个访客
  socket.on('delete_client', (sessionKey) => {
    delete clients[sessionKey];
    io.to('admin_room').emit('update_client_list', clients);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后端已在端口 ${PORT} 启动`));
