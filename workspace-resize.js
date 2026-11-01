/* Desktop splitters change presentation only; map ResizeObserver handles both map engines. */
(() => {
  const ranges = {layers:[240,520],search:[340,760],inspector:[360,1000]};
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  function preferences(value) {
    const clean = {};
    for (const key of Object.keys(ranges)) {
      const size = value?.[key];
      if (typeof size === 'number' && Number.isFinite(size) && size > 0) clean[key] = clamp(size,...ranges[key]);
    }
    return clean;
  }
  function fit(width,leftKind,rightOpen,desired={}) {
    width = Math.max(0,Number(width)||0);
    const leftRange = ranges[leftKind] || [0,0], rightRange = rightOpen ? ranges.inspector : [0,0];
    const minMap = Math.max(0,Math.min(320,width-leftRange[0]-rightRange[0]));
    let left = clamp(Number.isFinite(desired[leftKind]) ? desired[leftKind] : leftRange[0],...leftRange);
    let right = clamp(Number.isFinite(desired.inspector) ? desired.inspector : rightRange[0],...rightRange);
    const excess = Math.max(0,left+right+minMap-width),flex = left-leftRange[0]+right-rightRange[0];
    if (excess && flex) {
      left -= Math.min(excess,flex)*(left-leftRange[0])/flex;
      right -= Math.min(excess,flex)*(right-rightRange[0])/flex;
    }
    return {left,right,map:width-left-right,minMap,
      leftMin:leftRange[0],leftMax:Math.max(leftRange[0],Math.min(leftRange[1],width-minMap-right)),
      rightMin:rightRange[0],rightMax:Math.max(rightRange[0],Math.min(rightRange[1],width-minMap-left))};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {fit,preferences};
  if (typeof window === 'undefined') return;

  window.addEventListener('load',() => requestAnimationFrame(() => {
    const workspace=document.querySelector('.workspace'),body=document.body,media=matchMedia('(min-width:901px)');
    const storageKey='planview.desktop.panel-widths.v1';
    const tr=(en,nl,de)=>({nl,de}[document.documentElement.lang]||en);
    let saved={};try { saved=preferences(JSON.parse(localStorage.getItem(storageKey))); } catch {}
    let effective=null,drag=null,frame=0;
    const probe=document.createElement('div');probe.className='pv-width-probe';probe.setAttribute('aria-hidden','true');workspace.append(probe);
    function defaults() {
      const result={};
      for (const [key,variable] of Object.entries({layers:'--layers-width',search:'--journey-search-width',inspector:'--journey-inspector-width'})) {
        probe.style.width=`var(${variable})`;result[key]=probe.getBoundingClientRect().width;
      }
      return result;
    }
    const handles={};
    for (const side of ['left','right']) {
      const handle=document.createElement('div');handle.id=`pv-resize-${side}`;handle.className=`pv-panel-resizer pv-panel-resizer-${side}`;
      handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.tabIndex=0;handle.hidden=true;
      handles[side]=handle;workspace.append(handle);
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0||drag||!media.matches)return;
        event.preventDefault();event.stopPropagation();
        handle.focus({preventScroll:true});
        drag={side,id:event.pointerId,x:event.clientX,start:effective[side],original:{...saved},kind:side==='left'?effective.kind:'inspector',changed:false};
        handle.setPointerCapture(event.pointerId);body.classList.add('pv-panel-resizing');handle.dataset.dragging='true';
      });
      handle.addEventListener('pointermove',event=>{
        if(!drag||drag.side!==side||drag.id!==event.pointerId)return;
        const value=drag.start+(event.clientX-drag.x)*(side==='left'?1:-1);
        saved[drag.kind]=clamp(value,effective[`${side}Min`],effective[`${side}Max`]);drag.changed=true;refresh();
      });
      handle.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finish(true);});
      handle.addEventListener('pointercancel',()=>finish(false));
      handle.addEventListener('lostpointercapture',()=>{if(drag?.side===side)finish(false);});
      handle.addEventListener('click',event=>event.stopPropagation());
      handle.addEventListener('dblclick',event=>{event.preventDefault();reset(side);});
      handle.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        if(event.key==='Enter'){reset(side);return;}
        const kind=side==='left'?effective.kind:'inspector',step=event.shiftKey?48:16;
        const change=(event.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*step;
        const value=event.key==='Home'?effective[`${side}Min`]:event.key==='End'?effective[`${side}Max`]:effective[side]+change;
        saved[kind]=clamp(value,effective[`${side}Min`],effective[`${side}Max`]);refresh();persist();
      });
    }
    function persist(){try {localStorage.setItem(storageKey,JSON.stringify(saved));}catch {}}
    function finish(commit){
      if(!drag)return;const previous=drag;drag=null;
      if(!commit)saved=previous.original;
      delete handles[previous.side].dataset.dragging;body.classList.remove('pv-panel-resizing');
      if(handles[previous.side].hasPointerCapture(previous.id))handles[previous.side].releasePointerCapture(previous.id);
      if(commit&&previous.changed)persist();refresh();
    }
    function reset(side){delete saved[side==='left'?effective.kind:'inspector'];refresh();persist();}
    function refresh(){
      frame=0;body.classList.toggle('pv-desktop-layout',media.matches);
      const collection=body.dataset.workspace==='collection',kind=body.dataset.left==='layers'?'layers':body.dataset.left==='research'?'search':null;
      const rightOpen=body.dataset.inspector==='open'&&!collection;
      if(drag&&(!media.matches||collection||drag.kind!==(drag.side==='left'?kind:rightOpen?'inspector':null))){finish(false);return;}
      handles.left.hidden=!media.matches||!kind||collection;handles.right.hidden=!media.matches||!rightOpen;
      if(!media.matches)return;
      effective={...fit(workspace.clientWidth,collection?null:kind,rightOpen,{...defaults(),...saved}),kind};
      body.style.setProperty('--pv-left-size',`${effective.left}px`);body.style.setProperty('--pv-right-size',`${effective.right}px`);
      body.style.setProperty('--pv-splitter-top',`${document.querySelector('.map-stage').offsetTop}px`);
      for(const side of ['left','right']){
        const handle=handles[side],label=side==='right'?tr('Site details width','Breedte locatiegegevens','Breite der Standortdetails'):kind==='search'?tr('Search width','Zoekbreedte','Breite der Suche'):tr('Layers width','Lagenbreedte','Breite der Ebenen');
        handle.setAttribute('aria-label',label);handle.setAttribute('aria-controls',side==='right'?'detail-panel':kind==='search'?'advanced-panel':'sidebar');
        for(const [attribute,key] of [['aria-valuenow',side],['aria-valuemin',`${side}Min`],['aria-valuemax',`${side}Max`]])handle.setAttribute(attribute,String(Math.round(effective[key])));
        handle.title=tr('Drag to resize · Double-click to reset · Arrow keys to adjust','Sleep om te schalen · Dubbelklik om te herstellen · Pas aan met de pijltjestoetsen','Ziehen zum Vergrößern oder Verkleinern · Doppelklick zum Zurücksetzen · Mit Pfeiltasten anpassen');
      }
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(refresh);}
    new ResizeObserver(schedule).observe(workspace);
    new MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:['data-left','data-inspector','data-workspace']});
    window.addEventListener('resize',()=>{if(drag)finish(false);schedule();});
    window.addEventListener('blur',()=>finish(false));
    window.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);}},true);
    window.addEventListener('planview-language-change',schedule);media.addEventListener('change',schedule);refresh();
  }));
})();
