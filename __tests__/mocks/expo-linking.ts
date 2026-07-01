// Stub de expo-linking para el entorno de test (Node, sin app nativa).
export function createURL(path: string): string {
  return `safetruck://${path}`
}
export function openURL(_url: string): Promise<void> {
  return Promise.resolve()
}
export default { createURL, openURL }
