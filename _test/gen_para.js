(async()=>{
  const {PDFDocument, rgb}=PDFLib;
  const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
  const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
  const font=await doc.embedFont(fb.bytes,{subset:true});
  const page=doc.addPage([595,842]);
  const size=12, lead=20, left=72, maxW=595-144;
  const paras=[
    '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。',
    '（二）保险标的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗，自然磨损所造成的损失和费用；',
    '（三）需经常更换的工具和配件（如：打击锤、钻头、皮带、绳索、金属线等）、易损的玻璃配件（如：挡风玻璃、倒车镜、灯泡等）的单独损坏，以及车身表面油漆单独划伤所造成的损失和费用；',
    '（四）保险标的发动机进水后导致发动机的损失。'
  ];
  const wrap=(t,lim)=>{
    const out=[]; let line='';
    for(const ch of t){ const s=line+ch; if(font.widthOfTextAtSize(s,size)>lim&&line){ out.push(line); line=ch; } else line=s; }
    if(line) out.push(line); return out;
  };
  let y=780;
  paras.forEach((p,pi)=>{
    const ls=wrap(p, pi===0?maxW-size*2:maxW);
    ls.forEach((t,k)=>{ page.drawText(t,{x:left+(k===0&&pi===0?size*2:0), y, size, font, color:rgb(0,0,0)}); y-=lead; });
    y-=lead*0.4;
  });
  const bytes=await doc.save();
  let bin='';
  for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
  return btoa(bin);
})()
