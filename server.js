const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// 允许跨域并提高数据传输上限到 10MB
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7 
});

const templates = {};
const clients = {};

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.on('admin_init', () => {
    socket.join('admin_room');
    socket.emit('update_client_list', clients);
    socket.emit('init_templates_list', templates);
  });

  socket.on('create_template', (tplData) => {
    if (tplData && tplData.id) {
      templates[tplData.id] = tplData;
      console.log('成功保存模板:', tplData.id);
      io.to('admin_room').emit('template_created', tplData);
    }
  });

  socket.on('client_init', (data) => {
    const tplId = (data && data.tplId) ? data.tplId : 'default';
    const config = templates[tplId] || {
      id: 'default',
      title: '官方高级顾问',
      welcome: '您好！请问有什么可以帮您？'
    };
    
    socket.emit('init_template_data', config);

    clients[socket.id] = {
      id: socket.id,
      tplId: tplId,
      messages: []
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

  socket.on('disconnect', () => {
    if (clients[socket.id]) {
      delete clients[socket.id];
      io.to('admin_room').emit('update_client_list', clients);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`运行在端口 ${PORT}`));
