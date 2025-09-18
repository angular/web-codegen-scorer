/** Converts a screenshot PNG URL to a PNG buffer with the image contents. */
export async function screenshotUrlToPngBuffer(screenshotPngUrl: string) {
  // Note: In practice this is a base64 data URL, but `fetch` conveniently
  // allows us to extract the content for writing a PNG to disk.
  const screenshotContent = await (await fetch(screenshotPngUrl)).arrayBuffer();
  return Buffer.from(screenshotContent);
}
