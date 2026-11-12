import {test} from 'node:test';import {controlBrowser} from './control-browser.mjs';
test('real-browser-interaction ENT-115 right',t=>controlBrowser(t,'right'));
test('BF-33 real browser strict rights classification read audit and revocation',async()=>{await (await import('./control-browser.mjs')).rightClassificationBrowser();});
