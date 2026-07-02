import type { ZenmailApi } from '../shared/types';

declare global {
  interface Window {
    zenmail: ZenmailApi;
  }
}

export {};
