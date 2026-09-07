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

// 系统配置
const ADMIN_ACCOUNT = { user: "liusuoying2002", pass: "123321ABCabc" };

const templates = {}; // tplId -> templateData
const clients = {};   // sessionKey -> clientData
const templateCounters = {};

function getNextClientNumber(tplId) {
  if (!templateCounters[tplId]) {
    templateCounters[tplId] = 1;
  }
  return templateCounters[tplId]++;
}

io.on('connection', (socket) => {

  // ===== 1. 管理员/代理商 身份认证 =====
  
  // 总管理员初始化
  socket.on('admin_login', (data) => {
    if (data.user === ADMIN_ACCOUNT.user && data.pass === ADMIN_ACCOUNT.pass) {
      socket.join('admin_room');
      socket.emit('login_result', { success: true, role: 'admin' });
      socket.emit('update_client_list', clients);
      socket.emit('init_templates_list', templates);
    } else {
      socket.emit('login_result', { success: false, msg: '总管理员账号或密码错误！' });
    }
  });

  // 代理商登录
  socket.on('agent_login', (data) => {
    let matchedTpl = null;
    for (let id in templates) {
      if (templates[id].agentUser === data.user && templates[id].agentPass === data.pass) {
        matchedTpl = templates[id];
        break;
      }
    }

    if (matchedTpl) {
      const roomName = `agent_${matchedTpl.id}`;
      socket.join(roomName);
      socket.emit('login_result', { 
        success: true, 
        role: 'agent', 
        tpl: matchedTpl 
      });
      
      const agentClients = {};
      for (let sKey in clients) {
        if (clients[sKey].tplId === matchedTpl.id) {
          agentClients[sKey] = clients[sKey];
        }
      }
      socket.emit('update_client_list', agentClients);
    } else {
      socket.emit('login_result', { success: false, msg: '代理商账号或密码错误！' });
    }
  });

  // ===== 2. 模板增删改 =====

  socket.on('create_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = tplData;
      templateCounters[tplData.id] = 1;
      io.to('admin_room').emit('template_created', tplData);
      io.to('admin_room').emit('init_templates_list', templates);
    }
  });

  socket.on('update_template', (tplData) => {
    if (tplData && tplData.id && templates[tplData.id]) {
      templates[tplData.id] = { ...templates[tplData.id], ...tplData };
      io.to('admin_room').emit('init_templates_list', templates);
      io.to(`agent_${tplData.id}`).emit('template_updated', templates[tplData.id]);
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
    io.to('admin_room').emit('init_templates_list', templates);
    io.to('admin_room').emit('update_client_list', clients);
  });

  // ===== 3. 访客会话交互 =====

  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    const userUuid = (data && data.userUuid) ? data.userUuid : socket.id;
    const sessionKey = `${userUuid}_${tplId}`;

    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？',
      statusText: '在线中',
      placeholderText: '请输入内容...',
      sendBtnText: '发送'
    };

    socket.emit('init_template_data', config);

    let client = clients[sessionKey];

    if (!client) {
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
      client.socketId = socket.id;
      client.unread = true;
    }

    if (config.welcome) {
      client.messages.push({ sender: 'admin', text: config.welcome });
    }

    socket.join(sessionKey);

    io.to('admin_room').emit('client_joined', { client, sessionKey });
    io.to(`agent_${tplId}`).emit('client_joined', { client, sessionKey });

    notifyListUpdate(tplId);
  });

  socket.on('send_client_msg', (data) => {
    const sessionKey = `${data.userUuid}_${data.tplId}`;
    if (clients[sessionKey]) {
      clients[sessionKey].messages.push({ sender: 'client', text: data.msg });
      clients[sessionKey].unread = true;

      io.to('admin_room').emit('receive_client_msg', { sessionKey, msg: data.msg });
      io.to(`agent_${data.tplId}`).emit('receive_client_msg', { sessionKey, msg: data.msg });

      notifyListUpdate(data.tplId);
    }
  });

  socket.on('send_admin_msg', (data) => {
    const sessionKey = data.sessionKey;
    if (clients[sessionKey]) {
      clients[sessionKey].messages.push({ sender: 'admin', text: data.msg });
      if (clients[sessionKey].socketId) {
        io.to(clients[sessionKey].socketId).emit('receive_admin_msg', { msg: data.msg });
      }
      io.to('admin_room').emit('sync_admin_msg', { sessionKey, msg: data.msg });
      io.to(`agent_${clients[sessionKey].tplId}`).emit('sync_admin_msg', { sessionKey, msg: data.msg });
    }
  });

  socket.on('mark_read', (sessionKey) => {
    if (clients[sessionKey]) {
      clients[sessionKey].unread = false;
      notifyListUpdate(clients[sessionKey].tplId);
    }
  });

  socket.on('update_client_tag', (data) => {
    if (clients[data.sessionKey]) {
      clients[data.sessionKey].tag = data.tag;
      notifyListUpdate(clients[data.sessionKey].tplId);
    }
  });

  socket.on('delete_client', (sessionKey) => {
    if (clients[sessionKey]) {
      const tplId = clients[sessionKey].tplId;
      delete clients[sessionKey];
      notifyListUpdate(tplId);
    }
  });

  function notifyListUpdate(tplId) {
    io.to('admin_room').emit('update_client_list', clients);

    const agentClients = {};
    for (let sKey in clients) {
      if (clients[sKey].tplId === tplId) {
        agentClients[sKey] = clients[sKey];
      }
    }
    io.to(`agent_${tplId}`).emit('update_client_list', agentClients);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后端已在端口 ${PORT} 启动`));
