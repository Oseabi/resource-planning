/**
 * Hand a file built in the browser to the person as a download.
 *
 * The link is attached to the page while it is clicked and the object URL is
 * released a little later: freeing it straight after click() cancels the
 * download in Firefox and sometimes Safari, which then save nothing at all.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
