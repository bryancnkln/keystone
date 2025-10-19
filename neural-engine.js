/* ------------------------------------------------------------
 *  Neural Engine – zero‑allocation, lock‑free architecture
 * ------------------------------------------------------------ */

/* ---------- Constants & Enums --------------------------------- */
const MIND_SIZE_BYTES  = 64 * 1024;          // 64 KB
const FACET_SIZE       = 512;                // 512 floats per facet (2 kB)
const NUM_FACETS       = 16;
const RING_SLOTS       = 32;                 // tool result slots
const RING_SIZE_BYTES  = RING_SLOTS * FACET_SIZE * 4;
const RING_HEADER_SIZE = 16;                 // 4×Uint32

/** @enum {number} */
const FacetType = Object.freeze({
  INTENT:      0,    // Facet index 0
  CONTEXT:     1,    // Facet index 1
  EMOTION:     2,    // Facet index 2
  ACTION:      3,    // Facet index 3
  MEMORY:      4,    // Facet index 4
  TOOLS:       5,    // Facet index 5
  META:        6,    // Facet index 6
  QUERY:       7,    // Facet index 7
  RESPONSE:    8,    // Facet index 8
  CONFIDENCE:  9,    // Facet index 9
  ATTENTION:   10,   // Facet index 10
  ERROR:       11,   // Facet index 11
  LEARNING:    12,   // Facet index 12
  THRESHOLD:   13,   // Facet index 13
  RESERVED_A:  14,   // Facet index 14
  RESERVE_B:   15    // Facet index 15
});

/* ---------- SIMD‑friendly Ops --------------------------------- */
class SIMDOpsService {
  constructor() { this.simdSupport = this.detectSIMDSupport(); }

  detectSIMDSupport(){
    try{
      const mod = new WebAssembly.Module(
        new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
      );
      WebAssembly.instantiate(mod);
      return true;
    }catch{ return false; }
  }

  cosineSimilarity(a,b){
    if(a.length!==FACET_SIZE||b.length!==FACET_SIZE)
      throw new Error(`Vectors must be ${FACET_SIZE} floats`);
    let dot=0, na=0, nb=0;
    for(let i=0;i<FACET_SIZE;i+=4){
      const a0=a[i],a1=a[i+1],a2=a[i+2],a3=a[i+3];
      const b0=b[i],b1=b[i+1],b2=b[i+2],b3=b[i+3];
      dot += a0*b0 + a1*b1 + a2*b2 + a3*b3;
      na  += a0*a0 + a1*a1 + a2*a2 + a3*a3;
      nb  += b0*b0 + b1*b1 + b2*b2 + b3*b3;
    }
    const denom = Math.sqrt(na*nb);
    return denom===0?0:dot/denom;
  }

  addScaled(target, source, scale){
    for(let i=0;i<FACET_SIZE;i+=4){
      target[i]   += source[i]*scale;
      target[i+1] += source[i+1]*scale;
      target[i+2] += source[i+2]*scale;
      target[i+3] += source[i+3]*scale;
    }
  }

  normalize(v){
    let sum=0; for(let i=0;i<FACET_SIZE;++i) sum+=v[i]*v[i];
    const norm=Math.sqrt(sum);
    if(norm>0){
      const inv=1/norm;
      for(let i=0;i<FACET_SIZE;++i) v[i]*=inv;
    }
  }

  clipGradient(g,max){
    let sum=0; for(let i=0;i<FACET_SIZE;++i) sum+=g[i]*g[i];
    const norm=Math.sqrt(sum);
    if(norm>max){
      const scale=max/norm;
      for(let i=0;i<FACET_SIZE;++i) g[i]*=scale;
    }
  }

  softmax(v){
    let max=v[0];
    for(let i=1;i<FACET_SIZE;++i) if(v[i]>max) max=v[i];
    let sum=0;
    for(let i=0;i<FACET_SIZE;++i){ v[i]=Math.exp(v[i]-max); sum+=v[i]; }
    const inv=1/sum;
    for(let i=0;i<FACET_SIZE;++i) v[i]*=inv;
  }

  relu(v){
    for(let i=0;i<FACET_SIZE;i+=4){
      v[i]   = Math.max(0,v[i]);
      v[i+1] = Math.max(0,v[i+1]);
      v[i+2] = Math.max(0,v[i+2]);
      v[i+3] = Math.max(0,v[i+3]);
    }
  }

  benchmark(fn,iters=1e4){
    const t0 = performance.now();
    for(let i=0;i<iters;++i) fn();
    const t1 = performance.now();
    return ((t1-t0)/iters)*1000; // μs/op
  }

  hasSIMDSupport(){ return this.simdSupport; }
}

/* ---------- NeuralMind – 64 KB SRAM bank ---------------------- */
class NeuralMindService {
  constructor(){
    if(typeof SharedArrayBuffer==='undefined')
      throw new Error('SharedArrayBuffer not supported');
    this.mind = new SharedArrayBuffer(MIND_SIZE_BYTES);
    this.mindView = new Float32Array(this.mind);

    this.facetViews   = new Array(NUM_FACETS);
    this.lastSnapshot = new Array(NUM_FACETS);

    for(let i=0;i<NUM_FACETS;++i){
      const off = i*FACET_SIZE*4;
      this.facetViews[i]   = new Float32Array(this.mind, off, FACET_SIZE);
      this.lastSnapshot[i] = new Float32Array(FACET_SIZE);
    }
  }

  getFacet(idx){ 
    if(idx<0||idx>=NUM_FACETS) throw new Error(`Invalid facet ${idx}`); 
    return this.facetViews[idx]; 
  }

  readFacet(idx, dst){ if(dst.length!==FACET_SIZE) throw new Error(`Target must be ${FACET_SIZE}`); dst.set(this.getFacet(idx)); }

  writeFacet(idx, src){ if(src.length!==FACET_SIZE) throw new Error(`Source must be ${FACET_SIZE}`); this.getFacet(idx).set(src); }

  applyGradient(facet, delta, lr, mom=0){
    if(delta.length!==FACET_SIZE) throw new Error(`Delta must be ${FACET_SIZE}`);
    const target = this.getFacet(facet);
    const snap   = this.lastSnapshot[facet];
    for(let i=0;i<FACET_SIZE;++i){
      const prev = target[i]-snap[i];
      target[i] += lr*delta[i] + mom*prev;
      snap[i]   = target[i];
    }
  }

  reset(){ this.mindView.fill(0); for(const s of this.lastSnapshot) s.fill(0); }

  resetFacet(idx){ const t=this.getFacet(idx); t.fill(0); this.lastSnapshot[idx].fill(0); }

  snapshot(){
    const map = new Map();
    for(let i=0;i<NUM_FACETS;++i){ const copy=new Float32Array(FACET_SIZE); copy.set(this.getFacet(i)); map.set(i,copy); }
    return { timestamp:performance.now(), facets:map };
  }

  getSharedBuffer(){ return this.mind; }
  getRawView(){ return this.mindView; }

  getMemoryUsage(){ return { allocated:MIND_SIZE_BYTES, used:MIND_SIZE_BYTES, overhead:0 }; }
}

/* ---------- RingBuffer – lock‑free circular buffer ------------- */
class RingBufferService {
  constructor(){
    const total = RING_HEADER_SIZE + RING_SIZE_BYTES;
    this.ring = new SharedArrayBuffer(total);

    this.header = new Uint32Array(this.ring,0,4); // head, tail, gen, flags
    this.slots  = new Float32Array(this.ring,RING_HEADER_SIZE,RING_SLOTS*FACET_SIZE);

    Atomics.store(this.header,0,0); // head
    Atomics.store(this.header,1,0); // tail
    Atomics.store(this.header,2,0); // generation
    Atomics.store(this.header,3,0);
  }

  /** Reserve a slot, write the embedding, return its index */
  push(embedding){
    if(embedding.length!==FACET_SIZE) throw new Error(`Embedding must be ${FACET_SIZE}`);
    let head, next;
    do{
      head = Atomics.load(this.header,0);
      next = (head+1)%RING_SLOTS;
      const tail = Atomics.load(this.header,1);
      if(next===tail) throw new Error('Ring buffer full');
    }while(Atomics.compareExchange(this.header,0,head,next)!==head);

    const offset = head*FACET_SIZE;
    this.slots.set(embedding,offset);
    if(next===0) Atomics.add(this.header,2,1); // wrap → gen++
    return head;
  }

  /** Read the next slot (null if empty) */
  readNext(){
    const head = Atomics.load(this.header,0);
    const tail = Atomics.load(this.header,1);
    if(head===tail && Atomics.load(this.header,2)===0) return null;

    const slotIdx = tail;
    const offset  = slotIdx*FACET_SIZE;
    const view = new Float32Array(this.ring,RING_HEADER_SIZE+offset*4,FACET_SIZE);

    const nextTail = (tail+1)%RING_SLOTS;
    Atomics.store(this.header,1,nextTail);
    return view;
  }

  getSlot(idx){ 
    if(idx<0||idx>=RING_SLOTS) throw new Error(`Index ${idx} out of bounds`); 
    const off=idx*FACET_SIZE; 
    return new Float32Array(this.ring,RING_HEADER_SIZE+off*4,FACET_SIZE); 
  }

  readSlot(idx,dst){ 
    if(dst.length!==FACET_SIZE) throw new Error(`Target must be ${FACET_SIZE}`); 
    dst.set(this.getSlot(idx)); 
  }

  getHead(){ return Atomics.load(this.header,0); }
  getTail(){ return Atomics.load(this.header,1); }
  getGeneration(){ return Atomics.load(this.header,2); }

  isFull(){ const next=(this.getHead()+1)%RING_SLOTS; return next===this.getTail() && Atomics.load(this.header,2)>0; }

  available(){ const h=this.getHead(), t=this.getTail(); return h>=t?h-t:RING_SLOTS-t+h; }

  reset(){ Atomics.store(this.header,0,0); Atomics.store(this.header,1,0); Atomics.store(this.header,2,0); Atomics.store(this.header,3,0); this.slots.fill(0); }

  getSharedBuffer(){ return this.ring; }

  *iterate(){
    const head=this.getHead();
    let cur=this.getTail();
    while(cur!==head){
      yield this.getSlot(cur);
      cur=(cur+1)%RING_SLOTS;
    }
  }

  getMemoryUsage(){ const total=RING_HEADER_SIZE+RING_SIZE_BYTES; return { allocated:total, used:this.available()*FACET_SIZE*4, overhead:RING_HEADER_SIZE }; }
}

/* ---------- Prometheus – threshold monitor --------------------- */
class PrometheusService {
  constructor(mind, simd){
    this.mind = mind;
    this.simd = simd;

    this.thresholds   = new Map();
    this.lastStates   = new Map();
    this.handlers     = new Map();

    this.monitoring = false;
    this.intervalId = null;

    const defaultCfg = { threshold:0.7, learningRate:0.01, momentum:0.9 };

    const monitored = [FacetType.INTENT, FacetType.CONTEXT,
                       FacetType.EMOTION, FacetType.ACTION,
                       FacetType.ERROR];

    for(const f of monitored){
      this.thresholds.set(f, { facet:f, ...defaultCfg });
      const buf = new Float32Array(FACET_SIZE);
      this.lastStates.set(f,buf);
      this.handlers.set(f,[]);
      mind.readFacet(f,buf); // snapshot
    }

    console.log('[Prometheus] Initialized');
  }

  start(intervalMs=1){
    if(this.monitoring) return;
    this.monitoring = true;
    this.intervalId = setInterval(()=>this.check(),intervalMs);
  }

  stop(){
    if(!this.monitoring) return;
    this.monitoring = false;
    clearInterval(this.intervalId);
  }

  check(){
    const now=performance.now();
    for(const [f,cfg] of this.thresholds){
      const curr = this.mind.getFacet(f);
      const last = this.lastStates.get(f);

      const sim = this.simd.cosineSimilarity(curr,last);
      if(sim < cfg.threshold){
        const delta = new Float32Array(FACET_SIZE);
        for(let i=0;i<FACET_SIZE;++i) delta[i] = curr[i]-last[i];

        const intr={ facet:f, similarity:sim, delta, timestamp:now };
        this.fire(intr);
        last.set(curr);
        this.adapt(f,sim);
      }
    }
  }

  fire(intr){
    const h = this.handlers.get(intr.facet) || [];
    for(const fn of h){
      try{fn(intr);}catch(e){console.error('[Prometheus] handler error',e);}
    }
  }

  adapt(facet,observed){
    const cfg = this.thresholds.get(facet);
    if(!cfg) return;
    const err  = cfg.threshold - observed;
    const upd  = cfg.learningRate * err;
    let newThr = cfg.threshold - upd; // move toward observed (subtract to decrease when observed is lower)
    newThr = Math.max(0.5,Math.min(0.95,newThr));
    cfg.threshold = newThr;
  }

  onInterrupt(facet, fn){ this.handlers.get(facet)?.push(fn); }

  setThreshold(cfg){ this.thresholds.set(cfg.facet,cfg);
    if(!this.lastStates.has(cfg.facet)){
      const buf=new Float32Array(FACET_SIZE);
      this.lastStates.set(cfg.facet,buf);
      this.mind.readFacet(cfg.facet,buf);
    }
  }

  getThreshold(facet){ return this.thresholds.get(facet); }

  snapshot(facet){
    if(facet!==undefined) this.mind.readFacet(facet, this.lastStates.get(facet));
    else for(const [f,buf] of this.lastStates) this.mind.readFacet(f,buf);
  }

  getStats(){
    let totalHandlers=0,totalThr=0;
    for(const h of this.handlers.values()) totalHandlers+=h.length;
    for(const cfg of this.thresholds.values()) totalThr+=cfg.threshold;
    return { monitoring:this.monitoring,
             facetsMonitored:this.thresholds.size,
             handlersRegistered:totalHandlers,
             avgThreshold:this.thresholds.size?totalThr/this.thresholds.size:0 };
  }

  destroy(){ this.stop(); }
}

/* ---------- NeuralRouter – vector‑based tool selector ----------- */
class NeuralRouterService {
  constructor(mind, ring, simd){
    this.mind   = mind;
    this.ring   = ring; 
    this.simd   = simd;
    this.toolMap=[];
  }

  initializeToolMap(tools){
    this.toolMap = tools.map(t=>({
      ...t,
      centroid:new Float32Array(t.centroid),
      hitCount:t.hitCount||0,
      accuracy:t.accuracy||0
    }));
  }

  route(){
    if(!this.toolMap.length) throw new Error('Tool map not initialized');
    const start = performance.now();
    const intent = this.mind.getFacet(FacetType.INTENT);
    let best=0,bestSim=-Infinity;
    for(let i=0;i<this.toolMap.length;++i){
      const sim = this.simd.cosineSimilarity(intent,this.toolMap[i].centroid);
      if(sim>bestSim){ bestSim=sim; best=i;}
    }
    const intentCopy = new Float32Array(FACET_SIZE);
    intentCopy.set(intent);
    const latency = (performance.now()-start)*1000; // μs
    return { toolId:this.toolMap[best].toolId, confidence:bestSim,
             intentVector:intentCopy, latency };
  }

  routeTopK(k){
    if(!this.toolMap.length) throw new Error('Tool map not initialized');
    const intent = this.mind.getFacet(FacetType.INTENT);
    const cand=this.toolMap.map((t,i)=>({index:i, sim:this.simd.cosineSimilarity(intent,t.centroid)}));
    cand.sort((a,b)=>b.sim-a.sim);
    const intentCopy=new Float32Array(FACET_SIZE); intentCopy.set(intent);
    return cand.slice(0,k).map(c=>({ toolId:this.toolMap[c.index].toolId,
                                     confidence:c.sim, intentVector:intentCopy }));
  }

  updateTool(toolId, feedback, lr=0.01){
    const t=this.toolMap.find(t=>t.toolId===toolId);
    if(!t){ 
      console.warn(`[NeuralRouter] Tool ${toolId} not found`); 
      return;
    }
    if(feedback.length!==FACET_SIZE) {
      throw new Error(`Feedback must be ${FACET_SIZE} floats`);
    }
    for(let i=0;i<FACET_SIZE;++i){
      const delta = feedback[i]-t.centroid[i];
      t.centroid[i] += lr*delta;
    }
    this.simd.normalize(t.centroid);
    t.hitCount++;
  }

  recordAccuracy(toolId, correct){
    const t=this.toolMap.find(t=>t.toolId===toolId);
    if(!t) return;
    const alpha=0.1;
    t.accuracy = alpha*(correct?1:0)+(1-alpha)*t.accuracy;
  }

  getToolStats(toolId){ return this.toolMap.find(t=>t.toolId===toolId); }
  getAllToolStats(){ return [...this.toolMap]; }

  benchmark(iter=1000){
    const lat=[];
    for(let i=0;i<iter;++i){ const s=performance.now(); this.route(); lat.push(performance.now()-s); }
    const sum=lat.reduce((a,b)=>a+b,0);
    const avg=sum/iter;
    return { avgLatencyMs:avg, minLatencyMs:Math.min(...lat), maxLatencyMs:Math.max(...lat),
             throughputRps:1000/avg };
  }
}

/* ---------- Export / Global ----------------------------------- */
if(typeof module!=='undefined' && typeof module.exports!=='undefined'){
  module.exports = { SIMDOpsService, NeuralMindService, RingBufferService,
                    PrometheusService, NeuralRouterService,
                    FacetType, FACET_SIZE };
}else{
  window.NeuralEngine = { SIMDOpsService, NeuralMindService, RingBufferService,
                          PrometheusService, NeuralRouterService,
                          FacetType, FACET_SIZE };
}
