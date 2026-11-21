<script lang="ts">
  import FileTransfers from './FileTransfers.svelte';
  import FileMarkdown from './FileMarkdown.svelte';
  import { onMount, tick } from 'svelte';

  type Item = { name: string; kind: 'folder' | 'file' | 'link' };
  type View =
    | { kind: 'folder'; items: Item[]; upload: boolean }
    | { kind: 'text'; download?: boolean; text: string; version: string; next: number | null }
    | { kind: 'image' | 'unsupported'; download?: boolean };

  let dialog: HTMLDialogElement;
  let title: HTMLHeadingElement;
  let content: HTMLElement;
  let path = $state('');
  let view = $state<View | null>(null);
  let error = $state('');
  let busy = $state(false);
  let request: AbortController | undefined;
  const parts = $derived(path.split('/').filter(Boolean));
  const url = (name: string) => 'files?' + new URLSearchParams({ path: name });

  async function load(name: string, more = false, focusEntry?: string) {
    request?.abort();
    const current = (request = new AbortController());
    const previous = path;
    if (!more) {
      view = null;
      path = name.replace(/^\/workspace(?:\/|$)/, '');
      if (content) content.scrollTop = 0;
    }
    busy = true;
    error = '';
    try {
      const page =
        more && view?.kind === 'text'
          ? '&' +
            new URLSearchParams({
              offset: String(view.next),
              version: view.version,
            })
          : '';
      const response = await fetch(url(name) + page, { signal: current.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error ?? 'Could not open this file.');
      if (current.signal.aborted) return;
      path = result.path;
      if (more && view?.kind === 'text' && result.kind === 'text') result.text = view.text + result.text;
      view = result;
      await tick();
      if (current.signal.aborted) return;
      if (!more) {
        // Returning to a folder puts keyboard focus back on the row just visited.
        const prefix = path ? path + '/' : '';
        const child = previous.startsWith(prefix) ? previous.slice(prefix.length).split('/')[0] : '';
        const row = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-entry]')).find(
          (button) => button.dataset.entry === (focusEntry ?? child),
        );
        if (result.kind === 'folder') (row ?? title).focus();
        else content.focus({ preventScroll: true });
      } else content.focus({ preventScroll: true });
    } catch (cause) {
      if (!current.signal.aborted)
        error = cause instanceof Error ? cause.message : 'Could not open this file.';
    } finally {
      if (!current.signal.aborted) busy = false;
    }
  }

  function show(name = '') {
    if (!dialog.open) dialog.showModal();
    void load(name);
  }
  onMount(() => {
    function reference(event: Event) {
      show((event as CustomEvent<string>).detail);
    }
    function confirmedLink() {
      if (dialog.open) dialog.close();
    }
    window.addEventListener('browser:link', confirmedLink);
    window.addEventListener('browser:file', reference);
    return () => {
      request?.abort();
      window.removeEventListener('browser:file', reference);
      window.removeEventListener('browser:link', confirmedLink);
    };
  });
</script>

<button class="files-trigger" onclick={() => show()} aria-haspopup="dialog">
  <span class="codicon codicon-folder" aria-hidden="true"></span>Files
</button>

<dialog
  bind:this={dialog}
  aria-labelledby="files-title"
  onclose={() => {
    request?.abort();
    view = null;
    path = '';
  }}
>
  <div class="frame">
    <header>
      <h2 id="files-title" bind:this={title} tabindex="-1">Workspace files</h2>
      <button aria-label="Close file viewer" title="Close" onclick={() => dialog.close()}>
        <span class="codicon codicon-close"></span>
      </button>
    </header>
    <div class="toolbar">
      <nav aria-label="File path">
        {#if parts.length}
          <button onclick={() => load('')}>Workspace</button>
        {:else}<strong aria-current="page">Workspace</strong>{/if}
        {#each parts as part, i}
          <span class="separator" aria-hidden="true">/</span>
          {#if i + 1 === parts.length}<strong aria-current="page">{part}</strong>
          {:else}<button onclick={() => load(parts.slice(0, i + 1).join('/'))}>{part}</button>{/if}
        {/each}
      </nav>
      {#if view?.kind === 'folder' || error}
        <button aria-label="Refresh" title="Refresh" onclick={() => load(path)}>
          <span class="codicon codicon-refresh"></span>
        </button>
      {/if}
    </div>
    <div class="transfer-actions">
      <FileTransfers
        {path}
        upload={view?.kind === 'folder' && view.upload}
        download={!!view && view.kind !== 'folder' && !!view.download}
        onupload={(folder, name) => {
          if (dialog.open && view?.kind === 'folder' && path === folder) void load(folder, false, name);
        }}
      />
    </div>
    <section
      bind:this={content}
      class="content"
      aria-label={view?.kind === 'folder' ? 'Folder contents' : parts.at(-1) || 'File contents'}
      tabindex="-1"
    >
      {#if error}<p role="alert">{error}</p>
      {:else if !view}<p role="status">Loading…</p>
      {:else if view.kind === 'folder'}
        {#each view.items as item (item.name)}
          <button
            class="row"
            data-entry={item.name}
            aria-description={item.kind}
            onclick={() => load(path ? path + '/' + item.name : item.name)}
          >
            <span aria-hidden="true" class={'codicon codicon-' + (item.kind === 'link' ? 'link' : item.kind)}
            ></span>
            <span>{item.name}</span>
            {#if item.kind === 'folder'}<span class="codicon codicon-chevron-right" aria-hidden="true"
              ></span>{/if}
          </button>
        {:else}<p>This folder is empty.</p>{/each}
      {:else if view.kind === 'text'}
        {#if !view.text}<p>This file is empty.</p>
        {:else if /\.(md|markdown)$/i.test(path)}
          <FileMarkdown text={view.text} {path} open={load} />
        {:else}<pre>{view.text}</pre>{/if}
        {#if view.next != null}<button class="more" disabled={busy} onclick={() => load(path, true)}>
            {busy ? 'Loading…' : 'Show more'}
          </button>{/if}
      {:else if view.kind === 'image'}
        <div class="image">
          <img
            src={url(path) + '&image=1'}
            alt={parts.at(-1)}
            onerror={() => (error = 'This image could not be displayed.')}
          />
        </div>
      {:else}<p>This file type has no preview.</p>{/if}
    </section>
  </div>
</dialog>

<style>
  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover {
    background: var(--vscode-list-hoverBackground, #303030);
  }
  button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #659ad2);
    outline-offset: -2px;
  }
  .files-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.38rem 0.6rem;
    background: var(--vscode-button-secondaryBackground);
  }
  dialog {
    inset: 0;
    margin: auto;
    width: min(46rem, calc(100vw - 2rem));
    padding: 0;
    max-width: none;
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 0.65rem;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    box-shadow: 0 1rem 5rem #0006;
    overflow: hidden;
  }
  dialog::backdrop {
    background: #0008;
  }
  .frame {
    height: min(30rem, 78dvh);
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
  }
  header,
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
  }
  header {
    background: var(--vscode-sideBar-background);
  }
  h2 {
    font-family: inherit;
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0;
  }
  h2:focus {
    outline: none;
  }
  header button,
  .toolbar > button {
    display: grid;
    place-items: center;
    flex: none;
    width: 2rem;
    height: 2rem;
  }
  .toolbar {
    min-height: 2rem;
    border-bottom: 1px solid var(--vscode-widget-border, #454545);
  }
  nav {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    min-width: 0;
    gap: 0.25rem;
    overflow-wrap: anywhere;
  }
  nav button,
  nav strong {
    padding: 0.2rem 0.25rem;
    text-align: left;
    overflow-wrap: anywhere;
  }
  nav button,
  .separator {
    color: var(--vscode-descriptionForeground);
  }
  .content {
    overflow: auto;
    padding: 0.6rem;
    overscroll-behavior: contain;
  }
  .content:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #659ad2);
    outline-offset: -2px;
  }
  .row {
    width: 100%;
    padding: 0.55rem 0.7rem;
    display: grid;
    grid-template-columns: 1.2rem 1fr auto;
    gap: 0.55rem;
    align-items: center;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .row .codicon,
  .content p {
    color: var(--vscode-descriptionForeground);
  }
  .row .codicon-folder {
    color: var(--vscode-textLink-foreground);
  }
  .content p,
  pre {
    margin: 0.65rem;
  }
  pre {
    font: 0.9rem/1.6 var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 4;
  }
  .more {
    padding: 0.5rem 0.8rem;
    margin: 0.5rem;
    background: var(--vscode-button-secondaryBackground);
  }
  .image {
    display: grid;
    place-items: center;
    height: 100%;
  }
  img {
    max-width: 100%;
    max-height: 100%;
    min-height: 0;
    object-fit: contain;
  }
  @media (max-width: 680px) {
    dialog {
      width: calc(100vw - 1rem);
    }
    .frame {
      height: 88dvh;
    }
    .files-trigger {
      min-height: 2rem;
    }
    .row,
    header button,
    .toolbar > button {
      min-height: 2.75rem;
    }
  }
</style>
