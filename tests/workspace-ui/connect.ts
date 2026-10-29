export const streamCalls: {signal:AbortSignal;agentIds:string[]}[]=[];
type Event={agent?:{agentId:string;status:number;eventId:string};latestReport?:unknown};
let deliver: ((value:IteratorResult<Event>)=>void)|undefined;
export function emitStatus(event:Event) { if(!deliver)throw new Error('no live stream waiting');const receive=deliver;deliver=undefined;receive({done:false,value:event}); }
const clients = {browser:{
  watchAgentStatus(request:{agentIds:string[]},options:{signal:AbortSignal}) {
   streamCalls.push({signal:options.signal,agentIds:request.agentIds});
   return {
    [Symbol.asyncIterator]() { return this; },
    next():Promise<IteratorResult<Event>> {
     if(options.signal.aborted)return Promise.resolve({done:true,value:undefined});
     return new Promise(resolve=>{
      const finish=(value:IteratorResult<Event>)=>{options.signal.removeEventListener('abort',abort);resolve(value);};
      const abort=()=>{deliver=undefined;finish({done:true,value:undefined});};
      deliver=finish;options.signal.addEventListener('abort',abort,{once:true});
     });
    },
   };
  },
 }};
export function useConnect() { return clients; }

