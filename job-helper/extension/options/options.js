import { mountSetup } from '../lib/setup.js';

mountSetup(document.getElementById('setup'), {
  doneLabel: 'All set! Close this page',
  onDone: () => window.close(),
});
