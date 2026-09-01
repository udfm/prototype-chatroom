const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static HTML/JS files from the "public" directory
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('A user connected');

  // Listen for incoming messages from a user
  socket.on('chat message', (data) => {
    // Broadcast the message to everyone connected
    io.emit('chat message', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(3000, () => {
  console.log('Chatroom server running on http://localhost:3000');
});
