// Stub de expo-web-browser para el entorno de test.
export const WebBrowserPresentationStyle = {
  FULL_SCREEN: 'fullScreen',
  PAGE_SHEET: 'pageSheet',
}
export function openBrowserAsync(_url: string, _opts?: unknown): Promise<{ type: string }> {
  return Promise.resolve({ type: 'dismiss' })
}
export default { WebBrowserPresentationStyle, openBrowserAsync }
