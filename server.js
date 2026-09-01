const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Setup local SQLite database file
const db = new sqlite3.Database('./users.db');

// Create Users and Messages tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

const sessionMiddleware = session({
  secret: 'chatroom-secret-key-change-this',
  resave: false,
  saveUninitialized: false
});

app.use(sessionMiddleware);

// Share session data with Socket.IO
io.engine.use(sessionMiddleware);

/* --- Cleanup Function: Delete messages older than 30 days --- */
function cleanupOldMessages() {
  const thirtyDaysAgo = "DATETIME('now', '-30 days')";
  db.run(`DELETE FROM messages WHERE created_at < ${thirtyDaysAgo}`, function(err) {
    if (err) {
      console.error('Error cleaning up old messages:', err.message);
    } else if (this.changes > 0) {
      console.log(`Cleaned up ${this.changes} message(s) older than 30 days.`);
    }
  });
}

// Run cleanup when server starts, and every 24 hours
cleanupOldMessages();
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

/* --- API ROUTE: Register --- */
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Username is already taken' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      req.session.user = { id: this.lastID, username };
      res.json({ success: true, username });
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

/* --- API ROUTE: Login --- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid username or password' });

    req.session.user = { id: user.id, username: user.username };
    res.json({ success: true, username: user.username });
  });
});

/* --- API ROUTE: Check Current Session --- */
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

/* --- API ROUTE: Get Recent Messages (last 30 days) --- */
app.get('/api/messages', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  db.all(
    `SELECT username, text, created_at FROM messages 
     WHERE created_at >= DATETIME('now', '-30 days') 
     ORDER BY id ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

/* --- API ROUTE: Logout --- */
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

/* --- Socket Connection --- */
io.on('connection', (socket) => {
  const req = socket.request;
  const user = req.session ? req.session.user : null;

  if (!user) {
    socket.disconnect(true);
    return;
  }

  socket.on('chat message', (data) => {
    if (!data.text || !data.text.trim()) return;

    db.run(
      'INSERT INTO messages (username, text) VALUES (?, ?)',
      [user.username, data.text],
      function (err) {
        if (err) {
          console.error('Failed to save message:', err.message);
          return;
        }

        io.emit('chat message', {
          user: user.username,
          text: data.text
        });
      }
    );
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
