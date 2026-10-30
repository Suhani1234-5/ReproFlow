/// <reference types="vite/client" />

/** CRXJS resolves a content-script source file to its built URL. */
declare module '*?script' {
  const src: string;
  export default src;
}
