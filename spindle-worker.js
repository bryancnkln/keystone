/* ------------------------------------------------------------
 *  Spindle Worker – DMA controller for tool results
 * ------------------------------------------------------------ */

// Import constants from neural-engine.js for consistency
const RING_SLOTS = 32;  // Must match neural-engine.js
const FACET_SIZE = 512; // Must match neural-engine.js
const RING_HEADER_SIZE = 16; // 4×Uint32

let ringHeader = null;
let ringSlots  = null;

// ------------------------------------------------------------
// Initialise with shared buffers
function init(mindBuffer, ringBuffer){
  // Validate buffer sizes
  if(!ringBuffer || ringBuffer.byteLength < RING_HEADER_SIZE + RING_SLOTS * FACET_SIZE * 4) {
    throw new Error('Ring buffer too small');
  }

  // Initialize ring buffer views
  ringHeader = new Uint32Array(ringBuffer,0,4);
  ringSlots  = new Float32Array(ringBuffer,RING_HEADER_SIZE,RING_SLOTS*FACET_SIZE);

  // Initialize header values
  Atomics.store(ringHeader,0,0); // head
  Atomics.store(ringHeader,1,0); // tail
  Atomics.store(ringHeader,2,0); // generation
  Atomics.store(ringHeader,3,0); // flags

  postMessage({ type:'initialized' });
}

// ------------------------------------------------------------
// Lock‑free head rotation
function rotateHead(){
  let head, next;
  do{
    head = Atomics.load(ringHeader,0);
    next = (head+1)%RING_SLOTS;
    const tail = Atomics.load(ringHeader,1);
    if(next===tail) throw new Error('Ring buffer full');
  }while(Atomics.compareExchange(ringHeader,0,head,next)!==head);
  if(next===0) Atomics.add(ringHeader,2,1); // generation++
  return head; // Return the old head position (where to write)
}

// ------------------------------------------------------------
// Push a vector into the ring buffer
function pushEmbedding(emb){
  if(!ringSlots) throw new Error('Worker not initialised');
  if(emb.length!==FACET_SIZE)
    throw new Error(`Embedding must be ${FACET_SIZE}`);
  const idx = rotateHead();
  ringSlots.set(emb, idx*FACET_SIZE);
  return idx;
}

// ------------------------------------------------------------
// Deterministic string → unit vector (demo only)
function encodeString(str, toolId){
  const emb = new Float32Array(FACET_SIZE);
  let hash=0;
  for(let i=0;i<str.length;++i){
    hash = ((hash<<5)-hash)+str.charCodeAt(i);
    hash|=0;
  }
  let rng = hash + toolId*31337;
  for(let i=0;i<FACET_SIZE;++i){
    rng = (rng*1664525+1013904223)>>>0;
    emb[i] = (rng/4294967296)*2-1; // [-1,1]
  }
  // normalise
  let sum=0;
  for(let i=0;i<FACET_SIZE;++i) sum+=emb[i]*emb[i];
  const norm=Math.sqrt(sum);
  if(norm>0) for(let i=0;i<FACET_SIZE;++i) emb[i]/=norm;
  return emb;
}

// ------------------------------------------------------------
// Message handler - aligned with neural-engine.js API
const messageHandler = e=>{
  const { type, payload } = e.data;
  try{
    switch(type){
      case 'init':
        init(payload.mindBuffer, payload.ringBuffer);
        postMessage({ type:'initialized' });
        break;
      case 'pushToolResult':
        const { result, toolId } = payload;
        const emb = encodeString(result, toolId);
        const idx = pushEmbedding(emb);
        postMessage({ type:'toolResultPushed', payload:{slotIndex:idx, toolId} });
        break;
      case 'pushEmbedding':
        const { embedding, toolId:tid } = payload;
        const idx2 = pushEmbedding(new Float32Array(embedding));
        postMessage({ type:'embeddingPushed', payload:{slotIndex:idx2, toolId:tid} });
        break;
      case 'getStats':
        if(ringHeader){
          postMessage({ type:'stats',
            payload:{ head:Atomics.load(ringHeader,0),
                      tail:Atomics.load(ringHeader,1),
                      generation:Atomics.load(ringHeader,2),
                      available:getAvailableSlots() }});
        }
        break;
      case 'reset':
        if(ringHeader){
          Atomics.store(ringHeader,0,0);
          Atomics.store(ringHeader,1,0);
          Atomics.store(ringHeader,2,0);
          Atomics.store(ringHeader,3,0);
          ringSlots.fill(0);
          postMessage({ type:'resetComplete' });
        }
        break;
      default:
        postMessage({ type:'error', payload:{message:`Unknown message ${type}`}});
    }
  }catch(err){
    postMessage({ type:'error', payload:{message:err.message,stack:err.stack}});
  }
};

// ------------------------------------------------------------
// Helper function to get available slots (slots that can be read)
function getAvailableSlots(){
  if(!ringHeader) return 0;
  const head = Atomics.load(ringHeader,0);
  const tail = Atomics.load(ringHeader,1);
  return head >= tail ? head - tail : RING_SLOTS - tail + head;
}

// Environment detection and export
if (typeof self !== 'undefined') {
  // Web Worker environment
  self.onmessage = messageHandler;
  postMessage({ type:'ready' });
} else if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  module.exports = { messageHandler };
}
