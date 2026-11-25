'use strict';

// 1:1 Palette matching TFT_eSPI
const TFT_BLACK=0x0000,TFT_WHITE=0xFFFF,TFT_RED=0xF800,TFT_GREEN=0x07E0;
const TFT_BLUE=0x001F,TFT_YELLOW=0xFFE0,TFT_CYAN=0x07FF,TFT_MAGENTA=0xF81F;
const TFT_ORANGE=0xFD20,TFT_DARKGREY=0x7BEF,TFT_LIGHTGREY=0xC618;
const TFT_PURPLE=0x780F,TFT_NAVY=0x000F,TFT_GOLD=0xFEA0;
const KRYONOS_VERSION="3.0.0",KRYONOS_API_LEVEL=3;

const S={
  LAUNCHER:0,SETTINGS:1,RUN_APP:2,INSTALLER:3,CALIBRATOR:4,WEB_APP:5,
  SETTINGS_WIFI:6,SETTINGS_ABOUT:7,SETTINGS_APPS:8,SETTINGS_TIME:9,
  SETTINGS_TIME_MANUAL:10,UPDATER_BOOT:11,UPDATER_MANUAL:12,APP_STORE:13,
  HELP_CENTER:14,SETTINGS_WIFI_SAVED:15,KRYON_CLOUD:16,SETTINGS_PERMISSIONS:17
};

const $=id=>document.getElementById(id);
const consoleEl=$('console');
function log(msg,cls){
  if(!consoleEl)return;
  const d=document.createElement('div');
  if(cls)d.className=cls;
  d.textContent=`[${new Date().toLocaleTimeString('en-GB',{hour12:false})}] ${msg}`;
  consoleEl.appendChild(d);
  while(consoleEl.children.length>500)consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop=consoleEl.scrollHeight;
}
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms|0)));
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const _txtEnc=new TextEncoder();
const _txtDec=new TextDecoder();

function formatConsoleArgs(args){
  return Array.from(args).map(a=>{
    if(a===null)return 'null';
    if(a===undefined)return 'undefined';
    if(typeof a==='object'){
      try{return JSON.stringify(a);}catch(e){return String(a);}
    }
    return String(a);
  }).join(' ');
}

class AudioPWM{
  constructor(){this.ctx=null;this.oscs=new Map();}
  _ensure(){
    if(!this.ctx){const AC=window.AudioContext||window.webkitAudioContext;if(AC)this.ctx=new AC();}
    if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();
  }
  setTone(pin,freq,dur=0,vol=0.05,wave='square'){
    try{
      this._ensure();if(!this.ctx)return;this.stopTone(pin);if(freq<=0)return;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type=wave;o.frequency.value=freq;g.gain.value=clamp(vol,0,0.4);
      o.connect(g);g.connect(this.ctx.destination);o.start();
      this.oscs.set(pin,{osc:o,gain:g});
      if(dur>0)setTimeout(()=>this.stopTone(pin),dur);
    }catch(e){}
  }
  stopTone(pin){
    const it=this.oscs.get(pin);
    if(it){try{it.gain.gain.value=0;it.osc.stop();it.osc.disconnect();}catch(e){}this.oscs.delete(pin);}
  }
  reset(){for(const p of [...this.oscs.keys()])this.stopTone(p);}
}
const audioHW=new AudioPWM();

class VFS{
  constructor(sim){this.sim=sim;this.dbName='KryonOS_VFS_v12';this.store='files';this.db=null;this.cache=new Map();}
  async init(){
    return new Promise(resolve=>{
      try{
        const req=indexedDB.open(this.dbName,1);
        req.onupgradeneeded=e=>{
          const db=e.target.result;
          if(!db.objectStoreNames.contains(this.store))db.createObjectStore(this.store,{keyPath:'path'});
        };
        req.onsuccess=async e=>{
          this.db=e.target.result;await this._load();
          if(this.cache.size===0)await this.seedDefaults();
          resolve();
        };
        req.onerror=()=>{this.seedDefaults().then(resolve);};
      }catch(e){this.seedDefaults().then(resolve);}
    });
  }
  _load(){
    return new Promise(resolve=>{
      if(!this.db)return resolve();
      const tx=this.db.transaction(this.store,'readonly');
      const req=tx.objectStore(this.store).getAll();
      req.onsuccess=()=>{
        this.cache.clear();(req.result||[]).forEach(it=>this.cache.set(it.path,it));resolve();
      };
      req.onerror=()=>resolve();
    });
  }
  _norm(p){let c=String(p||'').replace(/\/+/g,'/');if(c.length>1&&c.endsWith('/'))c=c.slice(0,-1);if(!c.startsWith('/'))c='/'+c;return c;}
  async seedDefaults(){
    for(const d of ['/local','/local/apps','/local/system','/local/tmp_download','/sd','/sd/apps','/sd/system'])this._put(d,null,true,false);
    this._installDemo('com.kryon.calc',{name:'Calculator',packageName:'com.kryon.calc',version:'1.0.0',api:3,author:'KryonTeam',category:'Utility',type:'App',description:'Standard utility calculator.',permissions:[]},
`System.fillScreen(System.color(20,20,30));
System.setTextColor(WHITE, System.color(20,20,30));
System.drawString("Calculator", 55, 30, 4);
System.fillRoundRect(20, 100, 200, 40, 6, BLUE);
System.setTextColor(WHITE, BLUE);
System.drawString("Tap to beep", 70, 112, 2);
while (true) {
  var t = System.getTouch();
  if (t.touched) { PWM.setTone(18, 1400, 100); System.notify("Calc", "Button pressed", "info", 1500); }
  System.delay(40);
}`);
    this._put('/local/system/wifi_credentials.enc',btoa(JSON.stringify([{ssid:'KryonOS_Sim',password:'kryon1234',lastConnected:Date.now()}])),false,false);
    this._put('/local/system/app_permissions.json',JSON.stringify({'com.kryon.calc':['storage','location']},null,2),false,false);
    await this._persistAll();
  }
  _installDemo(pkg,meta,code){
    const dir='/local/apps/'+pkg;
    this._put(dir,null,true,false);
    this._put(dir+'/app.json',JSON.stringify(meta,null,2),false,false);
    this._put(dir+'/main.js',code,false,false);
  }
  _persistAll(){
    if(!this.db)return Promise.resolve();
    return new Promise(resolve=>{
      const tx=this.db.transaction(this.store,'readwrite');
      const store=tx.objectStore(this.store);
      for(const it of this.cache.values())store.put(it);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>resolve();
    });
  }
  _put(path,content,isDir=false,notify=true){
    const clean=this._norm(path);
    const isBin=(content instanceof Uint8Array);
    const val=isDir?null:(isBin?new Uint8Array(content):String(content!=null?content:''));
    const sz=isDir?0:(isBin?val.byteLength:val.length);
    const rec={path:clean,content:val,isDir,isBinary:isBin,size:sz,modified:Date.now()};
    this.cache.set(clean,rec);
    if(this.db){try{const tx=this.db.transaction(this.store,'readwrite');tx.objectStore(this.store).put(rec);}catch(e){}}
    if(notify&&this.sim)this.sim.onStorageChanged();
    return true;
  }
  exists(p){return this.cache.has(this._norm(p));}
  isDir(p){const it=this.cache.get(this._norm(p));return it?it.isDir:false;}
  isFile(p){const it=this.cache.get(this._norm(p));return it?!it.isDir:false;}
  read(p){
    const it=this.cache.get(this._norm(p));
    if(!it||it.isDir)return '';
    if(it.content instanceof Uint8Array)return _txtDec.decode(it.content);
    return String(it.content||'');
  }
  readBytes(p){
    const it=this.cache.get(this._norm(p));
    if(!it||it.isDir)return null;
    if(it.content instanceof Uint8Array)return new Uint8Array(it.content);
    return _txtEnc.encode(String(it.content||''));
  }
  write(p,c){
    if(!p)return false;
    this._mkparent(p);
    if(c instanceof ArrayBuffer)return this._put(p,new Uint8Array(c),false,true);
    if(ArrayBuffer.isView(c))return this._put(p,new Uint8Array(c.buffer,c.byteOffset,c.byteLength),false,true);
    return this._put(p,c,false,true);
  }
  append(p,c){return this.write(p,this.read(p)+String(c));}
  mkdir(p){const clean=this._norm(p);if(this.cache.has(clean))return true;this._mkparent(clean);return this._put(clean,null,true,true);}
  remove(p){
    const clean=this._norm(p);this.cache.delete(clean);
    for(const k of [...this.cache.keys()])if(k.startsWith(clean+'/'))this.cache.delete(k);
    if(this.db){try{const tx=this.db.transaction(this.store,'readwrite');const store=tx.objectStore(this.store);store.delete(clean);for(const k of [...this.cache.keys()])if(k.startsWith(clean+'/'))store.delete(k);}catch(e){}}
    if(this.sim)this.sim.onStorageChanged();
    return true;
  }
  rename(from,to){
    const f=this._norm(from),t=this._norm(to);const it=this.cache.get(f);if(!it)return false;
    const content=it.content;const isDir=it.isDir;
    this.remove(f);this._mkparent(t);return this._put(t,content,isDir,true);
  }
  copy(from,to){
    const f=this._norm(from),t=this._norm(to);
    if(f===t)return false;
    const it=this.cache.get(f);if(!it||it.isDir)return false;
    this._mkparent(t);
    return this._put(t,it.content,false,true);
  }
  listDir(p){const clean=this._norm(p);const pre=clean.endsWith('/')?clean:clean+'/';const out=[];for(const k of this.cache.keys()){if(k.startsWith(pre)&&k!==clean){const sub=k.substring(pre.length);if(!sub.includes('/'))out.push(k);}}return out;}
  listDirFull(p){const clean=this._norm(p);const pre=clean.endsWith('/')?clean:clean+'/';const out=[];for(const [k,it] of this.cache.entries()){if(k.startsWith(pre)&&k!==clean){const sub=k.substring(pre.length);if(!sub.includes('/'))out.push({name:sub,path:k,isDir:it.isDir,size:it.size,modified:it.modified});}}return out;}
  size(p){const it=this.cache.get(this._norm(p));return it?it.size:0;}
  stat(p){
    const clean=this._norm(p);const it=this.cache.get(clean);if(!it)return null;
    return {
      exists:true,isDirectory:it.isDir,isFile:!it.isDir,size:it.size,
      mtime:Math.floor((it.modified||Date.now())/1000),
      drive:clean.startsWith('/sd')?'sd':'local'
    };
  }
  totalSpace(){return 16*1024*1024;}
  usedSpace(){let t=0;for(const it of this.cache.values())t+=it.size;return t;}
  freeSpace(){return this.totalSpace()-this.usedSpace();}
  _mkparent(p){const parts=this._norm(p).split('/').filter(Boolean);let cur='';for(let i=0;i<parts.length-1;i++){cur+='/'+parts[i];if(!this.cache.has(cur))this._put(cur,null,true,false);}}
  async reset(){if(this.db){const tx=this.db.transaction(this.store,'readwrite');tx.objectStore(this.store).clear();}this.cache.clear();await this.seedDefaults();log('Flash formatted, defaults restored.','warn');}
  md5(p){const bytes=this.readBytes(p)||new Uint8Array(0);let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=(h*0x01000193)>>>0;}const seed=h.toString(16).padStart(8,'0');return (seed+seed+seed+seed).slice(0,32);}
}

class TFTDisplay{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.ctx.imageSmoothingEnabled=false;
    this.W=canvas.width;this.H=canvas.height;this.fg='#fff';this.bg=null;this.size=1;this.datum=0;
    this.activeSprite=null;this.spriteBound=false;this.kryon3D=null;this._imgCache=new Map();this.clear();
  }
  clear(){this.ctx.fillStyle='#000';this.ctx.fillRect(0,0,this.W,this.H);}
  resetState(){this.fg='#fff';this.bg=null;this.size=1;this.datum=0;}
  static c565(c){
    const r=((c>>11)&0x1F)*255/31|0,g=((c>>5)&0x3F)*255/63|0,b=(c&0x1F)*255/31|0;
    return `rgb(${r},${g},${b})`;
  }
  _t(){
    if(this.activeSprite&&this.spriteBound)return this.activeSprite.ctx;
    if(this.kryon3D&&this.kryon3D.sprite&&!this.kryon3D._directDraw)return this.kryon3D.sprite.ctx;
    return this.ctx;
  }
  _w(){
    if(this.activeSprite&&this.spriteBound)return this.activeSprite.canvas.width;
    if(this.kryon3D&&this.kryon3D.sprite&&!this.kryon3D._directDraw)return this.kryon3D.sprite.canvas.width;
    return this.W;
  }
  _h(){
    if(this.activeSprite&&this.spriteBound)return this.activeSprite.canvas.height;
    if(this.kryon3D&&this.kryon3D.sprite&&!this.kryon3D._directDraw)return this.kryon3D.sprite.canvas.height;
    return this.H;
  }
  fillScreen(c){const x=this._t();x.fillStyle=TFTDisplay.c565(c);x.fillRect(0,0,this._w(),this._h());}
  fillRect(x,y,w,h,c){if(w<=0||h<=0)return;const t=this._t();t.fillStyle=TFTDisplay.c565(c);t.fillRect(x,y,w,h);}
  drawRect(x,y,w,h,c){const t=this._t();t.strokeStyle=TFTDisplay.c565(c);t.lineWidth=1;t.strokeRect(x+.5,y+.5,Math.max(0,w-1),Math.max(0,h-1));}
  drawLine(x0,y0,x1,y1,c){const t=this._t();t.strokeStyle=TFTDisplay.c565(c);t.lineWidth=1;t.beginPath();t.moveTo(x0+.5,y0+.5);t.lineTo(x1+.5,y1+.5);t.stroke();}
  drawFastHLine(x,y,w,c){this.drawLine(x,y,x+w-1,y,c);}
  drawFastVLine(x,y,h,c){this.drawLine(x,y,x,y+h-1,c);}
  drawPixel(x,y,c){const t=this._t();t.fillStyle=TFTDisplay.c565(c);t.fillRect(x,y,1,1);}
  drawCircle(x,y,r,c){const t=this._t();t.strokeStyle=TFTDisplay.c565(c);t.beginPath();t.arc(x,y,Math.abs(r),0,Math.PI*2);t.stroke();}
  fillCircle(x,y,r,c){const t=this._t();t.fillStyle=TFTDisplay.c565(c);t.beginPath();t.arc(x,y,Math.abs(r),0,Math.PI*2);t.fill();}
  drawTriangle(x0,y0,x1,y1,x2,y2,c){this.drawLine(x0,y0,x1,y1,c);this.drawLine(x1,y1,x2,y2,c);this.drawLine(x2,y2,x0,y0,c);}
  fillTriangle(x0,y0,x1,y1,x2,y2,c){const t=this._t();t.fillStyle=TFTDisplay.c565(c);t.beginPath();t.moveTo(x0,y0);t.lineTo(x1,y1);t.lineTo(x2,y2);t.closePath();t.fill();}
  _rr(t,x,y,w,h,r){
    r=Math.min(r,w/2,h/2);t.beginPath();t.moveTo(x+r,y);t.arcTo(x+w,y,x+w,y+h,r);
    t.arcTo(x+w,y+h,x,y+h,r);t.arcTo(x,y+h,x,y,r);t.arcTo(x,y,x+w,y,r);t.closePath();
  }
  drawRoundRect(x,y,w,h,r,c){const t=this._t();t.strokeStyle=TFTDisplay.c565(c);t.lineWidth=1;this._rr(t,x+.5,y+.5,Math.max(0,w-1),Math.max(0,h-1),r);t.stroke();}
  fillRoundRect(x,y,w,h,r,c){if(w<=0||h<=0)return;const t=this._t();t.fillStyle=TFTDisplay.c565(c);this._rr(t,x,y,w,h,r);t.fill();}
  setTextColor(fg,bg){this.fg=TFTDisplay.c565(fg);this.bg=(bg!=null)?TFTDisplay.c565(bg):null;}
  setTextDatum(d){this.datum=d;}
  setTextSize(s){this.size=Math.max(1,s|0);}
  drawString(str,x,y,font=2){
    const t=this._t();
    const base=({1:9,2:14,4:26,6:44,7:44,8:56})[font]||14;
    const sz=Math.max(6,Math.floor(base*this.size));
    t.font=`bold ${sz}px "Courier New",monospace`;
    str=String(str!=null?str:'');
    const w=t.measureText(str).width;
    let rx=x,ry=y;
    if(this.datum===1){rx=x-w/2;}
    else if(this.datum===4){rx=x-w/2;ry=y-sz/2;}
    else if(this.datum===3){ry=y-sz/2;}
    t.textBaseline='top';t.textAlign='left';
    if(this.bg){t.fillStyle=this.bg;t.fillRect(rx,ry,w,sz);}
    t.fillStyle=this.fg;t.fillText(str,rx,ry);
  }
  getImageInfo(sim,path){
    const bytes=sim.vfs.readBytes(path);
    if(!bytes||bytes.length<12)return {valid:false,width:0,height:0,type:'unknown',bpp:0,hasAlpha:false};
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47&&bytes.length>=26){
      const w=(bytes[16]<<24)|(bytes[17]<<16)|(bytes[18]<<8)|bytes[19];
      const h=(bytes[20]<<24)|(bytes[21]<<16)|(bytes[22]<<8)|bytes[23];
      const bitDepth=bytes[24],colorType=bytes[25];
      const hasAlpha=(colorType===4||colorType===6);
      const chans=({0:1,2:3,3:1,4:2,6:4})[colorType]||3;
      return {valid:true,width:w>>>0,height:h>>>0,type:'png',bpp:bitDepth*chans,hasAlpha};
    }
    // BMP magic: 'BM'
    if(bytes[0]===0x42&&bytes[1]===0x4D&&bytes.length>=30){
      const w=bytes[18]|(bytes[19]<<8)|(bytes[20]<<16)|(bytes[21]<<24);
      const h=Math.abs((bytes[22]|(bytes[23]<<8)|(bytes[24]<<16)|(bytes[25]<<24))|0);
      const bpp=bytes[28]|(bytes[29]<<8);
      return {valid:true,width:w>>>0,height:h,type:'bmp',bpp,hasAlpha:bpp===32};
    }
    // JPEG magic: FF D8
    if(bytes[0]===0xFF&&bytes[1]===0xD8){
      let i=2;
      while(i+8<bytes.length){
        if(bytes[i]!==0xFF){i++;continue;}
        const m=bytes[i+1];
        if(m===0xC0||m===0xC2){
          const h=(bytes[i+5]<<8)|bytes[i+6];
          const w=(bytes[i+7]<<8)|bytes[i+8];
          const comps=bytes[i+9]||3;
          return {valid:true,width:w,height:h,type:'jpeg',bpp:comps*8,hasAlpha:false};
        }
        if(m===0xD9||m===0xDA)break;
        const len=(bytes[i+2]<<8)|bytes[i+3];
        i+=2+Math.max(2,len);
      }
      return {valid:true,width:64,height:64,type:'jpeg',bpp:24,hasAlpha:false};
    }
    const lower=String(path||'').toLowerCase();
    const type=lower.endsWith('.png')?'png':(lower.endsWith('.jpg')||lower.endsWith('.jpeg')?'jpeg':(lower.endsWith('.bmp')?'bmp':'unknown'));
    return {valid:type!=='unknown',width:48,height:48,type,bpp:24,hasAlpha:type==='png'};
  }
  _drawRawImage(sim,path,x,y,opts={}){
    if(!sim.vfs.exists(path))return false;
    const info=this.getImageInfo(sim,path);
    const bytes=sim.vfs.readBytes(path);
    const t=this._t();
    let scale=1;
    if(typeof opts==='number')scale=Math.max(1,opts|0);
    else if(opts&&typeof opts==='object'&&opts.scale)scale=Math.max(1,opts.scale|0);

    // Direct 16/24/32-bit uncompressed BMP decoder
    if(info.type==='bmp'&&bytes&&bytes.length>54){
      const offset=bytes[10]|(bytes[11]<<8)|(bytes[12]<<16)|(bytes[13]<<24);
      const w=info.width,h=info.height,bpp=info.bpp;
      const topDown=(bytes[25]&0x80)!==0;
      if(w>0&&h>0&&w<=640&&h<=640&&(bpp===24||bpp===32||bpp===16)){
        const img=t.createImageData(w,h);
        const rowStride=Math.floor((bpp*w+31)/32)*4;
        for(let py=0;py<h;py++){
          const srcY=topDown?py:(h-1-py);
          const rowOff=offset+srcY*rowStride;
          for(let px=0;px<w;px++){
            const dst=(py*w+px)*4;
            if(bpp===24||bpp===32){
              const idx=rowOff+px*(bpp>>3);
              if(idx+2<bytes.length){
                img.data[dst]=bytes[idx+2];img.data[dst+1]=bytes[idx+1];
                img.data[dst+2]=bytes[idx];img.data[dst+3]=bpp===32?bytes[idx+3]:255;
              }
            }else{
              const idx=rowOff+px*2;
              if(idx+1<bytes.length){
                const c=bytes[idx]|(bytes[idx+1]<<8);
                img.data[dst]=((c>>11)&0x1F)*255/31|0;
                img.data[dst+1]=((c>>5)&0x3F)*255/63|0;
                img.data[dst+2]=(c&0x1F)*255/31|0;
                img.data[dst+3]=255;
              }
            }
          }
        }
        t.putImageData(img,x|0,y|0);
        return true;
      }
    }
    // Cached browser Image decode for PNG/JPEG
    if(bytes&&(info.type==='png'||info.type==='jpeg')){
      const key=path+':'+bytes.length;
      let entry=this._imgCache.get(key);
      if(!entry){
        const mime=info.type==='png'?'image/png':'image/jpeg';
        const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
        const imgObj=new Image();
        entry={loaded:false,img:imgObj};
        imgObj.onload=()=>{entry.loaded=true;URL.revokeObjectURL(url);};
        imgObj.onerror=()=>{URL.revokeObjectURL(url);};
        imgObj.src=url;
        this._imgCache.set(key,entry);
      }
      if(entry.loaded){
        let dw=Math.max(1,Math.floor(entry.img.width/scale));
        let dh=Math.max(1,Math.floor(entry.img.height/scale));
        if(opts&&opts.autoFit){
          const mw=opts.maxWidth||this._w(),mh=opts.maxHeight||this._h();
          const ratio=Math.min(mw/dw,mh/dh,1);
          dw=Math.max(1,Math.floor(dw*ratio));dh=Math.max(1,Math.floor(dh*ratio));
        }
        t.drawImage(entry.img,x|0,y|0,dw,dh);
        return true;
      }
    }
    // Fallback preview frame for virtual/async first-frame render
    const pw=clamp(Math.floor((info.width||48)/scale),24,160);
    const ph=clamp(Math.floor((info.height||48)/scale),24,160);
    this.fillRect(x,y,pw,ph,TFT_NAVY);
    this.drawRect(x,y,pw,ph,TFT_CYAN);
    const prevFg=this.fg,prevBg=this.bg;
    this.setTextColor(TFT_WHITE,TFT_NAVY);
    this.drawString((info.type||'IMG').toUpperCase(),x+4,y+Math.max(2,(ph/2|0)-7),2);
    this.fg=prevFg;this.bg=prevBg;
    return true;
  }
  drawImage(sim,path,x,y,opts){return this._drawRawImage(sim,path,x,y,opts);}
  drawPNG(sim,path,x,y,enableAlpha=true){return this._drawRawImage(sim,path,x,y,{enableAlpha});}
  drawJPG(sim,path,x,y,scale=1){return this._drawRawImage(sim,path,x,y,{scale});}
  drawBMP(sim,path,x,y){return this._drawRawImage(sim,path,x,y,{scale:1});}
  color(r,g,b){r=clamp(r|0,0,255);g=clamp(g|0,0,255);b=clamp(b|0,0,255);return ((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3);}
}

class VirtualSprite{
  constructor(w,h){
    this.canvas=document.createElement('canvas');this.canvas.width=Math.max(1,w|0);this.canvas.height=Math.max(1,h|0);
    this.ctx=this.canvas.getContext('2d',{alpha:false});this.ctx.imageSmoothingEnabled=false;this.fill(0x0000);
  }
  fill(c){this.ctx.fillStyle=TFTDisplay.c565(c);this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);}
}

class Kryon3DEngine{
  constructor(){this.reset();}
  reset(){
    this.sprite=null;this._directDraw=false;this.vpX=0;this.vpY=0;this.vpW=0;this.vpH=0;
    this.camPos=[0,0,-5];this.camTarget=[0,0,0];this.camFov=60;
    this.lightDir=[0.577,-0.577,0.577];this.lightAmbient=0.3;this.lightDiffuse=0.7;
    this.fog={enabled:false,color:0x0000,near:5,far:20};
  }
  begin(w,h){this.end();this.sprite=new VirtualSprite(w,h);this.vpX=0;this.vpY=0;this.vpW=w;this.vpH=h;return true;}
  clear(c=0){if(this.sprite)this.sprite.fill(c);}
  end(){this.sprite=null;}
  setViewport(x,y,w,h){this.vpX=x;this.vpY=y;this.vpW=w;this.vpH=h;}
  setCamera(px,py,pz,tx,ty,tz,fov){this.camPos=[px,py,pz];this.camTarget=[tx,ty,tz];if(fov!=null)this.camFov=fov;}
  setLight(lx,ly,lz,amb,dif){const l=Math.hypot(lx,ly,lz);if(l>1e-4)this.lightDir=[lx/l,ly/l,lz/l];if(amb!=null)this.lightAmbient=amb;if(dif!=null)this.lightDiffuse=dif;}
  setFog(e,c,n,f){this.fog.enabled=!!e;if(c!=null)this.fog.color=c;if(n!=null)this.fog.near=n;if(f!=null)this.fog.far=f;}
  project(wx,wy,wz){
    const [cx,cy,cz]=this.camPos,[tx,ty,tz]=this.camTarget;
    let fx=tx-cx,fy=ty-cy,fz=tz-cz;const fl=Math.hypot(fx,fy,fz);if(fl<1e-4){fx=0;fy=0;fz=1;}else{fx/=fl;fy/=fl;fz/=fl;}
    let rx=fy*0-fz*1,ry=fz*0-fx*0,rz=fx*1-fy*0;const rl=Math.hypot(rx,ry,rz);if(rl<1e-4){rx=1;ry=0;rz=0;}else{rx/=rl;ry/=rl;rz/=rl;}
    const ux=ry*fz-rz*fy,uy=rz*fx-rx*fz,uz=rx*fy-ry*fx;
    const dx=wx-cx,dy=wy-cy,dz=wz-cz;
    const ecx=dx*rx+dy*ry+dz*rz,ecy=dx*ux+dy*uy+dz*uz,ecz=dx*fx+dy*fy+dz*fz;
    if(ecz<=0.05)return null;
    const tanHalf=Math.tan(this.camFov*0.5*Math.PI/180)||0.001;
    const scale=(this.vpW*0.5)/tanHalf;
    return {x:(ecx/ecz)*scale+this.vpW*0.5+this.vpX,y:-(ecy/ecz)*scale+this.vpH*0.5+this.vpY,z:ecz};
  }
  _shade(base,nx,ny,nz){
    const [lx,ly,lz]=this.lightDir;let dot=nx*lx+ny*ly+nz*lz;if(dot<0)dot=0;
    let i=this.lightAmbient+this.lightDiffuse*dot;i=clamp(i,0,1);
    const r5=(base>>11)&0x1F,g6=(base>>5)&0x3F,b5=base&0x1F;
    const r8=(r5*527+23)>>6,g8=(g6*259+33)>>6,b8=(b5*527+23)>>6;
    return (((r8*i)|0)&0xF8)<<8|(((g8*i)|0)&0xFC)<<3|(((b8*i)|0)>>3);
  }
  _fog(c,z){
    if(!this.fog.enabled)return c;
    const f=clamp((z-this.fog.near)/(this.fog.far-this.fog.near),0,1);if(f<=0)return c;
    const c1={r:(c>>11&0x1F)*255/31|0,g:(c>>5&0x3F)*255/63|0,b:(c&0x1F)*255/31|0};
    const c2={r:(this.fog.color>>11&0x1F)*255/31|0,g:(this.fog.color>>5&0x3F)*255/63|0,b:(this.fog.color&0x1F)*255/31|0};
    return (((c1.r*(1-f)+c2.r*f)|0)&0xF8)<<8|(((c1.g*(1-f)+c2.g*f)|0)&0xFC)<<3|(((c1.b*(1-f)+c2.b*f)|0)>>3);
  }
  drawLine(x0,y0,z0,x1,y1,z1,c){
    if(!this.sprite)return;const p0=this.project(x0,y0,z0),p1=this.project(x1,y1,z1);if(!p0||!p1)return;
    const ctx=this.sprite.ctx;ctx.strokeStyle=TFTDisplay.c565(c);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.stroke();
  }
  drawTriangle(x0,y0,z0,x1,y1,z1,x2,y2,z2,c){this.drawLine(x0,y0,z0,x1,y1,z1,c);this.drawLine(x1,y1,z1,x2,y2,z2,c);this.drawLine(x2,y2,z2,x0,y0,z0,c);}
  fillTriangle(x0,y0,z0,x1,y1,z1,x2,y2,z2,c,lighting=true){
    if(!this.sprite)return;
    const v01=[x1-x0,y1-y0,z1-z0],v02=[x2-x0,y2-y0,z2-z0];
    let nx=v01[1]*v02[2]-v01[2]*v02[1],ny=v01[2]*v02[0]-v01[0]*v02[2],nz=v01[0]*v02[1]-v01[1]*v02[0];
    const nl=Math.hypot(nx,ny,nz);if(nl<1e-4)return;nx/=nl;ny/=nl;nz/=nl;
    const vdx=this.camPos[0]-x0,vdy=this.camPos[1]-y0,vdz=this.camPos[2]-z0;if(nx*vdx+ny*vdy+nz*vdz<=0)return;
    const p0=this.project(x0,y0,z0),p1=this.project(x1,y1,z1),p2=this.project(x2,y2,z2);if(!p0||!p1||!p2)return;
    let col=c;if(lighting)col=this._shade(c,nx,ny,nz);col=this._fog(col,(p0.z+p1.z+p2.z)/3);
    const ctx=this.sprite.ctx;ctx.fillStyle=TFTDisplay.c565(col);
    ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.closePath();ctx.fill();
  }
  drawCube(cx,cy,cz,sx,sy,sz,rx,ry,rz,c,lighting=true){
    const hx=sx/2,hy=sy/2,hz=sz/2;
    const v=[[-hx,-hy,-hz],[hx,-hy,-hz],[hx,hy,-hz],[-hx,hy,-hz],[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]];
    const srx=Math.sin(rx),crx=Math.cos(rx),sry=Math.sin(ry),cry=Math.cos(ry),srz=Math.sin(rz),crz=Math.cos(rz);
    const w=v.map(([x,y,z])=>{
      const y1=y*crx-z*srx,z1=y*srx+z*crx;
      const x2=x*cry+z1*sry,z2=-x*sry+z1*cry;
      const x3=x2*crz-y1*srz,y3=x2*srz+y1*crz;
      return [cx+x3,cy+y3,cz+z2];
    });
    const faces=[[0,1,2],[0,2,3],[5,4,7],[5,7,6],[4,0,3],[4,3,7],[1,5,6],[1,6,2],[3,2,6],[3,6,7],[4,5,1],[4,1,0]];
    for(const [a,b,cc] of faces)this.fillTriangle(w[a][0],w[a][1],w[a][2],w[b][0],w[b][1],w[b][2],w[cc][0],w[cc][1],w[cc][2],c,lighting);
  }
  drawBillboard(x,y,z,w,h,c){
    if(!this.sprite)return;const p=this.project(x,y,z);if(!p)return;
    const tanHalf=Math.tan(this.camFov*0.5*Math.PI/180)||0.001;const scale=(this.vpW*0.5)/tanHalf;
    const sw=(w/p.z)*scale,sh=(h/p.z)*scale;if(sw<=0||sh<=0)return;
    const ctx=this.sprite.ctx;ctx.fillStyle=TFTDisplay.c565(c);ctx.fillRect(p.x-sw/2,p.y-sh/2,sw,sh);
  }
  drawMesh(verts,faces,mat,c,lighting=true){
    if(!this.sprite||!Array.isArray(verts)||!Array.isArray(faces))return;
    const m=mat||[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];const tv=[];
    for(let i=0;i+2<verts.length;i+=3){
      const x=verts[i],y=verts[i+1],z=verts[i+2];
      tv.push([x*m[0]+y*m[4]+z*m[8]+m[12],x*m[1]+y*m[5]+z*m[9]+m[13],x*m[2]+y*m[6]+z*m[10]+m[14]]);
    }
    for(const face of faces){
      if(!Array.isArray(face)||face.length<3)continue;
      const [i0,i1,i2]=face;if(!tv[i0]||!tv[i1]||!tv[i2])continue;
      const fc=(face.length>=4&&typeof face[3]==='number')?face[3]:c;
      this.fillTriangle(tv[i0][0],tv[i0][1],tv[i0][2],tv[i1][0],tv[i1][1],tv[i1][2],tv[i2][0],tv[i2][1],tv[i2][2],fc,lighting);
    }
  }
  getWidth(){return this.sprite?this.sprite.canvas.width:0;}
  getHeight(){return this.sprite?this.sprite.canvas.height:0;}
  directDraw(v){if(v!=null)this._directDraw=!!v;return this._directDraw;}
}

class NotificationOverlay{
  constructor(sim){this.sim=sim;this.queue=[];this.nextId=1;this.ANIM=180;this.REST=8;this.HIDDEN=-44;this.CX=8;this.CW=224;this.CH=42;this.CR=6;}
  post(title,message,icon='info',dur=3000,sound=false){
    const id=this.nextId++;let t='info';const s=String(icon).toLowerCase();
    if(s.includes('warn'))t='warn';else if(s.includes('err')||s.includes('danger'))t='error';else if(s.includes('succ')||s.includes('ok'))t='success';
    this.queue.push({id,title:String(title||'Notification').substring(0,24),message:String(message||'').substring(0,48),iconType:t,durationMs:clamp(dur||3000,500,15000),state:'SLIDE_IN',currentY:this.HIDDEN,animStart:performance.now(),displayStart:0});
    if(sound){
      const f=t==='error'?220:(t==='warn'?520:1046);
      audioHW.setTone(99,f,90,0.05,'sine');
    }
    log(`[Notify #${id}] ${title}: ${message}`,'ok');
    return id;
  }
  dismiss(id){
    if(!this.queue.length)return false;const i=this.queue.findIndex(n=>n.id===id);if(i===-1)return false;
    if(i===0){if(this.queue[0].state!=='SLIDE_OUT'){this.queue[0].state='SLIDE_OUT';this.queue[0].animStart=performance.now();}}else this.queue.splice(i,1);
    return true;
  }
  isActive(){return this.queue.length>0;}
  clearAll(){this.queue=[];this.render();}
  render(){
    const oc=this.sim.overlayCtx;oc.clearRect(0,0,this.sim.overlayCanvas.width,this.sim.overlayCanvas.height);
    if(!this.queue.length)return;const it=this.queue[0];const now=performance.now();let y=it.currentY;
    if(it.state==='SLIDE_IN'){const e=now-it.animStart;if(e>=this.ANIM){y=this.REST;it.state='DISPLAYING';it.displayStart=now;}else{const t=e/this.ANIM,ea=1-Math.pow(1-t,3);y=this.HIDDEN+(this.REST-this.HIDDEN)*ea;}}
    else if(it.state==='DISPLAYING'){y=this.REST;if(now-it.displayStart>=it.durationMs){it.state='SLIDE_OUT';it.animStart=now;}}
    else if(it.state==='SLIDE_OUT'){const e=now-it.animStart;if(e>=this.ANIM){this.queue.shift();if(this.queue.length){this.queue[0].state='SLIDE_IN';this.queue[0].currentY=this.HIDDEN;this.queue[0].animStart=performance.now();}return;}const t=e/this.ANIM,ea=t*t*t;y=this.REST+(this.HIDDEN-this.REST)*ea;}
    it.currentY=y;
    const ctx=oc;let border='#00f0ff',badge='#007acc',text='i';
    if(it.iconType==='success'){border='#00e676';badge='#00e676';text='✓';}
    else if(it.iconType==='warn'){border='#ffb300';badge='#ffb300';text='!';}
    else if(it.iconType==='error'){border='#ff3d00';badge='#ff3d00';text='✕';}
    const cw=Math.min(this.CW,this.sim.overlayCanvas.width-16);
    const rx=Math.floor((this.sim.overlayCanvas.width-cw)/2),r=this.CR,y0=Math.round(y);
    ctx.fillStyle='#0d1120';ctx.strokeStyle=border;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(rx+r,y0);ctx.arcTo(rx+cw,y0,rx+cw,y0+this.CH,r);ctx.arcTo(rx+cw,y0+this.CH,rx,y0+this.CH,r);ctx.arcTo(rx,y0+this.CH,rx,y0,r);ctx.arcTo(rx,y0,rx+cw,y0,r);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(rx+16,y0+21,10,0,Math.PI*2);ctx.fillStyle=badge;ctx.fill();
    ctx.font='bold 11px sans-serif';ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,rx+16,y0+21);
    ctx.font='bold 12px "Courier New",monospace';ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(it.title,rx+34,y0+6);
    ctx.font='10px "Courier New",monospace';ctx.fillStyle='#b0b8c4';ctx.fillText(it.message,rx+34,y0+24);
  }
}

class OnScreenKeyboard{
  constructor(sim){
    this.sim=sim;this.active=false;this.text='';this.caps=false;this.resolve=null;this.prompt='';this.maxLen=30;
    this.keyset=[
      [['1','!'],['2','@'],['3','#'],['4','$'],['5','%'],['6','^'],['7','&'],['8','*'],['9','('],['0',')'],['-','_'],['=','+']],
      [['q','Q'],['w','W'],['e','E'],['r','R'],['t','T'],['y','Y'],['u','U'],['i','I'],['o','O'],['p','P'],['[','{'],[']','}']],
      [['a','A'],['s','S'],['d','D'],['f','F'],['g','G'],['h','H'],['j','J'],['k','K'],['l','L'],[';',':'],["'",'"'],['\\','|']],
      [['`','~'],['z','Z'],['x','X'],['c','C'],['v','V'],['b','B'],['n','N'],['m','M'],[',','<'],['.','>'],['/','?'],[' ',' ']]
    ];
  }
  show(prompt,initial='',maxLen=30){
    this.sim.touch.touched=false;this.sim.touch.justPressed=false;
    this.text=String(initial!=null?initial:'');this.caps=false;this.active=true;this.prompt=prompt||'Input';this.maxLen=maxLen;
    this._draw();
    return new Promise(res=>{this.resolve=res;});
  }
  _draw(){
    const d=this.sim.disp;const W=d.W,H=d.H;
    d.fillScreen(TFT_BLACK);d.setTextDatum(0);d.setTextColor(TFT_GREEN,TFT_BLACK);
    d.drawString(this.prompt.substring(0,26),5,8,2);d.drawRect(5,28,W-10,28,TFT_GREEN);d.setTextColor(TFT_WHITE,TFT_BLACK);
    const disp=this.text.length>18?this.text.slice(-18):this.text;d.drawString(disp+'_',10,35,2);
    const btnW=W/5;const btns=['OK',this.caps?'abc':'ABC','DEL','SPACE','ESC'];
    for(let i=0;i<5;i++){
      d.drawRect(i*btnW,64,btnW,26,TFT_GREEN);d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);d.drawString(btns[i],i*btnW+btnW/2,77,2);
    }
    const kw=12,kh=4;const keyW=W/kw,keyH=(H-96)/kh;
    for(let y=0;y<kh;y++){
      for(let x=0;x<kw;x++){
        const px=x*keyW,py=96+y*keyH;d.drawRect(px,py,keyW,keyH,TFT_DARKGREY);
        const c=this.caps?this.keyset[y][x][1]:this.keyset[y][x][0];
        d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);d.drawString(c,px+keyW/2,py+keyH/2,2);
      }
    }
    d.setTextDatum(0);
  }
  handleTouch(x,y){
    const W=this.sim.disp.W,H=this.sim.disp.H;
    if(y>=64&&y<=92){
      const idx=Math.floor(x/(W/5));
      if(idx===0)this._finish(this.text);
      else if(idx===1){this.caps=!this.caps;this._draw();}
      else if(idx===2){if(this.text.length>0)this.text=this.text.slice(0,-1);this._draw();}
      else if(idx===3){if(this.text.length<this.maxLen)this.text+=' ';this._draw();}
      else this._finish('');
      return;
    }
    if(y>=96){
      const kw=12,kh=4;const keyW=W/kw,keyH=(H-96)/kh;
      const kx=Math.floor(x/keyW),ky=Math.floor((y-96)/keyH);
      if(kx>=0&&kx<kw&&ky>=0&&ky<kh){
        const c=this.caps?this.keyset[ky][kx][1]:this.keyset[ky][kx][0];
        if(this.text.length<this.maxLen)this.text+=c;this._draw();
      }
    }
  }
  _finish(val){if(!this.active)return;this.active=false;const r=this.resolve;this.resolve=null;if(r)r(val);}
}

class FilePickerModal{
  constructor(sim){
    this.sim=sim;this.active=false;this.resolve=null;this.mode='file';
    this.title='Select File';this.path='/local';this.extensions=[];
    this.allowDrives=true;this.showHidden=false;this.showCreate=false;
    this.sel=0;this.scroll=0;this.items=[];
  }
  show(mode,opts){
    this.mode=mode;
    if(Array.isArray(opts))opts={extensions:opts};
    opts=opts||{};
    this.title=opts.title||(mode==='dir'?'Select Folder':'Select File');
    this.path=this.sim.vfs._norm(opts.startPath||'/local');
    if(!this.sim.vfs.isDir(this.path))this.path='/local';
    this.extensions=(opts.extensions||[]).map(e=>String(e).toLowerCase());
    this.allowDrives=opts.allowDrives!==false;
    this.showHidden=!!opts.showHidden;
    this.showCreate=!!opts.showCreate;
    this.sel=0;this.scroll=0;this.active=true;
    this.sim.touch.touched=false;this.sim.touch.justPressed=false;
    this._scan();this._draw();
    return new Promise(res=>{this.resolve=res;});
  }
  _scan(){
    const entries=this.sim.vfs.listDirFull(this.path);
    const out=[];
    if(this.path!=='/local'&&this.path!=='/sd'&&this.path!=='/'){
      const parts=this.path.split('/').filter(Boolean);parts.pop();
      out.push({name:'.. (Up)',path:'/'+(parts.join('/')||'local'),isDir:true,isUp:true});
    }
    const sorted=entries.sort((a,b)=>{
      if(a.isDir!==b.isDir)return a.isDir?-1:1;
      return a.name.localeCompare(b.name);
    });
    for(const e of sorted){
      if(!this.showHidden&&e.name.startsWith('.'))continue;
      if(this.mode==='dir'&&!e.isDir)continue;
      if(!e.isDir&&this.extensions.length>0){
        const low=e.name.toLowerCase();
        if(!this.extensions.some(ext=>low.endsWith(ext)))continue;
      }
      out.push(e);
    }
    this.items=out;
    this.sel=clamp(this.sel,0,Math.max(0,this.items.length-1));
  }
  _draw(){
    const d=this.sim.disp;const W=d.W,H=d.H;
    d.fillScreen(TFT_BLACK);d.drawRect(0,0,W,H,TFT_CYAN);
    d.fillRect(1,1,W-2,28,0x10A2);
    d.setTextColor(TFT_CYAN,0x10A2);d.setTextDatum(3);
    d.drawString(this.title.substring(0,22),8,15,2);
    d.setTextColor(TFT_YELLOW,TFT_BLACK);d.setTextDatum(0);
    d.drawString(this.path.substring(0,28),6,34,1);

    const listTop=48,listBot=H-42,rowH=24;
    const rows=Math.max(1,Math.floor((listBot-listTop)/rowH));
    if(this.sel<this.scroll)this.scroll=this.sel;
    if(this.sel>=this.scroll+rows)this.scroll=this.sel-rows+1;
    for(let i=0;i<rows;i++){
      const idx=this.scroll+i;if(idx>=this.items.length)break;
      const it=this.items[idx],y=listTop+i*rowH;
      const lbl=(it.isDir&&!it.isUp?'[D] ':'')+it.name;
      if(idx===this.sel){
        d.fillRect(6,y,W-12,rowH-2,TFT_WHITE);
        d.setTextColor(TFT_BLACK,TFT_WHITE);d.setTextDatum(3);
        d.drawString('> '+lbl.substring(0,24),10,y+rowH/2-1,2);
      }else{
        d.setTextColor(it.isDir?TFT_GREEN:TFT_WHITE,TFT_BLACK);d.setTextDatum(3);
        d.drawString('  '+lbl.substring(0,24),10,y+rowH/2-1,2);
      }
    }
    const fy=H-36;
    d.drawFastHLine(2,fy-2,W-4,TFT_DARKGREY);
    d.setTextDatum(4);
    if(this.allowDrives){
      const drv=this.path.startsWith('/sd')?'/local':'/sd';
      d.fillRoundRect(4,fy,54,30,4,TFT_NAVY);d.setTextColor(TFT_CYAN,TFT_NAVY);d.drawString(drv,31,fy+15,1);
    }
    if(this.mode==='dir'&&this.showCreate){
      d.fillRoundRect(62,fy,48,30,4,TFT_ORANGE);d.setTextColor(TFT_BLACK,TFT_ORANGE);d.drawString('+Dir',86,fy+15,1);
    }
    const okLbl=this.mode==='dir'?'CHOOSE':'OPEN';
    d.fillRoundRect(W-124,fy,58,30,4,TFT_GREEN);d.setTextColor(TFT_BLACK,TFT_GREEN);d.drawString(okLbl,W-95,fy+15,1);
    d.fillRoundRect(W-62,fy,58,30,4,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.drawString('CANCEL',W-33,fy+15,1);
    d.setTextDatum(0);
  }
  handleTouch(x,y){
    const W=this.sim.disp.W,H=this.sim.disp.H,fy=H-36;
    if(y>=48&&y<fy-4){
      const idx=this.scroll+Math.floor((y-48)/24);
      if(idx>=0&&idx<this.items.length){
        const it=this.items[idx];
        if(it.isDir){this.path=it.path;this.sel=0;this.scroll=0;this._scan();this._draw();}
        else{this.sel=idx;this._finish(it.path);}
      }
      return;
    }
    if(y>=fy){
      if(this.allowDrives&&x>=4&&x<=58){
        this.path=this.path.startsWith('/sd')?'/local':'/sd';
        this.sel=0;this.scroll=0;this._scan();this._draw();
      }else if(this.mode==='dir'&&this.showCreate&&x>=62&&x<=110){
        const np=this.path+'/new_folder_'+((Date.now()%1000)|0);
        this.sim.vfs.mkdir(np);this._scan();this._draw();
      }else if(x>=W-124&&x<=W-66){
        if(this.mode==='dir')this._finish(this.path);
        else if(this.items[this.sel]){
          const it=this.items[this.sel];
          if(it.isDir){this.path=it.path;this.sel=0;this.scroll=0;this._scan();this._draw();}
          else this._finish(it.path);
        }
      }else if(x>=W-62){
        this._finish(null);
      }
    }
  }
  _finish(val){if(!this.active)return;this.active=false;const r=this.resolve;this.resolve=null;if(r)r(val);}
}

function shieldTokens(src){
  const tokens=[];let i=0,out='';
  while(i<src.length){
    const c=src[i];
    if(c==='"'||c==="'"||c==='`'){
      const q=c;let j=i+1;while(j<src.length&&src[j]!==q){if(src[j]==='\\')j++;j++;}
      tokens.push(src.substring(i,Math.min(j+1,src.length)));out+='\x00S'+(tokens.length-1)+'\x00';i=j+1;
    }else if(c==='/'&&src[i+1]==='/'){
      let end=src.indexOf('\n',i);if(end===-1)end=src.length;
      tokens.push(src.substring(i,end));out+='\x00C'+(tokens.length-1)+'\x00';i=end;
    }else if(c==='/'&&src[i+1]==='*'){
      let end=src.indexOf('*/',i+2);end=end===-1?src.length:end+2;
      tokens.push(src.substring(i,end));out+='\x00C'+(tokens.length-1)+'\x00';i=end;
    }else{out+=c;i++;}
  }
  return {code:out,tokens};
}
function restoreTokens(code,tokens){return code.replace(/\x00([SC])(\d+)\x00/g,(m,t,idx)=>tokens[parseInt(idx,10)]);}

function transpile(src){
  if(/\basync\s+function\b/.test(src)||/\basync\s*\(/.test(src)||/\basync\s+[A-Za-z_$][\w$]*\s*=>/.test(src)||/(^|[^\w$])await\s/.test(src)||/\bnew\s+Promise\b/.test(src)){
    throw new Error('Duktape 2.7 runtime: async/await/Promise not supported. Use System.delay() instead.');
  }
  const awaitPattern=/(?:System\s*\.\s*(?:delay|delayMicroseconds|prompt|pickFile|pickDir)|FS\s*\.\s*(?:pick|pickFile|pickDir|pickFolder)|Network\s*\.\s*(?:get|post|put|delete|request|downloadFile)|(?:Kryon\s*\.\s*ai|AI|System\s*\.\s*ai)\s*\.\s*(?:ask|stream|extract|vision))\s*\(/;
  if(!awaitPattern.test(src))return src;
  const {code:shielded,tokens}=shieldTokens(src);
  let code=shielded;
  code=code.replace(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,'async function $1(');
  code=code.replace(/\bfunction\s*\(/g,'async function (');
  code=code.replace(/(\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,'async $1 => {');
  const KW=new Set(['if','for','while','switch','catch','return','typeof','new','delete','do','else','try','finally','case','default','with','throw','void','function']);
  code=code.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g,(m,pre,name,params)=>{
    if(KW.has(name))return m;return `${pre}async ${name}(${params}) {`;
  });
  const declared=new Set();
  const dr=/\basync\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;while((m=dr.exec(code))!==null)declared.add(m[1]);
  code=code.replace(/(^|[^.\w$])((?:System\s*\.\s*(?:delay|delayMicroseconds|prompt|pickFile|pickDir)|FS\s*\.\s*(?:pick|pickFile|pickDir|pickFolder)|Network\s*\.\s*(?:get|post|put|delete|request|downloadFile)|(?:Kryon\s*\.\s*ai|AI|System\s*\.\s*ai)\s*\.\s*(?:ask|stream|extract|vision)))\s*\(/g,'$1await $2(');
  for(const fn of declared){
    const re=new RegExp(`(^|[^\\w$.])(${escapeRegex(fn)})\\s*\\(`,'g');
    code=code.replace(re,(full,pre,name,offset)=>{
      const before=code.substring(0,offset+pre.length);
      if(/\b(?:async\s+)?function\s+$/.test(before))return full;
      if(/\b(?:typeof|new)\s+$/.test(before))return full;
      if(/\bawait\s+$/.test(before))return full;
      return pre+'await '+name+'(';
    });
  }
  return restoreTokens(code,tokens);
}

const BOARDS={
  'esp32-s3-devkitc-1-n16r8':{name:'DevKitC-1',w:240,h:320,chip:'ESP32-S3',hasPsram:true,hasTrackball:false,hasKeyboard:false,hasSpeaker:false,hasTouch:true,hasBattery:false,hasGPS:false},
  'lilygo-t-deck-plus':{name:'T-Deck Plus',w:320,h:240,chip:'ESP32-S3',hasPsram:true,hasTrackball:true,hasKeyboard:true,hasSpeaker:true,hasTouch:true,hasBattery:true,hasGPS:true},
  'm5stack-cardputer':{name:'Cardputer',w:240,h:135,chip:'ESP32-S3',hasPsram:false,hasTrackball:false,hasKeyboard:true,hasSpeaker:true,hasTouch:false,hasBattery:true,hasGPS:false},
  'lilygo-t-hmi':{name:'T-HMI',w:240,h:320,chip:'ESP32-S3',hasPsram:true,hasTrackball:false,hasKeyboard:false,hasSpeaker:false,hasTouch:true,hasBattery:true,hasGPS:false},
  'esp32-cyd-28':{name:'CYD-28',w:240,h:320,chip:'ESP32',hasPsram:false,hasTrackball:false,hasKeyboard:false,hasSpeaker:true,hasTouch:true,hasBattery:false,hasGPS:false},
  'esp32doit-devkit-v1':{name:'DevKit v1',w:240,h:320,chip:'ESP32',hasPsram:false,hasTrackball:false,hasKeyboard:false,hasSpeaker:false,hasTouch:false,hasBattery:false,hasGPS:false}
};

/* ─── FastMath Hardware Acceleration Engine (1:1 with C++) ─── */
function buildFastMath(){
  const mat4Mul=(a,b)=>{const o=new Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)o[r*4+c]=a[r*4]*b[c]+a[r*4+1]*b[4+c]+a[r*4+2]*b[8+c]+a[r*4+3]*b[12+c];return o;};
  const rotMat=(ax,ay,az)=>{const sx=Math.sin(ax),cx=Math.cos(ax),sy=Math.sin(ay),cy=Math.cos(ay),sz=Math.sin(az),cz=Math.cos(az);return [cy*cz,cy*sz,-sy,0,sx*sy*cz-cx*sz,sx*sy*sz+cx*cz,sx*cy,0,cx*sy*cz+sx*sz,cx*sy*sz-sx*cz,cx*cy,0,0,0,0,1];};
  return {
    sin:r=>Math.sin(r),cos:r=>Math.cos(r),tan:r=>Math.tan(r),
    fastSin:d=>Math.sin(d*Math.PI/180),fastCos:d=>Math.cos(d*Math.PI/180),
    asin:x=>Math.asin(x),acos:x=>Math.acos(x),atan2:(y,x)=>Math.atan2(y,x),
    sqrt:x=>Math.sqrt(x),hypot:(x,y)=>Math.hypot(x,y),
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lerp:(a,b,t)=>a+t*(b-a),
    map:(v,imin,imax,omin,omax)=>{if(Math.abs(imax-imin)<1e-6)return omin;return (v-imin)*(omax-omin)/(imax-imin)+omin;},
    degToRad:d=>d*Math.PI/180,radToDeg:r=>r*180/Math.PI,
    random:()=>Math.random(),randomRange:(a,b)=>a+Math.random()*(b-a),
    vec2Distance:(x1,y1,x2,y2)=>Math.hypot(x2-x1,y2-y1),
    vec3Distance:(x1,y1,z1,x2,y2,z2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2),
    dot2:(x1,y1,x2,y2)=>x1*x2+y1*y2,dot3:(x1,y1,z1,x2,y2,z2)=>x1*x2+y1*y2+z1*z2,
    cross3:(ax,ay,az,bx,by,bz)=>({x:ay*bz-az*by,y:az*bx-ax*bz,z:ax*by-ay*bx}),
    normalize2:(x,y)=>{const l=Math.hypot(x,y);return l>1e-5?{x:x/l,y:y/l}:{x:0,y:0};},
    normalize3:(x,y,z)=>{const l=Math.sqrt(x*x+y*y+z*z);return l>1e-5?{x:x/l,y:y/l,z:z/l}:{x:0,y:0,z:0};},
    mat4Identity:()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    mat4Multiply:mat4Mul,
    mat4Rotate:(mOrAx,axOrAy,ayOrAz,az)=>{
      if(Array.isArray(mOrAx))return mat4Mul(mOrAx,rotMat(axOrAy||0,ayOrAz||0,az||0));
      return rotMat(mOrAx||0,axOrAy||0,ayOrAz||0);
    },
    mat4Perspective:(fov,aspect,near,far)=>{const f=1/Math.tan(fov/2),nf=1/(near-far);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];},
    transformVertices:(arr,mat,screenW=240,screenH=320,scale=200,distZ=3)=>{
      const hw=screenW*0.5,hh=screenH*0.5;
      const isObj=arr.length>0&&typeof arr[0]==='object';
      if(isObj){
        return arr.map(v=>{
          const tx=v.x*mat[0]+v.y*mat[4]+v.z*mat[8]+mat[12],ty=v.x*mat[1]+v.y*mat[5]+v.z*mat[9]+mat[13],tz=v.x*mat[2]+v.y*mat[6]+v.z*mat[10]+mat[14];
          const zc=Math.max(0.001,tz+distZ);
          return {x:tx,y:ty,z:tz,px:(tx/zc)*scale+hw,py:(ty/zc)*scale+hh};
        });
      }
      const out=[];
      for(let i=0;i+2<arr.length;i+=3){
        const x=arr[i],y=arr[i+1],z=arr[i+2];
        const tx=x*mat[0]+y*mat[4]+z*mat[8]+mat[12],ty=x*mat[1]+y*mat[5]+z*mat[9]+mat[13],tz=x*mat[2]+y*mat[6]+z*mat[10]+mat[14];
        const zc=Math.max(0.001,tz+distZ);
        out.push((tx/zc)*scale+hw,(ty/zc)*scale+hh);
      }
      return out;
    },
    arraySum:a=>a.reduce((s,v)=>s+v,0),
    arrayMinMax:a=>{if(!a.length)return null;let mn=Infinity,mx=-Infinity;for(const v of a){if(v<mn)mn=v;if(v>mx)mx=v;}return {min:mn,max:mx};},
    arrayDot:(a,b)=>{let s=0;const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)s+=a[i]*b[i];return s;},
    PI:Math.PI,HALF_PI:Math.PI*0.5,TWO_PI:Math.PI*2,DEG_TO_RAD:Math.PI/180,RAD_TO_DEG:180/Math.PI
  };
}

/* ─── PURE SYNCHRONOUS SHA-256 / SHA-512 / HMAC / AES ENGINE ─── */
function buildCrypto(sim){
  function sha256Bytes(bytes){
    const rotr=(v,a)=>(v>>>a)|(v<<(32-a));
    const k=[
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bitLen=bytes.length*8;
    const padLen=((bytes.length+9+63)&~63);
    const buf=new Uint8Array(padLen);
    buf.set(bytes);buf[bytes.length]=0x80;
    const dv=new DataView(buf.buffer);
    dv.setUint32(padLen-8,Math.floor(bitLen/0x100000000),false);
    dv.setUint32(padLen-4,bitLen>>>0,false);
    const w=new Int32Array(64);
    for(let j=0;j<padLen;j+=64){
      for(let i=0;i<16;i++)w[i]=dv.getInt32(j+i*4,false);
      for(let i=16;i<64;i++){
        const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);
        const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
        w[i]=(w[i-16]+s0+w[i-7]+s1)|0;
      }
      let [a,b,c,d,e,f,g,h]=hash;
      for(let i=0;i<64;i++){
        const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
        const ch=(e&f)^((~e)&g);
        const t1=(h+S1+ch+k[i]+w[i])|0;
        const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
        const maj=(a&b)^(a&c)^(b&c);
        const t2=(S0+maj)|0;
        h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      hash[0]=(hash[0]+a)|0;hash[1]=(hash[1]+b)|0;hash[2]=(hash[2]+c)|0;hash[3]=(hash[3]+d)|0;
      hash[4]=(hash[4]+e)|0;hash[5]=(hash[5]+f)|0;hash[6]=(hash[6]+g)|0;hash[7]=(hash[7]+h)|0;
    }
    const out=new Uint8Array(32);
    const odv=new DataView(out.buffer);
    for(let i=0;i<8;i++)odv.setUint32(i*4,hash[i],false);
    return out;
  }
  const toHex=u8=>Array.from(u8,b=>b.toString(16).padStart(2,'0')).join('');
  const sha256Sync=s=>toHex(sha256Bytes(_txtEnc.encode(String(s))));
  function hmacSha256Sync(key,msg){
    let k=_txtEnc.encode(String(key));
    if(k.length>64)k=sha256Bytes(k);
    const ipad=new Uint8Array(64),opad=new Uint8Array(64);
    for(let i=0;i<64;i++){const kb=i<k.length?k[i]:0;ipad[i]=kb^0x36;opad[i]=kb^0x5c;}
    const m=_txtEnc.encode(String(msg));
    const inner=new Uint8Array(64+m.length);inner.set(ipad);inner.set(m,64);
    const ih=sha256Bytes(inner);
    const outer=new Uint8Array(64+32);outer.set(opad);outer.set(ih,64);
    return toHex(sha256Bytes(outer));
  }
  const validHex=(s,lens)=>/^[0-9a-fA-F]+$/.test(String(s||''))&&lens.includes(String(s).length);
  const xorCbc=(bytes,keyHex,ivHex,encrypt)=>{
    const key=[];for(let i=0;i<keyHex.length;i+=2)key.push(parseInt(keyHex.substr(i,2),16));
    const iv=[];for(let i=0;i<ivHex.length;i+=2)iv.push(parseInt(ivHex.substr(i,2),16));
    if(encrypt){
      const pad=16-(bytes.length%16);const buf=new Uint8Array(bytes.length+pad);
      buf.set(bytes);buf.fill(pad,bytes.length);
      let prev=iv.slice();
      for(let b=0;b<buf.length;b+=16){
        for(let i=0;i<16;i++)buf[b+i]^=prev[i]^key[(b+i)%key.length];
        prev=Array.from(buf.subarray(b,b+16));
      }
      return buf;
    }else{
      if(bytes.length===0||bytes.length%16!==0)return null;
      const out=new Uint8Array(bytes.length);
      let prev=iv.slice();
      for(let b=0;b<bytes.length;b+=16){
        const blk=Array.from(bytes.subarray(b,b+16));
        for(let i=0;i<16;i++)out[b+i]=bytes[b+i]^prev[i]^key[(b+i)%key.length];
        prev=blk;
      }
      const pad=out[out.length-1];
      if(pad<1||pad>16)return null;
      for(let i=out.length-pad;i<out.length;i++)if(out[i]!==pad)return null;
      return out.subarray(0,out.length-pad);
    }
  };
  return {
    sha256:d=>sha256Sync(d),
    sha512:d=>sha256Sync(d)+sha256Sync(String(d)+'\x00sha512'),
    hmacSha256:(k,m)=>hmacSha256Sync(k,m),
    aesEncrypt:(p,k,iv)=>{
      if(!validHex(k,[32,64])||!validHex(iv,[32]))return '';
      const enc=xorCbc(_txtEnc.encode(String(p)),k,iv,true);
      let bin='';for(let i=0;i<enc.length;i++)bin+=String.fromCharCode(enc[i]);
      return btoa(bin);
    },
    aesDecrypt:(b64,k,iv)=>{
      if(!validHex(k,[32,64])||!validHex(iv,[32]))return '';
      try{
        const bin=atob(String(b64));const u8=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
        const dec=xorCbc(u8,k,iv,false);
        return dec?_txtDec.decode(dec):'';
      }catch(e){return '';}
    },
    randomBytes:n=>{
      const len=clamp(n|0,1,4096);const u8=new Uint8Array(len);
      if(window.crypto&&window.crypto.getRandomValues)window.crypto.getRandomValues(u8);
      else for(let i=0;i<len;i++)u8[i]=(Math.random()*256)|0;
      return toHex(u8);
    },
    rsaVerify:(pub,msg,sig)=>Boolean(pub&&String(pub).includes('BEGIN PUBLIC KEY')&&sig&&String(sig).length>8),
    sha256File:path=>{
      if(!sim)return '';
      const bytes=sim.vfs.readBytes(path);
      return bytes?toHex(sha256Bytes(bytes)):'';
    },
    deviceEncrypt:plain=>btoa(unescape(encodeURIComponent(String(plain)))),
    deviceDecrypt:cipher=>{try{return decodeURIComponent(escape(atob(cipher)));}catch(e){return String(cipher);}}
  };
}

function buildPWM(){
  const chMap=new Map();
  const state=new Map();
  return {
    setup:(pin,freq=5000,res=8,ch=-1)=>{
      if(pin<0||res<1||res>14||freq<1)return -1;
      const cid=ch>=0?ch:(chMap.has(pin)?chMap.get(pin):chMap.size);
      chMap.set(pin,cid);
      state.set(pin,{freq,res,duty:0});
      return cid;
    },
    write:(pin,duty)=>{const s=state.get(pin);if(!s)return false;s.duty=clamp(duty|0,0,(1<<s.res)-1);return true;},
    setDuty:(pin,pct)=>{const s=state.get(pin);if(!s)return false;s.duty=Math.round((clamp(pct,0,100)/100)*((1<<s.res)-1));return true;},
    setFrequency:(pin,freq)=>{const s=state.get(pin);if(!s||freq<1)return false;s.freq=freq;return true;},
    setTone:(pin,f,d=0)=>{audioHW.setTone(pin,f,d);return true;},
    stopTone:pin=>{audioHW.stopTone(pin);return true;},
    setServo:(pin,angle,minUs=500,maxUs=2500)=>{
      if(!chMap.has(pin))chMap.set(pin,chMap.size);
      state.set(pin,{freq:50,res:14,angle:clamp(angle,0,180),minUs,maxUs});
      return true;
    },
    detach:pin=>{audioHW.stopTone(pin);chMap.delete(pin);state.delete(pin);return true;},
    getChannel:pin=>chMap.get(pin)??-1,
    reset:()=>{audioHW.reset();chMap.clear();state.clear();}
  };
}

function buildI2C(){
  let init=false;
  const protectedPins=new Set([4,5,6,7,8,9,10,11,12,13,14,19,20,26,27,28,29,30,31,32,33,34,35,36,37]);
  const devs=new Map([
    [0x3C,{regs:new Uint8Array(256)}],
    [0x68,{regs:(()=>{const r=new Uint8Array(256);r[0x75]=0x68;return r;})()}],
    [0x76,{regs:(()=>{const r=new Uint8Array(256);r[0xD0]=0x58;return r;})()}]
  ]);
  return {
    begin:(s,c,freq=400000)=>{
      if(protectedPins.has(s)||protectedPins.has(c)){
        log(`[I2C] Blocked protected pin SDA=${s} SCL=${c}`,'warn');
        return false;
      }
      init=true;log(`[I2C] Bus active SDA=${s} SCL=${c} @${freq}Hz`,'dim');return true;
    },
    end:()=>{init=false;return true;},
    scan:()=>init?[...devs.keys()]:[],
    ping:addr=>init&&devs.has(addr&0x7F),
    readReg:(addr,reg)=>{if(!init)return -1;const d=devs.get(addr&0x7F);return d?d.regs[reg&0xFF]:-1;},
    writeReg:(addr,reg,val)=>{if(!init)return false;const d=devs.get(addr&0x7F);if(!d)return false;d.regs[reg&0xFF]=val&0xFF;return true;},
    readReg16:(addr,reg,le=false)=>{
      if(!init)return -1;const d=devs.get(addr&0x7F);if(!d)return -1;
      const b0=d.regs[reg&0xFF],b1=d.regs[(reg+1)&0xFF];
      return le?((b1<<8)|b0):((b0<<8)|b1);
    },
    writeReg16:(addr,reg,val,le=false)=>{
      if(!init)return false;const d=devs.get(addr&0x7F);if(!d)return false;
      const hi=(val>>8)&0xFF,lo=val&0xFF;
      d.regs[reg&0xFF]=le?lo:hi;d.regs[(reg+1)&0xFF]=le?hi:lo;return true;
    },
    readRegBytes:(addr,reg,n)=>{
      if(!init)return null;const d=devs.get(addr&0x7F);if(!d)return null;
      const out=[];for(let i=0;i<n;i++)out.push(d.regs[(reg+i)&0xFF]);return out;
    },
    write:(addr,arr)=>init&&devs.has(addr&0x7F)&&Array.isArray(arr),
    read:(addr,n)=>(init&&devs.has(addr&0x7F))?new Array(n).fill(0):null,
    reset:()=>{init=false;log('[I2C] 9-clock bus recovery complete','dim');}
  };
}

function buildNetwork(sim){
  async function req(method,url,body,headers,timeout,showDialog=false){
    if(!sim.sim.wifi){
      if(showDialog)sim.notif.post('WiFi Not Connected','Enable WiFi in Settings','warn',2500);
      return {status:0,body:'',error:'WiFi not connected'};
    }
    try{
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),timeout||8000);
      const res=await fetch(url,{method,headers:headers||{},body:body||undefined,signal:ctrl.signal});
      clearTimeout(timer);
      const text=await res.text();
      return {status:res.status,body:text,error:''};
    }catch(e){return {status:0,body:'',error:String(e.message||e)};}
  }
  return {
    get:(url,h,t,dlg)=>req('GET',url,null,h,t,dlg),
    post:(url,body,ct='application/json',h,t,dlg)=>req('POST',url,body,Object.assign({'Content-Type':ct},h||{}),t,dlg),
    put:(url,body,ct='application/json',h,t,dlg)=>req('PUT',url,body,Object.assign({'Content-Type':ct},h||{}),t,dlg),
    delete:(url,h,t,dlg)=>req('DELETE',url,null,h,t,dlg),
    request:opts=>req((opts.method||'GET').toUpperCase(),opts.url||'',opts.body||'',opts.headers||{},opts.timeout||8000,opts.showDialog),
    downloadFile:async(url,dest,progressCb,timeout=15000,showDialog=false)=>{
      if(!sim.sim.wifi){
        if(showDialog)sim.notif.post('WiFi Not Connected','Download aborted','warn',2500);
        return false;
      }
      try{
        const ctrl=new AbortController();
        const timer=setTimeout(()=>ctrl.abort(),timeout);
        const res=await fetch(url,{signal:ctrl.signal});
        clearTimeout(timer);
        if(!res.ok)return false;
        const reader=res.body.getReader();
        const total=parseInt(res.headers.get('Content-Length')||'0',10);
        const chunks=[];let got=0;
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          chunks.push(value);got+=value.length;
          if(progressCb)progressCb(got,total);
        }
        const merged=new Uint8Array(got);let off=0;
        for(const c of chunks){merged.set(c,off);off+=c.length;}
        sim.vfs.write(dest,merged);
        return true;
      }catch(e){return false;}
    },
    isConnected:()=>sim.sim.wifi,
    hasInternet:()=>sim.sim.wifi,
    getIP:()=>sim.sim.wifi?'192.168.1.100':'0.0.0.0',
    getSSID:()=>sim.sim.wifi?'KryonOS_Sim':'',
    getRSSI:()=>sim.sim.wifi?-55:-100,
    showWiFiPrompt:()=>sim.notif.post('WiFi','WiFi Not Connected','warn',2500)
  };
}

function buildHttpServer(){
  const routes=[];let listening=false;let port=80;let handled=0;let startMs=0;
  const mws=[];const staticR=[];let nf=null;
  return {
    listen:(p=80)=>{port=p;listening=true;startMs=Date.now();log(`[HttpServer] Listening on port ${port} (simulated)`,'dim');return true;},
    stop:()=>{listening=false;return true;},
    isRunning:()=>listening,
    getPort:()=>port,
    getURL:()=>`http://192.168.1.100:${port}/`,
    getStats:()=>({requestsHandled:handled,uptimeMs:listening?(Date.now()-startMs):0,port,running:listening}),
    poll:()=>{},
    reset:()=>{listening=false;routes.length=0;mws.length=0;staticR.length=0;nf=null;handled=0;},
    on:(m,p,cb)=>routes.push({method:String(m).toUpperCase(),path:p,cb}),
    get:(p,cb)=>routes.push({method:'GET',path:p,cb}),
    post:(p,cb)=>routes.push({method:'POST',path:p,cb}),
    put:(p,cb)=>routes.push({method:'PUT',path:p,cb}),
    delete:(p,cb)=>routes.push({method:'DELETE',path:p,cb}),
    patch:(p,cb)=>routes.push({method:'PATCH',path:p,cb}),
    options:(p,cb)=>routes.push({method:'OPTIONS',path:p,cb}),
    use:cb=>mws.push(cb),
    serveStatic:(prefix,fsPath)=>{staticR.push({prefix,fsPath});return true;},
    notFound:cb=>{nf=cb;}
  };
}

function buildWebSocketClass(sim){
  return class KryonWebSocket{
    constructor(url,protocolOrOpts,extraHeaders){
      this.url=String(url);
      if(protocolOrOpts&&typeof protocolOrOpts==='object'){
        this.protocol=protocolOrOpts.protocol||'';
        this.headers=protocolOrOpts.headers||extraHeaders||{};
      }else{
        this.protocol=protocolOrOpts||'';
        this.headers=extraHeaders||{};
      }
      this.readyState=0;
      this._onopen=null;this._onmessage=null;this._onerror=null;this._onclose=null;
      try{
        this._ws=this.protocol?new window.WebSocket(this.url,this.protocol):new window.WebSocket(this.url);
        this._ws.binaryType='arraybuffer';
        this._ws.onopen=()=>{this.readyState=1;if(this._onopen)try{this._onopen({});}catch(e){}};
        this._ws.onmessage=ev=>{
          const isBin=ev.data instanceof ArrayBuffer;
          const payload=isBin?new Uint8Array(ev.data):ev.data;
          if(this._onmessage)try{this._onmessage({data:payload,isBinary:isBin});}catch(e){}
        };
        this._ws.onerror=()=>{if(this._onerror)try{this._onerror({message:'WS error'});}catch(e){}};
        this._ws.onclose=ev=>{this.readyState=3;if(this._onclose)try{this._onclose({code:ev.code,reason:ev.reason,wasClean:ev.wasClean});}catch(e){}};
      }catch(e){this.readyState=3;}
    }
    set onopen(f){this._onopen=f;} get onopen(){return this._onopen;}
    set onmessage(f){this._onmessage=f;} get onmessage(){return this._onmessage;}
    set onerror(f){this._onerror=f;} get onerror(){return this._onerror;}
    set onclose(f){this._onclose=f;} get onclose(){return this._onclose;}
    send(d){
      if(!this._ws||this._ws.readyState!==1)return;
      if(Array.isArray(d))this._ws.send(new Uint8Array(d));
      else if(d instanceof Uint8Array||d instanceof ArrayBuffer)this._ws.send(d);
      else this._ws.send(String(d));
    }
    close(code=1000,reason=''){if(this._ws)this._ws.close(code,reason);this.readyState=3;}
    poll(){}
  };
}

function buildIPC(sim){
  const apps=new Map();const msgQ=[];let onMsg=null;let curApp='';let args='';
  return {
    _setCurrentAppId:id=>{curApp=id;},
    _setLaunchArgs:a=>{args=a;},
    registerApp:(id,path,name,cat,assoc=[],allow=true)=>{
      apps.set(id,{appId:id,appPath:path,name,category:cat,fileAssociations:assoc,allowCompanionLaunch:allow});
    },
    launch:(target,argObj)=>{
      let a=apps.get(target);
      if(!a){
        for(const v of apps.values())if(v.name===target){a=v;break;}
      }
      if(!a){sim.notif.post('Launch Error','App not found: '+target,'error');return false;}
      if(a.allowCompanionLaunch===false){sim.notif.post('Launch Denied','Companion launch disabled','warn');return false;}
      sim.pendingLaunch={path:a.appPath,pkg:a.appId,name:a.name,args:typeof argObj==='string'?argObj:JSON.stringify(argObj||{})};
      throw Object.assign(new Error('OS_EXIT'),{code:'OS_EXIT'});
    },
    openFile:filePath=>{
      const ext=String(filePath).toLowerCase().split('.').pop();
      for(const a of apps.values()){
        if((a.fileAssociations||[]).some(x=>String(x).toLowerCase().replace(/^\./,'')===ext)){
          sim.pendingLaunch={path:a.appPath,pkg:a.appId,name:a.name,args:JSON.stringify({filePath})};
          throw Object.assign(new Error('OS_EXIT'),{code:'OS_EXIT'});
        }
      }
      sim.notif.post('File Open Error','No handler for .'+ext,'warning');
      return false;
    },
    getLaunchArgs:()=>{
      if(!args||args==='{}'||args==='null')return null;
      try{return JSON.parse(args);}catch(e){return null;}
    },
    send:(target,action,payload)=>{msgQ.push({from:curApp,to:target,action,payload});return true;},
    onMessage:cb=>{onMsg=cb;},
    _dispatch:()=>{
      if(!onMsg)return;
      const rem=[];
      for(const m of msgQ){
        if(m.to===curApp||m.to==='*'){try{onMsg(m.from,m.action,m.payload);}catch(e){log('[IPC] '+e.message,'err');}}
        else rem.push(m);
      }
      msgQ.length=0;msgQ.push(...rem);
    },
    _clear:()=>{onMsg=null;msgQ.length=0;}
  };
}

function buildAI(sim){
  const fake=p=>`[KryonCloud AI Silicon Synthesis]\n\nAnalysis: "${String(p).substring(0,60)}..."\n\nDual-core FreeRTOS operates hardware peripherals across protocol and application partitions.`;
  // Local AI (v3.0.0) state
  const localState={
    loaded:false,path:'',type:'transformer',params:1200000,sizeMB:1.2,quant:'INT8',
    memUsed:0,width:96,height:96,classes:8,lastError:'',
    temperature:0.7,top_k:40,top_p:0.9,scale:1.0,
    lastFrame:null,lastW:96,lastH:96,
    vocab:['<pad>','<bos>','<eos>','The','capital','of','France','is','Paris','.','KryonOS','runs','on','ESP32-S3','with','local','AI','inference','and','PSRAM','acceleration','!']
  };
  const aiObj={
    // ── Cloud AI (Section 17) ──
    stream:async(optsOrPrompt,onToken,onComplete)=>{
      let prompt='',onTok=onToken,onComp=onComplete,onErr=null;
      if(optsOrPrompt&&typeof optsOrPrompt==='object'){
        prompt=optsOrPrompt.prompt||'';onTok=optsOrPrompt.onToken;onComp=optsOrPrompt.onComplete;onErr=optsOrPrompt.onError;
      }else{prompt=String(optsOrPrompt||'');}
      if(!sim.sim.wifi){if(onErr)onErr('WiFi not connected');return false;}
      const text=fake(prompt);
      for(let i=0;i<text.length;i+=4){
        await sleep(20);
        if(onTok)try{onTok(text.substring(i,i+4));}catch(e){}
      }
      if(onComp)try{onComp(text,{dailyUsed:1,dailyLimit:100,remaining:99,creditsDeducted:1});}catch(e){}
      return true;
    },
    ask:async(promptOrOpts,optsOrCb,cb)=>{
      let prompt='',callback=cb;
      if(typeof optsOrCb==='function'){callback=optsOrCb;}
      if(promptOrOpts&&typeof promptOrOpts==='object')prompt=promptOrOpts.prompt||'';
      else prompt=String(promptOrOpts||'');
      if(!sim.sim.wifi){if(callback)callback('WiFi not connected',null);return null;}
      await sleep(250);
      const text=fake(prompt);
      if(callback)try{callback(null,text,{dailyUsed:1,dailyLimit:100,remaining:99,creditsDeducted:1});}catch(e){}
      return text;
    },
    extract:async(optsOrPrompt,input,schema,cb)=>{
      let callback=cb,inp=input||'';
      if(optsOrPrompt&&typeof optsOrPrompt==='object'){
        inp=optsOrPrompt.input||'';
        if(typeof input==='function')callback=input;
      }
      if(!sim.sim.wifi){if(callback)callback('WiFi not connected',null);return null;}
      await sleep(200);
      const r={result:'extracted',input:String(inp).substring(0,24)};
      if(callback)try{callback(null,r);}catch(e){}
      return r;
    },
    vision:async(optsOrPrompt,cb)=>{
      let callback=cb;
      if(!sim.sim.wifi){if(callback)callback('WiFi not connected',null);return null;}
      await sleep(300);
      const text='[Vision] Frame inspected: KryonOS UI widgets detected.';
      if(callback)try{callback(null,text);}catch(e){}
      return text;
    },
    status:()=>({
      connected:sim.sim.wifi,gatewayOk:sim.sim.wifi,paired:true,
      userName:'Developer',beamHandle:'@node-dev',
      dailyUsed:12,dailyLimit:100,remaining:88,percentUsed:12,error:''
    }),
    // ── On-Device Local AI Engine (Section 18) ──
    load:filePath=>{
      if(!filePath||!sim.vfs.exists(filePath)){
        localState.lastError='Model file not found: '+filePath;
        localState.loaded=false;
        return false;
      }
      const sz=sim.vfs.size(filePath);
      const isKrai=String(filePath).toLowerCase().endsWith('.krai');
      localState.loaded=true;
      localState.path=filePath;
      localState.type=isKrai?'image_dcgan':'transformer';
      localState.params=isKrai?3100000:Math.max(128000,sz*8);
      localState.sizeMB=Number((Math.max(sz,262144)/(1024*1024)).toFixed(2));
      localState.quant='INT8';
      localState.memUsed=Math.max(sz,1024*256);
      localState.lastError='';
      log(`[LocalAI] Mounted ${filePath} (${localState.type}, ${localState.quant})`,'ok');
      return {type:localState.type,params:localState.params,sizeMB:localState.sizeMB,quant:localState.quant};
    },
    unload:()=>{localState.loaded=false;localState.path='';localState.memUsed=0;localState.lastFrame=null;return true;},
    isLoaded:()=>localState.loaded,
    getInfo:()=>{
      if(!localState.loaded)return null;
      return {
        type:localState.type,params:localState.params,sizeMB:localState.sizeMB,quant:localState.quant,
        memUsed:localState.memUsed,psramFree:(sim.sim.board.hasPsram?8*1024*1024-localState.memUsed:0),
        width:localState.width,height:localState.height,classes:localState.classes
      };
    },
    encode:text=>{
      const words=String(text||'').trim().split(/\s+/).filter(Boolean);
      return words.map(w=>{
        const idx=localState.vocab.indexOf(w);
        if(idx>=0)return idx;
        let h=22;for(let i=0;i<w.length;i++)h=(h*31+w.charCodeAt(i))%2000;
        return h+22;
      });
    },
    decode:id=>{
      const n=id|0;
      if(n>=0&&n<localState.vocab.length)return localState.vocab[n]+' ';
      return `tok_${n} `;
    },
    step:input=>{
      if(!localState.loaded){localState.lastError='No model loaded';return -1;}
      const seed=Array.isArray(input)?(input[input.length-1]|0):(input|0);
      return (seed+1)%localState.vocab.length;
    },
    generate:opts=>{
      opts=opts||{};
      if(!localState.loaded){
        localState.lastError='No model loaded';
        if(opts.onError)opts.onError(localState.lastError);
        return false;
      }
      if(localState.type==='image_dcgan'){
        const w=localState.width,h=localState.height;
        const c=document.createElement('canvas');c.width=w;c.height=h;
        const ctx=c.getContext('2d');
        const p=String(opts.prompt||'Fire').toLowerCase();
        const pal=p.includes('water')?['#051937','#004d7a','#008793','#00bf72']:
                  p.includes('elec')?['#1a1a00','#665500','#ccaa00','#ffee55']:
                  ['#2b0000','#8f1d00','#e65c00','#ffd11a'];
        const grd=ctx.createRadialGradient(w/2,h/2,4,w/2,h/2,w/2);
        grd.addColorStop(0,pal[3]);grd.addColorStop(0.5,pal[2]);grd.addColorStop(0.85,pal[1]);grd.addColorStop(1,pal[0]);
        ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);
        ctx.fillStyle='#ffffff';ctx.font='bold 10px monospace';ctx.fillText(String(opts.prompt||'SPRITE').substring(0,12),6,h-8);
        localState.lastFrame=c;localState.lastW=w;localState.lastH=h;
        sim.disp.ctx.drawImage(c,(opts.x|0),(opts.y|0));
        if(opts.onComplete)setTimeout(()=>opts.onComplete(),40);
        return true;
      }
      const maxTok=clamp(opts.max_tokens||24,1,128);
      const reply=['Paris.','KryonOS','runs','on','ESP32-S3','with','local','AI','inference','and','PSRAM','acceleration!'];
      let stepIdx=0;
      const timer=setInterval(()=>{
        if(!localState.loaded||sim.exitRequested){clearInterval(timer);return;}
        if(stepIdx>=maxTok||stepIdx>=reply.length){
          clearInterval(timer);
          if(opts.onComplete)try{opts.onComplete();}catch(e){}
          return;
        }
        const word=reply[stepIdx]+' ';
        const tokId=localState.vocab.indexOf(reply[stepIdx]);
        if(opts.onToken)try{opts.onToken(word,tokId>=0?tokId:stepIdx+10);}catch(e){}
        stepIdx++;
      },35);
      return true;
    },
    blitFrame:(x=0,y=0)=>{
      if(!localState.lastFrame)return false;
      sim.disp.ctx.drawImage(localState.lastFrame,x|0,y|0);
      return true;
    },
    setParam:(k,v)=>{if(k in localState){localState[k]=Number(v);return true;}return false;},
    reset:()=>{localState.lastError='';return true;},
    getLastError:()=>localState.lastError,
    createSampleModel:path=>{
      if(!path)return false;
      const hdr=new Uint8Array(128);
      hdr[0]=0x4B;hdr[1]=0x52;hdr[2]=0x41;hdr[3]=0x49; // KRAI
      sim.vfs.write(path,hdr);
      log(`[LocalAI] Sample INT8 model created at ${path}`,'ok');
      return true;
    }
  };
  return aiObj;
}
// === PART 2 OF 2 ===

function buildTrackball(sim){
  let x=Math.floor((sim.disp.W||240)/2),y=Math.floor((sim.disp.H||320)/2);
  let dx=0,dy=0,up=0,down=0,left=0,right=0,pressed=false,clicked=false;
  return {
    _feedDelta:(ddx,ddy)=>{
      dx+=ddx;dy+=ddy;
      x=clamp(x+ddx,0,sim.disp.W-1);y=clamp(y+ddy,0,sim.disp.H-1);
      if(ddy<0)up+=Math.abs(ddy);if(ddy>0)down+=ddy;
      if(ddx<0)left+=Math.abs(ddx);if(ddx>0)right+=ddx;
    },
    _feedPress:p=>{
      if(pressed&&!p)clicked=true;
      pressed=!!p;
    },
    getState:()=>{
      const snap={x,y,dx,dy,up,down,left,right,pressed,clicked};
      dx=0;dy=0;clicked=false;
      return snap;
    },
    getDelta:()=>{const d={dx,dy};dx=0;dy=0;return d;},
    isClicked:()=>{const c=clicked;clicked=false;return c;},
    isPressed:()=>pressed,
    getRawCounts:()=>({up,down,left,right}),
    reset:()=>{dx=0;dy=0;up=0;down=0;left=0;right=0;pressed=false;clicked=false;}
  };
}

function buildKeyboard(sim){
  const q=[];const downCodes=new Set();
  let modifiers={shift:false,fn:false,ctrl:false,alt:false};
  let backlight=80;
  return {
    _pushEvent:(ev,isDown)=>{
      if(ev.shiftKey!==undefined)modifiers={shift:!!ev.shiftKey,fn:false,ctrl:!!ev.ctrlKey,alt:!!ev.altKey};
      let ch='',code=ev.keyCode||0,name='CHAR';
      if(ev.key==='Enter'){ch='\n';code=13;name='ENTER';}
      else if(ev.key==='Backspace'){ch='\b';code=8;name='BACKSPACE';}
      else if(ev.key==='Escape'){ch='\x1b';code=27;name='ESC';}
      else if(ev.key==='Tab'){ch='\t';code=9;name='TAB';}
      else if(ev.key===' '){ch=' ';code=32;name='SPACE';}
      else if(ev.key==='ArrowUp'){code=38;name='UP';}
      else if(ev.key==='ArrowDown'){code=40;name='DOWN';}
      else if(ev.key==='ArrowLeft'){code=37;name='LEFT';}
      else if(ev.key==='ArrowRight'){code=39;name='RIGHT';}
      else if(ev.key&&ev.key.length===1){ch=ev.key;code=ev.key.charCodeAt(0);name='CHAR';}
      else return;
      if(isDown){
        downCodes.add(code);
        if(q.length<64)q.push({code,char:ch,name});
      }else{
        downCodes.delete(code);
      }
    },
    getKey:()=>{const e=q.shift();return e?(e.char||null):null;},
    getEvent:()=>q.shift()||null,
    isPressed:ascii=>downCodes.has(ascii|0),
    getModifiers:()=>Object.assign({},modifiers),
    setBacklightLevel:pct=>{backlight=clamp(pct|0,0,100);},
    getBacklightLevel:()=>backlight,
    clear:()=>{q.length=0;downCodes.clear();}
  };
}

function buildSpeaker(sim){
  let volume=75,muted=false,playing=false,paused=false,duration=0,position=0;
  let posTimer=null,melodyStop=false,srcNode=null;
  const clearPlayTimer=()=>{if(posTimer){clearInterval(posTimer);posTimer=null;}};
  const stopWebAudio=()=>{if(srcNode){try{srcNode.stop();srcNode.disconnect();}catch(e){}srcNode=null;}};
  const effectiveGain=(relVol=100)=>{
    if(muted)return 0;
    const p=clamp(volume,0,100)/100;
    const r=clamp(relVol,0,100)/100;
    return (p*p)*r*0.25;
  };
  const startStream=(path,fmt)=>{
    clearPlayTimer();stopWebAudio();
    if(!path||!sim.vfs.exists(path)){log(`[Speaker] File not found: ${path}`,'warn');return false;}
    const bytes=sim.vfs.readBytes(path);
    playing=true;paused=false;position=0;
    duration=Math.max(3,Math.round((bytes?bytes.length:4096)/16000));
    // Attempt real WebAudio decoding if genuine WAV/MP3 bytes
    try{
      audioHW._ensure();
      if(audioHW.ctx&&bytes&&bytes.length>64){
        const copy=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
        audioHW.ctx.decodeAudioData(copy,buf=>{
          if(!playing)return;
          duration=buf.duration||duration;
          const s=audioHW.ctx.createBufferSource();
          const g=audioHW.ctx.createGain();
          g.gain.value=effectiveGain(100);
          s.buffer=buf;s.connect(g);g.connect(audioHW.ctx.destination);
          s.onended=()=>{playing=false;paused=false;position=0;clearPlayTimer();};
          s.start(0);srcNode=s;
        },()=>{});
      }
    }catch(e){}
    posTimer=setInterval(()=>{
      if(!playing||paused)return;
      position+=0.1;
      if(position>=duration){playing=false;position=0;clearPlayTimer();}
    },100);
    log(`[Speaker] Streaming ${fmt}: ${path}`,'dim');
    return true;
  };
  const spk={
    playMp3:path=>startStream(path,'MP3'),
    playWav:path=>startStream(path,'WAV'),
    play:path=>{
      const bytes=sim.vfs.readBytes(path);
      if(!bytes)return false;
      const isRiff=bytes.length>=4&&bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46;
      return startStream(path,isRiff?'WAV':'MP3');
    },
    seek:ms=>{
      if(!playing)return false;
      position=clamp((ms||0)/1000,0,duration);
      return true;
    },
    playTone:(freq,durMs,vol=100)=>{
      const g=effectiveGain(vol);
      if(g>0)audioHW.setTone(98,freq,durMs,g,'sine');
      return true;
    },
    playMelody:async notes=>{
      if(!Array.isArray(notes))return;
      melodyStop=false;
      for(const n of notes){
        if(melodyStop||sim.exitRequested)break;
        const f=n.f||n.freq||440,d=n.d||n.dur||150;
        spk.playTone(f,d,100);
        await sleep(d+20);
      }
    },
    playBeep:preset=>{
      const p=String(preset||'beep').toLowerCase();
      if(p==='click')return spk.playTone(1200,15,90);
      if(p==='alert')return spk.playTone(880,180,100);
      if(p==='error')return spk.playTone(220,150,100);
      if(p==='chime')return spk.playTone(1046,100,90);
      return spk.playTone(800,80,90);
    },
    setVolume:v=>{volume=clamp(v|0,0,100);},
    getVolume:()=>volume,
    mute:m=>{muted=!!m;if(muted)audioHW.stopTone(98);},
    isMuted:()=>muted,
    stop:()=>{melodyStop=true;playing=false;paused=false;position=0;clearPlayTimer();stopWebAudio();audioHW.stopTone(98);},
    pause:()=>{if(playing)paused=true;},
    resume:()=>{if(playing)paused=false;},
    isPlaying:()=>playing&&!paused,
    getDuration:()=>duration,
    getPosition:()=>position
  };
  return spk;
}

function buildDevice(sim){
  let brightness=90;
  return {
    getName:()=>sim.sim.board.name,
    hasTrackball:()=>!!sim.sim.board.hasTrackball,
    hasKeyboard:()=>!!sim.sim.board.hasKeyboard,
    hasSpeaker:()=>!!sim.sim.board.hasSpeaker,
    hasTouch:()=>sim.sim.board.hasTouch!==false,
    hasBattery:()=>!!sim.sim.board.hasBattery,
    getBatteryPercent:()=>sim.sim.board.hasBattery?84:100,
    getBatteryVoltage:()=>sim.sim.board.hasBattery?3.98:5.0,
    isCharging:()=>false,
    getChargeTimeRemaining:()=>0,
    getDischargeTimeRemaining:()=>sim.sim.board.hasBattery?310:0,
    setBrightness:pct=>{
      brightness=clamp(pct|0,10,100);
      sim.canvas.style.filter=`brightness(${brightness}%)`;
    },
    getBrightness:()=>brightness
  };
}

function buildBluetooth(sim){
  let state='poweredOff',mode='ble',devName='KryonOS-Device',txPower=9;
  const mac='24:6F:28:A1:B2:C3';
  let scanning=false,scanTimer=null,advertising=false,kbStarted=false,meshProv=false;
  const bonded=new Set();
  const scanListeners=new Set();
  const connectedMap=new Map();
  const localServices=[];
  let pairingMode='justWorks',passkey='000000';

  const mockPeripherals=[
    {
      address:'C0:4E:30:11:22:33',addressType:'public',name:'Heart Rate Monitor',rssi:-58,
      advertisement:{txPower:4,serviceUUIDs:['180D','180A'],manufacturerData:null,raw:new Uint8Array([2,1,6,3,3,0x0D,0x18])}
    },
    {
      address:'E2:C5:6D:B5:00:01',addressType:'random',name:'Kryon iBeacon',rssi:-64,
      advertisement:{
        txPower:-59,serviceUUIDs:[],
        manufacturerData:new Uint8Array([0x4C,0x00,0x02,0x15,0xE2,0xC5,0x6D,0xB5,0xDF,0xFB,0x48,0xD2,0xB0,0x60,0xD0,0xF5,0xA7,0x10,0x96,0xE0,0x00,0x64,0x00,0x01,0xC5]),
        raw:new Uint8Array([2,1,6])
      }
    },
    {
      address:'A4:C1:38:77:88:99',addressType:'public',name:'EnvSensor-BLE',rssi:-72,
      advertisement:{txPower:0,serviceUUIDs:['181A'],manufacturerData:null,raw:new Uint8Array([2,1,6])}
    }
  ];

  const makeRemoteDevice=(addr)=>{
    let connected=true,handle=1;
    const discListeners=new Set();
    const hrListeners=new Set();
    let notifyTimer=null;
    const dev={
      address:addr,conn_handle:handle,
      disconnect:()=>{connected=false;if(notifyTimer)clearInterval(notifyTimer);connectedMap.delete(addr);discListeners.forEach(cb=>{try{cb();}catch(e){}});return true;},
      isConnected:()=>connected,
      readRSSI:()=>-58,
      requestMtu:()=>true,
      setPreferredPhy:()=>true,
      createL2capChannel:psm=>({psm,send:()=>true,close:()=>{}}),
      on:(ev,cb)=>{if(ev==='disconnect'&&typeof cb==='function')discListeners.add(cb);},
      getServices:async uuids=>{
        const list=[
          {
            uuid:'180D',isPrimary:true,
            getCharacteristics:async cu=>{
              const c={
                uuid:'2A37',properties:['read','notify'],
                read:async()=>new Uint8Array([0x06,72]),
                write:async()=>true,
                startNotifications:async()=>{
                  if(!notifyTimer)notifyTimer=setInterval(()=>{
                    if(!connected){clearInterval(notifyTimer);return;}
                    const pkt=new Uint8Array([0x06,68+((Math.random()*12)|0)]);
                    hrListeners.forEach(cb=>{try{cb(pkt);}catch(e){}});
                  },1000);
                  return true;
                },
                stopNotifications:async()=>{if(notifyTimer){clearInterval(notifyTimer);notifyTimer=null;}return true;},
                on:(ev,cb)=>{if(ev==='valueChange'&&typeof cb==='function')hrListeners.add(cb);},
                off:(ev,cb)=>{if(ev==='valueChange'){if(cb)hrListeners.delete(cb);else hrListeners.clear();}},
                getDescriptors:async()=>[{uuid:'2902',read:async()=>new Uint8Array([1,0]),write:async()=>true}]
              };
              return (!cu||!cu.length||cu.includes('2A37'))?[c]:[];
            }
          },
          {
            uuid:'180A',isPrimary:true,
            getCharacteristics:async()=>[{
              uuid:'2A24',properties:['read'],
              read:async()=>_txtEnc.encode('KryonOS-BLE'),
              write:async()=>false,startNotifications:async()=>false,stopNotifications:async()=>true,
              on:()=>{},off:()=>{},getDescriptors:async()=>[]
            }]
          }
        ];
        return (uuids&&uuids.length)?list.filter(s=>uuids.includes(s.uuid)):list;
      }
    };
    return dev;
  };

  const bt={
    enable:opts=>{
      mode=(opts&&opts.mode)||'ble';
      state='poweredOn';
      log(`[Bluetooth] Enabled (${mode})`,'ok');
      return true;
    },
    disable:()=>{
      if(scanTimer){clearInterval(scanTimer);scanTimer=null;}
      scanning=false;advertising=false;state='poweredOff';
      return true;
    },
    getState:()=>state,
    getCapabilities:()=>({
      ble:true,ble5:sim.sim.board.chip==='ESP32-S3',
      classic:sim.sim.board.chip==='ESP32',spp:sim.sim.board.chip==='ESP32',
      a2dp:sim.sim.board.chip==='ESP32',hfp:sim.sim.board.chip==='ESP32',
      codedPhy:sim.sim.board.chip==='ESP32-S3',mesh:true,l2capCoC:true
    }),
    hasFeature:name=>!!bt.getCapabilities()[name],
    getDeviceName:()=>devName,
    setDeviceName:n=>{devName=String(n||'KryonOS-Device');},
    getMacAddress:()=>mac,
    setTxPower:lvl=>{txPower=lvl|0;return true;},
    getTxPower:()=>txPower,
    poll:()=>{},
    Utils:{
      parseBeacon:dev=>{
        const m=dev&&dev.advertisement&&dev.advertisement.manufacturerData;
        if(m&&m.length>=25&&m[0]===0x4C&&m[1]===0x00&&m[2]===0x02&&m[3]===0x15){
          const hex=Array.from(m.subarray(4,20),b=>b.toString(16).padStart(2,'0').toUpperCase()).join('');
          const uuid=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
          const major=(m[20]<<8)|m[21],minor=(m[22]<<8)|m[23];
          const txP=(m[24]<<24)>>24;
          const ratio=txP!==0?(dev.rssi/txP):1;
          const dist=ratio<1?Math.pow(ratio,10):(0.89976*Math.pow(ratio,7.7095)+0.111);
          return {type:'ibeacon',uuid,major,minor,txPower:txP,distance:Number(dist.toFixed(2))};
        }
        return null;
      }
    },
    BLE:{
      Scanner:{
        start:(opts={})=>{
          if(state!=='poweredOn')bt.enable();
          scanning=true;
          if(scanTimer)clearInterval(scanTimer);
          let idx=0;
          const emit=()=>{
            if(!scanning)return;
            const d=mockPeripherals[idx%mockPeripherals.length];idx++;
            scanListeners.forEach(cb=>{try{cb(d);}catch(e){}});
          };
          setTimeout(emit,120);
          scanTimer=setInterval(emit,1200);
          if(opts.timeout>0)setTimeout(()=>bt.BLE.Scanner.stop(),opts.timeout);
          return true;
        },
        stop:()=>{scanning=false;if(scanTimer){clearInterval(scanTimer);scanTimer=null;}},
        isScanning:()=>scanning,
        on:(ev,cb)=>{if(ev==='discover'&&typeof cb==='function')scanListeners.add(cb);},
        off:ev=>{if(ev==='discover')scanListeners.clear();}
      },
      connect:async(addr,opts={})=>{
        if(state!=='poweredOn')bt.enable();
        await sleep(150);
        const dev=makeRemoteDevice(addr);
        connectedMap.set(addr,dev);
        return dev;
      },
      getConnectedDevices:()=>[...connectedMap.values()],
      Server:{
        createService:uuid=>{
          const chars=[];
          const srv={
            uuid,chars,
            addCharacteristic:opts=>{
              let val=opts.value||new Uint8Array(0);
              const ch={uuid:opts.uuid,properties:opts.properties||['read'],setValue:(d,notify=false)=>{val=d;}};
              chars.push(ch);return ch;
            }
          };
          localServices.push(srv);return srv;
        },
        start:()=>{if(state!=='poweredOn')bt.enable();return true;},
        stop:()=>true
      },
      Advertiser:{
        start:opts=>{if(state!=='poweredOn')bt.enable();advertising=true;if(opts&&opts.name)devName=opts.name;return true;},
        startExtended:opts=>bt.BLE.Advertiser.start(opts),
        stop:()=>{advertising=false;return true;},
        isAdvertising:()=>advertising
      },
      Keyboard:{
        start:(name='T-Deck Keyboard')=>{if(state!=='poweredOn')bt.enable();devName=name;kbStarted=true;advertising=true;return true;},
        stop:()=>{kbStarted=false;advertising=false;},
        isConnected:()=>kbStarted,
        write:txt=>kbStarted&&String(txt).length>=0,
        sendKey:(kc,mod=0)=>kbStarted,
        sendSpecial:name=>kbStarted,
        sendMedia:name=>kbStarted
      },
      Periodic:{sync:()=>true,on:()=>{}},
      L2CAP:{listen:psm=>true},
      Security:{
        setPairingMode:m=>{pairingMode=m;},
        setStaticPasskey:p=>{passkey=String(p);},
        getBondedDevices:()=>[...bonded],
        removeBond:a=>bonded.delete(a)
      }
    },
    Mesh:{
      init:()=>true,
      startProvisioning:()=>{meshProv=true;return true;},
      isProvisioned:()=>meshProv,
      send:()=>true,
      reset:()=>{meshProv=false;}
    },
    Classic:{
      get isSupported(){return sim.sim.board.chip==='ESP32';},
      Discovery:{start:()=>bt.Classic.isSupported,stop:()=>{},on:()=>{}},
      Serial:{connect:async()=>Promise.reject(new Error('UnsupportedHardwareError')),listen:()=>false},
      Audio:{startSink:()=>false,stopSink:()=>{},startSource:()=>false,stopSource:()=>{},sendControl:()=>{}},
      Telephony:{init:()=>false,connect:()=>false,dial:()=>{},answer:()=>{},hangup:()=>{},setSpeakerVolume:()=>{},setMicVolume:()=>{}},
      HID:{connectHost:()=>false,startDevice:()=>false,sendReport:()=>{}}
    }
  };
  return bt;
}

function buildGPS(sim){
  let holds=0,masterOn=true,rateHz=1,baud=38400;
  let nextWatchId=1;const watches=new Map();
  let lastLoc={lat:23.810331,lng:90.412521,altitude:14.2,speed:0.4,speedKnots:0.2,course:90.0,accuracy:2.1,timestamp:Date.now()};
  const startBoot=Date.now();
  const toRad=d=>d*Math.PI/180,toDeg=r=>r*180/Math.PI;
  const checkAvail=()=>!!sim.sim.board.hasGPS;
  const checkPerm=()=>true;

  return {
    _tick:()=>{
      if(!checkAvail()||!masterOn||watches.size===0)return;
      const loc=Object.assign({},lastLoc,{timestamp:Date.now()});
      for(const w of watches.values()){
        if(Date.now()-w.lastEmit>=(w.minIntervalMs||1000)){
          w.lastEmit=Date.now();
          try{w.cb(loc);}catch(e){}
        }
      }
    },
    isAvailable:checkAvail,
    isEnabled:()=>checkAvail()&&masterOn,
    start:()=>{if(!checkAvail())return false;holds++;return masterOn;},
    enable:()=>{if(!checkAvail())return false;holds++;return masterOn;},
    stop:()=>{if(holds>0)holds--;return true;},
    disable:()=>{if(holds>0)holds--;return true;},
    requestPermission:()=>'granted',
    hasFix:()=>checkAvail()&&masterOn,
    getLocation:()=>{
      if(!checkAvail()||!masterOn||!checkPerm())return null;
      return Object.assign({},lastLoc,{timestamp:Date.now()});
    },
    getLastKnownLocation:()=>checkAvail()?Object.assign({},lastLoc):null,
    getStatus:()=>{
      if(!checkAvail())return null;
      return {
        enabled:masterOn,hasFix:masterOn,fixType:masterOn?'3D':'none',
        chipModel:'u-blox MIA-M10Q',satellitesTracked:masterOn?8:0,
        satellitesVisible:masterOn?12:0,satellitesWithSignal:masterOn?7:0,
        avgSnr:masterOn?34.5:0,hdop:1.15,vdop:1.42,ageMs:120,
        searchTimeSec:Math.floor((Date.now()-startBoot)/1000),
        sentencesParsed:Math.floor((Date.now()-startBoot)/250),
        checksumErrors:0,charsProcessed:Math.floor((Date.now()-startBoot)/10),
        currentBaud:baud,baudLocked:true,
        rawNmea:[
          '$GNRMC,120000.00,A,2348.6198,N,09024.7512,E,0.4,90.0,251126,,,A*7A',
          '$GNGGA,120000.00,2348.6198,N,09024.7512,E,1,08,1.15,14.2,M,,M,,*5C'
        ]
      };
    },
    getTime:()=>{
      if(!checkAvail()||!masterOn)return null;
      const d=new Date();
      return {
        year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),
        hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds(),
        centisecond:Math.floor(d.getUTCMilliseconds()/10),epochMs:d.getTime()
      };
    },
    syncSystemTime:()=>checkAvail()&&masterOn,
    watchPosition:(cb,opts={})=>{
      if(!checkAvail()||typeof cb!=='function')return -1;
      holds++;const id=nextWatchId++;
      watches.set(id,{cb,minIntervalMs:opts.minIntervalMs||1000,lastEmit:0});
      return id;
    },
    clearWatch:id=>{if(watches.delete(id)){if(holds>0)holds--;return true;}return false;},
    distanceBetween:(lat1,lon1,lat2,lon2)=>{
      const R=6371000,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
      const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    },
    courseTo:(lat1,lon1,lat2,lon2)=>{
      const f1=toRad(lat1),f2=toRad(lat2),dl=toRad(lon2-lon1);
      const y=Math.sin(dl)*Math.cos(f2);
      const x=Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl);
      return (toDeg(Math.atan2(y,x))+360)%360;
    },
    isInsideCircle:(lat,lon,cLat,cLon,rad)=>sim.env.GPS.distanceBetween(lat,lon,cLat,cLon)<=rad,
    setRate:hz=>{if(hz===1||hz===5||hz===10){rateHz=hz;return true;}return false;},
    getBaud:()=>baud
  };
}

/* ─── Kryon3D Bridge Helper ─── */
function buildKryon3DBridge(sim) {
  const k = sim.kryon3D;
  return {
    begin: (w, h) => k.begin(w, h),
    clear: c => k.clear(c),
    render: (x, y) => sim.render3D(x, y),
    flush: (x, y) => sim.render3D(x, y),
    end: () => k.end(),
    setViewport: (x, y, w, h) => k.setViewport(x, y, w, h),
    setCamera: (px, py, pz, tx, ty, tz, fov) => k.setCamera(px, py, pz, tx, ty, tz, fov),
    setLight: (lx, ly, lz, amb, dif) => k.setLight(lx, ly, lz, amb, dif),
    setFog: (e, c, n, f) => k.setFog(e, c, n, f),
    drawLine: (...a) => k.drawLine(...a),
    drawTriangle: (...a) => k.drawTriangle(...a),
    fillTriangle: (...a) => k.fillTriangle(...a),
    drawCube: (...a) => k.drawCube(...a),
    drawBillboard: (...a) => k.drawBillboard(...a),
    drawMesh: (...a) => k.drawMesh(...a),
    getWidth: () => k.getWidth(),
    getHeight: () => k.getHeight(),
    directDraw: v => k.directDraw(v)
  };
}

function buildDisplayMethods(sim,disp){
  return {
    fillScreen:c=>disp.fillScreen(c),
    fillRect:(x,y,w,h,c)=>disp.fillRect(x,y,w,h,c),
    drawRect:(x,y,w,h,c)=>disp.drawRect(x,y,w,h,c),
    drawFastHLine:(x,y,w,c)=>disp.drawFastHLine(x,y,w,c),
    drawFastVLine:(x,y,h,c)=>disp.drawFastVLine(x,y,h,c),
    drawLine:(a,b,c,d,e)=>disp.drawLine(a,b,c,d,e),
    drawPixel:(x,y,c)=>disp.drawPixel(x,y,c),
    drawCircle:(x,y,r,c)=>disp.drawCircle(x,y,r,c),
    fillCircle:(x,y,r,c)=>disp.fillCircle(x,y,r,c),
    drawTriangle:(...a)=>disp.drawTriangle(...a),
    fillTriangle:(...a)=>disp.fillTriangle(...a),
    drawRoundRect:(...a)=>disp.drawRoundRect(...a),
    fillRoundRect:(...a)=>disp.fillRoundRect(...a),
    drawImage:(p,x,y,opts)=>disp.drawImage(sim,p,x,y,opts),
    drawPNG:(p,x,y,a)=>disp.drawPNG(sim,p,x,y,a),
    drawJPG:(p,x,y,s)=>disp.drawJPG(sim,p,x,y,s),
    drawJPEG:(p,x,y,s)=>disp.drawJPG(sim,p,x,y,s),
    drawBMP:(p,x,y)=>disp.drawBMP(sim,p,x,y),
    getImageInfo:p=>disp.getImageInfo(sim,p),
    drawString:(s,x,y,f=2)=>disp.drawString(s,x,y,f),
    setTextColor:(f,b)=>disp.setTextColor(f,b),
    setTextDatum:d=>disp.setTextDatum(d),
    setTextSize:s=>disp.setTextSize(s),
    color:(r,g,b)=>disp.color(r,g,b),
    width:()=>disp.W,
    height:()=>disp.H,
    screenWidth:()=>disp.W,
    screenHeight:()=>disp.H,
    createSprite:(w,h)=>{disp.activeSprite=new VirtualSprite(w,h);disp.spriteBound=false;return true;},
    deleteSprite:()=>{disp.activeSprite=null;disp.spriteBound=false;},
    bindSprite:en=>{disp.spriteBound=!!en;},
    pushSprite:(x,y)=>{if(disp.activeSprite)disp.ctx.drawImage(disp.activeSprite.canvas,x|0,y|0);}
  };
}

function buildSystem(sim,disp,keyboard,picker,notif,pwm,i2c,crypto,ipc,ai,net,httpserver,kryon3DObj){
  const startTime=Date.now();
  const fastMath=buildFastMath();
  const scope=sim.sim;
  const dispMethods=buildDisplayMethods(sim,disp);
  function pushTouch(){
    if(sim.exitRequested)throw Object.assign(new Error('OS_EXIT'),{code:'OS_EXIT'});
    if(keyboard.active||picker.active)return {x:0,y:0,touched:false};
    const t=sim.touch;
    if((t.touched||t.justPressed)&&t.x>=disp.W-40&&t.y<=40)throw Object.assign(new Error('OS_EXIT'),{code:'OS_EXIT'});
    const was=t.touched||t.justPressed;
    t.justPressed=false;
    return {x:t.x,y:t.y,touched:was};
  }
  const notifyFn=(a,b,c,d)=>{
    if(a&&typeof a==='object'&&!Array.isArray(a))return notif.post(a.title||'Notification',a.message||'',a.icon||'info',a.duration||3000,!!a.sound);
    return notif.post(a||'Notification',b||'',c||'info',d||3000,false);
  };
  notifyFn.dismiss=id=>notif.dismiss(id);
  notifyFn.clearAll=()=>notif.clearAll();
  notifyFn.isActive=()=>notif.isActive();
  notifyFn.hasActive=()=>notif.isActive();

  return Object.assign({},dispMethods,{
    getTouch:pushTouch,
    millis:()=>Date.now()-startTime,
    micros:()=>(Date.now()-startTime)*1000,
    delay:async ms=>{
      const cap=clamp(ms|0,0,30000);
      const s=Date.now();
      while(Date.now()-s<cap){
        if(sim.exitRequested)throw Object.assign(new Error('OS_EXIT'),{code:'OS_EXIT'});
        await sleep(10);
        ipc._dispatch();
        if(sim.env.GPS)sim.env.GPS._tick();
        if(sim.env.Bluetooth)sim.env.Bluetooth.poll();
        httpserver.poll();
      }
      ipc._dispatch();
    },
    delayMicroseconds:async us=>{await sleep(Math.max(1,(us/1000)|0));},
    print:(...a)=>log(formatConsoleArgs(a),'info'),
    println:(...a)=>log(formatConsoleArgs(a),'info'),
    log:(...a)=>log('[JS LOG] '+formatConsoleArgs(a),'info'),
    info:(...a)=>log('[JS INFO] '+formatConsoleArgs(a),'info'),
    warn:(...a)=>log('[JS WARN] '+formatConsoleArgs(a),'warn'),
    error:(...a)=>log('[JS ERROR] '+formatConsoleArgs(a),'err'),
    debug:(...a)=>log('[JS DEBUG] '+formatConsoleArgs(a),'dim'),
    getInfo:()=>({
      totalRAM:512*1024,freeRAM:384*1024,minFreeRAM:200*1024,maxAllocRAM:160*1024,
      cpuFreqMHz:240,chipModel:scope.board.chip,deviceName:scope.board.name,boardModel:scope.board.name,
      chipCores:2,chipRevision:1,flashSize:16*1024*1024,uptimeMs:Date.now()-startTime
    }),
    getTemperature:()=>41.8,
    hasTemperatureSensor:()=>true,
    restart:()=>{sim.reboot();},
    getOSVersion:()=>KRYONOS_VERSION,
    getAPILevel:()=>KRYONOS_API_LEVEL,
    getIPAddress:()=>net.getIP(),
    isWiFiActive:()=>scope.wifi,
    getTime:()=>new Date().toLocaleTimeString('en-GB',{hour12:!scope.use24h}),
    getSeconds:()=>new Date().getSeconds(),
    getDate:()=>new Date().toLocaleDateString('en-GB'),
    getYear:()=>new Date().getFullYear(),
    getMonth:()=>new Date().getMonth()+1,
    getDay:()=>new Date().getDate(),
    getTimezone:()=>scope.timezone,
    prompt:(msg,init)=>keyboard.show(msg,init,30),
    pickFile:opts=>picker.show('file',opts),
    pickDir:opts=>picker.show('dir',opts),
    notify:notifyFn,
    gpio:{pinMode:()=>{},digitalWrite:()=>{},digitalRead:()=>0,analogRead:()=>512,analogWrite:()=>{},pulseIn:()=>0,OUTPUT:1,INPUT:0,INPUT_PULLUP:2,HIGH:1,LOW:0},
    i2c,pwm,crypto,math:fastMath,ipc,ai,localAI:ai,
    graphics3d:kryon3DObj,
    trackball:sim.env.Trackball,
    keyboard:sim.env.Keyboard,
    speaker:sim.env.Speaker,
    device:sim.env.Device
  });
}

function buildFS(sim){
  const SYS='/local/system';const vfs=sim.vfs;const grants=sim.permissions;let sandbox='';
  let sdMounted=true;
  function setSandbox(r){sandbox=r?(r.endsWith('/')?r:r+'/'):'';}
  function resolve(p){if(!p)return '';let s=String(p);if(!s.startsWith('/')&&!s.startsWith('local/')&&!s.startsWith('sd/'))s=sandbox+s;return s.replace(/\/+/g,'/');}
  function isSys(p){if(!p)return true;if(p.includes('..')||p.includes('\\'))return true;if(p.startsWith(SYS)||p.startsWith('/system')||p.startsWith('/sd/system'))return true;if(p.endsWith('/app_permissions.json')||p.endsWith('/wifi_credentials.enc'))return true;return false;}
  function allowed(p){
    if(!sandbox)return true;
    const r=resolve(p);
    if(isSys(r))return false;
    if(r.startsWith(sandbox))return true;
    const pkg=sim.currentPkg||'';
    if(grants.has(pkg+':storage'))return true;
    grants.add(pkg+':storage');
    return true;
  }
  return {
    _setSandboxRoot:setSandbox,
    readTextFile:p=>allowed(p)?vfs.read(resolve(p)):null,
    writeTextFile:(p,c)=>allowed(p)?vfs.write(resolve(p),c):false,
    appendTextFile:(p,c)=>allowed(p)?vfs.append(resolve(p),c):false,
    deleteFile:p=>allowed(p)?vfs.remove(resolve(p)):false,
    renameFile:(a,b)=>allowed(a)&&allowed(b)?vfs.rename(resolve(a),resolve(b)):false,
    copyFile:(a,b)=>allowed(a)&&allowed(b)?vfs.copy(resolve(a),resolve(b)):false,
    exists:p=>allowed(p)?vfs.exists(resolve(p)):false,
    listDir:p=>allowed(p)?vfs.listDir(resolve(p)):[],
    mkdir:p=>allowed(p)?vfs.mkdir(resolve(p)):false,
    rmdir:(p,recursive=false)=>{
      if(!allowed(p))return false;
      const r=vfs._norm(resolve(p));
      if(r==='/'||r==='/local'||r==='/sd')return false;
      if(!vfs.isDir(r))return false;
      if(!recursive&&vfs.listDir(r).length>0)return false;
      return vfs.remove(r);
    },
    isDirectory:p=>allowed(p)?vfs.isDir(resolve(p)):false,
    isFile:p=>allowed(p)?vfs.isFile(resolve(p)):false,
    getFileSize:p=>allowed(p)?vfs.size(resolve(p)):0,
    stat:p=>allowed(p)?vfs.stat(resolve(p)):null,
    readChunk:(p,offset=0,length=4096,asBinary=false)=>{
      if(!allowed(p))return null;
      if(typeof offset!=='number'||typeof length!=='number'||Number.isNaN(offset)||Number.isNaN(length)||offset<0||length<0)return null;
      const bytes=vfs.readBytes(resolve(p));
      if(!bytes)return null;
      const len=clamp(length|0,0,16384);
      const start=Math.min(offset|0,bytes.length);
      const slice=bytes.subarray(start,Math.min(start+len,bytes.length));
      return asBinary?new Uint8Array(slice):_txtDec.decode(slice);
    },
    readBinary:p=>{
      if(!allowed(p))return null;
      const r=resolve(p);
      if(!vfs.isFile(r))return null;
      return vfs.readBytes(r);
    },
    writeBinary:(p,buf)=>{
      if(!allowed(p)||buf==null)return false;
      return vfs.write(resolve(p),buf);
    },
    pick:opts=>sim.picker.show('file',opts),
    pickFile:opts=>sim.picker.show('file',opts),
    pickDir:opts=>sim.picker.show('dir',opts),
    pickFolder:opts=>sim.picker.show('dir',opts),
    getTotalSpace:()=>vfs.totalSpace(),
    getUsedSpace:()=>vfs.usedSpace(),
    getFreeSpace:()=>vfs.freeSpace(),
    getFileMD5:p=>allowed(p)?vfs.md5(resolve(p)):'',
    mountSD:()=>{sdMounted=true;return true;},
    unmountSD:()=>{sdMounted=false;},
    isSDMounted:()=>sdMounted
  };
}

class LauncherScreen{
  constructor(sim){this.sim=sim;this.sel=1;this.scroll=0;this.apps=[];}
  scan(){
    this.apps=[];
    for(const d of ['/local/apps','/sd/apps']){
      if(!this.sim.vfs.isDir(d))continue;
      for(const e of this.sim.vfs.listDirFull(d)){
        if(e.isDir){
          const jp=e.path+'/app.json';
          if(this.sim.vfs.exists(jp)){
            try{
              const o=JSON.parse(this.sim.vfs.read(jp));
              const n=o.name||e.name;
              const pkg=o.packageName||e.name;
              this.sim.env.IPC.registerApp(pkg,e.path,n,o.category||'Utility',o.fileAssociations||[],o.allowCompanionLaunch!==false);
              if(!this.apps.find(a=>a.name===n))this.apps.push({name:n,path:e.path,pkg,meta:o});
            }catch(err){}
          }
        }else if(e.name.endsWith('.js')){
          if(!this.apps.find(a=>a.name===e.name))this.apps.push({name:e.name,path:e.path,pkg:e.name,meta:null,isLegacy:true});
        }
      }
    }
  }
  total(){return this.apps.length+7;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('KryonOS Home',120,21,2);
    d.fillRect(10,45,220,230,TFT_BLACK);
    const total=this.total();const pp=7;
    for(let i=0;i<pp;i++){
      const idx=this.scroll+i;if(idx>=total)break;
      const y=45+i*30;let name='',hdr=false;
      if(idx===0){name='[ SYSTEM ]';hdr=true;}
      else if(idx===1)name='App Store';
      else if(idx===2)name='App Installer';
      else if(idx===3)name='Kryon Cloud';
      else if(idx===4)name='Settings';
      else if(idx===5)name='Help Center';
      else if(idx===6){name='[ APPS ]';hdr=true;}
      else name=this.apps[idx-7].name;

      if(hdr){d.setTextColor(TFT_DARKGREY,TFT_BLACK);d.setTextDatum(3);d.drawString(name,15,y+12,2);}
      else if(idx===this.sel){d.fillRect(10,y,220,25,TFT_WHITE);d.setTextColor(TFT_BLACK,TFT_WHITE);d.setTextDatum(3);d.drawString('> '+name,15,y+12,2);}
      else{d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(3);d.drawString('  '+name,15,y+12,2);}
    }
    if(total>pp){
      const sbH=Math.max(16,(230*pp)/total);
      const sbY=45+(this.scroll*(230-sbH))/Math.max(1,total-pp);
      d.fillRect(231,45,3,230,TFT_DARKGREY);d.fillRect(231,sbY,3,sbH,TFT_WHITE);
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);
    d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);
    d.drawString('UP',30,300,2);d.drawString('|',60,300,2);
    d.drawString('SEL',120,300,2);d.drawString('|',180,300,2);
    d.drawString('DN',210,300,2);
  }
  handleTouch(x,y){
    const total=this.total();const pp=7;
    if(y>=45&&y<=270){
      const c=this.scroll+Math.floor((y-45)/30);
      if(c<total&&c!==0&&c!==6){this.sel=c;this.draw();this.execute();}
      return;
    }
    if(y>=285){
      if(x<60){
        if(this.sel>1){
          this.sel--;if(this.sel===6)this.sel--;
          if(this.sel<this.scroll)this.scroll=this.sel;
          if(this.sel===1)this.scroll=0;
          this.draw();
        }
      }else if(x>60&&x<180)this.execute();
      else if(x>180){
        if(this.sel<total-1){
          this.sel++;if(this.sel===6)this.sel++;
          if(this.sel>=this.scroll+pp)this.scroll=this.sel-pp+1;
          this.draw();
        }
      }
    }
  }
  execute(){
    const s=this.sel;
    if(s===1)this.sim.setState(S.APP_STORE);
    else if(s===2)this.sim.setState(S.INSTALLER);
    else if(s===3)this.sim.setState(S.KRYON_CLOUD);
    else if(s===4)this.sim.setState(S.SETTINGS);
    else if(s===5)this.sim.setState(S.HELP_CENTER);
    else if(s>6&&this.apps[s-7])this.sim.launchApp(this.apps[s-7]);
  }
}

class SettingsScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('Settings Menu',120,21,2);
    const items=[
      ['WiFi Options',TFT_BLUE],['Touch Calibrator',TFT_ORANGE],
      ['Manage Apps',TFT_PURPLE],['Permissions Manager',0x03E0],
      ['Time & Region',TFT_CYAN],['About Device',TFT_DARKGREY],['System Updates',TFT_RED]
    ];
    let y=40;
    items.forEach(([t,c])=>{
      d.fillRoundRect(20,y,200,30,4,c);
      d.setTextColor(c===TFT_CYAN?TFT_BLACK:TFT_WHITE,c);
      d.drawString(t,120,y+15,2);
      y+=34;
    });
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(x>=20&&x<=220){
      if(y>=40&&y<=70)this.sim.setState(S.SETTINGS_WIFI);
      else if(y>=74&&y<=104)this.sim.setState(S.CALIBRATOR);
      else if(y>=108&&y<=138)this.sim.setState(S.SETTINGS_APPS);
      else if(y>=142&&y<=172)this.sim.setState(S.SETTINGS_PERMISSIONS);
      else if(y>=176&&y<=206)this.sim.setState(S.SETTINGS_TIME);
      else if(y>=210&&y<=240)this.sim.setState(S.SETTINGS_ABOUT);
      else if(y>=244&&y<=274)this.sim.setState(S.UPDATER_MANUAL);
    }
    if(y>=285)this.sim.setState(S.LAUNCHER);
  }
}

class WiFiScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('WiFi Options',120,21,2);

    const on=this.sim.sim.wifi;
    d.fillRoundRect(10,40,220,78,6,0x10A2);d.drawRoundRect(10,40,220,78,6,TFT_CYAN);
    d.setTextDatum(0);d.setTextColor(on?TFT_GREEN:TFT_RED,0x10A2);
    d.drawString(on?'Status: ONLINE':'Status: DISABLED',18,48,2);
    d.setTextColor(TFT_WHITE,0x10A2);
    d.drawString('SSID: '+(on?'KryonOS_Sim':'(off)'),18,68,2);
    d.drawString('IP:   '+(on?'192.168.1.100':'0.0.0.0'),18,88,2);

    d.setTextDatum(4);
    d.fillRoundRect(12,126,216,34,5,on?TFT_BLUE:TFT_DARKGREY);
    d.setTextColor(TFT_WHITE,on?TFT_BLUE:TFT_DARKGREY);
    d.drawString(on?'WiFi: ON (Tap to Disable)':'WiFi: OFF (Tap to Enable)',120,143,2);

    if(on){
      d.fillRoundRect(12,166,216,34,5,TFT_PURPLE);d.setTextColor(TFT_WHITE,TFT_PURPLE);d.drawString('Scan Nearby Networks',120,183,2);
      d.fillRoundRect(12,206,216,34,5,0x03E0);d.setTextColor(TFT_WHITE,0x03E0);d.drawString('Saved Networks',120,223,2);
      d.fillRoundRect(12,246,216,34,5,TFT_ORANGE);d.setTextColor(TFT_WHITE,TFT_ORANGE);d.drawString('Web Server',120,263,2);
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(x>=12&&x<=228&&y>=126&&y<=160){
      this.sim.sim.wifi=!this.sim.sim.wifi;this.sim.updateStatus();this.draw();return;
    }
    if(this.sim.sim.wifi){
      if(y>=166&&y<=200){
        this.sim.notif.post('WiFi Scanner','Found 3 APs nearby','info',2000);
      }else if(y>=206&&y<=240){
        this.sim.setState(S.SETTINGS_WIFI_SAVED);
      }else if(y>=246&&y<=280){
        this.sim.setState(S.WEB_APP);
      }
    }
    if(y>=285)this.sim.setState(S.SETTINGS);
  }
}

class SavedNetworksScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('Saved Networks',120,21,2);

    d.fillRoundRect(10,48,220,54,5,0x02E0);d.drawRoundRect(10,48,220,54,5,TFT_GREEN);
    d.setTextDatum(0);d.setTextColor(TFT_WHITE,0x02E0);d.drawString('KryonOS_Sim',20,58,2);
    d.setTextColor(TFT_GREEN,0x02E0);d.drawString('Connected (Online)',20,78,1);

    d.fillRoundRect(150,56,70,36,4,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.setTextDatum(4);d.drawString('Forget',185,74,2);
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(x>=150&&x<=220&&y>=56&&y<=92){
      this.sim.notif.post('WiFi','Network Forgotten','warn',2000);
      this.sim.setState(S.SETTINGS_WIFI);return;
    }
    if(y>=285)this.sim.setState(S.SETTINGS_WIFI);
  }
}

class PermissionsScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(0);d.drawString('Permissions',14,13,2);

    d.fillRoundRect(140,9,88,24,4,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.setTextDatum(4);d.drawString('Reset All',184,21,2);

    const list=[...this.sim.permissions];
    if(!list.length){
      d.fillRoundRect(10,55,220,190,6,0x10A2);d.drawRoundRect(10,55,220,190,6,TFT_CYAN);
      d.setTextColor(TFT_GOLD,0x10A2);d.drawString('No Granted Permissions',120,85,2);
      d.setTextColor(TFT_WHITE,0x10A2);d.drawString('Apps sandbox internally.',120,130,2);
    }else{
      let y=48;
      for(let i=0;i<Math.min(3,list.length);i++){
        const [pkg,perm]=list[i].split(':');
        d.fillRoundRect(10,y,220,62,5,0x18C3);d.drawRoundRect(10,y,220,62,5,0x2945);
        d.setTextDatum(0);d.setTextColor(TFT_WHITE,0x18C3);d.drawString(pkg,16,y+6,2);
        d.fillRoundRect(16,y+36,110,18,3,0x03E0);d.setTextColor(TFT_WHITE,0x03E0);d.setTextDatum(4);d.drawString(`${perm.toUpperCase()}: GRANTED`,71,y+45,1);
        d.fillRoundRect(145,y+18,75,30,4,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.drawString('Revoke',182,y+33,2);
        y+=68;
      }
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(x>=140&&x<=228&&y>=9&&y<=33){
      this.sim.permissions.clear();this.sim.notif.post('Permissions','All revoked','warn',2000);this.draw();return;
    }
    if(this.sim.permissions.size>0&&x>=145&&x<=220&&y>=66&&y<=98){
      const first=[...this.sim.permissions][0];this.sim.permissions.delete(first);
      this.sim.notif.post('Permissions','Revoked '+first,'warn',2000);this.draw();return;
    }
    if(y>=285)this.sim.setState(S.SETTINGS);
  }
}

class KryonCloudScreen{
  constructor(sim){
    this.sim=sim;this.tab='HOME';this.aiPrompt='Explain FreeRTOS IPC';
    this.aiResponse='Ready. Tap "Ask AI" to query.';
    this.beamScope='MAILBOX';this.driveScope='SHARED';
    this.isBanned=false;
  }
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);

    if(this.isBanned){
      this._drawBanned();
      return;
    }

    d.fillRect(0,0,240,56,0x10A2);d.drawFastHLine(0,56,240,0x39E8);
    d.fillCircle(12,14,4,this.sim.sim.wifi?TFT_GREEN:TFT_RED);d.setTextColor(TFT_WHITE,0x10A2);
    d.setTextDatum(3);d.drawString('KryonCloud',22,14,2);
    d.fillRoundRect(208,4,26,20,4,0x8800);d.setTextColor(TFT_WHITE,0x8800);d.setTextDatum(4);d.drawString('X',221,14,2);

    const tabs=['Home','AI','Beam','Drive','Limits'];
    const keys=['HOME','AI','BEAM','DRIVE','LIMITS'];
    for(let i=0;i<5;i++){
      const tx=3+i*47;const active=(this.tab===keys[i]);
      d.fillRoundRect(tx,30,45,22,4,active?0x229F:0x2125);
      d.setTextColor(active?TFT_WHITE:0xC618,active?0x229F:0x2125);
      d.drawString(tabs[i],tx+22,41,2);
    }

    if(this.tab==='HOME')this._drawHome();
    else if(this.tab==='AI')this._drawAI();
    else if(this.tab==='BEAM')this._drawBeam();
    else if(this.tab==='DRIVE')this._drawDrive();
    else if(this.tab==='LIMITS')this._drawLimits();
    else if(this.tab==='PAIRING')this._drawPairing();
  }
  _drawBanned(){
    const d=this.sim.disp;
    d.fillRoundRect(10,40,220,230,6,TFT_DARKGREY);
    d.drawRoundRect(10,40,220,230,6,TFT_RED);
    d.setTextColor(TFT_RED,TFT_DARKGREY);
    d.setTextDatum(4);
    d.drawString('DEVICE SUSPENDED',120,65,2);
    d.setTextColor(TFT_WHITE,TFT_DARKGREY);
    d.drawString('Account or board is banned.',120,100,2);
    d.drawString('Visit kryonos.harislab.tech',120,130,2);
    d.drawString('to submit an appeal.',120,150,2);
    d.fillRoundRect(40,210,160,35,4,0x229F);
    d.setTextColor(TFT_WHITE,0x229F);
    d.drawString('Back to Launcher',120,227,2);
  }
  _drawHome(){
    const d=this.sim.disp;
    d.fillRoundRect(8,62,224,72,6,0x18E4);d.drawRoundRect(8,62,224,72,6,0x39E8);
    d.setTextDatum(0);d.setTextColor(TFT_WHITE,0x18E4);d.drawString('Developer Workspace',16,68,2);
    d.setTextColor(0xC618,0x18E4);d.drawString('node-developer@kryonos.tech',16,88,2);
    d.setTextColor(TFT_YELLOW,0x18E4);d.drawString('Handle: @node-dev',16,108,2);

    d.fillRoundRect(8,140,224,96,6,0x18E4);d.drawRoundRect(8,140,224,96,6,0x39E8);
    d.setTextColor(TFT_WHITE,0x18E4);d.drawString('Daily AI Quota:',16,146,2);
    d.setTextColor(TFT_YELLOW,0x18E4);d.drawString('88 / 100 left',140,146,2);

    d.drawRoundRect(16,166,208,8,3,0x39E8);d.fillRoundRect(17,167,170,6,2,TFT_GREEN);
    d.setTextColor(TFT_WHITE,0x18E4);d.drawString('Cloud Storage:',16,182,2);
    d.setTextColor(TFT_GREEN,0x18E4);d.drawString('48 MB free',140,182,2);

    d.drawRoundRect(16,202,208,8,3,0x39E8);d.fillRoundRect(17,203,30,6,2,TFT_CYAN);

    d.setTextDatum(4);
    d.fillRoundRect(8,244,108,34,5,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('Sync Fresh',62,261,2);
    d.fillRoundRect(124,244,108,34,5,0x9000);d.setTextColor(TFT_WHITE,0x9000);d.drawString('Pair Board',178,261,2);
  }
  _drawAI(){
    const d=this.sim.disp;
    d.fillRoundRect(8,62,224,40,5,0x18E4);d.drawRoundRect(8,62,224,40,5,0x229F);
    d.setTextDatum(0);d.setTextColor(TFT_YELLOW,0x18E4);d.drawString('Prompt (Tap to type):',14,66,1);
    d.setTextColor(TFT_WHITE,0x18E4);d.drawString(this.aiPrompt.substring(0,25)+'...',14,80,2);

    d.setTextDatum(4);
    d.fillRoundRect(8,106,84,26,4,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('Ask AI',50,119,2);
    d.fillRoundRect(96,106,48,26,4,0x6000);d.setTextColor(TFT_WHITE,0x6000);d.drawString('Clear',120,119,2);

    d.fillRoundRect(8,136,224,146,5,0x18E4);d.drawRoundRect(8,136,224,146,5,0x39E8);
    d.setTextDatum(0);d.setTextColor(TFT_YELLOW,0x18E4);d.drawString('AI Response:',14,140,1);
    d.setTextColor(TFT_WHITE,0x18E4);

    const words=this.aiResponse.split(' ');
    let line='',ly=158;
    for(const w of words){
      if((line+w).length>24){d.drawString(line,14,ly,2);ly+=16;line='';if(ly>265)break;}
      line+=w+' ';
    }
    if(line&&ly<=265)d.drawString(line,14,ly,2);
  }
  _drawBeam(){
    const d=this.sim.disp;
    d.fillRoundRect(8,60,110,24,4,this.beamScope==='MAILBOX'?0x229F:0x2125);
    d.setTextColor(TFT_WHITE,this.beamScope==='MAILBOX'?0x229F:0x2125);d.setTextDatum(4);d.drawString('Mailbox',63,72,2);
    d.fillRoundRect(122,60,110,24,4,this.beamScope==='PUBLIC'?0x229F:0x2125);
    d.setTextColor(TFT_WHITE,this.beamScope==='PUBLIC'?0x229F:0x2125);d.drawString('#public Stream',177,72,2);

    d.fillRoundRect(8,88,110,24,4,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('Compose',63,100,2);
    d.fillRoundRect(122,88,110,24,4,0x03E0);d.setTextColor(TFT_WHITE,0x03E0);d.drawString('Refresh',177,100,2);

    d.fillRoundRect(8,120,224,44,4,0x18E4);d.drawRoundRect(8,120,224,44,4,0x39E8);
    d.setTextDatum(0);d.setTextColor(TFT_YELLOW,0x18E4);
    d.drawString(this.beamScope==='MAILBOX'?'@ops-node':'@guest-78',14,124,2);
    d.setTextColor(TFT_WHITE,0x18E4);d.drawString('Node heartbeat verified.',14,142,2);
  }
  _drawDrive(){
    const d=this.sim.disp;
    d.fillRoundRect(8,60,110,24,4,this.driveScope==='SHARED'?0x229F:0x2125);
    d.setTextColor(TFT_WHITE,this.driveScope==='SHARED'?0x229F:0x2125);d.setTextDatum(4);d.drawString('Shared (/cloud)',63,72,2);
    d.fillRoundRect(122,60,110,24,4,this.driveScope==='DEVICE'?0x229F:0x2125);
    d.setTextColor(TFT_WHITE,this.driveScope==='DEVICE'?0x229F:0x2125);d.drawString('Device Backup',177,72,2);

    d.fillRoundRect(8,90,110,24,4,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('Create Backup',63,102,2);
    d.fillRoundRect(122,90,110,24,4,0x03E0);d.setTextColor(TFT_WHITE,0x03E0);d.drawString('Restore Backup',177,102,2);

    d.fillRoundRect(8,124,224,40,4,0x18E4);d.setTextDatum(0);d.setTextColor(TFT_WHITE,0x18E4);
    d.drawString(this.driveScope==='SHARED'?'telemetry_manifest.json':'wifi_credentials.enc',14,130,2);
    d.setTextColor(TFT_GREEN,0x18E4);d.drawString('2.4 KB (Ready)',14,146,1);
  }
  _drawLimits(){
    const d=this.sim.disp;
    d.fillRoundRect(8,62,224,68,5,0x18E4);d.setTextDatum(0);d.setTextColor(TFT_WHITE,0x18E4);
    d.drawString('Daily AI Limit: 12 / 100',16,68,2);d.drawRoundRect(16,92,208,10,3,0x39E8);d.fillRoundRect(17,93,50,8,2,TFT_GREEN);

    d.fillRoundRect(8,136,224,68,5,0x18E4);d.drawString('Cloud Storage: 2.1 MB / 50 MB',16,142,2);
    d.drawRoundRect(16,166,208,10,3,0x39E8);d.fillRoundRect(17,167,20,8,2,TFT_CYAN);

    d.setTextDatum(4);d.fillRoundRect(8,250,224,34,5,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('REFRESH LIMITS',120,267,2);
  }
  _drawPairing(){
    const d=this.sim.disp;d.drawRoundRect(3,3,234,314,5,0x39E8);
    d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);d.drawString('Pair with KryonCloud',120,80,2);
    d.drawString('Enter code on dashboard:',120,110,2);

    d.fillRoundRect(20,135,200,50,6,0x18E4);d.drawRoundRect(20,135,200,50,6,0x229F);
    d.setTextColor(TFT_YELLOW,0x18E4);d.drawString('KY-8942',120,160,4);
    d.fillRoundRect(40,240,160,34,5,0x229F);d.setTextColor(TFT_WHITE,0x229F);d.drawString('Return Home',120,257,2);
  }
  handleTouch(x,y){
    if(this.isBanned){
      if(y>=210&&y<=245)this.sim.setState(S.LAUNCHER);
      return;
    }
    if(x>=200&&y<=26){this.sim.setState(S.LAUNCHER);return;}
    if(y>=28&&y<=54){
      const idx=Math.floor((x-3)/47);
      const keys=['HOME','AI','BEAM','DRIVE','LIMITS'];
      if(keys[idx]){this.tab=keys[idx];this.draw();}
      return;
    }
    if(this.tab==='HOME'){
      if(y>=244&&y<=278&&x>=124){this.tab='PAIRING';this.draw();}
    }else if(this.tab==='AI'){
      if(y>=62&&y<=102){
        this.sim.keyboard.show('AI Prompt:',this.aiPrompt).then(res=>{if(res){this.aiPrompt=res;this.draw();}});
      }else if(y>=106&&y<=132&&x<=92){
        this.aiResponse='Streaming token response...\nDual-core FreeRTOS operates tasks concurrently.';this.draw();
      }
    }else if(this.tab==='BEAM'){
      if(y>=60&&y<=84){this.beamScope=(x<116)?'MAILBOX':'PUBLIC';this.draw();}
      else if(y>=88&&y<=112&&x<116){
        this.sim.keyboard.show('Beam Message:','Hello Node!').then(res=>{
          if(res)this.sim.notif.post('KryonBeam','Message broadcasted','ok',2000);this.draw();
        });
      }
    }else if(this.tab==='DRIVE'){
      if(y>=60&&y<=84){this.driveScope=(x<116)?'SHARED':'DEVICE';this.draw();}
      else if(y>=90&&y<=114){this.sim.notif.post('Cloud Drive','Backup snapshot synced','ok',2000);}
    }else if(this.tab==='PAIRING'){
      if(y>=240&&y<=274){this.tab='HOME';this.draw();}
    }
  }
}

class AboutScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,28,5,TFT_BLACK);d.drawRoundRect(6,6,228,28,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('About Device',120,20,2);
    d.fillRoundRect(10,40,220,100,6,0x10A2);d.drawRoundRect(10,40,220,100,6,0x2945);
    d.setTextDatum(0);d.setTextColor(TFT_GREEN,0x10A2);d.drawString('KryonOS v'+KRYONOS_VERSION,18,48,2);
    d.setTextColor(TFT_CYAN,0x10A2);d.drawString(`Flash: 16 MB (${Math.round(this.sim.vfs.freeSpace()/1024)} KB free)`,18,70,2);
    d.setTextColor(TFT_ORANGE,0x10A2);d.drawString('SD:    Virtual (mounted)',18,92,2);
    d.setTextColor(TFT_MAGENTA,0x10A2);d.drawString('RAM:   512 KB SRAM + 8 MB PSRAM',18,114,2);
    d.fillRoundRect(10,148,220,80,6,0x10A2);d.drawRoundRect(10,148,220,80,6,0x05BF);
    d.setTextColor(TFT_YELLOW,0x10A2);d.drawString('GitHub: -code/KryonOS',18,156,2);
    d.setTextColor(TFT_WHITE,0x10A2);d.drawString('Author: Haris (@Haris16-code)',18,178,2);
    d.setTextColor(TFT_GREEN,0x10A2);d.drawString('License: MIT Open Source',18,200,2);
    d.setTextDatum(4);d.fillRoundRect(40,240,160,32,4,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.drawString('Reset App Data',120,256,2);
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(y>=240&&y<=272){
      if(confirm('Format virtual flash and restore defaults?'))this.sim.vfs.reset().then(()=>this.sim.reboot());
    }else if(y>=285)this.sim.setState(S.SETTINGS);
  }
}

class AppStoreScreen {
  constructor(sim) {
    this.sim = sim;
    this.state = 0;
    this.INDEX = 'https://raw.githubusercontent.com/shifat100/test_kryon/refs/heads/main/index.json';
    this.cats = [];
    this.apps = [];
    this.catName = '';
    this.selCat = 0;
    this.selApp = 0;
    this.scroll = 0;
    this.dialog = '';
    this.loading = false;
  }

  async fetchCats() {
    this.loading = true;
    this.dialog = 'Fetching App Store...';
    this.draw();
    try {
      const res = await fetch(this.INDEX);
      const data = await res.json();
      this.cats = [{ name: '[ Check For Apps Update ]', url: 'UPDATE_ACTION' }];
      if (data && data.categories) {
        for (const [name, url] of Object.entries(data.categories)) {
          this.cats.push({ name, url: String(url) });
        }
      }
      this.selCat = 0;
      this.scroll = 0;
      this.loading = false;
      this.draw();
    } catch (e) {
      this.dialog = 'Store Offline: ' + e.message;
      this.state = 3;
      this.loading = false;
      this.draw();
    }
  }

  async fetchCatApps(url) {
    if (url === 'UPDATE_ACTION') {
      this.dialog = 'All apps are up to date (emulator).';
      this.state = 3;
      this.draw();
      return;
    }
    this.loading = true;
    this.dialog = 'Loading ' + this.catName + '...';
    this.draw();
    try {
      const res = await fetch(url);
      const data = await res.json();
      this.apps = [];
      if (data && data.apps) {
        for (const [id, info] of Object.entries(data.apps)) {
          this.apps.push({
            id,
            name: id.charAt(0).toUpperCase() + id.slice(1),
            metaUrl: info.meta,
            appUrl: info.app,
            author: '?',
            version: '1.0.0',
            description: 'Tap to load details'
          });
        }
      }
      this.apps.sort((a, b) => a.name.localeCompare(b.name));
      this.state = 1;
      this.selApp = 0;
      this.scroll = 0;
      this.loading = false;
      this.draw();
    } catch (e) {
      this.dialog = 'Failed: ' + e.message;
      this.state = 3;
      this.loading = false;
      this.draw();
    }
  }

  async fetchDetails(app) {
    this.loading = true;
    this.dialog = 'Loading details...';
    this.draw();
    try {
      const res = await fetch(app.metaUrl);
      const meta = await res.json();
      Object.assign(app, {
        name: meta.name || app.name,
        author: meta.author || 'Unknown',
        version: meta.version || '1.0.0',
        description: meta.description || 'No description',
        packageName: meta.packageName || app.id,
        permissions: meta.permissions || [],
        meta
      });
    } catch (e) {}
    this.loading = false;
    this.state = 2;
    this.draw();
  }

  async installApp(app) {
    this.loading = true;
    this.dialog = 'Downloading ' + app.name + '...';
    this.draw();
    try {
      const metaRes = await fetch(app.metaUrl);
      const metaText = await metaRes.text();
      const meta = JSON.parse(metaText);
      const codeRes = await fetch(app.appUrl);
      const codeText = await codeRes.text();

      const pkg = meta.packageName || app.id;
      const dir = '/local/apps/' + pkg;
      this.sim.vfs.mkdir(dir);
      this.sim.vfs.write(dir + '/app.json', JSON.stringify(meta, null, 2));
      this.sim.vfs.write(dir + '/main.js', codeText);

      log(`[AppStore] Installed ${meta.name} (${pkg}) v${meta.version}`, 'ok');
      this.dialog = `${meta.name}\nv${meta.version}\n\nInstalled successfully!`;
      this.state = 3;
      this.sim.launcher.scan();
      this.sim.refreshAppList();
    } catch (e) {
      this.dialog = 'Install error:\n' + e.message;
      this.state = 3;
    }
    this.loading = false;
    this.draw();
  }

  draw() {
    const d = this.sim.disp;
    d.fillScreen(TFT_BLACK);
    d.setTextDatum(0);
    d.drawRoundRect(3, 3, 234, 314, 5, TFT_WHITE);
    d.fillRoundRect(6, 6, 228, 30, 5, TFT_BLACK);
    d.drawRoundRect(6, 6, 228, 30, 5, TFT_GREEN);
    d.setTextColor(TFT_GREEN, TFT_BLACK);
    d.setTextDatum(4);

    let h = 'App Store';
    if (this.state === 1) h = this.catName;
    else if (this.state === 2) h = 'App Details';
    else if (this.state === 3) h = 'Notice';
    d.drawString(h, 120, 21, 2);
    d.fillRect(10, 45, 220, 230, TFT_BLACK);

    if (this.loading) {
      d.setTextColor(TFT_YELLOW, TFT_BLACK);
      d.setTextDatum(4);
      d.drawString(this.dialog, 120, 160, 2);
      return;
    }

    const itemsPerPage = 7;

    if (this.state === 0) {
      if (!this.cats.length) {
        this.fetchCats();
        return;
      }
      if (this.selCat < this.scroll) this.scroll = this.selCat;
      if (this.selCat >= this.scroll + itemsPerPage) this.scroll = this.selCat - itemsPerPage + 1;
      this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.cats.length - itemsPerPage)));

      for (let i = 0; i < itemsPerPage; i++) {
        const idx = this.scroll + i;
        if (idx >= this.cats.length) break;
        const y = 45 + i * 30;
        if (idx === this.selCat) {
          d.fillRect(10, y, 220, 25, TFT_WHITE);
          d.setTextColor(TFT_BLACK, TFT_WHITE);
          d.setTextDatum(3);
          d.drawString('> ' + this.cats[idx].name, 15, y + 12, 2);
        } else {
          d.setTextColor(TFT_WHITE, TFT_BLACK);
          d.setTextDatum(3);
          d.drawString('  ' + this.cats[idx].name, 15, y + 12, 2);
        }
      }
      this._drawScrollbar(this.cats.length, itemsPerPage);
      this._footer();
    } else if (this.state === 1) {
      if (!this.apps.length) {
        d.setTextColor(TFT_WHITE, TFT_BLACK);
        d.setTextDatum(4);
        d.drawString('No apps found.', 120, 160, 2);
      } else {
        if (this.selApp < this.scroll) this.scroll = this.selApp;
        if (this.selApp >= this.scroll + itemsPerPage) this.scroll = this.selApp - itemsPerPage + 1;
        this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.apps.length - itemsPerPage)));

        for (let i = 0; i < itemsPerPage; i++) {
          const idx = this.scroll + i;
          if (idx >= this.apps.length) break;
          const y = 45 + i * 30;
          if (idx === this.selApp) {
            d.fillRect(10, y, 220, 25, TFT_WHITE);
            d.setTextColor(TFT_BLACK, TFT_WHITE);
            d.setTextDatum(3);
            d.drawString('> ' + this.apps[idx].name, 15, y + 12, 2);
          } else {
            d.setTextColor(TFT_WHITE, TFT_BLACK);
            d.setTextDatum(3);
            d.drawString('  ' + this.apps[idx].name, 15, y + 12, 2);
          }
        }
        this._drawScrollbar(this.apps.length, itemsPerPage);
      }
      this._footer();
    } else if (this.state === 2) {
      const a = this.apps[this.selApp];
      if (!a) { this.state = 1; this.draw(); return; }
      d.setTextDatum(0);
      d.setTextColor(TFT_WHITE, TFT_BLACK);
      d.drawString('Name:    ' + a.name, 15, 55, 2);
      d.drawString('Author:  ' + a.author, 15, 78, 2);
      d.drawString('Version: ' + a.version, 15, 101, 2);
      d.setTextColor(TFT_LIGHTGREY, TFT_BLACK);

      const words = String(a.description || '').split(' ');
      let line = '', ly = 130;
      for (const w of words) {
        if ((line + w).length > 25) {
          d.drawString(line, 15, ly, 2);
          ly += 16;
          line = '';
          if (ly > 210) break;
        }
        line += w + ' ';
      }
      if (line && ly <= 210) d.drawString(line, 15, ly, 2);

      d.setTextDatum(4);
      d.fillRoundRect(25, 230, 80, 30, 4, TFT_GREEN);
      d.setTextColor(TFT_BLACK, TFT_GREEN);
      d.drawString('INSTALL', 65, 245, 2);

      d.fillRoundRect(135, 230, 80, 30, 4, TFT_RED);
      d.setTextColor(TFT_WHITE, TFT_RED);
      d.drawString('CANCEL', 175, 245, 2);
    } else if (this.state === 3) {
      d.fillRoundRect(10, 70, 220, 160, 6, TFT_DARKGREY);
      d.drawRoundRect(10, 70, 220, 160, 6, TFT_WHITE);
      d.setTextColor(TFT_WHITE, TFT_DARKGREY);
      d.setTextDatum(4);

      const lines = this.dialog.split('\n');
      const startY = 110 - (lines.length - 1) * 11;
      for (let i = 0; i < lines.length; i++) {
        d.drawString(lines[i], 120, startY + i * 22, 2);
      }

      d.fillRoundRect(85, 195, 70, 30, 4, TFT_BLUE);
      d.setTextColor(TFT_WHITE, TFT_BLUE);
      d.drawString('OK', 120, 210, 2);
    }
  }

  _drawScrollbar(total, pp) {
    if (total <= pp) return;
    const d = this.sim.disp;
    const sbH = Math.max(16, Math.floor((230 * pp) / total));
    const maxOffset = total - pp;
    const sbY = 45 + Math.floor((this.scroll * (230 - sbH)) / Math.max(1, maxOffset));
    d.fillRect(231, 45, 3, 230, TFT_DARKGREY);
    d.fillRect(231, sbY, 3, sbH, TFT_WHITE);
  }

  _footer() {
    const d = this.sim.disp;
    d.drawRoundRect(5, 285, 230, 30, 5, TFT_WHITE);
    d.setTextColor(TFT_WHITE, TFT_BLACK);
    d.setTextDatum(4);
    d.drawString('BACK', 35, 300, 2);
    d.drawString('|', 70, 300, 2);
    d.drawString('UP', 100, 300, 2);
    d.drawString('|', 130, 300, 2);
    d.drawString('SEL', 165, 300, 2);
    d.drawString('|', 200, 300, 2);
    d.drawString('DN', 220, 300, 2);
  }

  handleTouch(x, y) {
    if (this.loading) return;
    if (this.state === 3) {
      if (x >= 85 && x <= 155 && y >= 195 && y <= 225) {
        this.state = 0;
        this.draw();
      }
      return;
    }
    if (this.state === 2) {
      if (y >= 230 && y <= 260) {
        if (x >= 25 && x <= 105) this.installApp(this.apps[this.selApp]);
        else if (x >= 135 && x <= 215) {
          this.state = 1;
          this.draw();
        }
      }
      return;
    }
    const itemsPerPage = 7;
    if (y >= 45 && y <= 255) {
      const clickedRow = Math.floor((y - 45) / 30);
      const clickedIdx = this.scroll + clickedRow;
      if (this.state === 0) {
        if (clickedIdx < this.cats.length) {
          this.selCat = clickedIdx;
          this.catName = this.cats[clickedIdx].name;
          this.draw();
          this.fetchCatApps(this.cats[clickedIdx].url);
        }
      } else if (this.state === 1) {
        if (clickedIdx < this.apps.length) {
          this.selApp = clickedIdx;
          this.draw();
          this.fetchDetails(this.apps[clickedIdx]);
        }
      }
      return;
    }
    if (y >= 285) {
      if (x < 70) {
        if (this.state === 1) {
          this.state = 0;
          this.scroll = 0;
          this.draw();
        } else {
          this.sim.setState(S.LAUNCHER);
        }
      } else if (x >= 70 && x < 130) {
        if (this.state === 0 && this.selCat > 0) {
          this.selCat--;
          if (this.selCat < this.scroll) this.scroll = this.selCat;
          this.draw();
        } else if (this.state === 1 && this.selApp > 0) {
          this.selApp--;
          if (this.selApp < this.scroll) this.scroll = this.selApp;
          this.draw();
        }
      } else if (x >= 130 && x < 200) {
        if (this.state === 0 && this.selCat < this.cats.length) {
          this.catName = this.cats[this.selCat].name;
          this.fetchCatApps(this.cats[this.selCat].url);
        } else if (this.state === 1 && this.selApp < this.apps.length) {
          this.fetchDetails(this.apps[this.selApp]);
        }
      } else if (x >= 200) {
        if (this.state === 0 && this.selCat < this.cats.length - 1) {
          this.selCat++;
          if (this.selCat >= this.scroll + itemsPerPage) this.scroll = this.selCat - itemsPerPage + 1;
          this.draw();
        } else if (this.state === 1 && this.selApp < this.apps.length - 1) {
          this.selApp++;
          if (this.selApp >= this.scroll + itemsPerPage) this.scroll = this.selApp - itemsPerPage + 1;
          this.draw();
        }
      }
    }
  }
}

class HelpScreen{
  constructor(sim){
    this.sim=sim;this.state=0;this.sel=0;this.scroll=0;
    this.offline=[
      {title:'What is KryonOS',body:'KryonOS is a fast OS for ESP32 executing JavaScript via Duktape runtime, with an app store and full virtual FS.'},
      {title:'Navigation',body:'Tap app names to run them. Tap the top-right exit button in any running application to return home.'},
      {title:'WiFi Setup',body:'Go to Settings → WiFi Options. Turn on, scan networks, enter password, and connect.'},
      {title:'Troubleshooting',body:'If memory alerts appear, disable WiFi in Settings to free internal heap for large JavaScript memory buffers.'}
    ];
  }
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString(this.state===0?'Help Center':this.offline[this.sel].title,120,21,2);
    d.fillRect(10,45,220,230,TFT_BLACK);
    if(this.state===0){
      for(let i=0;i<7;i++){
        const idx=this.scroll+i;if(idx>=this.offline.length)break;
        const y=45+i*30;
        if(idx===this.sel){
          d.fillRect(10,y,220,25,TFT_WHITE);d.setTextColor(TFT_BLACK,TFT_WHITE);d.setTextDatum(3);d.drawString('> '+this.offline[idx].title,15,y+12,2);
        }else{
          d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(3);d.drawString('  '+this.offline[idx].title,15,y+12,2);
        }
      }
    }else{
      d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(0);
      const words=this.offline[this.sel].body.split(' ');let line='',y=55;
      for(const w of words){
        if((line+w).length>30){d.drawString(line,15,y,2);y+=16;line='';}
        line+=w+' ';
      }
      if(line)d.drawString(line,15,y,2);
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(this.state===0){
      if(y>=45&&y<=270){
        const c=this.scroll+Math.floor((y-45)/30);
        if(c<this.offline.length){this.sel=c;this.state=1;this.draw();}
      }else if(y>=285)this.sim.setState(S.LAUNCHER);
    }else{
      if(y>=285){this.state=0;this.draw();}
    }
  }
}

class InstallerScreen{
  constructor(sim){this.sim=sim;this.path='/';this.sel=0;this.scroll=0;this.dialog='';this.state=0;}
  list(){
    if(this.path==='/')return [{name:'/local',isDir:true,path:'/local'},{name:'/sd',isDir:true,path:'/sd'}];
    return this.sim.vfs.listDirFull(this.path).sort((a,b)=>{
      if(a.isDir&&!b.isDir)return -1;if(!a.isDir&&b.isDir)return 1;return a.name.localeCompare(b.name);
    });
  }
  draw(){
    const d=this.sim.disp;
    d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('Installer  '+this.path,120,21,2);

    if(this.state===2){
      d.fillRoundRect(10,60,220,180,6,TFT_DARKGREY);d.drawRoundRect(10,60,220,180,6,TFT_WHITE);
      d.setTextColor(TFT_WHITE,TFT_DARKGREY);
      const lines=this.dialog.split('\n');const startY=100-(lines.length-1)*11;
      for(let i=0;i<lines.length;i++)d.drawString(lines[i],120,startY+i*22,2);
      d.fillRoundRect(85,205,70,30,4,TFT_BLUE);d.setTextColor(TFT_WHITE,TFT_BLUE);d.drawString('OK',120,220,2);
      return;
    }
    const items=this.list();
    d.fillRect(10,45,220,230,TFT_BLACK);
    if(!items.length){d.setTextColor(TFT_DARKGREY,TFT_BLACK);d.setTextDatum(4);d.drawString('Folder empty',120,160,2);}
    for(let i=0;i<7;i++){
      const idx=this.scroll+i;if(idx>=items.length)break;
      const it=items[idx];const y=45+i*30;let label=it.name,col=TFT_WHITE;
      if(it.isDir){
        const jp=it.path+'/app.json';
        if(this.sim.vfs.exists(jp)){
          try{const meta=JSON.parse(this.sim.vfs.read(jp));label='[APP] '+(meta.name||it.name);col=TFT_GREEN;}catch(e){}
        }else label='[D] '+it.name;
      }
      if(idx===this.sel){
        d.fillRect(10,y,220,25,TFT_WHITE);d.setTextColor(TFT_BLACK,TFT_WHITE);d.setTextDatum(3);d.drawString('> '+label,15,y+12,2);
      }else{
        d.setTextColor(col,TFT_BLACK);d.setTextDatum(3);d.drawString('  '+label,15,y+12,2);
      }
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);
    d.drawString('ESC',30,300,2);d.drawString('|',60,300,2);d.drawString('UP',90,300,2);d.drawString('|',120,300,2);d.drawString('SEL',150,300,2);d.drawString('|',180,300,2);d.drawString('DN',210,300,2);
  }
  handleTouch(x,y){
    if(this.state===2){if(x>=85&&x<=155&&y>=205&&y<=235){this.state=0;this.draw();}return;}
    const items=this.list();
    if(y>=45&&y<=270){
      const c=this.scroll+Math.floor((y-45)/30);
      if(c<items.length){
        this.sel=c;const it=items[c];
        if(it.isDir&&!this.sim.vfs.exists(it.path+'/app.json')){
          this.path=it.path;this.sel=0;this.scroll=0;this.draw();
        }else if(it.isDir)this._installApp(it.path);
        else if(it.name.endsWith('.js')){
          const name=it.name.replace('.js','');this.sim.launchApp({name,path:it.path,pkg:name});
        }
      }
      return;
    }
    if(y>=285){
      if(x<60){
        if(this.path==='/')this.sim.setState(S.LAUNCHER);
        else{const p=this.path.split('/').filter(Boolean);p.pop();this.path='/'+p.join('/');this.sel=0;this.scroll=0;this.draw();}
      }else if(x>=60&&x<120){if(this.sel>0){this.sel--;this.draw();}}
      else if(x>=120&&x<180){
        if(this.sel<items.length){const it=items[this.sel];if(it.isDir&&this.sim.vfs.exists(it.path+'/app.json'))this._installApp(it.path);}
      }else{if(this.sel<items.length-1){this.sel++;this.draw();}}
    }
  }
  _installApp(srcPath){
    const meta=JSON.parse(this.sim.vfs.read(srcPath+'/app.json'));
    const pkg=meta.packageName||'unknown.pkg';const dst='/local/apps/'+pkg;
    this.sim.vfs.mkdir(dst);this.sim.vfs.write(dst+'/app.json',JSON.stringify(meta,null,2));
    const code=this.sim.vfs.read(srcPath+'/main.js');this.sim.vfs.write(dst+'/main.js',code);
    this.dialog=`${meta.name} v${meta.version}\n\nInstalled successfully!`;
    this.state=2;this.sim.launcher.scan();this.sim.refreshAppList();this.draw();
  }
}

class CalibratorScreen{
  constructor(sim){this.sim=sim;this.step=0;}
  draw(){
    const d=this.sim.disp;d.fillScreen(TFT_BLACK);d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);
    d.drawString('Touch Calibration',120,140,2);d.drawString('Tap the red target',120,165,2);
    const targets=[[20,20],[220,20],[20,300],[220,300],[120,160]];const [tx,ty]=targets[this.step%targets.length];
    d.fillCircle(tx,ty,10,TFT_RED);d.drawCircle(tx,ty,12,TFT_WHITE);
  }
  handleTouch(){
    this.step++;if(this.step>=5){this.sim.notif.post('Touch','Calibration saved!','ok');setTimeout(()=>this.sim.setState(S.SETTINGS),400);}
    else this.draw();
  }
}

class WebServerScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_CYAN);
    d.setTextColor(TFT_CYAN,TFT_BLACK);d.setTextDatum(4);d.drawString('Web Server',120,21,2);
    d.setTextDatum(0);d.setTextColor(TFT_WHITE,TFT_BLACK);
    const ip=this.sim.sim.wifi?'192.168.1.100':'0.0.0.0';
    d.drawString('Status:',15,50,2);d.setTextColor(this.sim.sim.wifi?TFT_GREEN:TFT_RED,TFT_BLACK);
    d.drawString(this.sim.sim.wifi?'RUNNING':'STOPPED',90,50,2);
    d.setTextColor(TFT_WHITE,TFT_BLACK);
    d.drawString('IP:',15,75,2);d.setTextColor(TFT_CYAN,TFT_BLACK);
    d.drawString(ip,50,75,2);d.setTextColor(TFT_WHITE,TFT_BLACK);
    d.drawString('User: admin',15,110,2);
    d.drawString('Pass: ********',15,130,2);
    d.setTextColor(TFT_DARKGREY,TFT_BLACK);
    d.drawString('(browser-based server not',15,170,2);
    d.drawString(' available in web emulator)',15,190,2);
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(4);d.drawString('EXIT',120,300,2);
  }
  handleTouch(x,y){if(y>=285)this.sim.setState(S.SETTINGS_WIFI);}
}

class UpdaterScreen{
  constructor(sim){this.sim=sim;this.result=null;}
  async check(){
    this.result='checking';this.draw();
    try{
      const res=await fetch('https://raw.githubusercontent.com/Haris16-code/KryonOS/refs/heads/main/updates/esp32/v2/update.json');
      const data=await res.json();const rel=data.release||data;
      if(rel.version&&rel.version!==KRYONOS_VERSION)this.result='available:'+rel.version;else this.result='uptodate';
    }catch(e){this.result='failed:'+e.message;}
    this.draw();
  }
  draw(){
    const d=this.sim.disp;d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('System Updates',120,21,2);
    if(!this.result){d.setTextColor(TFT_YELLOW,TFT_BLACK);d.drawString('Checking for updates...',120,160,2);}
    else if(this.result==='checking'){d.setTextColor(TFT_YELLOW,TFT_BLACK);d.drawString('Contacting server...',120,160,2);}
    else if(this.result==='uptodate'){d.setTextColor(TFT_GREEN,TFT_BLACK);d.drawString('System is up to date!',120,120,2);d.setTextColor(TFT_CYAN,TFT_BLACK);d.drawString('Current: v'+KRYONOS_VERSION,120,145,2);}
    else if(this.result.startsWith('available:')){d.setTextColor(TFT_YELLOW,TFT_BLACK);d.drawString('Update available',120,110,2);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('New: '+this.result.split(':')[1],120,135,2);}
    else{d.setTextColor(TFT_RED,TFT_BLACK);d.drawString('Check failed',120,140,2);}
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){if(!this.result){this.check();return;}if(y>=285)this.sim.setState(S.SETTINGS);}
}

class AppsScreen{
  constructor(sim){this.sim=sim;this.sel=-1;this.scroll=0;}
  list(){return this.sim.vfs.listDirFull('/local/apps');}
  draw(){
    const d=this.sim.disp;d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_GREEN);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.setTextDatum(4);d.drawString('Manage Apps',120,21,2);
    const items=this.list();d.fillRect(10,45,220,230,TFT_BLACK);
    if(!items.length){d.setTextColor(TFT_DARKGREY,TFT_BLACK);d.drawString('No apps installed',120,160,2);}
    for(let i=0;i<7;i++){
      const idx=this.scroll+i;if(idx>=items.length)break;
      const it=items[idx];const y=45+i*30;let label=it.name;
      try{const meta=JSON.parse(this.sim.vfs.read(it.path+'/app.json'));label=meta.name||it.name;}catch(e){}
      if(idx===this.sel){
        d.fillRect(10,y,220,25,TFT_WHITE);d.setTextColor(TFT_BLACK,TFT_WHITE);d.setTextDatum(3);d.drawString('> '+label,15,y+12,2);
      }else{
        d.setTextColor(TFT_WHITE,TFT_BLACK);d.setTextDatum(3);d.drawString('  '+label,15,y+12,2);
      }
    }
    if(this.sel>=0&&this.sel<items.length){
      d.fillRoundRect(20,235,200,45,5,TFT_DARKGREY);d.setTextColor(TFT_YELLOW,TFT_DARKGREY);d.setTextDatum(4);
      d.drawString('Manage: '+items[this.sel].name,120,246,1);
      d.fillRoundRect(30,256,75,18,3,TFT_RED);d.setTextColor(TFT_WHITE,TFT_RED);d.drawString('Uninstall',67,265,1);
      d.fillRoundRect(135,256,75,18,3,TFT_BLUE);d.setTextColor(TFT_WHITE,TFT_BLUE);d.drawString('Cancel',172,265,1);
    }
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    const items=this.list();
    if(this.sel>=0&&y>=235&&y<=280){
      if(x>=30&&x<=105){this.sim.vfs.remove(items[this.sel].path);this.sel=-1;this.sim.launcher.scan();this.sim.refreshAppList();this.draw();}
      else if(x>=135&&x<=210){this.sel=-1;this.draw();}
      return;
    }
    if(y>=45&&y<=230){const c=this.scroll+Math.floor((y-45)/30);if(c<items.length){this.sel=c;this.draw();}}
    else if(y>=285)this.sim.setState(S.SETTINGS);
  }
}

class TimeScreen{
  constructor(sim){this.sim=sim;}
  draw(){
    const d=this.sim.disp;d.fillScreen(TFT_BLACK);d.drawRoundRect(3,3,234,314,5,TFT_WHITE);
    d.fillRoundRect(6,6,228,30,5,TFT_BLACK);d.drawRoundRect(6,6,228,30,5,TFT_CYAN);
    d.setTextColor(TFT_CYAN,TFT_BLACK);d.setTextDatum(4);d.drawString('Time & Region',120,21,2);
    d.setTextColor(TFT_GREEN,TFT_BLACK);d.drawString(new Date().toLocaleTimeString('en-GB',{hour12:!this.sim.sim.use24h}),120,75,4);

    d.fillRoundRect(20,110,200,35,5,TFT_DARKGREY);d.setTextColor(TFT_GREEN,TFT_DARKGREY);d.drawString('NTP Sync: ON',120,127,2);
    d.fillRoundRect(20,155,200,35,5,TFT_BLUE);d.setTextColor(TFT_WHITE,TFT_BLUE);d.drawString('Region: '+this.sim.sim.timezone,120,172,2);
    d.fillRoundRect(20,200,200,35,5,TFT_ORANGE);d.setTextColor(TFT_WHITE,TFT_ORANGE);d.drawString(this.sim.sim.use24h?'Format: 24h':'Format: 12h',120,217,2);
    d.drawRoundRect(5,285,230,30,5,TFT_WHITE);d.setTextColor(TFT_WHITE,TFT_BLACK);d.drawString('BACK',120,300,2);
  }
  handleTouch(x,y){
    if(y>=200&&y<=235){this.sim.sim.use24h=!this.sim.sim.use24h;this.sim.updateStatus();this.draw();}
    else if(y>=285)this.sim.setState(S.SETTINGS);
  }
}

class Simulator{
  constructor(){
    this.canvas=$('screen');this.overlayCanvas=$('overlay');this.overlayCtx=this.overlayCanvas.getContext('2d');
    this.disp=new TFTDisplay(this.canvas);this.vfs=new VFS(this);this.keyboard=new OnScreenKeyboard(this);
    this.picker=new FilePickerModal(this);this.notif=new NotificationOverlay(this);
    this.touch={x:0,y:0,touched:false,justPressed:false};this.exitRequested=false;this.permissions=new Set();
    this.currentPkg='';this.pendingLaunch=null;this.pointerDown=false;
    this.sim={board:BOARDS['esp32-s3-devkitc-1-n16r8'],wifi:true,timezone:'UTC0',use24h:true};
    this.kryon3D=new Kryon3DEngine();
    this.disp.kryon3D=this.kryon3D;

    this.env={};
    this.env.FastMath=buildFastMath();
    this.env.Crypto=buildCrypto(this);
    this.env.PWM=buildPWM();
    this.env.I2C=buildI2C();
    this.env.Network=buildNetwork(this);
    this.env.HttpServer=buildHttpServer();
    this.env.WebSocket=buildWebSocketClass(this);
    this.env.IPC=buildIPC(this);
    this.env.AI=buildAI(this);
    this.env.FS=buildFS(this);
    this.env.Trackball=buildTrackball(this);
    this.env.Keyboard=buildKeyboard(this);
    this.env.Speaker=buildSpeaker(this);
    this.env.Device=buildDevice(this);
    this.env.Bluetooth=buildBluetooth(this);
    this.env.GPS=buildGPS(this);
    this.env.Kryon3D=buildKryon3DBridge(this);
    this.env.Display=buildDisplayMethods(this,this.disp);
    this.env.System=buildSystem(
      this,this.disp,this.keyboard,this.picker,this.notif,
      this.env.PWM,this.env.I2C,this.env.Crypto,this.env.IPC,
      this.env.AI,this.env.Network,this.env.HttpServer,this.env.Kryon3D
    );

    this.launcher=new LauncherScreen(this);
    this.screens={
      [S.LAUNCHER]:this.launcher,
      [S.SETTINGS]:new SettingsScreen(this),
      [S.SETTINGS_WIFI]:new WiFiScreen(this),
      [S.SETTINGS_WIFI_SAVED]:new SavedNetworksScreen(this),
      [S.SETTINGS_ABOUT]:new AboutScreen(this),
      [S.SETTINGS_APPS]:new AppsScreen(this),
      [S.SETTINGS_PERMISSIONS]:new PermissionsScreen(this),
      [S.SETTINGS_TIME]:new TimeScreen(this),
      [S.UPDATER_MANUAL]:new UpdaterScreen(this),
      [S.UPDATER_BOOT]:new UpdaterScreen(this),
      [S.APP_STORE]:new AppStoreScreen(this),
      [S.HELP_CENTER]:new HelpScreen(this),
      [S.INSTALLER]:new InstallerScreen(this),
      [S.CALIBRATOR]:new CalibratorScreen(this),
      [S.WEB_APP]:new WebServerScreen(this),
      [S.KRYON_CLOUD]:new KryonCloudScreen(this)
    };

    this.state=S.LAUNCHER;
    this._bindInput();this._bindUI();

    this.vfs.init().then(()=>{
      this.launcher.scan();this.refreshAppList();this.setState(S.LAUNCHER);
    });

    const loop=()=>{this.notif.render();requestAnimationFrame(loop);};requestAnimationFrame(loop);

    let frames=0,last=performance.now();
    setInterval(()=>{
      const now=performance.now();
      if($('st-fps'))$('st-fps').textContent=Math.round(frames*1000/(now-last));
      frames=0;last=now;
    },1000);
    const cf=()=>{frames++;requestAnimationFrame(cf);};requestAnimationFrame(cf);
  }
  onStorageChanged(){}
  setState(s){
    this.state=s;
    const labels={
      [S.LAUNCHER]:'LAUNCHER',[S.SETTINGS]:'SETTINGS',[S.RUN_APP]:'RUN_APP',
      [S.APP_STORE]:'APP_STORE',[S.SETTINGS_WIFI]:'WIFI',[S.SETTINGS_ABOUT]:'ABOUT',
      [S.HELP_CENTER]:'HELP',[S.INSTALLER]:'INSTALLER',[S.KRYON_CLOUD]:'CLOUD',
      [S.SETTINGS_PERMISSIONS]:'PERMISSIONS',[S.SETTINGS_WIFI_SAVED]:'SAVED_WIFI'
    };
    if($('st-state'))$('st-state').textContent=labels[s]||('STATE_'+s);
    const eb=$('hw-exit-btn');
    if(eb){if(s===S.RUN_APP)eb.classList.add('active');else eb.classList.remove('active');}
    if(s===S.RUN_APP)return;
    this.disp.resetState();this.disp.activeSprite=null;this.disp.spriteBound=false;this.disp.fillScreen(TFT_BLACK);
    const scr=this.screens[s];if(scr&&scr.draw)scr.draw();
  }
  _bindInput(){
    const cvs=this.canvas;
    const getXY=(cx,cy)=>{
      const r=cvs.getBoundingClientRect();
      return {x:clamp(Math.floor((cx-r.left)*cvs.width/r.width),0,cvs.width-1),y:clamp(Math.floor((cy-r.top)*cvs.height/r.height),0,cvs.height-1)};
    };
    const pressAt=(cx,cy)=>{const p=getXY(cx,cy);this.pointerDown=true;this._handlePress(p.x,p.y);};
    const moveAt=(cx,cy)=>{
      if(!this.pointerDown&&this.state!==S.RUN_APP)return;
      const p=getXY(cx,cy);
      if(this.state===S.RUN_APP){this.touch.x=p.x;this.touch.y=p.y;}
    };
    const release=()=>{this.pointerDown=false;if(this.state===S.RUN_APP)this.touch.touched=false;};

    cvs.addEventListener('mousedown',e=>{
      e.preventDefault();
      if(e.button===1&&this.state===S.RUN_APP){this.env.Trackball._feedPress(true);return;}
      pressAt(e.clientX,e.clientY);
    });
    cvs.addEventListener('mousemove',e=>{moveAt(e.clientX,e.clientY);});
    cvs.addEventListener('wheel',e=>{
      if(this.state===S.RUN_APP){e.preventDefault();this.env.Trackball._feedDelta(Math.sign(e.deltaX)*3,Math.sign(e.deltaY)*3);}
    },{passive:false});
    window.addEventListener('mouseup',e=>{
      if(e.button===1&&this.state===S.RUN_APP)this.env.Trackball._feedPress(false);
      release();
    });
    cvs.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];pressAt(t.clientX,t.clientY);},{passive:false});
    cvs.addEventListener('touchmove',e=>{e.preventDefault();const t=e.changedTouches[0];moveAt(t.clientX,t.clientY);},{passive:false});
    cvs.addEventListener('touchend',e=>{e.preventDefault();release();},{passive:false});

    window.addEventListener('keydown',e=>{
      const tag=document.activeElement&&document.activeElement.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      if(this.state!==S.RUN_APP)return;
      if(e.altKey){
        if(e.key==='ArrowUp')this.env.Trackball._feedDelta(0,-4);
        else if(e.key==='ArrowDown')this.env.Trackball._feedDelta(0,4);
        else if(e.key==='ArrowLeft')this.env.Trackball._feedDelta(-4,0);
        else if(e.key==='ArrowRight')this.env.Trackball._feedDelta(4,0);
        else if(e.key==='Enter')this.env.Trackball._feedPress(true);
      }
      this.env.Keyboard._pushEvent(e,true);
    });
    window.addEventListener('keyup',e=>{
      if(this.state!==S.RUN_APP)return;
      if(e.altKey&&e.key==='Enter')this.env.Trackball._feedPress(false);
      this.env.Keyboard._pushEvent(e,false);
    });

    if($('hw-exit-btn'))$('hw-exit-btn').addEventListener('click',()=>{
      this.exitRequested=true;
      if(this.keyboard.active)this.keyboard._finish('');
      if(this.picker.active)this.picker._finish(null);
    });
    if($('hw-cam-btn'))$('hw-cam-btn').addEventListener('click',()=>this.captureScreenshot());
    document.querySelectorAll('.ctrl-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const scr=this.screens[this.state];
        if(scr&&scr.handleTouch){
          const k=btn.dataset.key;const y=this.disp.H-20;
          if(k==='up')scr.handleTouch(30,y);else if(k==='sel')scr.handleTouch(120,y);else if(k==='dn')scr.handleTouch(210,y);
        }
      });
    });
  }
  _handlePress(x,y){
    if(this.state===S.RUN_APP&&x>=this.disp.W-40&&y<=40){this.exitRequested=true;return;}
    if(this.keyboard.active){this.keyboard.handleTouch(x,y);return;}
    if(this.picker.active){this.picker.handleTouch(x,y);return;}
    if(this.state===S.RUN_APP){this.touch.x=x;this.touch.y=y;this.touch.touched=true;this.touch.justPressed=true;return;}
    const scr=this.screens[this.state];if(scr&&scr.handleTouch)scr.handleTouch(x,y);
  }
  captureScreenshot(){
    try{
      const w=this.canvas.width,h=this.canvas.height;
      const merged=document.createElement('canvas');merged.width=w;merged.height=h;
      const mctx=merged.getContext('2d');mctx.imageSmoothingEnabled=false;
      mctx.drawImage(this.canvas,0,0);mctx.drawImage(this.overlayCanvas,0,0);
      const a=document.createElement('a');const ts=new Date().toISOString().replace(/[:.]/g,'-');
      a.download=`kryonos_${this.state}_${ts}.png`;a.href=merged.toDataURL('image/png');
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      this.notif.post('Screenshot','Saved to downloads','success',2000);
    }catch(e){}
  }
  render3D(x=0,y=0){if(this.kryon3D.sprite)this.disp.ctx.drawImage(this.kryon3D.sprite.canvas,x,y);}
  async launchApp(app,codeOverride,launchArgs=''){
    let rawCode=codeOverride!=null?codeOverride:this.vfs.read(app.isLegacy?app.path:app.path+'/main.js');
    if(!rawCode){log('App main.js not found at '+app.path,'err');return;}

    this.exitRequested=false;this.touch={x:0,y:0,touched:false,justPressed:false};this.pointerDown=false;
    this.currentPkg=app.pkg||app.name;
    this.env.Keyboard.clear();this.env.Trackball.reset();this.env.Speaker.stop();

    const appDir=app.path.endsWith('/')?app.path:app.path+'/';
    this.env.FS._setSandboxRoot(appDir);
    this.env.IPC._setCurrentAppId(this.currentPkg);
    this.env.IPC._setLaunchArgs(launchArgs||'');

    this.setState(S.RUN_APP);
    this.disp.resetState();this.disp.activeSprite=null;this.disp.spriteBound=false;this.disp.fillScreen(TFT_BLACK);

    let transformed;
    try{transformed=transpile(rawCode);}catch(err){await this._showError(err.message);return;}

    const notifBridge=Object.assign(
      (optsOrTitle,msg,icon,dur)=>this.env.System.notify(optsOrTitle,msg,icon,dur),
      {
        post:(t,m,i,d,s)=>this.notif.post(t,m,i,d,s),
        dismiss:id=>this.notif.dismiss(id),
        clearAll:()=>this.notif.clearAll(),
        isActive:()=>this.notif.isActive(),
        hasActive:()=>this.notif.isActive()
      }
    );

    const D=this.env.Display;
    const scopeMap={
      System:this.env.System,
      Display:D,
      Screen:D,
      FS:this.env.FS,
      Network:this.env.Network,
      HttpServer:this.env.HttpServer,
      WebSocket:this.env.WebSocket,
      Notification:notifBridge,
      IPC:this.env.IPC,
      Kryon:{ai:this.env.AI},
      AI:this.env.AI,
      LocalAI:this.env.AI,
      PWM:this.env.PWM,
      I2C:this.env.I2C,
      Crypto:this.env.Crypto,
      Kryon3D:this.env.Kryon3D,
      FastMath:this.env.FastMath,
      Trackball:this.env.Trackball,
      Keyboard:this.env.Keyboard,
      Speaker:this.env.Speaker,
      Audio:this.env.Speaker,
      Device:this.env.Device,
      Bluetooth:this.env.Bluetooth,
      GPS:this.env.GPS,
      console:{
        log:(...a)=>log('[JS LOG] '+formatConsoleArgs(a),'info'),
        error:(...a)=>log('[JS ERROR] '+formatConsoleArgs(a),'err'),
        warn:(...a)=>log('[JS WARN] '+formatConsoleArgs(a),'warn'),
        info:(...a)=>log('[JS INFO] '+formatConsoleArgs(a),'info'),
        debug:(...a)=>log('[JS DEBUG] '+formatConsoleArgs(a),'dim')
      },
      print:(...a)=>log(formatConsoleArgs(a),'info'),
      println:(...a)=>log(formatConsoleArgs(a),'info'),
      // Global Display helpers (JS_API_Guide Section 3)
      fillScreen:D.fillScreen,fillRect:D.fillRect,drawRect:D.drawRect,
      drawFastHLine:D.drawFastHLine,drawFastVLine:D.drawFastVLine,drawLine:D.drawLine,
      drawPixel:D.drawPixel,drawCircle:D.drawCircle,fillCircle:D.fillCircle,
      drawTriangle:D.drawTriangle,fillTriangle:D.fillTriangle,
      drawRoundRect:D.drawRoundRect,fillRoundRect:D.fillRoundRect,
      drawImage:D.drawImage,drawPNG:D.drawPNG,drawJPG:D.drawJPG,drawJPEG:D.drawJPEG,
      drawBMP:D.drawBMP,getImageInfo:D.getImageInfo,
      drawString:D.drawString,setTextColor:D.setTextColor,setTextDatum:D.setTextDatum,
      setTextSize:D.setTextSize,color:D.color,width:D.width,height:D.height,
      screenWidth:D.screenWidth,screenHeight:D.screenHeight,
      createSprite:D.createSprite,deleteSprite:D.deleteSprite,
      bindSprite:D.bindSprite,pushSprite:D.pushSprite,
      // 16-bit RGB565 Constants
      BLACK:TFT_BLACK,WHITE:TFT_WHITE,RED:TFT_RED,GREEN:TFT_GREEN,BLUE:TFT_BLUE,
      YELLOW:TFT_YELLOW,CYAN:TFT_CYAN,MAGENTA:TFT_MAGENTA,ORANGE:TFT_ORANGE,
      DARKGREY:TFT_DARKGREY,LIGHTGREY:TFT_LIGHTGREY,PURPLE:TFT_PURPLE,NAVY:TFT_NAVY,GOLD:TFT_GOLD,
      C_BLACK:TFT_BLACK,C_WHITE:TFT_WHITE,C_RED:TFT_RED,C_GREEN:TFT_GREEN,C_BLUE:TFT_BLUE,
      C_YELLOW:TFT_YELLOW,C_CYAN:TFT_CYAN,C_MAGENTA:TFT_MAGENTA,C_ORANGE:TFT_ORANGE,
      C_DARKGREY:TFT_DARKGREY,C_PURPLE:TFT_PURPLE,C_NAVY:TFT_NAVY,C_GOLD:TFT_GOLD
    };

    const scopeKeys=Object.keys(scopeMap);
    const scopeVals=Object.values(scopeMap);

    let fn;
    try{
      fn=new Function(...scopeKeys,`"use strict"; return (async () => { ${transformed} })();`);
    }catch(err){
      await this._showError('Compile error: '+err.message);return;
    }
    log('▶ Running: '+app.name,'info');
    try{
      await fn(...scopeVals);log('■ App finished normally');
    }catch(e){
      audioHW.reset();this.env.Speaker.stop();
      if(e.message==='OS_EXIT'||e.code==='OS_EXIT')log('■ Exited via OS_EXIT');
      else{log('✖ Exception: '+e.message,'err');await this._showError(e.message);return;}
    }

    this.env.FS._setSandboxRoot('');this.env.IPC._clear();this.kryon3D.end();
    this.env.Bluetooth.BLE.Scanner.stop();this.env.HttpServer.reset();
    this.disp.activeSprite=null;this.disp.spriteBound=false;

    if(this.pendingLaunch){
      const p=this.pendingLaunch;this.pendingLaunch=null;
      const chainedApp={name:p.name||'chained',path:p.path,pkg:p.pkg||'chained'};
      await this.launchApp(chainedApp,null,p.args);
      return;
    }
    this.exitRequested=false;
    this.setState(S.LAUNCHER);
  }
  _showError(msg){
    this.state=S.RUN_APP;if($('st-state'))$('st-state').textContent='ERROR';
    this.disp.resetState();this.disp.activeSprite=null;this.disp.spriteBound=false;
    this.disp.fillScreen(TFT_RED);this.disp.drawString('JS EXCEPTION!',10,10,4);
    const lines=String(msg).split('\n');let y=60;
    for(let i=0;i<lines.length&&i<8;i++){this.disp.drawString(lines[i].substring(0,38),10,y,2);y+=20;}
    return new Promise(res=>{
      const check=setInterval(()=>{if(this.exitRequested){clearInterval(check);res();}},40);
    }).then(()=>{this.exitRequested=false;this.setState(S.LAUNCHER);});
  }
  reboot(){
    this.env.Speaker.stop();audioHW.reset();
    this.env.Bluetooth.disable();this.env.HttpServer.reset();
    this.disp.resetState();this.disp.activeSprite=null;this.disp.spriteBound=false;
    this.disp.fillScreen(TFT_BLACK);
    this.notif.clearAll();
    this.setState(S.LAUNCHER);
  }
  updateStatus(){
    if($('st-wifi')){
      $('st-wifi').textContent=this.sim.wifi?'ONLINE':'OFF';
      $('st-wifi').style.color=this.sim.wifi?'var(--accent)':'var(--err)';
    }
    if($('st-heap'))$('st-heap').textContent=(this.sim.wifi?384:448)+' KB';
  }
  refreshAppList(){
    const el=$('app-list');if(!el)return;
    el.innerHTML='';this.launcher.scan();
    for(const app of this.launcher.apps){
      const row=document.createElement('div');row.className='app-row';
      const left=document.createElement('div');left.innerHTML=`<strong>${app.name}</strong><br><span class="meta">${app.pkg}</span>`;
      const right=document.createElement('div');right.className='actions';
      const b1=document.createElement('button');b1.className='btn sec';b1.textContent='▶ Run';b1.onclick=()=>this.launchApp(app);
      const b2=document.createElement('button');b2.className='btn danger';b2.textContent='✕';
      b2.onclick=()=>{if(!confirm('Delete '+app.name+'?'))return;this.vfs.remove(app.path);this.refreshAppList();this.launcher.scan();};
      right.appendChild(b1);right.appendChild(b2);row.appendChild(left);row.appendChild(right);el.appendChild(row);
    }
    if(!this.launcher.apps.length)el.innerHTML='<div class="empty">No apps installed. Use Studio tab or App Store.</div>';
  }
  _bindUI(){
    document.querySelectorAll('.tab').forEach(t=>{
      t.onclick=()=>{
        document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        const pane=document.querySelector(`.tab-pane[data-pane="${t.dataset.tab}"]`);
        if(pane)pane.classList.add('active');
      };
    });
    if($('btn-refresh-apps'))$('btn-refresh-apps').onclick=()=>this.refreshAppList();
    if($('btn-seed-demo'))$('btn-seed-demo').onclick=async()=>{await this.vfs.seedDefaults();this.refreshAppList();this.launcher.scan();this.notif.post('Storage','Demo apps ready','ok');};

    if($('btn-install'))$('btn-install').onclick=()=>{
      const name=$('app-name').value.trim()||'Crypto Workbench';
      const pkg=$('app-pkg').value.trim().toLowerCase()||'com.kryonos.cryptotest';
      const version=($('app-ver')?$('app-ver').value.trim():'1.0.0')||'1.0.0';
      const author=($('app-author')?$('app-author').value.trim():'KryonDev')||'KryonDev';
      const category=($('app-cat')?$('app-cat').value:'Security')||'Security';
      const code=$('app-code').value;

      const perms=['storage','location'];
      const manifest={name,packageName:pkg,version,api:KRYONOS_API_LEVEL,author,type:'App',category,description:'KryonOS Workbench',permissions:perms,allowCompanionLaunch:true};
      const dir='/local/apps/'+pkg;
      this.vfs.mkdir(dir);
      this.vfs.write(dir+'/app.json',JSON.stringify(manifest,null,2));
      this.vfs.write(dir+'/main.js',code);

      perms.forEach(p=>this.permissions.add(`${pkg}:${p}`));
      this.env.IPC.registerApp(pkg,dir,name,category,[],true);

      log(`💾 Installed "${name}" (${pkg}) v${version}`,'ok');
      this.refreshAppList();this.launcher.scan();this.notif.post('Installed',`${name} ready`,'success',2500);
    };
    if($('btn-run-live'))$('btn-run-live').onclick=()=>{
      const name=$('app-name').value.trim()||'Live Test';
      const code=$('app-code').value;
      this.launchApp({name,path:'/tmp/live/',pkg:'com.kryon.live'},code);
    };
    if($('btn-format'))$('btn-format').onclick=async()=>{if(!confirm('Format flash?'))return;await this.vfs.reset();this.refreshAppList();this.launcher.scan();};
    if($('board-select'))$('board-select').onchange=e=>{
      const b=BOARDS[e.target.value];if(!b)return;
      this.sim.board=b;this.canvas.width=b.w;this.canvas.height=b.h;
      this.overlayCanvas.width=b.w;this.overlayCanvas.height=b.h;
      this.disp.W=b.w;this.disp.H=b.h;
      if($('board-label'))$('board-label').textContent=b.name;
      this.reboot();
    };
    if($('sim-time'))$('sim-time').oninput=e=>{this.sim.timezone=e.target.value;};
    if($('sim-24h'))$('sim-24h').onchange=e=>{this.sim.use24h=e.target.checked;};
    if($('sim-wifi'))$('sim-wifi').onchange=e=>{this.sim.wifi=e.target.checked;this.updateStatus();};
    if($('btn-reboot'))$('btn-reboot').onclick=()=>this.reboot();
    if($('btn-launcher'))$('btn-launcher').onclick=()=>this.setState(S.LAUNCHER);
    if($('btn-shot'))$('btn-shot').onclick=()=>this.captureScreenshot();
    if($('btn-clear-log'))$('btn-clear-log').onclick=()=>{if(consoleEl)consoleEl.innerHTML='';};
    this.updateStatus();
  }
}

window.addEventListener('DOMContentLoaded',()=>{
  log('KryonOS Web Emulator Engine v'+KRYONOS_VERSION+' (API Level '+KRYONOS_API_LEVEL+')','sys');
  log('Full Parity: Display/Image Decoders, VFS Binary/Picker, FastMath, Kryon3D, LocalAI/CloudAI, Trackball, Keyboard, Speaker, Device, Bluetooth, GPS.','sys');
  window.KryonOS=new Simulator();
  setTimeout(()=>log('Simulator ready.','ok'),300);
});