import test from 'node:test';import {assuranceBrowser} from './assurance-browser.mjs';
test('real-browser-interaction ENT-119 policy',t=>assuranceBrowser(t,'policy'));
