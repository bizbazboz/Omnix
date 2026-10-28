// This document has an opaque sandbox origin. Kernels never run in the application window.
const channel = new URL(location.href).searchParams.get("channel");
const root = new URL("/notebook/python/", location.href).href;
const policy = document.createElement("meta");
policy.httpEquiv = "Content-Security-Policy";
policy.content = `default-src 'none'; script-src ${root} 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${root}; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
document.head.append(policy);
const kernels = new Map();
function send(data) {
  parent.postMessage({ ...data, channel }, "*");
}
function start(language) {
  const source = `const runtimeRoot=${JSON.stringify(root)};
 let python=null;let used=0;let lines=0;let capturing=false;
 const post=self.postMessage.bind(self);
 function text(value){if(value===undefined)return '';if(typeof value==='string')return value;try{return JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v)??String(value);}catch{return String(value);}}
 function output(value,error=false){if(!capturing)return;let line=text(value);if(used>=65536||lines>=1000)return;lines++;const available=65536-used;line=line.slice(0,available);used+=Math.max(1,line.length);post({type:'output',text:line,error});if(used>=65536)post({type:'output',text:'[Output truncated at 64 KiB]',error:true});}
 Object.assign(self.console,{log:(...args)=>output(args.map(text).join(' ')),info:(...args)=>output(args.map(text).join(' ')),warn:(...args)=>output(args.map(text).join(' '),true),error:(...args)=>output(args.map(text).join(' '),true),debug:(...args)=>output(args.map(text).join(' '))});
 self.onmessage=async event=>{used=0;lines=0;capturing=false;const {language,code}=event.data;try{
  if(language==='python'){
   if(!python){post({type:'loading'});importScripts(runtimeRoot+'pyodide.js');python=await loadPyodide({indexURL:runtimeRoot,fullStdLib:true});python.setStdin({stdin:()=>null});}
   python.setStdout({batched:line=>output(line)});python.setStderr({batched:line=>output(line,true)});
   capturing=true;post({type:'running'});const result=await python.runPythonAsync(code);
   if(result!==undefined && result!==null){output(typeof result==='object'&&result.toString?result.toString():result);result?.destroy?.();}
  }else{
   const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
   capturing=true;post({type:'running'});const result=await new AsyncFunction(code)();if(result!==undefined)output(result);
  }
  post({type:'done'});
 }catch(error){capturing=true;output(error?.stack||String(error),true);post({type:'done',failed:true});}};`;
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  const kernel = { worker, active: null };
  worker.onmessage = (event) => {
    if (!kernel.active) return;
    const data = event.data;
    if (!["output", "loading", "running", "done"].includes(data?.type)) return;
    send({
      type: data.type,
      id: kernel.active.id,
      language,
      text: typeof data.text === "string" ? data.text.slice(0, 66000) : "",
      error: Boolean(data.error),
      failed: Boolean(data.failed)
    });
    if (data.type === "done") kernel.active = null;
  };
  worker.onerror = (event) => {
    if (kernel.active) {
      send({
        type: "output",
        id: kernel.active.id,
        language,
        text: event.message || "Kernel failed.",
        error: true
      });
      send({ type: "done", id: kernel.active.id, language, failed: true });
      kernel.active = null;
    }
    worker.terminate();
    kernels.delete(language);
  };
  kernels.set(language, kernel);
  return kernel;
}
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== channel) return;
  const { type, language, id, code } = event.data;
  if (!["python", "javascript"].includes(language)) return;
  if (type === "reset") {
    kernels.get(language)?.worker.terminate();
    kernels.delete(language);
    return;
  }
  if (type !== "run" || typeof code !== "string" || code.length > 200000)
    return;
  const kernel = kernels.get(language) || start(language);
  if (kernel.active) return;
  kernel.active = { id };
  kernel.worker.postMessage({ language, code });
});
send({ type: "ready" });
