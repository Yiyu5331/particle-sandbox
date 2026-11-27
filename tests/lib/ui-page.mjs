// 用真实单文件加载管理器和模式。无头环境只替代画布像素接口及浏览器帧时钟。
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { parse } from 'acorn';
import assert from 'node:assert/strict';

export async function openUIPage() {
  const html = readFileSync(process.env.PARTICLE_TEST_HTML || new URL('../../dist/particle-sandbox.html',import.meta.url),'utf8');
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  parse(js,{ecmaVersion:'latest',sourceType:'script'});
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=/i);
  const page = new Window({url:'http://localhost/?nowarm=1&nogl=1',settings:{enableJavaScriptEvaluation:true}});
  try {
    const doc = page.document;
    doc.write(html.replace(/<script>[\s\S]*?<\/script>/,''));
    // happy-dom 缺少此宿主 API；本夹具的 localStorage 路径只克隆 JSON 数据。
    page.structuredClone=page.eval('(value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))');
    page.MessageChannel = class { port1 = {}; port2 = {postMessage:()=>this.port1.onmessage?.()}; };
    page.HTMLCanvasElement.prototype.getContext = function() { return {canvas:this,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},fillRect(){},drawImage(){},clearRect(){},strokeRect(){},setLineDash(){}}; };
    page.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AQID';
    const queue = [], phases = new Set(); let time = 0;
    page.requestAnimationFrame = fn => { queue.push(fn); return queue.length; };
    const manager = page.eval(js + '\ngame;');
    async function frames(n,dt=16) {
      for (let i=0;i<n;i++) {
        const progress = doc.querySelector('[data-screen="loading"] progress');
        if (progress) phases.add(progress.value);
        time += dt; queue.splice(0).forEach(fn=>fn(time)); await new Promise(r=>setImmediate(r));
      }
    }
    const click = (label,host = doc.querySelector('#ui-screen')) => {
      const b = [...host.querySelectorAll('button')].find(n=>n.textContent.startsWith(label));
      assert.ok(b,'找不到按钮 '+label); b.click();
    };
    const press = (key,el = doc.activeElement) => el.dispatchEvent(new page.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    // 启动需要等候真实的异步档案读取，再驱动其余渲染阶段。
    const deadline = Date.now()+5000;
    do { await frames(1); await new Promise(r=>setTimeout(r,2)); }
    while (doc.querySelector('#ui-screen').dataset.screen==='loading' && Date.now()<deadline);
    assert.notEqual(doc.querySelector('#ui-screen').dataset.screen,'loading');
    assert.ok(manager.profile, '档案服务必须成功启动');
    return {page,doc,manager,frames,phases,click,press,screen:()=>doc.querySelector('#ui-screen').dataset.screen};
  } catch (e) { await page.happyDOM.close(); throw e; }
}
