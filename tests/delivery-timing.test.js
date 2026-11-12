import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanDeliveryTiming,deliveryTimingSummary} from '../delivery-timing.js';
const id='a'.repeat(32);
test('timing export is allowlisted, bounded and does not infer missing milestones',()=>{
 const timing=cleanDeliveryTiming({id,attemptStartedAt:1000,detectedAt:900,word:'private-word',token:'private-token',url:'private-url',requests:Array(20).fill({service:'spotify',startedAt:1100,responseAt:1220,status:200,headers:'private-header'})});
 assert.equal(timing.requests.length,8);assert.equal(JSON.stringify(timing).includes('private'),false);
 assert.equal(timing.confirmedAt,undefined);assert.equal(cleanDeliveryTiming({id,attemptStartedAt:NaN}),null);
 assert.equal(cleanDeliveryTiming({id,attemptStartedAt:1000,requests:[{service:'secret'}]}).requests.length,0);
 assert.doesNotMatch(deliveryTimingSummary(timing),/Atualização confirmada:/);
});
test('timing summary uses server clock milestones and does not claim Spotify screen refresh timing',()=>{
 const timing={id,attemptStartedAt:1000,detectedAt:900,confirmedAt:1300,result:'confirmed',requests:[{service:'spotify',startedAt:1100,responseAt:1220,status:200}]};
 const summary=deliveryTimingSummary(timing);
 assert.match(summary,/Detecção até início do envio: 200 ms/);
 assert.match(summary,/Detecção até confirmação: 400 ms/);
 assert.match(summary,/Não mede quando a palavra chegou ao Inject nem quando a tela do aplicativo Spotify mudou/);
 assert.match(deliveryTimingSummary(null),/próximo envio remoto/);
});
