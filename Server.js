require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_CODE = process.env.SECRET_CODE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const DATA_FILE = path.join(__dirname, 'data', 'users.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

let users = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    users = [];
  }
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Signup endpoint
app.post('/api/signup', (req, res) => {
  const { name, phone, dob, workStatus, code } = req.body;

  if (code !== SECRET_CODE) {
    return res.status(403).json({ error: 'Wrong secret code' });
  }

  const blockedUser = users.find(u => u.phone === phone && u.blocked);
  if (blockedUser) {
    return res.status(403).json({ error: 'Your access has been revoked by admin.' });
  }

  const newUser = {
    id: Date.now().toString(),
    name,
    phone,
    dob,
    workStatus,
    blocked: false,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();

  const token = jwt.sign({ id: newUser.id, phone: newUser.phone }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('auth_token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
  res.json({ success: true, message: 'Welcome! Redirecting...' });
});

// Token verification
app.get('/api/verify', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === decoded.id);
    if (!user || user.blocked) {
      res.clearCookie('auth_token');
      return res.status(401).json({ valid: false, reason: 'blocked' });
    }
    res.json({ valid: true, user: { name: user.name } });
  } catch (err) {
    res.clearCookie('auth_token');
    return res.status(401).json({ valid: false });
  }
});

// Admin panel route (prompts for admin password)
app.get('/admin', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required.');
  }
  const base64Credentials = auth.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [, password] = credentials.split(':');
  if (password !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid credentials.');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API: get all users
app.get('/api/admin/users', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const base64Credentials = auth.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [, password] = credentials.split(':');
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const safeUsers = users.map(({ code, ...u }) => u);
  res.json(safeUsers);
});

// Admin API: block user
app.post('/api/admin/block/:id', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const base64Credentials = auth.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [, password] = credentials.split(':');
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const userId = req.params.id;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.blocked = true;
  saveUsers();
  res.json({ success: true, message: 'User blocked' });
});

// Redirect root to appropriate page
app.get('/', (req, res) => {
  const token = req.cookies.auth_token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect('/app.html');
    } catch (e) {}
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Protect app.html
app.get('/app.html', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.redirect('/');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === decoded.id);
    if (!user || user.blocked) {
      res.clearCookie('auth_token');
      return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
  } catch (err) {
    res.clearCookie('auth_token');
    return res.redirect('/');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
