import {test} from 'node:test';import {controlBrowser} from './control-browser.mjs';
test('real-browser-interaction ENT-116 journey',t=>controlBrowser(t,'journey'));
import {journeyRecoveryBrowser} from './control-browser.mjs';
test('BF-27 real browser two-step reverse recovery and historical recipient',()=>journeyRecoveryBrowser());

import {journeyCancellationRestoreBrowser} from './control-browser.mjs';
test('BF-28 real browser compensation after pre-cancel database restore and author revocation',()=>journeyCancellationRestoreBrowser());

import {journeyRepeatedCancellationRestoreBrowser} from './control-browser.mjs';
test('BF-29 real browser recovery with committed and unresolved repeat cancellation after restore',()=>journeyRepeatedCancellationRestoreBrowser());

import {journeyThreeDepartmentBrowser} from './control-browser.mjs';
test('BF-30 real browser three-department payload boundary and authorized reverse recovery',()=>journeyThreeDepartmentBrowser());

import {journeyCaseBoundaryBrowser} from './control-browser.mjs';
test('BF-31 real browser cross-case offer rejected without disclosure and same-case recovery',()=>journeyCaseBoundaryBrowser());

import {journeyClassificationBrowser} from './control-browser.mjs';
test('BF-32 real browser classification downgrade rejected and strict authorized recovery',()=>journeyClassificationBrowser());
