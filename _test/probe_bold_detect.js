/* 验证行级字体检测：edLexStream/edScanTextOps 的 node 复刻，对真实保单第 1 页 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const V = path.join(__dirname, '..', 'renderer', 'vendor');
globalThis.DOMMatrix = class DOMMatrix { constructor(){ this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; } };
globalThis.Path2D = class Path2D { moveTo(){} lineTo(){} bezierCurveTo(){} arc(){} rect(){} closePath(){} };
globalThis.ImageData = class ImageData { constructor(a,b,c){ this.data=a; this.width=b; this.height=c; } };
const PDFLib = require(path.join(V, 'pdf-lib.min.js'));
const pdfjsLib = require(path.join(V, 'pdf.min.js'));
globalThis.pdfjsWorker = require(path.join(V, 'pdf.worker.min.js'));

const PN = () => PDFLib.PDFName, PD = () => PDFLib.PDFDict;

function normKey(k){
  const s = (k==null) ? '' : k;
  return String(s).replace(/^[^\w]+/, '');
}
function lex(str){
  const out=[]; let i=0; const n=str.length;
  while(i<n){
    const c=str[i];
    if(c==='%'){ while(i<n && str[i]!=='\n' && str[i]!=='\r') i++; continue; }
    if(c==='('){
      let depth=1, j=i+1, s='';
      while(j<n && depth>0){
        const ch=str[j];
        if(ch==='\\'){ s+=ch+(str[j+1]||''); j+=2; continue; }
        if(ch==='(') depth++;
        else if(ch===')'){ depth--; if(!depth) break; }
        s+=ch; j++;
      }
      out.push({t:'s', v:s}); i=j+1; continue;
    }
    if(c==='<'){ const j=str.indexOf('>', i); out.push({t:'h', v:str.slice(i+1, j<0?n:j).replace(/\s+/g,'')}); i=(j<0?n:j)+1; continue; }
    if(c==='['){ out.push({t:'['}); i++; continue; }
    if(c===']'){ out.push({t:']'}); i++; continue; }
    if(c==='/'){ let j=i+1; while(j<n && !/[\s\[\]<>(){}%]/.test(str[j])) j++; out.push({t:'n', v:str.slice(i+1, j)}); i=j; continue; }
    if(/[A-Za-z'"*]/.test(c)){ let j=i+1; while(j<n && !/[\s\[\]<>(){}%]/.test(str[j])) j++; out.push({t:'n', v:str.slice(i, j)}); i=j; continue; }
    if(/[-\d+.]/.test(c)){ let j=i+1; while(j<n && /[-\d.]+/.test(str[j])) j++; out.push({t:'num', v:parseFloat(str.slice(i,j))}); i=j; continue; }
    i++;
  }
  return out;
}
function scanOps(str){
  const toks=lex(str);
  const ops=[]; let lm={x:0,y:0}, tl=0, font=null;
  const stack=[];
  for(let i=0;i<toks.length;i++){
    const t=toks[i];
    if(t.t!=='n') continue;
    const op=t.v;
    if(op==='Tf'){ const nm=toks[i-2]; font=(nm&&nm.t==='n')?nm.v:font; }
    else if(op==='Tm'){ const f=toks[i-1]; if(f&&f.t==='num') lm={x:(toks[i-2]&&toks[i-2].v)||0, y:f.v}; }
    else if(op==='Td'||op==='TD'){ const ty=toks[i-1]; if(ty&&ty.t==='num'){ lm.y+=ty.v; if(op==='TD') tl=-ty.v; } }
    else if(op==='TL'){ const ty=toks[i-1]; if(ty&&ty.t==='num') tl=ty.v; }
    else if(op==='T*'){ lm.y-=tl; }
    else if(op==='q'){ stack.push({lm,tl,font}); }
    else if(op==='Q'){ const s=stack.pop(); if(s){lm=s.lm;tl=s.tl;font=s.font;} }
    else if(op==='Tj'||op==="'"){
      const s=toks[i-1];
      const cnt=(s&&s.t==='h')?Math.ceil(s.v.length/2):(s&&s.t==='s'?s.v.length:1);
      if(font) ops.push({y:lm.y, font, count:Math.max(1,cnt)});
      if(op==="'") lm.y-=tl;
    }
    else if(op==='TJ'){
      let cnt=0, j=i-1;
      while(j>=0 && toks[j].t!==']'){ if(toks[j].t==='h') cnt+=toks[j].v.length/2; else if(toks[j].t==='s') cnt+=toks[j].v.length; j--; }
      if(font) ops.push({y:lm.y, font, count:Math.max(1,cnt)});
    }
  }
  return ops;
}
function inflate(s){
  let b = Buffer.from(s.getContents());
  try { const f = s.dict.get(PN().of('Filter')); if (f && String(f).includes('Flate')) b = zlib.inflateSync(b); } catch(e){}
  return b.toString('latin1');
}

(async () => {
  const bytes = fs.readFileSync('C:/Users/Administrator/Desktop/苏M34412-2026年工程机械保单.pdf');
  const doc = await PDFLib.PDFDocument.load(bytes);
  const page = doc.getPages()[0];

  // 字体资源映射
  const map = new Map();
  const res = page.node.Resources();
  const fonts = res.lookup(PN().of('Font'), PD());
  for (const [k, v] of fonts.entries()) {
    const d = doc.context.lookup(v);
    let nm = '';
    try { const bf = d.get(PN().of('BaseFont')); if (bf) nm = bf.asString ? bf.asString() : String(bf); } catch(e){}
    map.set(normKey(k.encodedName), nm);
  }
  console.log('map:', [...map.entries()].map(([k,v])=>k+'->'+v).join(' ; '));

  const cont = doc.context.lookup(page.node.Contents());
  const txt = inflate(cont);
  const ops = scanOps(txt).map(o => ({...o, font: map.get(normKey(o.font)) || o.font}));
  console.log('ops:', ops.length, 'sample:', JSON.stringify(ops.slice(0,3)));

  // pdf.js 行 y 对照
  const jc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), cMapUrl: path.join(V,'cmaps','/'), cMapPacked: true, standardFontDataUrl: path.join(V,'standard_fonts','/') }).promise;
  const jp = await jc.getPage(1);
  const tc = await jp.getTextContent();
  // 按行分组
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    items.push({x: it.transform[4], y: it.transform[5], w: it.width, h: Math.hypot(it.transform[2]||0, it.transform[3]||0) || it.height || 10, str: it.str, fn: it.fontName});
  }
  items.sort((a,b)=>b.y-a.y || a.x-b.x);
  const lines = [];
  for (const it of items) {
    let L = null;
    for (const l of lines) { if (Math.abs(l.y-it.y) <= Math.max(3, l.h*0.45)) { L=l; break; } }
    if (L) { L.items.push(it); L.h=Math.max(L.h, it.h); }
    else lines.push({y: it.y, h: it.h, items:[it]});
  }
  for (const L of lines) {
    L.text = L.items.map(i=>i.str).join('');
    L.x = Math.min(...L.items.map(i=>i.x));
    L.x2 = Math.max(...L.items.map(i=>i.x+i.w));
  }
  console.log('=== 行匹配 ===');
  for (const L of lines.slice(0, 8)) {
    const tol = Math.max(1.5, L.h*0.7);
    const cand = ops.filter(o=>Math.abs(o.y-L.y)<=tol);
    const vote = new Map();
    for (const o of cand) vote.set(o.font, (vote.get(o.font)||0)+o.count);
    let bf='', bv=0; for (const [f,c] of vote) if(c>bv){bv=c;bf=f;}
    const bold = /bold|black|heavy|dark|semib/i.test(bf);
    console.log(`y=${L.y.toFixed(1)} tol=${tol.toFixed(1)} -> ${bf||'(none)'} bold=${bold} | ${L.text.slice(0,18)}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
