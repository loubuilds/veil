import test from 'node:test';import assert from 'node:assert/strict';import {positionedGlyphs} from '../src/glyphs.mjs';
const O=Object.fromEntries(['setFont','setTextMatrix','showText','moveText','transform','save','restore','setCharSpacing','setWordSpacing','setHScale','setTextRise','setLeading','nextLine','setLeadingMoveText','beginText','setTextRenderingMode','setGState','paintFormXObjectBegin','paintFormXObjectEnd','beginGroup','endGroup'].map((s,i)=>[s,i+1]));
const g=unicode=>({unicode,width:500,isSpace:unicode===' '});
const item=(extra={})=>({str:'AB',fontName:'f',dir:'ltr',width:10,transform:[10,0,0,10,20,50],...extra});
const match=(rows,font={})=>positionedGlyphs({fnArray:rows.map(r=>O[r[0]]),argsArray:rows.map(r=>r.slice(1))},O,()=>font);
const base=(matrix=[1,0,0,1,20,50])=>[['setFont','f',10],['setTextMatrix',matrix],['showText',[g('A'),g('B')]]];
test('normal exact geometry resolves; reflected vertical orientation must stay locked',()=>{
 assert(match(base()).resolve(item()));
 assert.equal(match(base([1,0,0,-1,20,50])).resolve(item({transform:[10,0,0,-10,20,50]})),null);
});
test('nonfinite item geometry and invalid renderer font must stay locked',()=>{
 assert.equal(match(base()).resolve(item({transform:[10,0,0,10,NaN,50]})),null);
 assert.equal(match(base()).resolve(item({width:Infinity,transform:[10,0,0,Infinity,20,50]})),null);
 assert.equal(match(base(),{isInvalidPDFjsFont:true}).resolve(item()),null);
});
test('Td uses text line position independently of preceding glyph advance',()=>{
 const m=match([['setFont','f',10],['setTextMatrix',[1,0,0,1,20,50]],['showText',[g('A')]],['moveText',8,0],['showText',[g('B')]]]);
 const spans=m.resolve(item({str:'A B',width:13}));assert(spans);assert(Math.abs(spans[2].start-8/13)<1e-9);
 assert.equal(m.resolve(item({str:'A B',width:18})),null);
});
test('horizontal scaling spacing rise and numeric adjustments use verified absolute positions',()=>{
 const m=match([['setFont','f',10],['setTextMatrix',[1,0,0,1,20,50]],['setHScale',200],['setCharSpacing',1],['setTextRise',3],['showText',[g('A'),100,g('B')]]]);
 const spans=m.resolve(item({width:20,transform:[20,0,0,10,20,53]}));assert(spans);assert.equal(spans[0].end,.5);assert.equal(spans[1].start,.5);
});
test('ambiguous overlays ligatures rotated text and forms fail conservatively',()=>{
 const twice=[...base(),...base()];assert.equal(match(twice).resolve(item()),null);
 assert.equal(match([['setFont','f',10],['setTextMatrix',[1,0,0,1,20,50]],['showText',[{unicode:'AB',width:1000}]]]).resolve(item()),null);
 assert.equal(match(base([0,1,-1,0,20,50])).resolve(item()),null);
 assert.equal(match([...base(),['paintFormXObjectBegin']]).resolve(item()),null);
});
