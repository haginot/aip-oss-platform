import test from 'node:test';import {assuranceBrowser} from './assurance-browser.mjs';
test('real-browser-interaction ENT-118 sla',t=>assuranceBrowser(t,'sla'));
