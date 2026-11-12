import test from 'node:test';import {assuranceBrowser} from './assurance-browser.mjs';
test('real-browser-interaction ENT-117 resource',t=>assuranceBrowser(t,'resource'));
