<script lang="ts">
  import { mountMarkdownImages } from '@frostime/pi-client/ui/features/conversation/markdown/mountMarkdownImages';
  import { postToHost } from '@frostime/pi-client/ui/bridge/hostBridge';
  import { renderMarkdownHtml } from '@frostime/pi-client/ui/features/conversation/markdown/renderMarkdown';

  let {
    text,
    path,
    open,
  }: {
    text: string;
    path: string;
    open: (name: string) => void;
  } = $props();

  function local(name: string) {
    return name.startsWith('/') ? name : '/workspace/' + path.slice(0, path.lastIndexOf('/') + 1) + name;
  }

  // Use FrostPi's sanitized Markdown. File links and images are relative to this document.
  function enhance(node: HTMLElement) {
    for (const placeholder of node.querySelectorAll<HTMLElement>('[data-markdown-image]')) {
      const source = placeholder.dataset.imageSource ?? '';
      const alt = placeholder.dataset.imageAlt || 'Image';
      if (!source || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
        // Remote and embedded images follow the same rules as images in chat.
        if (source.startsWith('//')) placeholder.dataset.imageSource = 'https:' + source;
        continue;
      }
      const image = document.createElement('img');
      image.alt = alt;
      image.loading = 'lazy';
      placeholder.removeAttribute('data-markdown-image');
      try {
        image.src = 'files?' + new URLSearchParams({ path: local(decodeURIComponent(source)), image: '1' });
      } catch {
        placeholder.textContent = alt + ' · Invalid image path';
        continue;
      }
      image.onerror = () => {
        placeholder.textContent = alt + ' · Image preview unavailable';
      };
      placeholder.replaceChildren(image);
    }
    const images = mountMarkdownImages(node);
    const click = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor) return;
      event.preventDefault();
      if (anchor.dataset.filePath) open(local(anchor.dataset.filePath));
      else if (anchor.dataset.transcriptUrl)
        postToHost({ type: 'openTranscriptLink', url: anchor.dataset.transcriptUrl });
    };
    node.addEventListener('click', click);
    node.addEventListener('keydown', click);
    return {
      destroy() {
        images.destroy();
        node.removeEventListener('click', click);
        node.removeEventListener('keydown', click);
      },
    };
  }
</script>

{#key text}
  <article class="markdown-body" use:enhance>{@html renderMarkdownHtml(text)}</article>
{/key}

<style>
  article {
    padding: 0.35rem 1rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  article :global(:is(img, table)) {
    max-width: 100%;
  }
  article :global(pre) {
    overflow-x: auto;
  }
  article :global(a[data-transcript-url]) {
    cursor: pointer;
  }
</style>
