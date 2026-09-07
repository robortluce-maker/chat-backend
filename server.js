const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const ADMIN_ACCOUNT = { user: "liusuoying2002", pass: "123321ABCabc" };
const DATA_FILE = path.join(__dirname, 'templates.json');

// 从本地 JSON 读取模板
let templates = {};
function loadTemplates() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const rawData = fs.readFileSync(DATA_FILE, 'utf8');
      templates = JSON.parse(rawData);
      console.log("成功读取持久化模板数据：", Object.keys(templates));
    }
  } catch (e) {
    console.error("读取持久化模板失败:", e);
    templates = {};
  }
}
loadTemplates();

function saveTemplatesToFile() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(templates, null, 2), 'utf8');
    console.log("模板数据保存成功！");
  } catch (e) {
    console.error("写入持久化模板失败:", e);
  }
}

const clients = {}; 
const templateCounters = {};

function getNextClientNumber(tplId) {
  if (!templateCounters[tplId]) {
    templateCounters[tplId] = 1;
  }
  return templateCounters[tplId]++;
}

io.on('connection', (socket) => {

  // 1. 账号登录
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

  // 2. 模板配置增删改
  socket.on('create_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = tplData;
      templateCounters[tplData.id] = 1;
      saveTemplatesToFile();
      io.to('admin_room').emit('init_templates_list', templates);
    }
  });

  socket.on('update_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = { ...templates[tplData.id], ...tplData };
      saveTemplatesToFile();

      io.to('admin_room').emit('init_templates_list', templates);
      io.to(`agent_${tplData.id}`).emit('template_updated', templates[tplData.id]);
    }
  });

  socket.on('delete_template', (tplId) => {
    if (templates[tplId]) {
      delete templates[tplId];
      delete templateCounters[tplId];
      saveTemplatesToFile();

      for (let sessionKey in clients) {
        if (clients[sessionKey].tplId === tplId) {
          delete clients[sessionKey];
        }
      }
      io.to('admin_room').emit('init_templates_list', templates);
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  // 3. 纯文本会话交互
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

      if (config.welcome) {
        client.messages.push({ sender: 'admin', text: config.welcome });
      }

      clients[sessionKey] = client;
    } else {
      client.socketId = socket.id;
      client.unread = true;
    }

    socket.join(sessionKey);

    socket.emit('init_template_data', {
      config: config,
      messages: client.messages
    });

    io.to('admin_room').emit('client_joined', { client, sessionKey });
    io.to(`agent_${tplId}`).emit('client_joined', { client, sessionKey });

    notifyListUpdate(tplId);
  });

  socket.on('send_client_msg', (data) => {
    const sessionKey = `${data.userUuid}_${data.tplId}`;
    if (clients[sessionKey]) {
      const msgObj = { sender: 'client', text: data.msg };
      clients[sessionKey].messages.push(msgObj);
      clients[sessionKey].unread = true;

      io.to('admin_room').emit('receive_client_msg', { sessionKey, msgObj });
      io.to(`agent_${data.tplId}`).emit('receive_client_msg', { sessionKey, msgObj });

      notifyListUpdate(data.tplId);
    }
  });

  socket.on('send_admin_msg', (data) => {
    const sessionKey = data.sessionKey;
    if (clients[sessionKey]) {
      const msgObj = { sender: 'admin', text: data.msg };
      clients[sessionKey].messages.push(msgObj);
      if (clients[sessionKey].socketId) {
        io.to(clients[sessionKey].socketId).emit('receive_admin_msg', msgObj);
      }
      io.to('admin_room').emit('sync_admin_msg', { sessionKey, msgObj });
      io.to(`agent_${clients[sessionKey].tplId}`).emit('sync_admin_msg', { sessionKey, msgObj });
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
server.listen(PORT, () => console.log(`后端服务在端口 ${PORT} 启动`));
