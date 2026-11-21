import '@frostime/pi-client/ui/styles';
import '../src/renderer/theme.css';
import { get } from 'svelte/store';
import { presentationStore } from '@frostime/pi-client/ui/state/sessionViewStore.svelte';
import { mount } from 'svelte';
import {
  connectHostBridge,
  onHostMessage,
  postToHost,
} from '@frostime/pi-client/ui/bridge/hostBridge';
import { applyHostMessage } from '@frostime/pi-client/ui/bridge/applyHostMessage';
import BrowserApp from './BrowserApp.svelte';

import type { HostToWebviewMessage } from '@frostime/pi-client/shared/bridge/hostToWebview';
import { send } from './transport';

const listeners = new Set<(message: HostToWebviewMessage) => void>();
connectHostBridge({
  postMessage: (message) => {
    if (message.type === 'openFile') {
      const session = get(presentationStore);
      const cwd = session.displayedSession?.cwd || session.workspacePath;
      const path = message.path.startsWith('/')
        ? message.path
        : cwd + '/' + message.path;
      window.dispatchEvent(new CustomEvent('browser:file', { detail: path }));
      return;
    }
    void send('frostpi:client:in', message);
  },
  onMessage: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
});
mount(BrowserApp, { target: document.querySelector('#app')! });
onHostMessage(applyHostMessage);
const events = new EventSource('events');
events.onmessage = (event) => {
  const [channel, value] = JSON.parse(event.data);
  if (channel === 'frostpi:client:out') {
    for (const listener of listeners) listener(value);
  } else window.dispatchEvent(new CustomEvent(channel, { detail: value }));
};
events.onopen = () => {
  window.dispatchEvent(new CustomEvent('connection-error', { detail: '' }));
  postToHost({ type: 'ready' });
  void send('frostpi:projects:request');
  void send('frostpi:resume:request');
};
events.onerror = () =>
  window.dispatchEvent(
    new CustomEvent('connection-error', {
      detail: 'Reconnecting to the sandbox…',
    }),
  );
