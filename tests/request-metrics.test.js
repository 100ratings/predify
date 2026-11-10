import test from 'node:test';
import assert from 'node:assert/strict';
import {metricKey,countAttempt,countResult,mergeMetrics,metricCount} from '../request-metrics.js';
test('requests, responses and failures are separate counters, payload size does not multiply calls',()=>{
 const m={},k=metricKey('spotify','playlist-items','PUT');
 countAttempt(m,k,20);countResult(m,k,200,80);
 countAttempt(m,k,20);countResult(m,k,429,90);
 countAttempt(m,k,20);countResult(m,k,null,200);
 assert.equal(metricCount(m,'spotify'),3);
 assert.deepEqual(m[k],{attempts:3,responses:2,successes:1,httpErrors:1,networkErrors:1,totalMs:370,maxMs:200,itemsSubmitted:60,statuses:{200:1,429:1}});
 assert.equal(metricCount(mergeMetrics(m,m),'spotify'),6);
});
test('metric merging cannot export unknown keys or arbitrary strings',()=>{
 const result=mergeMetrics({'private-token':{attempts:5},'spotify|search|GET':{attempts:2,body:'secret',statuses:{secret:1,200:2}}});
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.equal(metricCount(result,'spotify'),2);
});
