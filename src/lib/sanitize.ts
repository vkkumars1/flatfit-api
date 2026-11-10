// why: strip HTML to stop stored XSS in bios, chats and listings.
export function stripHtml(input: string): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}
