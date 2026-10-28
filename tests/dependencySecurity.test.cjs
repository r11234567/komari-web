const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { realpathSync } = require('node:fs');
const { resolve } = require('node:path');
const rollupRequire = createRequire(require.resolve('@rollup/plugin-node-resolve'));
const merge = rollupRequire('deepmerge');

test('Rollup actually resolves the reviewed local security patch', () => {
 assert.equal(realpathSync(rollupRequire.resolve('deepmerge')), realpathSync(resolve('vendor/deepmerge/index.cjs')));
});
test('GHSA-gcqx-w48m-w2h4: target own __proto__ cannot poison result prototype', () => {
 const target = JSON.parse('{"__proto__":{"poisoned":true},"safe":1}');
 const vulnerable = {};
 for (const key of Object.keys(target)) vulnerable[key] = target[key];
 assert.equal(vulnerable.poisoned,true,'negative control must reproduce the unsafe assignment');
 const result = merge(target,{other:2});
 assert.equal(Object.getPrototypeOf(result),Object.prototype);
 assert.equal(result.poisoned,undefined);
 assert.equal(Object.prototype.poisoned,undefined);
 assert.equal(Object.hasOwn(result,'__proto__'),true);
 assert.deepEqual(result.__proto__,{poisoned:true});
});
test('GHSA-gcqx-w48m-w2h4: null-prototype target and nested sources remain safe', () => {
 const source=JSON.parse('{"__proto__":{"poisoned":true},"nested":{"__proto__":{"poisoned":true},"ok":1}}');
 const result=merge(Object.create(null),source);
 assert.equal(Object.getPrototypeOf(result),Object.prototype);
 assert.equal(result.poisoned,undefined);
 assert.equal(Object.getPrototypeOf(result.nested),Object.prototype);
 assert.equal(result.nested.poisoned,undefined);
 assert.equal(result.nested.ok,1);
});
test('existing clone, array, symbol and custom merge behavior remains compatible', () => {
 const symbol=Symbol('config');
 const left={options:{one:true},items:[1],[symbol]:{left:true}};
 const right={options:{two:true},items:[2],[symbol]:{right:true}};
 assert.deepEqual(merge(left,right),{options:{one:true,two:true},items:[1,2],[symbol]:{left:true,right:true}});
 assert.deepEqual(merge.all([{a:1},{b:2}]),{a:1,b:2});
 assert.deepEqual(merge(left,right,{arrayMerge:(_,source)=>source}).items,[2]);
 assert.deepEqual(merge({value:{n:1}},{value:{n:2}},{customMerge: key=>key==='value' ? (a,b)=>({n:a.n+b.n}) : undefined}),{value:{n:3}});
 assert.equal(left.items.length,1);
});
