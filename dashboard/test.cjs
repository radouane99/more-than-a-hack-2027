'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseCSV, analyse} = require('./app.js');
// Use synthetic labels to test boundaries without shipping licensed match outputs.
const labels = Array(199319).fill('X');
labels.fill('H',11185,90652);
labels.fill('A',110808,190198);
const csv='frame,label\n'+labels.map((v,i)=>`${i},${v}`).join('\n')+'\n';
const result=analyse(parseCSV(csv));
assert.deepEqual(result.count,{H:79467,A:79390,D:0,X:0});
assert.equal(result.spells.length,2);
assert.throws(()=>parseCSV('frame,label\n0,H'));
assert.throws(()=>parseCSV(csv.replace('0,X','0,Z')));
assert.throws(()=>parseCSV(csv.replace('1,X','0,X')));
assert.equal(analyse(Array(199319).fill('D')).spells.length,0);
console.log('PASS: half boundaries, possession segments, dead-only input, malformed CSV rejection.');
