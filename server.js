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
const clients = {};
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

  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };
    
    socket.emit('init_template_data', config);

    // 自动为访客编号，并在消息记录里预置打招呼内容
    const clientName = `访客 ${clientCounter++}`;
    clients[socket.id] = {
      id: socket.id,
      name: clientName,
      tplId: tplId,
      tag: '',
      messages: config.welcome ? [{ sender: 'admin', text: config.welcome }] : []
    };

    io.to('admin_room').emit('update_client_list', clients);
  });

  socket.on('send_client_msg', (data) => {
    if (clients[socket.id]) {
      clients[socket.id].messages.push({ sender: 'client', text: data.msg });
    }
    io.to('admin_room').emit('receive_client_msg', {
      clientId: socket.id,
      msg: data.msg
    });
  });

  socket.on('send_admin_msg', (data) => {
    if (clients[data.clientId]) {
      clients[data.clientId].messages.push({ sender: 'admin', text: data.msg });
    }
    io.to(data.clientId).emit('receive_admin_msg', { msg: data.msg });
  });

  socket.on('update_client_tag', (data) => {
    if (clients[data.clientId]) {
      clients[data.clientId].tag = data.tag;
      io.to('admin_room').emit('update_client_list', clients);
    }
  });

  socket.on('delete_client', (clientId) => {
    delete clients[clientId];
    io.to('admin_room').emit('update_client_list', clients);
  });

  socket.on('disconnect', () => {
    if (clients[socket.id]) {
      delete clients[socket.id];
      io.to('admin_room').emit('update_client_list', clients);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后端已在端口 ${PORT} 启动`));
