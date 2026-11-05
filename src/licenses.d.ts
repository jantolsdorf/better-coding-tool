// The licenses of the bundled third-party packages, made at build time (build/licenses.ts).
declare module 'virtual:third-party-licenses' {
  const licenses: { name: string; version: string; license: string; homepage?: string; text: string }[];
  export default licenses;
}
