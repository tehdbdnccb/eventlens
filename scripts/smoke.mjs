const base='http://localhost:4000';
const health=await fetch(base+'/health').then(r=>r.json());
if(!health.ok) throw new Error('API health failed');
const markets=await fetch(base+'/markets').then(r=>r.json());
if(!Array.isArray(markets)||markets.length<4) throw new Error('Market discovery failed');
const preview=await fetch(base+'/trades/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({marketId:markets[0].marketId,side:'UP',quantity:5,wallet:'0xDemo'})}).then(r=>r.json());
if(!preview.ok) throw new Error('Risk preview failed: '+JSON.stringify(preview));
console.log(JSON.stringify({health,markets:markets.length,previewOk:preview.ok},null,2));
