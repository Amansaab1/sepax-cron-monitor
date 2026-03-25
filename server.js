const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Sepax7373737:sepax%409988@cluster0.3dbw30p.mongodb.net/sepax-cron?retryWrites=true&w=majority';

app.use(cors());
app.use(express.json());

// Monitor Schema
const monitorSchema = new mongoose.Schema({
  url: String,
  status: { type: String, enum: ['Active', 'Down'], default: 'Active' },
  lastPing: { type: Date, default: Date.now },
  interval: { type: Number, default: 2 },
  responseTime: Number,
  lastError: String
}, { timestamps: true });

const Monitor = mongoose.model('Monitor', monitorSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.log('❌ MongoDB Error:', err.message));

// Cron Job - Check every 2 minutes
async function checkAllUrls() {
  console.log(`\n[${new Date().toLocaleString()}] 🔍 Checking URLs...`);
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
          console.log(`✅ ${monitor.url} - ACTIVE`);
        } else {
          await Monitor.findByIdAndUpdate(monitor._id, {
            status: 'Down',
            lastPing: new Date(),
            responseTime: Date.now() - startTime,
            lastError: `HTTP ${response.status}`
          });
          console.log(`⚠️ ${monitor.url} - DOWN`);
        }
      } catch (error) {
        await Monitor.findByIdAndUpdate(monitor._id, {
          status: 'Down',
          lastPing: new Date(),
          responseTime: Date.now() - startTime,
          lastError: error.code || error.message
        });
        console.log(`❌ ${monitor.url} - ERROR`);
      }
    }
  } catch (error) {
    console.error('Cron error:', error);
  }
}

cron.schedule('*/2 * * * *', checkAllUrls);
setTimeout(checkAllUrls, 5000);

// API Routes
app.get('/api/monitors', async (req, res) => {
  try {
    const monitors = await Monitor.find().sort({ createdAt: -1 });
    res.json(monitors);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/add-url', async (req, res) => {
  try {
    const { url, interval } = req.body;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Valid URL required' });
    }
    const existing = await Monitor.findOne({ url });
    if (existing) return res.status(400).json({ error: 'URL already exists' });
    
    const monitor = new Monitor({ url, interval: interval || 2 });
    await monitor.save();
    res.json({ success: true, monitor });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.delete('/api/delete/:id', async (req, res) => {
  try {
    await Monitor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.put('/api/update/:id', async (req, res) => {
  try {
    const { url, interval } = req.body;
    const updated = await Monitor.findByIdAndUpdate(req.params.id, { url, interval }, { new: true });
    res.json({ success: true, monitor: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/ping', (req, res) => res.json({ status: 'alive' }));

// Serve HTML - This is the fixed part
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// For any other route, send the HTML
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Create a separate HTML file
const fs = require('fs');
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
        .header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;margin-bottom:30px;padding-bottom:15px;border-bottom:1px solid #333;}
        .logo{display:flex;align-items:center;gap:10px;}
        .logo i{font-size:30px;color:#6366f1;}
        .logo h1{font-size:24px;background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;background-clip:text;color:transparent;}
        .badge{background:#22c55e20;color:#4ade80;padding:4px 10px;border-radius:20px;font-size:12px;}
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
        @media(max-width:768px){.input-group{flex-direction:column;} .search input{width:100%;}}
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <div class="logo"><i class="fas fa-shield-alt"></i><h1>Sepax-Cron</h1><span class="badge">FREE</span></div>
        <div class="search"><i class="fas fa-search"></i><input type="text" id="searchInput" placeholder="Search URLs..."></div>
        <div><i class="fas fa-sync-alt" id="refreshBtn" style="cursor:pointer;font-size:20px;"></i></div>
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
        <table><thead><tr><th>URL</th><th>Last Check</th><th>Status</th><th>Response</th><th>Actions</th></tr></thead><tbody id="tableBody"><tr><td colspan="5" style="text-align:center;">Loading...</td></tr></tbody></table>
    </div>
    <div class="footer"><p>⚡ Free Uptime Monitor | Powered by Node.js + MongoDB</p></div>
</div>
<script>
const API = window.location.origin;
let data = [];

async function fetchData(){
    try{
        const res=await fetch(API+'/api/monitors');
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
    if(!confirm('Delete?'))return;
    await fetch(API+'/api/delete/'+id,{method:'DELETE'});
    fetchData();
    toast('Deleted');
}

async function editMon(id,oldUrl,oldInt){
    let newUrl=prompt('Edit URL:',oldUrl);
    if(!newUrl||newUrl===oldUrl)return;
    if(!newUrl.startsWith('http')){toast('URL must start with http','error');return;}
    let newInt=prompt('Interval (1,2,5 min):',oldInt);
    if(!newInt)return;
    await fetch(API+'/api/update/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:newUrl,interval:parseInt(newInt)})});
    fetchData();
    toast('Updated');
}

async function addMon(){
    let url=document.getElementById('urlInput').value.trim();
    let int=parseInt(document.getElementById('intervalSelect').value);
    if(!url){toast('Enter URL','error');return;}
    if(!url.startsWith('http')){toast('URL must start with http','error');return;}
    let res=await fetch(API+'/api/add-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,interval:int})});
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
document.getElementById('refreshBtn').addEventListener('click',fetchData);
document.getElementById('searchInput').addEventListener('input',()=>render(data));
fetchData();
setInterval(fetchData,15000);
function escapeHtml(s){if(!s)return '';return s.replace(/[&<>]/g,function(m){if(m==='&')return'&amp;';if(m==='<')return'&lt;';if(m==='>')return'&gt;';return m;});}
</script>
</body>
</html>`;

// Write HTML file
fs.writeFileSync(path.join(__dirname, 'index.html'), htmlContent);
console.log('✅ HTML file created');

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
