<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    path,
    upload,
    download,
    onupload,
  }: {
    path: string;
    upload: boolean;
    download: boolean;
    onupload: (folder: string, name: string) => void;
  } = $props();
  let picker: HTMLInputElement;
  let transfer = $state<AbortController | null>(null);
  let message = $state('');
  let failed = $state(false);
  let messagePath = $state('');

  async function selected() {
    const file = picker.files?.[0];
    if (!file || transfer) return;
    const folder = path;
    picker.value = '';
    failed = false;
    messagePath = folder;
    message = 'Uploading ' + file.name + '…';
    const controller = (transfer = new AbortController());
    try {
      const query = new URLSearchParams({ path: folder, name: file.name });
      const response = await fetch('files?' + query, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error || 'Could not upload this file. Try again.');
      }
      message = 'Uploaded ' + file.name + '.';
      onupload(folder, file.name);
    } catch (error) {
      failed = !controller.signal.aborted;
      message = failed ? (error instanceof Error ? error.message : 'Upload failed.') : 'Upload cancelled.';
    } finally {
      transfer = null;
    }
  }
  onDestroy(() => transfer?.abort());
</script>

{#if upload || download || transfer || (message && path === messagePath)}
  <div class="transfers">
    {#if upload || transfer}
      <input type="file" hidden bind:this={picker} onchange={selected} />
      <button onclick={() => (transfer ? transfer.abort() : picker.click())}>
        {#if transfer}Cancel upload{:else}<span aria-hidden="true" class="codicon codicon-cloud-upload"
          ></span>Upload file…{/if}
      </button>
    {:else if download}
      <a href={'files?' + new URLSearchParams({ path, download: '1' })} download>
        <span aria-hidden="true" class="codicon codicon-cloud-download"></span>Download
      </a>
    {/if}
    {#if message && (transfer || path === messagePath)}
      <span role={failed ? 'alert' : 'status'}>{message}</span>
    {/if}
  </div>
{/if}

<style>
  .transfers {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.4rem 1rem;
  }
  a,
  button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--vscode-foreground);
    font: inherit;
    background: var(--vscode-button-secondaryBackground);
    border: 0;
    border-radius: 0.3rem;
    padding: 0.4rem 0.65rem;
    cursor: pointer;
    text-decoration: none;
  }
  a:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #659ad2);
  }
  [role='status'],
  [role='alert'] {
    overflow-wrap: anywhere;
    color: var(--vscode-descriptionForeground);
  }
  [role='alert'] {
    color: var(--vscode-errorForeground);
  }
</style>
