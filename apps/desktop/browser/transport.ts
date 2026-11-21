export async function send(channel: string, ...args: unknown[]) {
  try {
    const result = await fetch('request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    });
    if (!result.ok)
      throw new Error(
        'The request failed. Reopen FrostPi from the sandbox manager.',
      );
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('connection-error', { detail: String(error) }),
    );
  }
}
