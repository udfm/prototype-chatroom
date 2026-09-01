// Create Messages table with a timestamp column
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

// Run cleanup when the server starts, and then every 24 hours
cleanupOldMessages();
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

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

    // Save message to SQLite database
    db.run(
      'INSERT INTO messages (username, text) VALUES (?, ?)',
      [user.username, data.text],
      function (err) {
        if (err) {
          console.error('Failed to save message:', err.message);
          return;
        }

        // Broadcast to all connected clients
        io.emit('chat message', {
          user: user.username,
          text: data.text
        });
      }
    );
  });
});
