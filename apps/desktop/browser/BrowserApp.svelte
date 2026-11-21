<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ClientApp from '@frostime/pi-client/ui';
  import { presentationStore } from '@frostime/pi-client/ui/state/sessionViewStore.svelte';
  import { postToHost } from '@frostime/pi-client/ui/bridge/hostBridge';
  import { withFrostPiCommands } from '@frostime/pi-client/ui/features/composer/frostPiCommands';
  import { DESKTOP_CLIENT_UI_CAPABILITIES } from '../src/shared/desktopCapabilities';
  import { quickPickMatches } from '../src/renderer/quickPick';
  import VscodeLabel from '../src/renderer/VscodeLabel.svelte';
  import WorkspaceFiles from './WorkspaceFiles.svelte';
  import { send } from './transport';
  let error = $state(''),
    question = $state<any>(null),
    input = $state(''),
    workspace = $state(''),
    link = $state('');
  const capabilities = {
    ...DESKTOP_CLIENT_UI_CAPABILITIES,
    openReferencedLocation: true,
  };
  const commands = {
    completions: withFrostPiCommands,
    handle: ({ text, hasImages }) =>
      !hasImages && text.trim() === '/resume'
        ? {
            draft: 'clear',
            execute: () => postToHost({ type: 'resumeSession' }),
          }
        : undefined,
  };
  onMount(() => {
    const handlers = {
      'connection-error': (e) => (error = e.detail),
      'frostpi:projects:view': (e) =>
        (workspace =
          e.detail.projects.find((p) => p.id === e.detail.activeProjectId)
            ?.name ?? ''),
      'frostpi:dialog:view': (e) => {
        question = e.detail;
        input = e.detail?.value ?? '';
      },
      'browser:dialog': (e) => {
        question = e.detail;
        input = '';
      },
      'browser:message': (e) => (error = e.detail),
      'frostpi:resume:view': (e) => {
        if (e.detail?.phase === 'failed') error = e.detail.error;
      },
      'frostpi:settings:open': () =>
        (error =
          'Open Settings in the sandbox manager to change the sandbox configuration.'),
      'browser:link': (e) => (link = e.detail),
      'browser:clipboard': (e) =>
        navigator.clipboard
          .writeText(e.detail)
          .catch(
            () => (error = 'Your browser blocked copying to the clipboard.'),
          ),
    };
    for (const [event, handler] of Object.entries(handlers))
      window.addEventListener(event, handler);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        window.removeEventListener(event, handler);
    };
  });
  function answer(value: string | null) {
    if (!question) return;
    void send(
      question.native ? 'browser:response' : 'frostpi:dialog:response',
      question.id,
      value,
    );
    question = null;
  }
  function show(dialog: HTMLDialogElement) {
    dialog.showModal();
    tick().then(() => dialog.querySelector<HTMLInputElement>('input')?.focus());
  }
</script>

<div class="layout">
  <aside aria-label="Conversations">
    <header>
      <div><strong>FrostPi</strong><small>{workspace}</small></div>
      <WorkspaceFiles />
    </header>
    {#if $presentationStore.sessions.length}
      <div class="actions">
        <button onclick={() => postToHost({ type: 'createSession' })}>
          New chat
        </button>
        <button onclick={() => postToHost({ type: 'resumeSession' })}>
          Resume…
        </button>
      </div>
    {/if}
    <nav aria-label="Open chats">
      {#each $presentationStore.sessions as session (session.id)}
        <button
          class:active={session.id === $presentationStore.activeSessionId}
          onclick={() =>
            postToHost({ type: 'activateSession', sessionId: session.id })}
        >
          {session.title}
        </button>
      {/each}
    </nav>
  </aside>
  <section class="client" aria-label="Conversation">
    <ClientApp localComposerCommands={commands} {capabilities} />
  </section>
</div>
{#if link}<div class="notice">
    <a href={link} target="_blank" rel="noopener noreferrer">Open link</a>
    <button onclick={() => (link = '')}>Close</button>
  </div>{/if}
{#if error}<div role="status" class="notice">
    {error}
    <button aria-label="Dismiss message" onclick={() => (error = '')}>×</button>
  </div>{/if}
{#if question}
  {#key question.id}
    <dialog
      use:show
      oncancel={(event) => {
        event.preventDefault();
        answer(null);
      }}
      aria-labelledby="question-title"
    >
      <h2 id="question-title">{question.title}</h2>
      {#if question.prompt}<p>{question.prompt}</p>{/if}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (question.kind === 'input') answer(input);
        }}
      >
        {#if question.kind === 'input' || question.kind === 'pick'}<input
            aria-label={question.kind === 'pick'
              ? 'Filter choices'
              : question.title}
            bind:value={input}
            placeholder={question.placeholder ?? ''}
          />{/if}
        {#if question.error}<p role="alert">{question.error}</p>{/if}
        {#each (question.items ?? []).filter((item) => !input || question.kind !== 'pick' || quickPickMatches(item, input, question)) as item}
          {#if item.separator}<h3>{item.label}</h3>{:else}
            <button
              type="button"
              class="choice"
              onclick={() => answer(item.id)}
            >
              <VscodeLabel label={item.label} />{#if item.description}<small>
                  {item.description}
                </small>{/if}{#if item.detail}<small>{item.detail}</small>{/if}
            </button>
          {/if}
        {/each}
        <footer>
          <button type="button" onclick={() => answer(null)}>
            Cancel
          </button>{#if question.kind === 'input'}<button>Continue</button>{/if}
        </footer>
      </form>
    </dialog>
  {/key}
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }
  .layout {
    display: grid;
    grid-template-columns: clamp(13rem, 19vw, 18rem) minmax(0, 1fr);
    height: 100dvh;
  }
  aside {
    padding: 1rem;
    background: var(--vscode-sideBar-background);
    border-right: 1px solid var(--vscode-widget-border);
    overflow: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }
  header strong {
    font-size: 1.15rem;
  }
  small {
    display: block;
    color: var(--vscode-descriptionForeground);
    overflow-wrap: anywhere;
  }
  .actions,
  footer {
    display: flex;
    gap: 0.5rem;
    margin: 1rem 0;
  }
  .client {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .client :global(.frostpi-root) {
    flex: 1;
    min-width: 0;
  }
  button,
  input {
    font: inherit;
    color: inherit;
  }
  button {
    background: var(--vscode-button-secondaryBackground);
    border: 0;
    border-radius: 0.3rem;
    padding: 0.4rem 0.7rem;
    cursor: pointer;
  }
  nav button,
  .choice {
    display: block;
    width: 100%;
    text-align: left;
    margin: 0.25rem 0;
  }
  nav button {
    background: transparent;
  }
  nav button.active {
    background: var(--vscode-list-activeSelectionBackground);
  }
  dialog,
  .notice {
    background: var(--vscode-editorWidget-background);
    color: inherit;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 0.5rem;
    padding: 1rem;
  }
  dialog {
    width: min(30rem, 82vw);
    max-height: 80vh;
    overflow: auto;
  }
  dialog::backdrop {
    background: #0009;
  }
  input {
    padding: 0.4rem;
    background: var(--vscode-input-background);
    width: 100%;
    box-sizing: border-box;
  }
  .notice {
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    max-width: 90vw;
    z-index: 1000;
  }
  footer {
    justify-content: flex-end;
  }
  @media (max-width: 680px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }
    aside {
      padding: 0.5rem 0.8rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .actions {
      margin: 0;
    }
    nav {
      max-height: 3.6rem;
      min-width: 0;
      overflow: auto;
    }
    header small {
      display: none;
    }
  }
</style>
