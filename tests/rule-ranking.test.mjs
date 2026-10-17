import test from 'node:test';
import assert from 'node:assert/strict';
import {queryTokens,rankRuleSources} from '../cloud/lib/rule-answer.mjs';

const pool={id:'municipal#p',documentId:'municipal',componentId:'gm1_3__art_22.27',article:'Artikel 22.27 Uitzonderingen op vergunningplicht',title:'Uitzonderingen op vergunningplicht',text:'Het verbod, bedoeld in artikel 22.26, geldt niet voor een zwembad op het gebouwerf bij een woning, zonder overkapping.',applicability:'point',internalReferences:['art_22.26']};
const restriction={id:'municipal#restriction',documentId:'municipal',componentId:'gm1_3__art_22.28',article:'Artikel 22.28 Inperkingen vanwege cultureel erfgoed',title:'Cultureel erfgoed',text:'Bij een gemeentelijk monument is artikel 22.27 niet van toepassing.',applicability:'point',internalReferences:['art_22.27']};
const base={id:'municipal#base',documentId:'municipal',componentId:'gm1_3__art_22.26',article:'Artikel 22.26 Vergunningplicht',text:'Het is verboden zonder omgevingsvergunning een bouwwerk te bouwen.',applicability:'point'};
const water=Array.from({length:15},(_,i)=>({id:`national#w${i}`,documentId:'national',componentId:`mn1__art_${i}`,article:'Artikel 3.6 Zwemwaterprofiel en zwemwaterkwaliteit',title:'Zwemwaterprofiel zwemwaterkwaliteit',text:'De beheerder van een oppervlaktewaterlichaam actualiseert het zwemwaterprofiel.',applicability:'point'}));

test('pool construction reaches the model before public bathing-water procedures, with base rule and heritage restriction',()=>{
 const result=rankRuleSources({sources:[...water,pool,restriction,base],coverage:{}},'Welche Bedingungen gelten hier für einen Pool?');
 assert.equal(result.sources[0].id,pool.id);assert.ok(result.sources.slice(0,8).some(s=>s.id===base.id));assert.ok(result.sources.slice(0,8).some(s=>s.id===restriction.id));
 assert.ok(!result.sources.some(s=>s.id.startsWith('national#w')));
});

test('an explicit bathing-water question still retrieves public water-quality rules',()=>{
 const result=rankRuleSources({sources:[pool,...water],coverage:{}},'Welke regels gelden voor zwemwaterkwaliteit?');
 assert.ok(result.sources[0].id.startsWith('national#w'));
});

test('short question words do not accidentally activate unrelated topics',()=>{
 const terms=queryTokens('Wat mag ik hier bouwen?');assert.ok(terms.includes('bouw'));assert.ok(!terms.includes('zwemwater'));assert.ok(!terms.includes('hoogte'));
 assert.ok(queryTokens('How can I build here?').includes('bouwen'));
});

test('long excerpts centre the pool clause, remain continuous, and are not trapped by early generic construction terms',()=>{
 const text='Bouw vergunning. '+('Andere bepaling zonder zwembad. '.replace('zwembad','focus').repeat(210))+'Een zwembad bij een woning mag geen overkapping hebben. '+('Andere tekst. '.repeat(400));
 const source={...pool,text};const result=rankRuleSources({sources:[source],coverage:{}},'Can I build a pool here?');
 assert.match(result.sources[0].text,/Een zwembad bij een woning mag geen overkapping hebben/);assert.equal(result.sources[0].excerpt,true);
 assert.ok(text.replace(/\s+/g,' ').includes(result.sources[0].text));assert.ok(result.sources[0].text.length<=4000);
});

test('broad chapter references and unrelated monument rules cannot crowd out directly relevant evidence',()=>{
 const broad={...restriction,id:'municipal#broad',text:'Op dit monument geldt hoofdstuk 22.',internalReferences:['chp_22']};
 const result=rankRuleSources({sources:[pool,...water,broad],coverage:{}},'Pool?');assert.ok(!result.sources.some(s=>s.id===broad.id));
});

