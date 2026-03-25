const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Sepax7373737:sepax%409988@cluster0.3dbw30p.mongodb.net/sepax-cron?retryWrites=true&w=majority';

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Middleware
app.use(session({
  secret: 'sepax-cron-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ============ MODELS ============

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Monitor Schema (with userId)
const monitorSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  url: { type: String, required: true, trim: true, lowercase: true },
  name: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Down'], default: 'Active' },
  lastPing: { type: Date, default: Date.now },
  interval: { type: Number, default: 2 },
  responseTime: { type: Number, default: 0 },
  lastError: { type: String, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Monitor = mongoose.model('Monitor', monitorSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.log('❌ MongoDB Error:', err.message));

// ============ CRON JOB ============
async function checkAllUrls() {
  console.log(`\n[${new Date().toLocaleString()}] 🔍 Checking all URLs...`);
  try {
    const monitors = await Monitor.find();
    if (monitors.length === 0) return;
    
    for (const monitor of monitors) {
      const startTime = Date.now();
      try {
        const response = await axios.get(monitor.url, { timeout: 10000 });
        if (response.status === 200) {
          await Monitor.findByIdAndUpdate(monitor._id, {
            status: 'Active',
            lastPing: new Date(),
            responseTime: Date.now() - startTime,
            lastError: null
          });
        } else {
          await Monitor.findByIdAndUpdate(monitor._id, {
            status: 'Down',
            lastPing: new Date(),
            responseTime: Date.now() - startTime,
            lastError: `HTTP ${response.status}`
          });
        }
      } catch (error) {
        await Monitor.findByIdAndUpdate(monitor._id, {
          status: 'Down',
          lastPing: new Date(),
          responseTime: Date.now() - startTime,
          lastError: error.code || error.message
        });
      }
    }
    console.log(`✅ Checked ${monitors.length} URLs`);
  } catch (error) {
    console.error('Cron error:', error);
  }
}

cron.schedule('*/2 * * * *', checkAllUrls);
setTimeout(checkAllUrls, 5000);

// ============ AUTH API ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    // Auto login after register
    req.session.userId = user._id;
    req.session.username = user.username;
    
    res.json({ success: true, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    
    req.session.userId = user._id;
    req.session.username = user.username;
    
    res.json({ success: true, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check session
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.json({ authenticated: false });
  }
  
  res.json({ 
    authenticated: true, 
    user: { id: user._id, username: user.username, email: user.email } 
  });
});

// ============ MONITOR API ROUTES (with user filter) ============

// Get user's monitors
app.get('/api/monitors', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const monitors = await Monitor.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json(monitors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

// Add monitor
app.post('/api/add-url', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { url, interval } = req.body;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Valid URL required' });
    }
    
    const existing = await Monitor.findOne({ userId: req.session.userId, url });
    if (existing) {
      return res.status(400).json({ error: 'URL already exists' });
    }
    
    const monitor = new Monitor({
      userId: req.session.userId,
      url,
      interval: interval || 2
    });
    
    await monitor.save();
    res.json({ success: true, monitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add' });
  }
});

// Delete monitor
app.delete('/api/delete/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const monitor = await Monitor.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' });
    }
    
    await Monitor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Update monitor
app.put('/api/update/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { url, interval } = req.body;
    const monitor = await Monitor.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' });
    }
    
    const updated = await Monitor.findByIdAndUpdate(
      req.params.id, 
      { url, interval: interval || 2 }, 
      { new: true }
    );
    
    res.json({ success: true, monitor: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.get('/ping', (req, res) => res.json({ status: 'alive' }));

// ============ SERVE HTML ============

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sepax-Cron | Free Uptime Monitor</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:linear-gradient(135deg,#0a0c10,#0f1117);font-family:Arial,sans-serif;color:#e5e7eb;padding:20px;}
        .container{max-width:1200px;margin:0 auto;}
        
        /* Auth Styles */
        .auth-container{max-width:400px;margin:100px auto;background:#11182780;border-radius:20px;padding:30px;text-align:center;}
        .auth-container h2{margin-bottom:20px;}
        .auth-container input{width:100%;padding:12px;margin:10px 0;background:#111827;border:1px solid #374151;border-radius:10px;color:white;}
        .auth-container button{width:100%;padding:12px;margin:10px 0;background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:10px;color:white;font-weight:bold;cursor:pointer;}
        .auth-container p{margin-top:15px;color:#9ca3af;}
        .auth-container a{color:#818cf8;cursor:pointer;}
        
        /* Main App Styles */
        .header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;margin-bottom:30px;padding-bottom:15px;border-bottom:1px solid #333;}
        .logo{display:flex;align-items:center;gap:10px;}
        .logo i{font-size:30px;color:#6366f1;}
        .logo h1{font-size:24px;background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;background-clip:text;color:transparent;}
        .badge{background:#22c55e20;color:#4ade80;padding:4px 10px;border-radius:20px;font-size:12px;}
        .user-info{display:flex;align-items:center;gap:15px;}
        .logout-btn{background:#ef4444;border:none;padding:8px 15px;border-radius:10px;color:white;cursor:pointer;}
        .search{position:relative;}
        .search input{background:#111827;border:1px solid #374151;border-radius:12px;padding:10px 15px 10px 35px;color:white;width:250px;}
        .search i{position:absolute;left:12px;top:12px;color:#6b7280;}
        .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:30px;}
        .stat-card{background:#11182780;backdrop-filter:blur(10px);border:1px solid #333;border-radius:20px;padding:20px;display:flex;justify-content:space-between;}
        .stat-value{font-size:32px;font-weight:bold;}
        .green{color:#4ade80;}
        .red{color:#f87171;}
        .add-section{background:#11182780;border:1px solid #333;border-radius:20px;padding:20px;margin-bottom:30px;}
        .input-group{display:flex;gap:15px;flex-wrap:wrap;}
        .input-group input{flex:2;background:#111827;border:1px solid #374151;border-radius:12px;padding:12px;color:white;}
        .input-group select{background:#111827;border:1px solid #374151;border-radius:12px;padding:12px;color:white;}
        .btn{background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:12px;padding:12px 25px;color:white;font-weight:bold;cursor:pointer;}
        .table-container{background:#11182780;border:1px solid #333;border-radius:20px;overflow-x:auto;}
        table{width:100%;border-collapse:collapse;}
        th{text-align:left;padding:15px;background:#1f2937;color:#9ca3af;}
        td{padding:15px;border-bottom:1px solid #333;}
        .status-active{background:#22c55e20;color:#4ade80;padding:5px 12px;border-radius:20px;display:inline-block;}
        .status-down{background:#ef444420;color:#f87171;padding:5px 12px;border-radius:20px;display:inline-block;}
        .action-buttons i{margin:0 5px;cursor:pointer;}
        .edit-btn{color:#60a5fa;}
        .delete-btn{color:#f87171;}
        .footer{text-align:center;margin-top:30px;padding:20px;color:#6b7280;}
        .hidden{display:none;}
        @media(max-width:768px){.input-group{flex-direction:column;} .search input{width:100%;}}
    </style>
</head>
<body>
<!-- Login/Register Container -->
<div id="authContainer" class="auth-container">
    <div id="loginForm">
        <h2><i class="fas fa-shield-alt"></i> Sepax-Cron</h2>
        <p style="margin-bottom:20px;">Login to your account</p>
        <input type="text" id="loginUsername" placeholder="Username">
        <input type="password" id="loginPassword" placeholder="Password">
        <button onclick="login()">Login</button>
        <p>Don't have an account? <a onclick="showRegister()">Register</a></p>
    </div>
    <div id="registerForm" class="hidden">
        <h2><i class="fas fa-user-plus"></i> Register</h2>
        <input type="text" id="regUsername" placeholder="Username">
        <input type="email" id="regEmail" placeholder="Email">
        <input type="password" id="regPassword" placeholder="Password">
        <button onclick="register()">Register</button>
        <p>Already have an account? <a onclick="showLogin()">Login</a></p>
    </div>
</div>

<!-- Main App Container -->
<div id="appContainer" class="container hidden">
    <div class="header">
        <div class="logo"><i class="fas fa-shield-alt"></i><h1>Sepax-Cron</h1><span class="badge">FREE</span></div>
        <div class="search"><i class="fas fa-search"></i><input type="text" id="searchInput" placeholder="Search URLs..."></div>
        <div class="user-info">
            <span id="usernameDisplay"></span>
            <button class="logout-btn" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>
        </div>
    </div>
    
    <div class="stats">
        <div class="stat-card"><div><p>Total Monitors</p><p class="stat-value" id="totalCount">0</p></div><i class="fas fa-chart-line" style="font-size:40px;color:#818cf8;"></i></div>
        <div class="stat-card"><div><p>Active Bots</p><p class="stat-value green" id="activeCount">0</p></div><i class="fas fa-check-circle" style="font-size:40px;color:#4ade80;"></i></div>
        <div class="stat-card"><div><p>Failed Pings</p><p class="stat-value red" id="failedCount">0</p></div><i class="fas fa-exclamation-triangle" style="font-size:40px;color:#f87171;"></i></div>
    </div>
    
    <div class="add-section">
        <div class="input-group">
            <input type="text" id="urlInput" placeholder="https://your-website.com">
            <select id="intervalSelect"><option value="1">1 min</option><option value="2" selected>2 min</option><option value="5">5 min</option></select>
            <button class="btn" id="addBtn"><i class="fas fa-plus-circle"></i> Add Monitor</button>
        </div>
        <p style="font-size:12px;color:#6b7280;margin-top:10px;"><i class="fas fa-info-circle"></i> Free service - Checks every 2 minutes</p>
    </div>
    
    <div class="table-container">
        <table class="monitor-table">
            <thead><tr><th>URL</th><th>Last Check</th><th>Status</th><th>Response</th><th>Actions</th></tr></thead>
            <tbody id="tableBody"><tr><td colspan="5" style="text-align:center;">Loading...</td></tr></tbody>
        </table>
    </div>
    <div class="footer"><p>⚡ Free Uptime Monitor | Powered by Node.js + MongoDB</p></div>
</div>

<script>
const API = window.location.origin;
let data = [];

// Auth Functions
async function checkSession() {
    try {
        const res = await fetch(API+'/api/me', {credentials: 'include'});
        const result = await res.json();
        if(result.authenticated) {
            document.getElementById('usernameDisplay').innerText = result.user.username;
            document.getElementById('authContainer').classList.add('hidden');
            document.getElementById('appContainer').classList.remove('hidden');
            fetchData();
        } else {
            document.getElementById('authContainer').classList.remove('hidden');
            document.getElementById('appContainer').classList.add('hidden');
        }
    } catch(e) {
        console.log('Session check failed');
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    if(!username || !password) { toast('Enter username and password','error'); return; }
    
    try {
        const res = await fetch(API+'/api/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username, password}),
            credentials: 'include'
        });
        const data = await res.json();
        if(data.success) {
            toast('Welcome back, '+username+'!');
            checkSession();
        } else {
            toast(data.error, 'error');
        }
    } catch(e) { toast('Login failed','error'); }
}

async function register() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    if(!username || !email || !password) { toast('Fill all fields','error'); return; }
    
    try {
        const res = await fetch(API+'/api/register', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username, email, password}),
            credentials: 'include'
        });
        const data = await res.json();
        if(data.success) {
            toast('Registered successfully!');
            checkSession();
        } else {
            toast(data.error, 'error');
        }
    } catch(e) { toast('Registration failed','error'); }
}

async function logout() {
    await fetch(API+'/api/logout', {method:'POST', credentials:'include'});
    checkSession();
}

function showRegister() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

// Monitor Functions
async function fetchData(){
    try{
        const res=await fetch(API+'/api/monitors', {credentials: 'include'});
        if(res.status===401){ checkSession(); return; }
        const monitors=await res.json();
        data=monitors;
        render(monitors);
        document.getElementById('totalCount').innerText=monitors.length;
        document.getElementById('activeCount').innerText=monitors.filter(m=>m.status==='Active').length;
        document.getElementById('failedCount').innerText=monitors.filter(m=>m.status==='Down').length;
    }catch(e){document.getElementById('tableBody').innerHTML='<tr><td colspan="5">Error loading</td></tr>';}
}

function formatTime(d){
    if(!d)return 'Never';
    let date=new Date(d),diff=Math.floor((new Date()-date)/1000);
    if(diff<60)return diff+' sec ago';
    if(diff<3600)return Math.floor(diff/60)+' min ago';
    if(diff<86400)return Math.floor(diff/3600)+' hr ago';
    return date.toLocaleDateString();
}

function render(monitors){
    const search=document.getElementById('searchInput').value.toLowerCase();
    const filtered=monitors.filter(m=>m.url.toLowerCase().includes(search));
    if(!filtered.length){document.getElementById('tableBody').innerHTML='<tr><td colspan="5">No monitors</td></tr>';return;}
    document.getElementById('tableBody').innerHTML=filtered.map(m=>{
        return '<tr>'+
            '<td style="word-break:break-all;max-width:250px;">'+escapeHtml(m.url)+'</td>'+
            '<td>'+formatTime(m.lastPing)+'</td>'+
            '<td><span class="'+(m.status==='Active'?'status-active':'status-down')+'"><i class="fas fa-circle" style="font-size:8px;"></i> '+m.status+'</span></td>'+
            '<td>'+(m.responseTime?m.responseTime+'ms':'-')+'</td>'+
            '<td class="action-buttons"><i class="fas fa-edit edit-btn" data-id="'+m._id+'" data-url="'+escapeHtml(m.url)+'" data-interval="'+m.interval+'"></i> <i class="fas fa-trash-alt delete-btn" data-id="'+m._id+'"></i></td>'+
            '</tr>';
    }).join('');
    document.querySelectorAll('.delete-btn').forEach(btn=>btn.addEventListener('click',()=>deleteMon(btn.dataset.id)));
    document.querySelectorAll('.edit-btn').forEach(btn=>btn.addEventListener('click',()=>editMon(btn.dataset.id,btn.dataset.url,btn.dataset.interval)));
}

async function deleteMon(id){
    if(!confirm('Delete this monitor?'))return;
    await fetch(API+'/api/delete/'+id,{method:'DELETE', credentials:'include'});
    fetchData();
    toast('Deleted');
}

async function editMon(id,oldUrl,oldInt){
    let newUrl=prompt('Edit URL:',oldUrl);
    if(!newUrl||newUrl===oldUrl)return;
    if(!newUrl.startsWith('http')){toast('URL must start with http','error');return;}
    let newInt=prompt('Interval (1,2,5 min):',oldInt);
    if(!newInt)return;
    await fetch(API+'/api/update/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:newUrl,interval:parseInt(newInt)}), credentials:'include'});
    fetchData();
    toast('Updated');
}

async function addMon(){
    let url=document.getElementById('urlInput').value.trim();
    let int=parseInt(document.getElementById('intervalSelect').value);
    if(!url){toast('Enter URL','error');return;}
    if(!url.startsWith('http')){toast('URL must start with http','error');return;}
    let res=await fetch(API+'/api/add-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,interval:int}), credentials:'include'});
    if(res.ok){document.getElementById('urlInput').value='';fetchData();toast('Added!');}
    else{let err=await res.json();toast(err.error||'Failed','error');}
}

function toast(msg,type='success'){
    let t=document.createElement('div');
    t.innerHTML=msg;
    t.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(type==='success'?'#10b981':'#ef4444')+';color:white;padding:12px 20px;border-radius:8px;z-index:1000;';
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),3000);
}

document.getElementById('addBtn').addEventListener('click',addMon);
document.getElementById('searchInput').addEventListener('input',()=>render(data));

function escapeHtml(s){if(!s)return '';return s.replace(/[&<>]/g,function(m){if(m==='&')return'&amp;';if(m==='<')return'&lt;';if(m==='>')return'&gt;';return m;});}

checkSession();
setInterval(()=>{ if(!document.getElementById('authContainer').classList.contains('hidden')) return; fetchData(); },15000);
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'index.html'), htmlContent);
console.log('✅ HTML file created');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
