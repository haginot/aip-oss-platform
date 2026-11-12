import test from 'node:test';import {assuranceBrowser} from './assurance-browser.mjs';
test('real-browser-interaction ENT-120 coverage',t=>assuranceBrowser(t,'coverage'));
