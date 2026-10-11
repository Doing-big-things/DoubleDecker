// The handle the web app exposes for tests (see packages/web/src/main.tsx).
declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: the page's internals are untyped from here
    __decker: { store: { getState(): any }; camera: any };
  }
}
export {};
